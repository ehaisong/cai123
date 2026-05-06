
CREATE OR REPLACE FUNCTION public.merchant_agents_with_stats()
RETURNS TABLE (
  user_id uuid,
  agent_code text,
  l1_rate numeric,
  created_at timestamptz,
  nickname text,
  phone text,
  user_code text,
  customer_count bigint,
  yesterday_income numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_my uuid;
  v_y_start timestamptz;
  v_y_end timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT id INTO v_my FROM public.merchants WHERE user_id = v_uid;
  IF v_my IS NULL THEN RAISE EXCEPTION '不是商家'; END IF;

  v_y_start := (date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) - interval '1 day') AT TIME ZONE 'Asia/Shanghai';
  v_y_end   := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';

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
      SELECT sum(cr.amount) FROM public.commission_records cr
      WHERE cr.beneficiary_id = ar.user_id
        AND cr.created_at >= v_y_start
        AND cr.created_at <  v_y_end
    ), 0) AS yesterday_income
  FROM public.agent_relations ar
  JOIN public.profiles p ON p.user_id = ar.user_id
  WHERE ar.bound_merchant_id = v_my AND ar.is_agent = true
  ORDER BY ar.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.merchant_agents_with_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.merchant_agent_detail(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_my uuid;
  v_pid uuid;
  v_y_start timestamptz;
  v_y_end timestamptz;
  v_today_start timestamptz;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT id INTO v_my FROM public.merchants WHERE user_id = v_uid;
  IF v_my IS NULL THEN RAISE EXCEPTION '不是商家'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.agent_relations
                WHERE user_id = _user_id AND bound_merchant_id = v_my AND is_agent = true) THEN
    RAISE EXCEPTION '该用户不是本店代理';
  END IF;

  SELECT id INTO v_pid FROM public.profiles WHERE user_id = _user_id;

  v_today_start := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_y_start := v_today_start - interval '1 day';
  v_y_end   := v_today_start;

  SELECT jsonb_build_object(
    'user_id', _user_id,
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.user_id = _user_id),
    'relation', (SELECT to_jsonb(ar) FROM public.agent_relations ar WHERE ar.user_id = _user_id),
    'customer_count', (SELECT count(*) FROM public.agent_relations WHERE upline_id = v_pid AND is_agent = false),
    'agent_invitee_count', (SELECT count(*) FROM public.agent_relations WHERE upline_id = v_pid AND is_agent = true),
    'yesterday_income', COALESCE((SELECT sum(amount) FROM public.commission_records
       WHERE beneficiary_id = _user_id AND created_at >= v_y_start AND created_at < v_y_end), 0),
    'today_income', COALESCE((SELECT sum(amount) FROM public.commission_records
       WHERE beneficiary_id = _user_id AND created_at >= v_today_start), 0),
    'total_income', COALESCE((SELECT sum(amount) FROM public.commission_records
       WHERE beneficiary_id = _user_id), 0),
    'order_count', COALESCE((SELECT count(*) FROM public.commission_records
       WHERE beneficiary_id = _user_id), 0),
    'customers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', cp.user_id,
        'nickname', cp.nickname,
        'phone', cp.phone,
        'user_code', cp.user_code,
        'created_at', ar2.created_at
      ) ORDER BY ar2.created_at DESC)
      FROM public.agent_relations ar2
      JOIN public.profiles cp ON cp.user_id = ar2.user_id
      WHERE ar2.upline_id = v_pid AND ar2.is_agent = false
      LIMIT 200
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.merchant_agent_detail(uuid) TO authenticated;
