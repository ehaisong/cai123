-- 1) 客户扫第二个代理码不应改变上线/商家绑定。仅在尚未绑定上线时才写入。
CREATE OR REPLACE FUNCTION public.bind_referrer(_agent_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_my RECORD;
  v_target_merchant UUID;
  v_upline RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT * INTO v_my FROM public.agent_relations WHERE user_id = v_uid;

  -- 商家直码 M_<merchant_id>：仅当客户尚未绑定任何上线代理时，可设置/覆盖默认店铺；
  -- 已经绑定代理的客户，店铺由代理决定，不允许通过商家码更改。
  IF _agent_code LIKE 'M\_%' ESCAPE '\' THEN
    v_target_merchant := (SUBSTR(_agent_code, 3))::uuid;
    IF v_my.is_agent = true THEN
      RETURN false;
    END IF;
    IF v_my.upline_id IS NULL THEN
      UPDATE public.agent_relations
         SET bound_merchant_id = v_target_merchant
       WHERE user_id = v_uid;
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  -- 代理推荐码：profiles.user_code
  SELECT p.id, p.user_id INTO v_upline FROM public.profiles p WHERE p.user_code = _agent_code;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_upline.user_id = v_uid THEN RETURN false; END IF;

  IF v_my.is_agent = true THEN
    RETURN false;
  END IF;

  -- 仅当未绑定上线时写入；扫第二个代理码不会变更绑定
  IF v_my.upline_id IS NULL THEN
    SELECT bound_merchant_id INTO v_target_merchant
      FROM public.agent_relations WHERE user_id = v_upline.user_id;
    UPDATE public.agent_relations SET
      upline_id = v_upline.id,
      bound_merchant_id = v_target_merchant
    WHERE user_id = v_uid;
    UPDATE public.profiles SET referrer_id = v_upline.id WHERE user_id = v_uid;
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

-- 2) 解析"我"应进入的店铺：若已绑定上线代理，使用代理当前的 bound_merchant_id；
--    否则使用自己的 bound_merchant_id 兜底。
CREATE OR REPLACE FUNCTION public.resolve_my_shop()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_upline_profile UUID;
  v_upline_user UUID;
  v_merchant UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT upline_id, bound_merchant_id INTO v_upline_profile, v_merchant
    FROM public.agent_relations WHERE user_id = v_uid;
  IF v_upline_profile IS NOT NULL THEN
    SELECT user_id INTO v_upline_user FROM public.profiles WHERE id = v_upline_profile;
    IF v_upline_user IS NOT NULL THEN
      SELECT bound_merchant_id INTO v_merchant
        FROM public.agent_relations WHERE user_id = v_upline_user;
    END IF;
  END IF;
  IF v_merchant IS NULL THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.merchants WHERE id = v_merchant AND status = 'approved';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_merchant;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_my_shop() TO authenticated;