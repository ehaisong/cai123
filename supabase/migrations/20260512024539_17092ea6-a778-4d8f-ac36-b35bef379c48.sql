CREATE OR REPLACE FUNCTION public.merchant_agents_with_stats()
 RETURNS TABLE(user_id uuid, agent_code text, l1_rate numeric, created_at timestamp with time zone, nickname text, phone text, user_code text, customer_count bigint, yesterday_income numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_my uuid;
  v_y_start timestamptz;
  v_y_end timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT m.id INTO v_my FROM public.merchants m WHERE m.user_id = v_uid;
  IF v_my IS NULL THEN RAISE EXCEPTION '不是商家'; END IF;

  v_y_start := (date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) - interval '1 day') AT TIME ZONE 'Asia/Shanghai';
  v_y_end   := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';

  RETURN QUERY
  WITH agent_ids AS (
    SELECT ar.user_id FROM public.agent_relations ar
      WHERE ar.is_agent = true AND ar.bound_merchant_id = v_my
    UNION
    SELECT amb.user_id FROM public.agent_merchant_bindings amb
      WHERE amb.merchant_id = v_my
  )
  SELECT
    ar.user_id,
    ar.agent_code,
    ar.l1_rate,
    ar.created_at,
    p.nickname,
    p.phone,
    p.user_code,
    COALESCE((
      SELECT count(*) FROM public.agent_relations ar2
      WHERE ar2.upline_id = p.id AND ar2.is_agent = false
    ), 0) AS customer_count,
    COALESCE((
      SELECT sum(cr.amount) FROM public.commission_records cr
      WHERE cr.beneficiary_id = ar.user_id
        AND cr.created_at >= v_y_start
        AND cr.created_at <  v_y_end
    ), 0) AS yesterday_income
  FROM public.agent_relations ar
  JOIN public.profiles p ON p.user_id = ar.user_id
  WHERE ar.user_id IN (SELECT user_id FROM agent_ids) AND ar.is_agent = true
  ORDER BY ar.created_at DESC;
END $function$;