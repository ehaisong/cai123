-- ============================================================
-- 方案 A'：将 agent_relations 改造为由 shop_memberships 触发器同步的派生表
-- 清理 agent_merchant_bindings 与 profiles 中的旧推荐字段
-- ============================================================

-- 1) 去重并加唯一索引（旧代码用 maybeSingle 读 agent_relations.user_id）
DELETE FROM public.agent_relations a
USING public.agent_relations b
WHERE a.ctid < b.ctid AND a.user_id = b.user_id;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_relations_user_id_key'
  ) THEN
    ALTER TABLE public.agent_relations
      ADD CONSTRAINT agent_relations_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- 2) 同步函数：根据 shop_memberships 重算单个用户在 agent_relations 中的派生字段
CREATE OR REPLACE FUNCTION public.sync_agent_relations_from_sm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := COALESCE(NEW.user_id, OLD.user_id);
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.agent_relations(user_id)
    VALUES (v_uid)
    ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.agent_relations ar SET
    is_agent = COALESCE((
      SELECT bool_or(is_agent) FROM public.shop_memberships
      WHERE user_id = v_uid
    ), false),
    agent_code = (
      SELECT agent_code FROM public.shop_memberships
      WHERE user_id = v_uid AND is_agent = true AND agent_code IS NOT NULL
      ORDER BY joined_at DESC LIMIT 1
    ),
    bound_merchant_id = (
      SELECT merchant_id FROM public.shop_memberships
      WHERE user_id = v_uid AND is_agent = true
      ORDER BY joined_at DESC LIMIT 1
    ),
    upline_id = (
      SELECT p.id FROM public.shop_memberships sm
      JOIN public.profiles p ON p.user_id = sm.upline_user_id
      WHERE sm.user_id = v_uid AND sm.upline_user_id IS NOT NULL
      ORDER BY sm.joined_at DESC LIMIT 1
    ),
    l1_rate = (
      SELECT l1_rate FROM public.shop_memberships
      WHERE user_id = v_uid AND is_agent = true
      ORDER BY joined_at DESC LIMIT 1
    )
  WHERE ar.user_id = v_uid;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sync_agent_relations_sm ON public.shop_memberships;
CREATE TRIGGER trg_sync_agent_relations_sm
AFTER INSERT OR UPDATE OR DELETE ON public.shop_memberships
FOR EACH ROW EXECUTE FUNCTION public.sync_agent_relations_from_sm();

-- 3) 全量回填一次
INSERT INTO public.agent_relations(user_id)
SELECT DISTINCT user_id FROM public.shop_memberships
ON CONFLICT (user_id) DO NOTHING;

UPDATE public.agent_relations ar SET
  is_agent = COALESCE((
    SELECT bool_or(is_agent) FROM public.shop_memberships
    WHERE user_id = ar.user_id
  ), false),
  agent_code = (
    SELECT agent_code FROM public.shop_memberships
    WHERE user_id = ar.user_id AND is_agent = true AND agent_code IS NOT NULL
    ORDER BY joined_at DESC LIMIT 1
  ),
  bound_merchant_id = (
    SELECT merchant_id FROM public.shop_memberships
    WHERE user_id = ar.user_id AND is_agent = true
    ORDER BY joined_at DESC LIMIT 1
  ),
  upline_id = (
    SELECT p.id FROM public.shop_memberships sm
    JOIN public.profiles p ON p.user_id = sm.upline_user_id
    WHERE sm.user_id = ar.user_id AND sm.upline_user_id IS NOT NULL
    ORDER BY sm.joined_at DESC LIMIT 1
  ),
  l1_rate = (
    SELECT l1_rate FROM public.shop_memberships
    WHERE user_id = ar.user_id AND is_agent = true
    ORDER BY joined_at DESC LIMIT 1
  );

-- 4) 重写所有用到 agent_merchant_bindings 的函数，改为 shop_memberships

-- 4.1 bind_shop_referrer：去掉 agent_merchant_bindings 兜底；去掉手工写 agent_relations（触发器接管）
CREATE OR REPLACE FUNCTION public.bind_shop_referrer(_merchant_id uuid, _ref text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_upline_user uuid;
  v_existing RECORD;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF _merchant_id IS NULL THEN RAISE EXCEPTION '缺少商家'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchants
                  WHERE id = _merchant_id AND status='approved' AND is_disabled=false) THEN
    RAISE EXCEPTION '商家不存在或不可用';
  END IF;

  IF _ref IS NOT NULL AND length(_ref) > 0 THEN
    IF _ref ~ '^A_[^_]+_M_[0-9a-fA-F-]{36}$' THEN
      SELECT p.user_id INTO v_upline_user
        FROM public.profiles p
        JOIN public.shop_memberships sm
          ON sm.user_id = p.user_id AND sm.merchant_id = _merchant_id AND sm.is_agent = true
       WHERE p.user_code = split_part(_ref, '_', 2)
       LIMIT 1;
    ELSIF _ref ~ '^M_[0-9a-fA-F-]{36}$' THEN
      v_upline_user := NULL;
    ELSE
      SELECT p.user_id INTO v_upline_user
        FROM public.profiles p
        JOIN public.shop_memberships sm
          ON sm.user_id = p.user_id AND sm.merchant_id = _merchant_id AND sm.is_agent = true
       WHERE p.user_code = _ref
       LIMIT 1;
    END IF;
  END IF;

  IF v_upline_user = v_uid THEN v_upline_user := NULL; END IF;

  SELECT * INTO v_existing FROM public.shop_memberships
    WHERE user_id = v_uid AND merchant_id = _merchant_id;
  IF FOUND THEN
    IF v_existing.upline_user_id IS NULL AND v_upline_user IS NOT NULL THEN
      UPDATE public.shop_memberships
         SET upline_user_id = v_upline_user
       WHERE id = v_existing.id;
    END IF;
    v_new_id := v_existing.id;
  ELSE
    INSERT INTO public.shop_memberships(user_id, merchant_id, is_agent, upline_user_id)
      VALUES (v_uid, _merchant_id, false, v_upline_user)
      ON CONFLICT (user_id, merchant_id) DO UPDATE
        SET upline_user_id = COALESCE(public.shop_memberships.upline_user_id, EXCLUDED.upline_user_id)
      RETURNING id INTO v_new_id;
  END IF;

  RETURN v_new_id;
END $function$;
GRANT EXECUTE ON FUNCTION public.bind_shop_referrer(uuid, text) TO authenticated;

-- 4.2 become_agent_for_merchant：去掉对 agent_relations / agent_merchant_bindings 的兼容写入
CREATE OR REPLACE FUNCTION public.become_agent_for_merchant(_merchant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT;
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

  SELECT user_code INTO v_code FROM public.profiles WHERE user_id = v_uid;

  INSERT INTO public.shop_memberships(user_id, merchant_id, is_agent, agent_code, joined_at)
    VALUES (v_uid, _merchant_id, true, v_code, now())
    ON CONFLICT (user_id, merchant_id) DO UPDATE
      SET is_agent = true,
          agent_code = COALESCE(public.shop_memberships.agent_code, EXCLUDED.agent_code),
          joined_at = now();

  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;
  RETURN v_code;
END $function$;

-- 4.3 switch_agent_merchant：bump joined_at 即可让 agent_relations.bound_merchant_id 切到该店
CREATE OR REPLACE FUNCTION public.switch_agent_merchant(_merchant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.merchants
                 WHERE id = _merchant_id AND status='approved' AND is_disabled=false) THEN
    RAISE EXCEPTION '商家不存在或不可用';
  END IF;
  IF EXISTS(SELECT 1 FROM public.merchants WHERE id = _merchant_id AND user_id = v_uid) THEN
    RAISE EXCEPTION '商家本人无法成为代理';
  END IF;

  SELECT user_code INTO v_code FROM public.profiles WHERE user_id = v_uid;

  INSERT INTO public.shop_memberships(user_id, merchant_id, is_agent, agent_code, joined_at)
    VALUES (v_uid, _merchant_id, true, v_code, now())
    ON CONFLICT (user_id, merchant_id) DO UPDATE
      SET is_agent = true,
          agent_code = COALESCE(public.shop_memberships.agent_code, EXCLUDED.agent_code),
          joined_at = now();

  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;
  RETURN true;
END $function$;

-- 4.4 agent_my_bound_merchants：改为基于 shop_memberships
CREATE OR REPLACE FUNCTION public.agent_my_bound_merchants()
RETURNS TABLE(merchant_id uuid, shop_name text, shop_avatar_url text, status merchant_status, is_active boolean, bound_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_active uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT sm.merchant_id INTO v_active FROM public.shop_memberships sm
    WHERE sm.user_id = v_uid AND sm.is_agent = true
    ORDER BY sm.joined_at DESC LIMIT 1;
  RETURN QUERY
  SELECT m.id, m.shop_name, m.shop_avatar_url, m.status,
         (m.id = v_active) AS is_active,
         sm.joined_at
  FROM public.shop_memberships sm
  JOIN public.merchants m ON m.id = sm.merchant_id
  WHERE sm.user_id = v_uid AND sm.is_agent = true
  ORDER BY (m.id = v_active) DESC, sm.joined_at DESC;
END $function$;

-- 4.5 agent_switch_active_merchant
CREATE OR REPLACE FUNCTION public.agent_switch_active_merchant(_merchant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.shop_memberships
                 WHERE user_id = v_uid AND merchant_id = _merchant_id AND is_agent = true) THEN
    RAISE EXCEPTION '尚未绑定该商家';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.merchants
                 WHERE id = _merchant_id AND status='approved' AND is_disabled=false) THEN
    RAISE EXCEPTION '商家不可用';
  END IF;
  UPDATE public.shop_memberships
     SET joined_at = now()
   WHERE user_id = v_uid AND merchant_id = _merchant_id AND is_agent = true;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;
  RETURN true;
END $function$;

-- 4.6 agent_unbind_merchant：将 is_agent 置 false（保留客户关系）
CREATE OR REPLACE FUNCTION public.agent_unbind_merchant(_merchant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_active uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT merchant_id INTO v_active FROM public.shop_memberships
    WHERE user_id = v_uid AND is_agent = true
    ORDER BY joined_at DESC LIMIT 1;
  IF v_active = _merchant_id THEN
    RAISE EXCEPTION '当前活跃商家不能解绑，请先切换到其他商家';
  END IF;
  UPDATE public.shop_memberships
     SET is_agent = false, agent_code = NULL, l1_rate = NULL
   WHERE user_id = v_uid AND merchant_id = _merchant_id AND is_agent = true;
  RETURN true;
END $function$;

-- 4.7 agent_add_merchant_binding
CREATE OR REPLACE FUNCTION public.agent_add_merchant_binding(_merchant_owner_phone text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_owner uuid; v_mid uuid; v_code text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  v_owner := public.find_user_by_phone(_merchant_owner_phone);
  IF v_owner IS NULL THEN RAISE EXCEPTION '该手机号未注册商家'; END IF;
  IF v_owner = v_uid THEN RAISE EXCEPTION '不能绑定自己的店铺'; END IF;
  SELECT id INTO v_mid FROM public.merchants
    WHERE user_id = v_owner AND status='approved' AND is_disabled=false
    ORDER BY created_at ASC LIMIT 1;
  IF v_mid IS NULL THEN RAISE EXCEPTION '该手机号未关联到已审核商家'; END IF;

  SELECT user_code INTO v_code FROM public.profiles WHERE user_id = v_uid;

  INSERT INTO public.shop_memberships(user_id, merchant_id, is_agent, agent_code)
    VALUES (v_uid, v_mid, true, v_code)
    ON CONFLICT (user_id, merchant_id) DO UPDATE
      SET is_agent = true,
          agent_code = COALESCE(public.shop_memberships.agent_code, EXCLUDED.agent_code);
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;
  RETURN v_mid;
END $function$;

-- 4.8 admin_merchant_agents_with_stats：改为基于 shop_memberships
CREATE OR REPLACE FUNCTION public.admin_merchant_agents_with_stats(_merchant_id uuid)
RETURNS TABLE(user_id uuid, agent_code text, l1_rate numeric, created_at timestamp with time zone, nickname text, phone text, user_code text, customer_count bigint, total_sales numeric, total_commission numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF NOT has_role(v_uid, 'admin'::app_role) THEN RAISE EXCEPTION '无权访问'; END IF;

  RETURN QUERY
  SELECT
    sm.user_id,
    sm.agent_code,
    sm.l1_rate,
    sm.joined_at AS created_at,
    p.nickname,
    p.phone,
    p.user_code,
    COALESCE((
      SELECT count(*) FROM public.shop_memberships sm2
      WHERE sm2.upline_user_id = sm.user_id
        AND sm2.merchant_id = _merchant_id
        AND sm2.is_agent = false
    ), 0) AS customer_count,
    COALESCE((
      SELECT sum(o.amount) FROM public.orders o
      WHERE o.merchant_id = _merchant_id
        AND o.status = 'paid'
        AND (o.agent_l1_id = sm.user_id OR o.agent_l2_id = sm.user_id)
    ), 0) AS total_sales,
    COALESCE((
      SELECT sum(cr.amount) FROM public.commission_records cr
      JOIN public.orders o ON o.id = cr.order_id
      WHERE cr.beneficiary_id = sm.user_id
        AND o.merchant_id = _merchant_id
    ), 0) AS total_commission
  FROM public.shop_memberships sm
  JOIN public.profiles p ON p.user_id = sm.user_id
  WHERE sm.is_agent = true AND sm.merchant_id = _merchant_id
  ORDER BY sm.joined_at DESC;
END $function$;

-- 4.9 admin_broadcast：把 'agents' 受众改为查 shop_memberships
CREATE OR REPLACE FUNCTION public.admin_broadcast(_title text, _content text, _audience text DEFAULT 'all'::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_count int;
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION '无权限'; END IF;
  IF length(coalesce(_title,''))=0 THEN RAISE EXCEPTION '标题必填'; END IF;

  WITH targets AS (
    SELECT DISTINCT user_id FROM (
      SELECT p.user_id FROM public.profiles p WHERE _audience='all'
      UNION
      SELECT m.user_id FROM public.merchants m WHERE _audience='merchants' AND m.status='approved'
      UNION
      SELECT sm.user_id FROM public.shop_memberships sm WHERE _audience='agents' AND sm.is_agent=true
    ) t
  ), ins AS (
    INSERT INTO public.notifications(user_id, category, title, content, sender_id, sender_role)
    SELECT user_id, 'admin_message', _title, _content, v_uid, 'admin' FROM targets
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;
  RETURN v_count;
END $function$;

-- 4.10 resolve_my_shop：保持兼容（仍读 agent_relations，由触发器同步）
-- 5) handle_new_user：保留对 agent_relations 的初始化插入（触发器要求行存在）
--    无需修改

-- 6) 删除 agent_merchant_bindings 表
DROP TABLE IF EXISTS public.agent_merchant_bindings CASCADE;

-- 7) 删除 profiles 中已弃用的旧推荐字段
ALTER TABLE public.profiles DROP COLUMN IF EXISTS referrer_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS referred_merchant_id;
