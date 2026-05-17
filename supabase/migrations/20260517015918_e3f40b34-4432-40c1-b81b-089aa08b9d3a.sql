DO $$
DECLARE
  v_admin uuid := 'c3a6b5f6-801b-4358-9691-462dd6e7490e';
  v_demo  uuid := '725b6638-0d75-4c10-86a7-d210cd934834';
  v_demo_merchant uuid := 'b36f6413-2d03-47ee-83b9-9794f3cefdee';
  v_keep uuid[] := ARRAY[v_admin, v_demo];
BEGIN
  -- Disable trigger that auto-creates rows on new users (not needed here, just safety)

  -- 1. delete commission/orders/wallet tx for non-keep users
  DELETE FROM public.commission_records
    WHERE beneficiary_id <> ALL(v_keep)
       OR order_id IN (SELECT id FROM public.orders WHERE buyer_id <> ALL(v_keep));
  DELETE FROM public.wallet_transactions WHERE user_id <> ALL(v_keep);
  DELETE FROM public.package_subscriptions WHERE buyer_id <> ALL(v_keep);
  DELETE FROM public.orders WHERE buyer_id <> ALL(v_keep);
  DELETE FROM public.withdrawals WHERE user_id <> ALL(v_keep);
  DELETE FROM public.payment_orders WHERE user_id <> ALL(v_keep);
  DELETE FROM public.payment_logs WHERE user_id IS NOT NULL AND user_id <> ALL(v_keep);

  -- 2. agent / membership / applications
  DELETE FROM public.shop_memberships;  -- truly start fresh
  DELETE FROM public.agent_applications;
  DELETE FROM public.agent_relations WHERE user_id <> ALL(v_keep);

  -- 3. notifications, feedback, kyc, client logs
  DELETE FROM public.notifications WHERE user_id <> ALL(v_keep);
  DELETE FROM public.feedback WHERE user_id IS NULL OR user_id <> ALL(v_keep);
  DELETE FROM public.user_kyc WHERE user_id <> ALL(v_keep);
  DELETE FROM public.client_error_logs WHERE user_id IS NOT NULL AND user_id <> ALL(v_keep);

  -- 4. other merchants: delete their products, issues, history, packages, affiliations, applications
  DELETE FROM public.merchant_affiliations
    WHERE affiliate_merchant_id <> v_demo_merchant OR host_merchant_id <> v_demo_merchant;
  DELETE FROM public.product_issues
    WHERE product_id IN (SELECT id FROM public.products WHERE merchant_id <> v_demo_merchant);
  DELETE FROM public.product_history
    WHERE product_id IN (SELECT id FROM public.products WHERE merchant_id <> v_demo_merchant);
  DELETE FROM public.products WHERE merchant_id <> v_demo_merchant;
  DELETE FROM public.product_packages WHERE merchant_id <> v_demo_merchant;
  DELETE FROM public.merchant_applications WHERE user_id <> ALL(v_keep);
  DELETE FROM public.merchants WHERE id <> v_demo_merchant;

  -- 5. profiles / wallets / roles for non-keep users
  DELETE FROM public.user_roles WHERE user_id <> ALL(v_keep);
  DELETE FROM public.wallets WHERE user_id <> ALL(v_keep);
  DELETE FROM public.profiles WHERE user_id <> ALL(v_keep);

  -- 6. finally delete auth users
  DELETE FROM auth.users WHERE id <> ALL(v_keep);

  -- 7. ensure roles for kept users
  INSERT INTO public.user_roles(user_id, role) VALUES (v_admin, 'admin')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_demo, 'merchant')
    ON CONFLICT DO NOTHING;
  -- clear stray agent_relations for kept users (reset to clean)
  UPDATE public.agent_relations
     SET is_agent=false, agent_code=NULL, upline_id=NULL, upline_l2_id=NULL,
         bound_merchant_id=NULL, l1_rate=NULL
    WHERE user_id = ANY(v_keep);
END $$;