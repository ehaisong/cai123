
-- 防止同一用户重复提交 pending 申请
CREATE UNIQUE INDEX IF NOT EXISTS uniq_merchant_app_pending_per_user
  ON public.merchant_applications(user_id)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.admin_review_merchant_application(
  _id uuid,
  _approve boolean,
  _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app RECORD;
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION '无权限';
  END IF;

  SELECT * INTO v_app FROM public.merchant_applications WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '申请不存在'; END IF;
  IF v_app.status <> 'pending' THEN RAISE EXCEPTION '该申请已处理'; END IF;

  IF _approve THEN
    INSERT INTO public.merchants(
      user_id, shop_name, shop_avatar_url, real_name,
      wechat_id, fans_count, public_account, shop_description, status
    ) VALUES (
      v_app.user_id,
      COALESCE(v_app.shop_name, COALESCE(v_app.real_name, '') || ' 的店铺'),
      v_app.shop_avatar_url,
      v_app.real_name,
      v_app.wechat_id,
      v_app.fans_count,
      v_app.public_account,
      v_app.description,
      'approved'::merchant_status
    )
    ON CONFLICT (user_id) DO UPDATE SET
      shop_name = COALESCE(public.merchants.shop_name, EXCLUDED.shop_name),
      shop_avatar_url = COALESCE(public.merchants.shop_avatar_url, EXCLUDED.shop_avatar_url),
      real_name = COALESCE(public.merchants.real_name, EXCLUDED.real_name),
      wechat_id = COALESCE(public.merchants.wechat_id, EXCLUDED.wechat_id),
      fans_count = COALESCE(public.merchants.fans_count, EXCLUDED.fans_count),
      public_account = COALESCE(public.merchants.public_account, EXCLUDED.public_account),
      shop_description = COALESCE(public.merchants.shop_description, EXCLUDED.shop_description),
      status = 'approved'::merchant_status,
      updated_at = now();

    INSERT INTO public.user_roles(user_id, role)
      VALUES (v_app.user_id, 'merchant') ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.merchant_applications
     SET status = CASE WHEN _approve THEN 'approved'::merchant_status ELSE 'rejected'::merchant_status END,
         reject_reason = CASE WHEN _approve THEN NULL ELSE _reason END,
         reviewed_at = now(),
         reviewed_by = v_uid,
         updated_at = now()
   WHERE id = _id;
END $$;

-- 商家本人不需要执行；只允许 authenticated 调用，由内部 has_role 守门
REVOKE ALL ON FUNCTION public.admin_review_merchant_application(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_merchant_application(uuid, boolean, text) TO authenticated;
