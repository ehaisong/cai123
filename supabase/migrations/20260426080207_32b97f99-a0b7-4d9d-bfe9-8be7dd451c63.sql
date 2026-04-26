-- 清理 Demo 买家的钱包余额和充值/购买流水（开关默认关闭）
UPDATE public.wallets w
   SET balance = 0, total_recharge = 0, updated_at = now()
  FROM public.profiles p
 WHERE w.user_id = p.user_id AND p.nickname = 'Demo 普通用户';

DELETE FROM public.wallet_transactions wt
 USING public.profiles p
 WHERE wt.user_id = p.user_id
   AND p.nickname = 'Demo 普通用户'
   AND wt.type IN ('recharge', 'purchase');