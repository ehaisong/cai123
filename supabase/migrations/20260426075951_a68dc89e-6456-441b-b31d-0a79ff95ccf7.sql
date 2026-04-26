-- 1. 应用配置表
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 所有人可读（用于前端判断开关）
CREATE POLICY "settings_select_all" ON public.app_settings
  FOR SELECT USING (true);

-- 仅管理员可写
CREATE POLICY "settings_admin_manage" ON public.app_settings
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- 默认配置：余额购买开关，默认关闭
INSERT INTO public.app_settings (key, value)
VALUES ('wallet_purchase_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. 重写 purchase_product：根据开关决定是否扣余额
CREATE OR REPLACE FUNCTION public.purchase_product(_product_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer UUID := auth.uid();
  v_product RECORD;
  v_merchant RECORD;
  v_buyer_wallet RECORD;
  v_order_id UUID;
  v_agent_l1 UUID;
  v_agent_l2 UUID;
  v_cfg RECORD;
  v_l1_amount NUMERIC(10,2) := 0;
  v_l2_amount NUMERIC(10,2) := 0;
  v_platform_amount NUMERIC(10,2) := 0;
  v_merchant_amount NUMERIC(10,2) := 0;
  v_l1_user UUID;
  v_l2_user UUID;
  v_wallet_enabled BOOLEAN := false;
BEGIN
  IF v_buyer IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT * INTO v_product FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND OR v_product.status <> 'published' THEN RAISE EXCEPTION '商品不存在或已下架'; END IF;

  IF EXISTS(SELECT 1 FROM public.orders WHERE buyer_id = v_buyer AND product_id = _product_id AND status = 'paid') THEN
    RAISE EXCEPTION '已购买过该商品';
  END IF;

  SELECT * INTO v_merchant FROM public.merchants WHERE id = v_product.merchant_id FOR UPDATE;

  -- 读取「余额购买」开关
  SELECT COALESCE((value)::boolean, false) INTO v_wallet_enabled
    FROM public.app_settings WHERE key = 'wallet_purchase_enabled';

  IF v_wallet_enabled THEN
    SELECT * INTO v_buyer_wallet FROM public.wallets WHERE user_id = v_buyer FOR UPDATE;
    IF v_buyer_wallet.balance < v_product.price THEN RAISE EXCEPTION '余额不足，请充值'; END IF;
  END IF;

  SELECT upline_id, upline_l2_id INTO v_agent_l1, v_agent_l2 FROM public.agent_relations WHERE user_id = v_buyer;
  SELECT * INTO v_cfg FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  IF v_agent_l1 IS NOT NULL THEN
    v_l1_amount := round(v_product.price * v_cfg.l1_rate, 2);
    SELECT user_id INTO v_l1_user FROM public.profiles WHERE id = v_agent_l1;
  END IF;
  IF v_agent_l2 IS NOT NULL THEN
    v_l2_amount := round(v_product.price * v_cfg.l2_rate, 2);
    SELECT user_id INTO v_l2_user FROM public.profiles WHERE id = v_agent_l2;
  END IF;
  v_platform_amount := round(v_product.price * v_cfg.platform_rate, 2);
  v_merchant_amount := v_product.price - v_l1_amount - v_l2_amount - v_platform_amount;
  IF v_merchant_amount < 0 THEN v_merchant_amount := 0; END IF;

  INSERT INTO public.orders(buyer_id, product_id, merchant_id, amount, agent_l1_id, agent_l2_id, status, paid_at)
    VALUES (v_buyer, _product_id, v_product.merchant_id, v_product.price, v_agent_l1, v_agent_l2, 'paid', now())
    RETURNING id INTO v_order_id;

  -- 扣买家（仅当开关开启）
  IF v_wallet_enabled THEN
    UPDATE public.wallets SET balance = balance - v_product.price, updated_at = now() WHERE user_id = v_buyer;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_buyer, 'purchase', -v_product.price, v_buyer_wallet.balance - v_product.price, v_order_id, '购买：' || v_product.title);
  END IF;

  -- 商家入账
  UPDATE public.wallets SET balance = balance + v_merchant_amount, updated_at = now() WHERE user_id = v_merchant.user_id;
  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
    SELECT v_merchant.user_id, 'commission', v_merchant_amount, w.balance, v_order_id, '商品销售：' || v_product.title
    FROM public.wallets w WHERE w.user_id = v_merchant.user_id;
  UPDATE public.merchants SET total_sales = total_sales + v_product.price WHERE id = v_merchant.id;
  UPDATE public.products SET sales_count = sales_count + 1 WHERE id = _product_id;

  -- 一级代理分成
  IF v_l1_user IS NOT NULL AND v_l1_amount > 0 THEN
    UPDATE public.wallets SET balance = balance + v_l1_amount, total_commission = total_commission + v_l1_amount, updated_at = now()
      WHERE user_id = v_l1_user;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      SELECT v_l1_user, 'commission', v_l1_amount, w.balance, v_order_id, '一级分成：' || v_product.title
      FROM public.wallets w WHERE w.user_id = v_l1_user;
    INSERT INTO public.commission_records(order_id, beneficiary_id, level, amount, rate)
      VALUES (v_order_id, v_l1_user, 1, v_l1_amount, v_cfg.l1_rate);
  END IF;

  -- 二级代理分成
  IF v_l2_user IS NOT NULL AND v_l2_amount > 0 THEN
    UPDATE public.wallets SET balance = balance + v_l2_amount, total_commission = total_commission + v_l2_amount, updated_at = now()
      WHERE user_id = v_l2_user;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      SELECT v_l2_user, 'commission', v_l2_amount, w.balance, v_order_id, '二级分成：' || v_product.title
      FROM public.wallets w WHERE w.user_id = v_l2_user;
    INSERT INTO public.commission_records(order_id, beneficiary_id, level, amount, rate)
      VALUES (v_order_id, v_l2_user, 2, v_l2_amount, v_cfg.l2_rate);
  END IF;

  RETURN v_order_id;
END;
$function$;