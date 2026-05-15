-- =========================================================
-- Phase 1: shop_memberships + bind_shop_referrer + double-write
-- =========================================================

-- 1) 新表
CREATE TABLE IF NOT EXISTS public.shop_memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  merchant_id     uuid NOT NULL,
  is_agent        boolean NOT NULL DEFAULT false,
  agent_code      text,
  upline_user_id  uuid,
  l1_rate         numeric(6,4),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_memberships_merchant_upline
  ON public.shop_memberships(merchant_id, upline_user_id);
CREATE INDEX IF NOT EXISTS idx_shop_memberships_merchant_agent
  ON public.shop_memberships(merchant_id, is_agent);
CREATE INDEX IF NOT EXISTS idx_shop_memberships_user
  ON public.shop_memberships(user_id);

ALTER TABLE public.shop_memberships ENABLE ROW LEVEL SECURITY;

-- 自己的 membership 可读
CREATE POLICY sm_select_self ON public.shop_memberships
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- 商家 owner 可读自家所有 membership
CREATE POLICY sm_select_merchant_owner ON public.shop_memberships
  FOR SELECT USING (
    EXISTS(SELECT 1 FROM public.merchants m
            WHERE m.id = shop_memberships.merchant_id AND m.user_id = auth.uid())
  );

-- admin 全权
CREATE POLICY sm_admin_all ON public.shop_memberships
  FOR ALL USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));


-- 2) 新 RPC：客户进入某商家时调用，按 (user, merchant) 维度首次写入
CREATE OR REPLACE FUNCTION public.bind_shop_referrer(_merchant_id uuid, _ref text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_upline_user uuid;
  v_upline_profile uuid;
  v_existing RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF _merchant_id IS NULL THEN RAISE EXCEPTION '缺少商家'; END IF;

  -- 校验商家
  IF NOT EXISTS (SELECT 1 FROM public.merchants
                  WHERE id = _merchant_id AND status='approved' AND is_disabled=false) THEN
    RAISE EXCEPTION '商家不存在或不可用';
  END IF;

  -- 已有该商家 membership：直接返回（不变更上线）
  SELECT * INTO v_existing FROM public.shop_memberships
    WHERE user_id = v_uid AND merchant_id = _merchant_id;
  IF FOUND THEN RETURN v_existing.id; END IF;

  -- 解析 ref → upline user
  IF _ref IS NOT NULL AND length(_ref) > 0 THEN
    -- 形如 A_<userCode>_M_<merchantId>
    IF _ref ~ '^A_[^_]+_M_[0-9a-fA-F-]{36}$' THEN
      SELECT p.user_id INTO v_upline_user
        FROM public.profiles p
        JOIN public.shop_memberships sm
          ON sm.user_id = p.user_id AND sm.merchant_id = _merchant_id AND sm.is_agent = true
       WHERE p.user_code = split_part(_ref, '_', 2)
       LIMIT 1;
    -- 形如 M_<merchantId>：商家自己的招客户码 → 无上线
    ELSIF _ref ~ '^M_[0-9a-fA-F-]{36}$' THEN
      v_upline_user := NULL;
    -- 兼容旧的纯 user_code：要求该用户在该商家是代理
    ELSE
      SELECT p.user_id INTO v_upline_user
        FROM public.profiles p
        JOIN public.shop_memberships sm
          ON sm.user_id = p.user_id AND sm.merchant_id = _merchant_id AND sm.is_agent = true
       WHERE p.user_code = _ref
       LIMIT 1;
      -- 兜底：从老表 agent_merchant_bindings 再判一次
      IF v_upline_user IS NULL THEN
        SELECT p.user_id INTO v_upline_user
          FROM public.profiles p
          JOIN public.agent_merchant_bindings amb
            ON amb.user_id = p.user_id AND amb.merchant_id = _merchant_id
         WHERE p.user_code = _ref
         LIMIT 1;
      END IF;
    END IF;
  END IF;

  -- 不能让客户上线是自己
  IF v_upline_user = v_uid THEN v_upline_user := NULL; END IF;

  INSERT INTO public.shop_memberships(user_id, merchant_id, is_agent, upline_user_id)
    VALUES (v_uid, _merchant_id, false, v_upline_user)
    ON CONFLICT (user_id, merchant_id) DO NOTHING
    RETURNING id INTO v_existing.id;

  RETURN v_existing.id;
END $$;


-- 3) 历史数据迁移（一次性，幂等）
-- 3a) 已有的代理-商家绑定 → memberships(is_agent=true)
INSERT INTO public.shop_memberships (user_id, merchant_id, is_agent, agent_code, l1_rate, joined_at)
SELECT amb.user_id,
       amb.merchant_id,
       true,
       p.user_code,
       ar.l1_rate,
       amb.created_at
FROM public.agent_merchant_bindings amb
LEFT JOIN public.profiles p ON p.user_id = amb.user_id
LEFT JOIN public.agent_relations ar ON ar.user_id = amb.user_id
WHERE EXISTS(SELECT 1 FROM public.merchants m
              WHERE m.id = amb.merchant_id AND m.status='approved')
ON CONFLICT (user_id, merchant_id) DO NOTHING;

-- 3b) agent_relations 中"客户 → 全局上线"按其当前 bound_merchant_id 落地
INSERT INTO public.shop_memberships (user_id, merchant_id, is_agent, upline_user_id, joined_at)
SELECT ar.user_id,
       ar.bound_merchant_id,
       false,
       up.user_id,
       ar.created_at
FROM public.agent_relations ar
JOIN public.profiles up ON up.id = ar.upline_id
WHERE ar.is_agent = false
  AND ar.bound_merchant_id IS NOT NULL
  AND ar.upline_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.merchants m
              WHERE m.id = ar.bound_merchant_id AND m.status='approved')
ON CONFLICT (user_id, merchant_id) DO NOTHING;

-- 3c) 历史订单中的 (buyer, merchant, agent_l1_id) 兜底
INSERT INTO public.shop_memberships (user_id, merchant_id, is_agent, upline_user_id, joined_at)
SELECT DISTINCT ON (o.buyer_id, o.merchant_id)
       o.buyer_id,
       o.merchant_id,
       false,
       up.user_id,
       o.created_at
FROM public.orders o
LEFT JOIN public.profiles up ON up.id = o.agent_l1_id
WHERE o.status = 'paid'
  AND EXISTS(SELECT 1 FROM public.merchants m WHERE m.id = o.merchant_id)
ORDER BY o.buyer_id, o.merchant_id, o.created_at ASC
ON CONFLICT (user_id, merchant_id) DO NOTHING;


-- 4) 老 bind_referrer 双写（保持原行为，同时写新表）
--    旧实现位于 public.bind_referrer(_agent_code text)；这里覆写以双写。
--    若旧函数原本返回 boolean / 接受不同参数，也兼容覆盖。
CREATE OR REPLACE FUNCTION public.bind_referrer(_agent_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_upline_profile_id uuid;
  v_upline_user_id uuid;
  v_merchant_id uuid;
  v_is_self_merchant boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF _agent_code IS NULL OR length(_agent_code) = 0 THEN RETURN false; END IF;

  -- 先解析"目标商家"
  v_merchant_id := public.resolve_ref_to_merchant(_agent_code);

  -- 形如 A_<code>_M_<mid> → 取 code
  IF _agent_code ~ '^A_[^_]+_M_[0-9a-fA-F-]{36}$' THEN
    SELECT user_id, id INTO v_upline_user_id, v_upline_profile_id
      FROM public.profiles WHERE user_code = split_part(_agent_code, '_', 2) LIMIT 1;
  ELSIF _agent_code ~ '^M_' THEN
    v_upline_user_id := NULL; v_upline_profile_id := NULL;
  ELSE
    SELECT user_id, id INTO v_upline_user_id, v_upline_profile_id
      FROM public.profiles WHERE user_code = _agent_code LIMIT 1;
  END IF;

  -- 旧表写入：仅当当前 user 不是代理 且 还没设置过 upline 时
  UPDATE public.agent_relations
     SET upline_id = COALESCE(upline_id, v_upline_profile_id),
         bound_merchant_id = COALESCE(bound_merchant_id, v_merchant_id)
   WHERE user_id = v_uid
     AND is_agent = false
     AND upline_id IS NULL;

  -- 新表双写：调 bind_shop_referrer
  IF v_merchant_id IS NOT NULL THEN
    BEGIN
      PERFORM public.bind_shop_referrer(v_merchant_id, _agent_code);
    EXCEPTION WHEN OTHERS THEN
      -- 双写失败不影响旧路径
      NULL;
    END;
  END IF;

  RETURN true;
END $$;