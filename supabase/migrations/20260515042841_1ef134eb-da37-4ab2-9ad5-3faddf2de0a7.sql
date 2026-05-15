CREATE OR REPLACE FUNCTION public.admin_merchant_agents_with_stats(_merchant_id uuid)
 RETURNS TABLE(user_id uuid, agent_code text, l1_rate numeric, created_at timestamp with time zone, nickname text, phone text, user_code text, customer_count bigint, total_sales numeric, total_commission numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF NOT has_role(v_uid, 'admin'::app_role) THEN RAISE EXCEPTION '无权访问'; END IF;

  RETURN QUERY
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
      SELECT sum(o.amount) FROM public.orders o
      WHERE o.merchant_id = _merchant_id
        AND o.status = 'paid'
        AND (o.agent_l1_id = ar.user_id OR o.agent_l2_id = ar.user_id)
    ), 0) AS total_sales,
    COALESCE((
      SELECT sum(cr.amount) FROM public.commission_records cr
      JOIN public.orders o ON o.id = cr.order_id
      WHERE cr.beneficiary_id = ar.user_id
        AND o.merchant_id = _merchant_id
    ), 0) AS total_commission
  FROM public.agent_relations ar
  JOIN public.profiles p ON p.user_id = ar.user_id
  WHERE ar.is_agent = true AND ar.bound_merchant_id = _merchant_id
  ORDER BY ar.created_at DESC;
END $function$;