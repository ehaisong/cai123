CREATE OR REPLACE FUNCTION public.review_agent_application(_id uuid, _approve boolean, _reason text DEFAULT NULL)
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
    INSERT INTO public.shop_memberships(user_id, merchant_id, is_agent, agent_code)
      VALUES (v_app.user_id, v_app.merchant_id, true, v_code)
      ON CONFLICT (user_id, merchant_id) DO UPDATE
        SET is_agent = true,
            agent_code = COALESCE(public.shop_memberships.agent_code, EXCLUDED.agent_code);

    INSERT INTO public.user_roles(user_id, role) VALUES (v_app.user_id, 'agent') ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.agent_applications
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         reject_reason = CASE WHEN _approve THEN NULL ELSE _reason END,
         reviewed_by = v_uid,
         reviewed_at = now()
   WHERE id = _id;

  RETURN true;
END $function$;