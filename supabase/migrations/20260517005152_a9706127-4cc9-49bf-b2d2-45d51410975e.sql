CREATE OR REPLACE FUNCTION public.resolve_ref_to_merchant(_ref text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _ref IS NULL OR length(_ref) = 0 THEN NULL::uuid
    WHEN _ref ~ '^A_[^_]+_M_[0-9a-fA-F-]{36}$' THEN (
      SELECT m.id
      FROM public.merchants m
      WHERE m.id::text = split_part(_ref, '_M_', 2)
        AND m.status = 'approved'
        AND COALESCE(m.is_disabled, false) = false
      LIMIT 1
    )
    WHEN _ref ~ '^M_[0-9a-fA-F-]{36}$' THEN (
      SELECT m.id
      FROM public.merchants m
      WHERE m.id::text = substring(_ref from 3)
        AND m.status = 'approved'
        AND COALESCE(m.is_disabled, false) = false
      LIMIT 1
    )
    ELSE (
      SELECT m.id
      FROM public.profiles p
      JOIN public.agent_relations ar ON ar.user_id = p.user_id
      JOIN public.merchants m ON m.id = ar.bound_merchant_id
      WHERE p.user_code = _ref
        AND ar.is_agent = true
        AND m.status = 'approved'
        AND COALESCE(m.is_disabled, false) = false
      LIMIT 1
    )
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_ref_to_merchant(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.bind_referrer(_agent_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_upline_profile_id uuid;
  v_merchant_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF _agent_code IS NULL OR length(_agent_code) = 0 THEN RETURN false; END IF;

  v_merchant_id := public.resolve_ref_to_merchant(_agent_code);

  IF _agent_code ~ '^A_[^_]+_M_[0-9a-fA-F-]{36}$' THEN
    SELECT id INTO v_upline_profile_id
      FROM public.profiles
      WHERE user_code = split_part(_agent_code, '_', 2)
      LIMIT 1;
  ELSIF _agent_code ~ '^M_' THEN
    v_upline_profile_id := NULL;
  ELSE
    SELECT id INTO v_upline_profile_id
      FROM public.profiles
      WHERE user_code = _agent_code
      LIMIT 1;
  END IF;

  UPDATE public.agent_relations
     SET upline_id = COALESCE(upline_id, v_upline_profile_id),
         bound_merchant_id = COALESCE(bound_merchant_id, v_merchant_id)
   WHERE user_id = v_uid
     AND is_agent = false
     AND upline_id IS NULL;

  IF v_merchant_id IS NOT NULL THEN
    PERFORM public.bind_shop_referrer(v_merchant_id, _agent_code);
  END IF;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bind_referrer(text) TO authenticated;