
DO $$
DECLARE
  keep_admin uuid := 'c3a6b5f6-801b-4358-9691-462dd6e7490e';
  keep_demo  uuid := '725b6638-0d75-4c10-86a7-d210cd934834';
  keep_merchant uuid := 'b36f6413-2d03-47ee-83b9-9794f3cefdee';
BEGIN
  DELETE FROM public.commission_records;
  DELETE FROM public.wallet_transactions;
  DELETE FROM public.orders;
  DELETE FROM public.package_subscriptions;
  DELETE FROM public.payment_logs;
  DELETE FROM public.payment_orders;
  DELETE FROM public.withdrawals;
  DELETE FROM public.notifications;
  DELETE FROM public.feedback;
  DELETE FROM public.client_error_logs;
  DELETE FROM public.sms_codes;

  DELETE FROM public.agent_applications;
  DELETE FROM public.agent_merchant_bindings;
  DELETE FROM public.shop_memberships;
  DELETE FROM public.merchant_affiliations;
  DELETE FROM public.merchant_applications;

  -- break FK from agent_relations to merchants before deleting merchants
  UPDATE public.agent_relations
     SET bound_merchant_id = NULL, upline_id = NULL, upline_l2_id = NULL, is_agent = false, agent_code = NULL;

  DELETE FROM public.product_history WHERE product_id IN (SELECT id FROM public.products WHERE merchant_id <> keep_merchant);
  DELETE FROM public.product_issues  WHERE product_id IN (SELECT id FROM public.products WHERE merchant_id <> keep_merchant);
  DELETE FROM public.products WHERE merchant_id <> keep_merchant;
  DELETE FROM public.product_packages WHERE merchant_id <> keep_merchant;

  DELETE FROM public.merchants WHERE id <> keep_merchant;

  DELETE FROM public.user_kyc        WHERE user_id NOT IN (keep_admin, keep_demo);
  DELETE FROM public.user_roles      WHERE user_id NOT IN (keep_admin, keep_demo);
  DELETE FROM public.agent_relations WHERE user_id NOT IN (keep_admin, keep_demo);
  DELETE FROM public.wallets         WHERE user_id NOT IN (keep_admin, keep_demo);
  DELETE FROM public.profiles        WHERE user_id NOT IN (keep_admin, keep_demo);

  DELETE FROM auth.users WHERE id NOT IN (keep_admin, keep_demo);

  UPDATE public.wallets SET balance = 0, total_commission = 0, total_recharge = 0
    WHERE user_id IN (keep_admin, keep_demo);
  UPDATE public.merchants SET total_sales = 0 WHERE id = keep_merchant;
END $$;
