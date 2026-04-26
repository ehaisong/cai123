-- 1. 默认店铺配置占位（值为 null 时表示未配置）
INSERT INTO public.app_settings(key, value)
VALUES ('default_shop_id', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. 代理升级为指定商家的代理
CREATE OR REPLACE FUNCTION public.become_agent_for_merchant(_merchant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT;
  v_existing RECORD;
  v_merchant RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT id, status INTO v_merchant FROM public.merchants WHERE id = _merchant_id;
  IF NOT FOUND OR v_merchant.status <> 'approved' THEN
    RAISE EXCEPTION '商家不存在或未通过审核';
  END IF;

  -- 商家本人不能成为自己的代理
  IF EXISTS (SELECT 1 FROM public.merchants WHERE id = _merchant_id AND user_id = v_uid) THEN
    RAISE EXCEPTION '商家本人无法申请代理';
  END IF;

  SELECT is_agent, bound_merchant_id INTO v_existing FROM public.agent_relations WHERE user_id = v_uid;
  IF v_existing.is_agent = true AND v_existing.bound_merchant_id IS NOT NULL
     AND v_existing.bound_merchant_id <> _merchant_id THEN
    RAISE EXCEPTION '您已是其他商家的代理，请先到目标商家店铺切换归属';
  END IF;

  SELECT user_code INTO v_code FROM public.profiles WHERE user_id = v_uid;
  UPDATE public.agent_relations
     SET is_agent = true,
         agent_code = v_code,
         bound_merchant_id = _merchant_id
   WHERE user_id = v_uid;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;
  RETURN v_code;
END;
$$;

-- 3. 代理切换归属商家
CREATE OR REPLACE FUNCTION public.switch_agent_merchant(_merchant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_merchant RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT id, status, user_id INTO v_merchant FROM public.merchants WHERE id = _merchant_id;
  IF NOT FOUND OR v_merchant.status <> 'approved' THEN
    RAISE EXCEPTION '商家不存在或未通过审核';
  END IF;
  IF v_merchant.user_id = v_uid THEN
    RAISE EXCEPTION '商家本人无法成为代理';
  END IF;
  UPDATE public.agent_relations
     SET is_agent = true,
         bound_merchant_id = _merchant_id,
         upline_id = NULL,
         upline_l2_id = NULL
   WHERE user_id = v_uid;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

-- 4. 重写 bind_referrer：买家可被多家商家引流（最近一次为准），代理身份不被覆盖
CREATE OR REPLACE FUNCTION public.bind_referrer(_agent_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_my RECORD;
  v_target_merchant UUID;
  v_upline RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT * INTO v_my FROM public.agent_relations WHERE user_id = v_uid;

  -- 商家直码：M_<merchant_id>
  IF _agent_code LIKE 'M\_%' ESCAPE '\' THEN
    v_target_merchant := (SUBSTR(_agent_code, 3))::uuid;
    -- 代理身份：不修改 bound_merchant_id（代理归属保持稳定）
    IF v_my.is_agent = true THEN
      RETURN false;
    END IF;
    UPDATE public.agent_relations
       SET bound_merchant_id = v_target_merchant
     WHERE user_id = v_uid;
    RETURN true;
  END IF;

  -- 代理推荐码：profiles.user_code
  SELECT p.id, p.user_id INTO v_upline FROM public.profiles p WHERE p.user_code = _agent_code;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_upline.user_id = v_uid THEN RETURN false; END IF;

  -- 取上线代理所属商家
  SELECT bound_merchant_id INTO v_target_merchant
    FROM public.agent_relations WHERE user_id = v_upline.user_id;

  -- 代理身份不修改归属（保持稳定）
  IF v_my.is_agent = true THEN
    RETURN false;
  END IF;

  -- 仅当未绑定上线时写入上线（上线一旦确定不再覆盖，避免乱分成）
  IF v_my.upline_id IS NULL THEN
    UPDATE public.agent_relations SET
      upline_id = v_upline.id,
      upline_l2_id = (SELECT upline_id FROM public.agent_relations WHERE user_id = v_upline.user_id),
      bound_merchant_id = v_target_merchant
    WHERE user_id = v_uid;
    UPDATE public.profiles SET referrer_id = v_upline.id WHERE user_id = v_uid;
  ELSE
    -- 已有上线：仅更新当前浏览商家
    UPDATE public.agent_relations SET bound_merchant_id = v_target_merchant
     WHERE user_id = v_uid;
  END IF;

  RETURN true;
END;
$$;