-- 审核通过时：始终把代理的活跃归属切换到新商家
CREATE OR REPLACE FUNCTION public.review_agent_application(_id uuid, _approve boolean, _reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_app RECORD;
  v_merchant RECORD;
  v_code text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT * INTO v_app FROM public.agent_applications WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION '申请不存在'; END IF;
  IF v_app.status <> 'pending' THEN RAISE EXCEPTION '该申请已处理'; END IF;

  SELECT id, user_id INTO v_merchant FROM public.merchants WHERE id = v_app.merchant_id;
  IF NOT FOUND THEN RAISE EXCEPTION '商家不存在'; END IF;
  IF v_merchant.user_id <> v_uid AND NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION '无权审核';
  END IF;

  IF _approve THEN
    SELECT user_code INTO v_code FROM public.profiles WHERE user_id = v_app.user_id;
    -- 审核通过：始终切换 bound_merchant_id 到新商家（活跃归属）
    UPDATE public.agent_relations
      SET is_agent = true,
          agent_code = COALESCE(agent_code, v_code),
          bound_merchant_id = v_app.merchant_id
      WHERE user_id = v_app.user_id;
    INSERT INTO public.user_roles(user_id, role) VALUES (v_app.user_id, 'agent') ON CONFLICT DO NOTHING;
    INSERT INTO public.agent_merchant_bindings(user_id, merchant_id)
      VALUES (v_app.user_id, v_app.merchant_id) ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.agent_applications
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         reject_reason = CASE WHEN _approve THEN NULL ELSE _reason END,
         reviewed_by = v_uid,
         reviewed_at = now()
   WHERE id = _id;

  RETURN true;
END $function$;

-- 商家代理列表回退为仅按 bound_merchant_id 展示（旧归属商家不再看到）
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
  WHERE ar.is_agent = true AND ar.bound_merchant_id = v_my
  ORDER BY ar.created_at DESC;
END $function$;