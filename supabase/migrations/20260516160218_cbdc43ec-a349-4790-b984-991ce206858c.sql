
DO $$
DECLARE
  v_keep_users uuid[] := ARRAY[
    '725b6638-0d75-4c10-86a7-d210cd934834'::uuid,
    'c3a6b5f6-801b-4358-9691-462dd6e7490e'::uuid
  ];
  v_demo_merchant uuid := 'b36f6413-2d03-47ee-83b9-9794f3cefdee';
BEGIN
  DELETE FROM public.commission_records;
  DELETE FROM public.wallet_transactions;
  DELETE FROM public.package_subscriptions;
  DELETE FROM public.orders;
  DELETE FROM public.payment_orders;
  DELETE FROM public.payment_logs;
  DELETE FROM public.withdrawals;
  DELETE FROM public.notifications;
  DELETE FROM public.feedback;
  DELETE FROM public.client_error_logs;
  DELETE FROM public.sms_codes;
  DELETE FROM public.user_kyc;
  DELETE FROM public.announcements;

  DELETE FROM public.agent_applications;
  DELETE FROM public.merchant_applications;
  DELETE FROM public.merchant_affiliations;
  DELETE FROM public.agent_merchant_bindings;
  DELETE FROM public.shop_memberships;

  -- 先全清 agent_relations，解除对 merchants 的外键
  DELETE FROM public.agent_relations;

  DELETE FROM public.product_history
    WHERE product_id IN (SELECT id FROM public.products WHERE merchant_id <> v_demo_merchant);
  DELETE FROM public.product_issues
    WHERE product_id IN (SELECT id FROM public.products WHERE merchant_id <> v_demo_merchant);
  DELETE FROM public.product_packages WHERE merchant_id <> v_demo_merchant;
  DELETE FROM public.products WHERE merchant_id <> v_demo_merchant;

  DELETE FROM public.merchants WHERE id <> v_demo_merchant;

  UPDATE public.merchants SET total_sales = 0 WHERE id = v_demo_merchant;
  UPDATE public.products  SET sales_count = 0 WHERE merchant_id = v_demo_merchant;
  UPDATE public.product_issues SET sales_count = 0
    WHERE product_id IN (SELECT id FROM public.products WHERE merchant_id = v_demo_merchant);

  DELETE FROM public.wallets    WHERE user_id <> ALL(v_keep_users);
  DELETE FROM public.user_roles WHERE user_id <> ALL(v_keep_users);
  DELETE FROM public.profiles   WHERE user_id <> ALL(v_keep_users);

  -- 为保留用户重建 agent_relations
  INSERT INTO public.agent_relations(user_id)
    SELECT unnest(v_keep_users)
    ON CONFLICT DO NOTHING;

  UPDATE public.wallets SET balance = 0, total_commission = 0, total_recharge = 0
    WHERE user_id = ANY(v_keep_users);

  DELETE FROM auth.users WHERE id <> ALL(v_keep_users);
END $$;
