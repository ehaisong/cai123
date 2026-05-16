-- 1) 默认平台抽成改为 8%
ALTER TABLE public.commission_config ALTER COLUMN platform_rate SET DEFAULT 0.08;
UPDATE public.commission_config SET platform_rate = 0.08, updated_at = now();

-- 2) 商家级平台抽成覆盖（NULL 表示沿用全局）
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS platform_rate numeric;

-- 3) 结算函数使用商家覆盖
CREATE OR REPLACE FUNCTION public.purchase_product(_product_id uuid, _issue_id uuid DEFAULT NULL::uuid, _shop_merchant_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer UUID := auth.uid();
  v_product RECORD;
  v_issue RECORD;
  v_merchant RECORD;
  v_buyer_wallet RECORD;
  v_order_id UUID;
  v_cfg RECORD;
  v_l1_rate NUMERIC(6,4) := 0;
  v_l1_amount NUMERIC(10,2) := 0;
  v_platform_rate NUMERIC(6,4) := 0;
  v_platform_amount NUMERIC(10,2) := 0;
  v_merchant_amount NUMERIC(10,2) := 0;
  v_l1_user UUID;
  v_agent_rate NUMERIC(6,4);
  v_wallet_enabled BOOLEAN := false;
  v_effective_merchant_id UUID;
  v_agent_l1_pid UUID;
BEGIN
  IF v_buyer IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT * INTO v_product FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND OR v_product.status <> 'published' THEN RAISE EXCEPTION '商品不存在或已下架'; END IF;

  v_effective_merchant_id := v_product.merchant_id;
  IF _shop_merchant_id IS NOT NULL AND _shop_merchant_id <> v_product.merchant_id THEN
    IF EXISTS(SELECT 1 FROM public.merchant_affiliations
               WHERE affiliate_merchant_id = _shop_merchant_id
                 AND host_merchant_id = v_product.merchant_id
                 AND status='approved') THEN
      v_effective_merchant_id := _shop_merchant_id;
    END IF;
  END IF;

  IF _issue_id IS NULL THEN
    SELECT * INTO v_issue FROM public.product_issues
      WHERE product_id = _product_id AND status = 'published' AND publish_at <= now()
      ORDER BY publish_at DESC LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO v_issue FROM public.product_issues
      WHERE id = _issue_id AND product_id = _product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '期号不存在'; END IF;
    IF v_issue.status <> 'published' THEN RAISE EXCEPTION '该期未发布'; END IF;
  END IF;

  IF v_issue.id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.orders WHERE buyer_id = v_buyer AND issue_id = v_issue.id AND status = 'paid') THEN
      RAISE EXCEPTION '已购买过该期';
    END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM public.orders WHERE buyer_id = v_buyer AND product_id = _product_id AND status = 'paid') THEN
      RAISE EXCEPTION '已购买过该商品';
    END IF;
  END IF;

  SELECT * INTO v_merchant FROM public.merchants WHERE id = v_effective_merchant_id FOR UPDATE;

  SELECT COALESCE((value)::boolean, false) INTO v_wallet_enabled
    FROM public.app_settings WHERE key = 'wallet_purchase_enabled';

  IF v_wallet_enabled THEN
    SELECT * INTO v_buyer_wallet FROM public.wallets WHERE user_id = v_buyer FOR UPDATE;
    IF v_buyer_wallet.balance < v_product.price THEN RAISE EXCEPTION '余额不足，请充值'; END IF;
  END IF;

  SELECT sm.upline_user_id, sm.l1_rate
    INTO v_l1_user, v_agent_rate
    FROM public.shop_memberships sm
    WHERE sm.user_id = v_buyer AND sm.merchant_id = v_effective_merchant_id
    LIMIT 1;

  SELECT * INTO v_cfg FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  -- 平台抽成：商家覆盖优先
  v_platform_rate := COALESCE(v_merchant.platform_rate, v_cfg.platform_rate, 0);

  IF v_l1_user IS NOT NULL THEN
    SELECT COALESCE(v_agent_rate, sm2.l1_rate, v_merchant.l1_rate, 0)
      INTO v_l1_rate
      FROM (SELECT 1) x
      LEFT JOIN public.shop_memberships sm2
        ON sm2.user_id = v_l1_user AND sm2.merchant_id = v_effective_merchant_id;
    v_l1_rate := COALESCE(v_l1_rate, 0);
    IF v_l1_rate > COALESCE(v_merchant.l1_max_rate, v_l1_rate) THEN v_l1_rate := v_merchant.l1_max_rate; END IF;
    v_l1_amount := round(v_product.price * v_l1_rate, 2);
    SELECT id INTO v_agent_l1_pid FROM public.profiles WHERE user_id = v_l1_user;
  END IF;

  v_platform_amount := round(v_product.price * v_platform_rate, 2);
  v_merchant_amount := v_product.price - v_l1_amount - v_platform_amount;
  IF v_merchant_amount < 0 THEN v_merchant_amount := 0; END IF;

  INSERT INTO public.orders(buyer_id, product_id, issue_id, merchant_id, amount, agent_l1_id, status, paid_at)
    VALUES (v_buyer, _product_id, v_issue.id, v_effective_merchant_id, v_product.price, v_agent_l1_pid, 'paid', now())
    RETURNING id INTO v_order_id;

  INSERT INTO public.shop_memberships(user_id, merchant_id, upline_user_id)
    VALUES (v_buyer, v_effective_merchant_id, v_l1_user)
    ON CONFLICT (user_id, merchant_id) DO NOTHING;

  IF v_wallet_enabled THEN
    UPDATE public.wallets SET balance = balance - v_product.price, updated_at = now() WHERE user_id = v_buyer;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_buyer, 'purchase', -v_product.price, v_buyer_wallet.balance - v_product.price, v_order_id, '购买：' || v_product.title);
  END IF;

  UPDATE public.wallets SET balance = balance + v_merchant_amount, updated_at = now() WHERE user_id = v_merchant.user_id;
  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
    SELECT v_merchant.user_id, 'commission', v_merchant_amount, w.balance, v_order_id, '商品销售：' || v_product.title
    FROM public.wallets w WHERE w.user_id = v_merchant.user_id;
  UPDATE public.merchants SET total_sales = total_sales + v_product.price WHERE id = v_merchant.id;
  UPDATE public.products SET sales_count = sales_count + 1 WHERE id = _product_id;
  IF v_issue.id IS NOT NULL THEN
    UPDATE public.product_issues SET sales_count = sales_count + 1 WHERE id = v_issue.id;
  END IF;

  IF v_l1_user IS NOT NULL AND v_l1_amount > 0 THEN
    UPDATE public.wallets SET balance = balance + v_l1_amount, total_commission = total_commission + v_l1_amount, updated_at = now()
      WHERE user_id = v_l1_user;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      SELECT v_l1_user, 'commission', v_l1_amount, w.balance, v_order_id, '一级分成：' || v_product.title
      FROM public.wallets w WHERE w.user_id = v_l1_user;
    INSERT INTO public.commission_records(order_id, beneficiary_id, level, amount, rate)
      VALUES (v_order_id, v_l1_user, 1, v_l1_amount, v_l1_rate);
  END IF;

  RETURN v_order_id;
END $function$;

-- 4) 同步更新 validate_merchant_commission：允许 platform_rate 覆盖且校验 L1+平台<=100%
CREATE OR REPLACE FUNCTION public.validate_merchant_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg RECORD;
  v_effective_platform NUMERIC;
BEGIN
  SELECT l1_max_rate, platform_rate INTO v_cfg
    FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  IF NEW.l1_max_rate IS NULL OR NEW.l1_max_rate < 0 THEN
    RAISE EXCEPTION '商家分成上限不能为空或为负';
  END IF;
  IF v_cfg.l1_max_rate IS NOT NULL AND NEW.l1_max_rate > v_cfg.l1_max_rate THEN
    RAISE EXCEPTION '商家分成上限不能超过平台上限 %', v_cfg.l1_max_rate;
  END IF;

  IF NEW.l1_rate IS NULL OR NEW.l1_rate < 0 THEN
    RAISE EXCEPTION '一级分成比例不能为空或为负';
  END IF;
  IF NEW.l1_rate > NEW.l1_max_rate THEN
    RAISE EXCEPTION '一级分成比例不能超过商家上限 %', NEW.l1_max_rate;
  END IF;

  NEW.l2_enabled := false;
  NEW.l2_rate := 0;

  IF NEW.platform_rate IS NOT NULL AND (NEW.platform_rate < 0 OR NEW.platform_rate > 1) THEN
    RAISE EXCEPTION '平台抽成需在 0-1 之间';
  END IF;

  v_effective_platform := COALESCE(NEW.platform_rate, v_cfg.platform_rate, 0);
  IF (NEW.l1_rate + v_effective_platform) > 1 THEN
    RAISE EXCEPTION 'L1 + 平台抽成 不能超过 100%%';
  END IF;
  RETURN NEW;
END;
$function$;