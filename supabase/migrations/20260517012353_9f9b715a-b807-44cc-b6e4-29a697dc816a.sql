CREATE OR REPLACE FUNCTION public.bind_shop_referrer(_merchant_id uuid, _ref text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_upline_user uuid;
  v_upline_profile_id uuid;
  v_existing RECORD;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF _merchant_id IS NULL THEN RAISE EXCEPTION '缺少商家'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.merchants
                  WHERE id = _merchant_id AND status='approved' AND is_disabled=false) THEN
    RAISE EXCEPTION '商家不存在或不可用';
  END IF;

  -- 解析 ref → upline user（以店铺会员关系为准，兼容老 agent_merchant_bindings）
  IF _ref IS NOT NULL AND length(_ref) > 0 THEN
    IF _ref ~ '^A_[^_]+_M_[0-9a-fA-F-]{36}$' THEN
      SELECT p.user_id, p.id INTO v_upline_user, v_upline_profile_id
        FROM public.profiles p
        JOIN public.shop_memberships sm
          ON sm.user_id = p.user_id AND sm.merchant_id = _merchant_id AND sm.is_agent = true
       WHERE p.user_code = split_part(_ref, '_', 2)
       LIMIT 1;
    ELSIF _ref ~ '^M_[0-9a-fA-F-]{36}$' THEN
      v_upline_user := NULL;
      v_upline_profile_id := NULL;
    ELSE
      SELECT p.user_id, p.id INTO v_upline_user, v_upline_profile_id
        FROM public.profiles p
        JOIN public.shop_memberships sm
          ON sm.user_id = p.user_id AND sm.merchant_id = _merchant_id AND sm.is_agent = true
       WHERE p.user_code = _ref
       LIMIT 1;
      IF v_upline_user IS NULL THEN
        SELECT p.user_id, p.id INTO v_upline_user, v_upline_profile_id
          FROM public.profiles p
          JOIN public.agent_merchant_bindings amb
            ON amb.user_id = p.user_id AND amb.merchant_id = _merchant_id
         WHERE p.user_code = _ref
         LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF v_upline_user = v_uid THEN
    v_upline_user := NULL;
    v_upline_profile_id := NULL;
  END IF;

  -- 已有 membership：仅当当前 upline 为空且新 ref 解出了上线时，补上一线
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

  -- 兼容旧读路径：部分代理端/后台仍按 agent_relations.upline_id 统计客户。
  -- 只给非代理、且旧上线为空的用户补齐，避免覆盖已有历史代理关系。
  IF v_upline_profile_id IS NOT NULL THEN
    UPDATE public.agent_relations
       SET upline_id = COALESCE(upline_id, v_upline_profile_id),
           bound_merchant_id = COALESCE(bound_merchant_id, _merchant_id)
     WHERE user_id = v_uid
       AND is_agent = false
       AND upline_id IS NULL;
  END IF;

  RETURN v_new_id;
END;
$function$;

-- 回填：把新店铺会员关系中已绑定上线，但旧代理关系仍为空的客户补齐。
UPDATE public.agent_relations ar
   SET upline_id = up.id,
       bound_merchant_id = COALESCE(ar.bound_merchant_id, sm.merchant_id)
  FROM public.shop_memberships sm
  JOIN public.profiles up ON up.user_id = sm.upline_user_id
 WHERE ar.user_id = sm.user_id
   AND ar.is_agent = false
   AND ar.upline_id IS NULL
   AND sm.is_agent = false
   AND sm.upline_user_id IS NOT NULL;

GRANT EXECUTE ON FUNCTION public.bind_shop_referrer(uuid, text) TO authenticated;