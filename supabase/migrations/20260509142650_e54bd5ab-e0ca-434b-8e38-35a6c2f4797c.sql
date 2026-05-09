-- 代理-商家多绑定关系表（每个代理可同时绑定多个商家，但只有一个活跃）
CREATE TABLE IF NOT EXISTS public.agent_merchant_bindings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, merchant_id)
);
CREATE INDEX IF NOT EXISTS idx_amb_user ON public.agent_merchant_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_amb_merchant ON public.agent_merchant_bindings(merchant_id);

ALTER TABLE public.agent_merchant_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY amb_admin_all ON public.agent_merchant_bindings
  FOR ALL USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY amb_select_self ON public.agent_merchant_bindings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY amb_select_merchant_owner ON public.agent_merchant_bindings
  FOR SELECT USING (EXISTS(
    SELECT 1 FROM public.merchants m WHERE m.id = agent_merchant_bindings.merchant_id AND m.user_id = auth.uid()
  ));

-- 回填：把现有 bound_merchant_id 写入 bindings
INSERT INTO public.agent_merchant_bindings(user_id, merchant_id)
SELECT user_id, bound_merchant_id FROM public.agent_relations
WHERE is_agent = true AND bound_merchant_id IS NOT NULL
ON CONFLICT (user_id, merchant_id) DO NOTHING;

-- 修改：申请成为商家代理时，移除"已绑定其他商家"限制，并写入 bindings
CREATE OR REPLACE FUNCTION public.become_agent_for_merchant(_merchant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF EXISTS (SELECT 1 FROM public.merchants WHERE id = _merchant_id AND user_id = v_uid) THEN
    RAISE EXCEPTION '商家本人无法申请代理';
  END IF;

  SELECT is_agent, bound_merchant_id INTO v_existing FROM public.agent_relations WHERE user_id = v_uid;
  SELECT user_code INTO v_code FROM public.profiles WHERE user_id = v_uid;

  -- 已是该店代理：直接返回
  IF v_existing.is_agent = true AND v_existing.bound_merchant_id = _merchant_id THEN
    INSERT INTO public.agent_merchant_bindings(user_id, merchant_id) VALUES (v_uid, _merchant_id)
      ON CONFLICT DO NOTHING;
    RETURN v_code;
  END IF;

  -- 是其他商家代理：只新增绑定，不切换活跃商家（让用户在「我的商家」页主动切换）
  IF v_existing.is_agent = true AND v_existing.bound_merchant_id IS NOT NULL
     AND v_existing.bound_merchant_id <> _merchant_id THEN
    INSERT INTO public.agent_merchant_bindings(user_id, merchant_id) VALUES (v_uid, _merchant_id)
      ON CONFLICT DO NOTHING;
    RETURN v_code;
  END IF;

  -- 新代理或未绑定：成为代理且设为活跃
  UPDATE public.agent_relations
     SET is_agent = true,
         agent_code = v_code,
         bound_merchant_id = _merchant_id
   WHERE user_id = v_uid;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;
  INSERT INTO public.agent_merchant_bindings(user_id, merchant_id) VALUES (v_uid, _merchant_id)
    ON CONFLICT DO NOTHING;
  RETURN v_code;
END;
$function$;

-- 修改：切换归属，同时写入 bindings
CREATE OR REPLACE FUNCTION public.switch_agent_merchant(_merchant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  INSERT INTO public.agent_merchant_bindings(user_id, merchant_id) VALUES (v_uid, _merchant_id)
    ON CONFLICT DO NOTHING;
  RETURN true;
END;
$function$;

-- 我的已绑定商家列表（包含店名/头像/是否活跃）
CREATE OR REPLACE FUNCTION public.agent_my_bound_merchants()
 RETURNS TABLE(merchant_id uuid, shop_name text, shop_avatar_url text, status merchant_status, is_active boolean, bound_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_active uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT bound_merchant_id INTO v_active FROM public.agent_relations WHERE user_id = v_uid;
  RETURN QUERY
  SELECT m.id, m.shop_name, m.shop_avatar_url, m.status,
         (m.id = v_active) AS is_active,
         b.created_at
  FROM public.agent_merchant_bindings b
  JOIN public.merchants m ON m.id = b.merchant_id
  WHERE b.user_id = v_uid
  ORDER BY (m.id = v_active) DESC, b.created_at DESC;
END $function$;

-- 切换活跃商家（必须已在 bindings 中）
CREATE OR REPLACE FUNCTION public.agent_switch_active_merchant(_merchant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.agent_merchant_bindings WHERE user_id = v_uid AND merchant_id = _merchant_id) THEN
    RAISE EXCEPTION '尚未绑定该商家';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.merchants WHERE id = _merchant_id AND status = 'approved' AND is_disabled = false) THEN
    RAISE EXCEPTION '商家不可用';
  END IF;
  UPDATE public.agent_relations
     SET is_agent = true,
         bound_merchant_id = _merchant_id,
         upline_id = NULL,
         upline_l2_id = NULL
   WHERE user_id = v_uid;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;
  RETURN true;
END $function$;

-- 解绑商家（不能解绑当前活跃商家）
CREATE OR REPLACE FUNCTION public.agent_unbind_merchant(_merchant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_active uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT bound_merchant_id INTO v_active FROM public.agent_relations WHERE user_id = v_uid;
  IF v_active = _merchant_id THEN
    RAISE EXCEPTION '当前活跃商家不能解绑，请先切换到其他商家';
  END IF;
  DELETE FROM public.agent_merchant_bindings WHERE user_id = v_uid AND merchant_id = _merchant_id;
  RETURN true;
END $function$;

-- 通过手机号添加商家绑定（短信验证由 edge function 完成后再调用此函数）
-- 注意：此函数本身不验证短信，仅供 edge function（service role）在校验通过后调用
CREATE OR REPLACE FUNCTION public.agent_add_merchant_binding(_merchant_owner_phone text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_owner uuid; v_mid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  v_owner := public.find_user_by_phone(_merchant_owner_phone);
  IF v_owner IS NULL THEN RAISE EXCEPTION '该手机号未注册商家'; END IF;
  IF v_owner = v_uid THEN RAISE EXCEPTION '不能绑定自己的店铺'; END IF;
  SELECT id INTO v_mid FROM public.merchants
    WHERE user_id = v_owner AND status = 'approved' AND is_disabled = false
    ORDER BY created_at ASC LIMIT 1;
  IF v_mid IS NULL THEN RAISE EXCEPTION '该手机号未关联到已审核商家'; END IF;
  INSERT INTO public.agent_merchant_bindings(user_id, merchant_id) VALUES (v_uid, v_mid)
    ON CONFLICT DO NOTHING;
  -- 若代理还未激活，则把第一次绑定的商家设为活跃
  UPDATE public.agent_relations
     SET is_agent = true,
         agent_code = COALESCE(agent_code, (SELECT user_code FROM public.profiles WHERE user_id = v_uid)),
         bound_merchant_id = COALESCE(bound_merchant_id, v_mid)
   WHERE user_id = v_uid;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;
  RETURN v_mid;
END $function$;