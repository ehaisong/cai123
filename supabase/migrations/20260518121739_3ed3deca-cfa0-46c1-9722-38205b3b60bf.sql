CREATE OR REPLACE FUNCTION public.admin_platform_income(_from timestamp with time zone DEFAULT NULL::timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone, _merchant_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_default_rate numeric;
  v_today_start timestamptz;
  v_yest_start timestamptz;
  v_month_start timestamptz;
  v_from timestamptz;
  v_to timestamptz;
  v_summary jsonb;
  v_by_merchant jsonb;
  v_orders jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION '无权访问';
  END IF;

  SELECT COALESCE(platform_rate, 0) INTO v_default_rate
    FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;
  v_default_rate := COALESCE(v_default_rate, 0);

  v_today_start := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_yest_start  := v_today_start - interval '1 day';
  v_month_start := date_trunc('month', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';

  v_from := COALESCE(_from, '1970-01-01'::timestamptz);
  v_to   := COALESCE(_to,   now() + interval '1 day');

  WITH base AS (
    SELECT o.amount,
           COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, m.platform_rate, v_default_rate), 2)) AS plat,
           o.paid_at
      FROM public.orders o
      JOIN public.merchants m ON m.id = o.merchant_id
     WHERE o.status = 'paid'
       AND (_merchant_id IS NULL OR o.merchant_id = _merchant_id)
  )
  SELECT jsonb_build_object(
    'today',     COALESCE((SELECT sum(plat) FROM base WHERE paid_at >= v_today_start), 0),
    'yesterday', COALESCE((SELECT sum(plat) FROM base WHERE paid_at >= v_yest_start AND paid_at < v_today_start), 0),
    'month',     COALESCE((SELECT sum(plat) FROM base WHERE paid_at >= v_month_start), 0),
    'range',     COALESCE((SELECT sum(plat) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0),
    'range_orders', COALESCE((SELECT count(*) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0),
    'range_amount', COALESCE((SELECT sum(amount) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0),
    'total',     COALESCE((SELECT sum(plat) FROM base), 0),
    'total_orders', COALESCE((SELECT count(*) FROM base), 0),
    'default_rate', v_default_rate
  ) INTO v_summary;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.platform_amount DESC), '[]'::jsonb)
    INTO v_by_merchant
  FROM (
    SELECT m.id AS merchant_id,
           m.shop_name,
           COALESCE(m.platform_rate, v_default_rate) AS rate,
           count(o.id) AS order_count,
           COALESCE(sum(o.amount), 0) AS total_amount,
           COALESCE(sum(COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, m.platform_rate, v_default_rate), 2))), 0) AS platform_amount
      FROM public.orders o
      JOIN public.merchants m ON m.id = o.merchant_id
     WHERE o.status = 'paid'
       AND o.paid_at >= v_from AND o.paid_at < v_to
       AND (_merchant_id IS NULL OR o.merchant_id = _merchant_id)
     GROUP BY m.id, m.shop_name, m.platform_rate
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.paid_at DESC), '[]'::jsonb)
    INTO v_orders
  FROM (
    SELECT o.id AS order_id,
           o.amount,
           COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, m.platform_rate, v_default_rate), 2)) AS platform_amount,
           COALESCE(o.platform_rate, m.platform_rate, v_default_rate) AS rate,
           o.paid_at,
           o.merchant_id,
           m.shop_name,
           o.buyer_id,
           bp.nickname AS buyer_nickname,
           bp.user_code AS buyer_code,
           p.title AS product_title
      FROM public.orders o
      JOIN public.merchants m ON m.id = o.merchant_id
      LEFT JOIN public.profiles bp ON bp.user_id = o.buyer_id
      LEFT JOIN public.products p ON p.id = o.product_id
     WHERE o.status = 'paid'
       AND o.paid_at >= v_from AND o.paid_at < v_to
       AND (_merchant_id IS NULL OR o.merchant_id = _merchant_id)
     ORDER BY o.paid_at DESC
     LIMIT GREATEST(_limit, 1)
  ) t;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'by_merchant', v_by_merchant,
    'orders', v_orders
  );
END $function$;