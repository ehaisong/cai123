-- ============ agent_finance ============
CREATE OR REPLACE FUNCTION public.agent_finance(
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _merchant_id uuid DEFAULT NULL,
  _limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today_start timestamptz;
  v_yest_start timestamptz;
  v_month_start timestamptz;
  v_from timestamptz;
  v_to timestamptz;
  v_summary jsonb;
  v_by_merchant jsonb;
  v_records jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  v_today_start := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_yest_start  := v_today_start - interval '1 day';
  v_month_start := date_trunc('month', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_from := COALESCE(_from, '1970-01-01'::timestamptz);
  v_to   := COALESCE(_to,   now() + interval '1 day');

  WITH base AS (
    SELECT cr.amount, cr.rate, cr.created_at, cr.order_id,
           o.merchant_id, o.buyer_id, o.amount AS order_amount, o.paid_at
      FROM public.commission_records cr
      LEFT JOIN public.orders o ON o.id = cr.order_id
     WHERE cr.beneficiary_id = v_uid
       AND (_merchant_id IS NULL OR o.merchant_id = _merchant_id)
  )
  SELECT jsonb_build_object(
    'today',     COALESCE((SELECT sum(amount) FROM base WHERE created_at >= v_today_start), 0),
    'yesterday', COALESCE((SELECT sum(amount) FROM base WHERE created_at >= v_yest_start AND created_at < v_today_start), 0),
    'month',     COALESCE((SELECT sum(amount) FROM base WHERE created_at >= v_month_start), 0),
    'total',     COALESCE((SELECT sum(amount) FROM base), 0),
    'total_orders', COALESCE((SELECT count(*) FROM base), 0),
    'range',     COALESCE((SELECT sum(amount) FROM base WHERE created_at >= v_from AND created_at < v_to), 0),
    'range_orders', COALESCE((SELECT count(*) FROM base WHERE created_at >= v_from AND created_at < v_to), 0),
    'range_gmv', COALESCE((SELECT sum(order_amount) FROM base WHERE created_at >= v_from AND created_at < v_to), 0)
  ) INTO v_summary;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.commission_amount DESC), '[]'::jsonb)
    INTO v_by_merchant
  FROM (
    SELECT m.id AS merchant_id,
           m.shop_name,
           m.shop_avatar_url,
           count(cr.id) AS order_count,
           COALESCE(sum(cr.amount), 0) AS commission_amount,
           COALESCE(sum(o.amount), 0) AS gmv
      FROM public.commission_records cr
      LEFT JOIN public.orders o ON o.id = cr.order_id
      LEFT JOIN public.merchants m ON m.id = o.merchant_id
     WHERE cr.beneficiary_id = v_uid
       AND cr.created_at >= v_from AND cr.created_at < v_to
       AND (_merchant_id IS NULL OR o.merchant_id = _merchant_id)
       AND m.id IS NOT NULL
     GROUP BY m.id, m.shop_name, m.shop_avatar_url
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb)
    INTO v_records
  FROM (
    SELECT cr.id AS record_id,
           cr.amount AS commission_amount,
           cr.rate,
           cr.level,
           cr.created_at,
           cr.order_id,
           o.amount AS order_amount,
           o.paid_at,
           o.merchant_id,
           m.shop_name,
           m.shop_avatar_url,
           o.buyer_id,
           bp.nickname AS buyer_nickname,
           bp.user_code AS buyer_code,
           p.title AS product_title
      FROM public.commission_records cr
      LEFT JOIN public.orders o ON o.id = cr.order_id
      LEFT JOIN public.merchants m ON m.id = o.merchant_id
      LEFT JOIN public.profiles bp ON bp.user_id = o.buyer_id
      LEFT JOIN public.products p ON p.id = o.product_id
     WHERE cr.beneficiary_id = v_uid
       AND cr.created_at >= v_from AND cr.created_at < v_to
       AND (_merchant_id IS NULL OR o.merchant_id = _merchant_id)
     ORDER BY cr.created_at DESC
     LIMIT GREATEST(_limit, 1)
  ) t;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'by_merchant', v_by_merchant,
    'records', v_records
  );
END $$;

GRANT EXECUTE ON FUNCTION public.agent_finance(timestamptz, timestamptz, uuid, integer) TO authenticated;

-- ============ merchant_finance ============
CREATE OR REPLACE FUNCTION public.merchant_finance(
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_default_rate numeric;
  v_today_start timestamptz;
  v_yest_start timestamptz;
  v_month_start timestamptz;
  v_from timestamptz;
  v_to timestamptz;
  v_summary jsonb;
  v_orders jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT COALESCE(platform_rate, 0) INTO v_default_rate
    FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;
  v_default_rate := COALESCE(v_default_rate, 0);

  v_today_start := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_yest_start  := v_today_start - interval '1 day';
  v_month_start := date_trunc('month', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_from := COALESCE(_from, '1970-01-01'::timestamptz);
  v_to   := COALESCE(_to,   now() + interval '1 day');

  WITH my_merchants AS (
    SELECT id, COALESCE(platform_rate, v_default_rate) AS p_rate
      FROM public.merchants WHERE user_id = v_uid
  ),
  base AS (
    SELECT o.id, o.amount, o.paid_at, o.merchant_id, o.buyer_id, o.product_id,
           COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, mm.p_rate), 2)) AS plat_fee,
           COALESCE((SELECT sum(cr.amount) FROM public.commission_records cr WHERE cr.order_id = o.id), 0) AS agent_fee
      FROM public.orders o
      JOIN my_merchants mm ON mm.id = o.merchant_id
     WHERE o.status = 'paid'
  )
  SELECT jsonb_build_object(
    'today_income',     COALESCE((SELECT sum(amount - plat_fee - agent_fee) FROM base WHERE paid_at >= v_today_start), 0),
    'today_gmv',        COALESCE((SELECT sum(amount) FROM base WHERE paid_at >= v_today_start), 0),
    'today_orders',     COALESCE((SELECT count(*) FROM base WHERE paid_at >= v_today_start), 0),
    'yesterday_income', COALESCE((SELECT sum(amount - plat_fee - agent_fee) FROM base WHERE paid_at >= v_yest_start AND paid_at < v_today_start), 0),
    'month_income',     COALESCE((SELECT sum(amount - plat_fee - agent_fee) FROM base WHERE paid_at >= v_month_start), 0),
    'month_gmv',        COALESCE((SELECT sum(amount) FROM base WHERE paid_at >= v_month_start), 0),
    'total_income',     COALESCE((SELECT sum(amount - plat_fee - agent_fee) FROM base), 0),
    'total_gmv',        COALESCE((SELECT sum(amount) FROM base), 0),
    'total_orders',     COALESCE((SELECT count(*) FROM base), 0),
    'total_platform',   COALESCE((SELECT sum(plat_fee) FROM base), 0),
    'total_agent',      COALESCE((SELECT sum(agent_fee) FROM base), 0),
    'range_income',     COALESCE((SELECT sum(amount - plat_fee - agent_fee) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0),
    'range_gmv',        COALESCE((SELECT sum(amount) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0),
    'range_orders',     COALESCE((SELECT count(*) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0)
  ) INTO v_summary;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.paid_at DESC), '[]'::jsonb)
    INTO v_orders
  FROM (
    SELECT o.id AS order_id,
           o.amount,
           COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, mm.p_rate), 2)) AS platform_fee,
           COALESCE((SELECT sum(cr.amount) FROM public.commission_records cr WHERE cr.order_id = o.id), 0) AS agent_fee,
           o.amount - COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, mm.p_rate), 2))
             - COALESCE((SELECT sum(cr.amount) FROM public.commission_records cr WHERE cr.order_id = o.id), 0) AS merchant_income,
           o.paid_at,
           o.buyer_id,
           bp.nickname AS buyer_nickname,
           bp.user_code AS buyer_code,
           p.title AS product_title
      FROM public.orders o
      JOIN my_merchants mm ON mm.id = o.merchant_id
      LEFT JOIN public.profiles bp ON bp.user_id = o.buyer_id
      LEFT JOIN public.products p ON p.id = o.product_id
     WHERE o.status = 'paid'
       AND o.paid_at >= v_from AND o.paid_at < v_to
     ORDER BY o.paid_at DESC
     LIMIT GREATEST(_limit, 1)
  ) t;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'orders', v_orders
  );
END $$;

GRANT EXECUTE ON FUNCTION public.merchant_finance(timestamptz, timestamptz, integer) TO authenticated;