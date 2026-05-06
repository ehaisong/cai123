
-- 1. 商家表：新增管理员为该商家设置的分成上限
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS l1_max_rate numeric(6,4) NOT NULL DEFAULT 0.10;

UPDATE public.merchants SET l1_max_rate = 0.10 WHERE l1_max_rate IS NULL;

-- 2. 代理关系表：新增单个代理的分成比例（可选，未设置则使用商家默认）
ALTER TABLE public.agent_relations
  ADD COLUMN IF NOT EXISTS l1_rate numeric(6,4);

-- 3. 平台配置：默认一级上限设为 92%
UPDATE public.commission_config
  SET l1_max_rate = 0.92,
      l2_max_rate = 0,
      updated_at = now();

-- 4. 重写商家分成校验：l1_rate 不超过 l1_max_rate；二级强制关闭
CREATE OR REPLACE FUNCTION public.validate_merchant_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg RECORD;
BEGIN
  SELECT l1_max_rate, platform_rate
    INTO v_cfg
    FROM public.commission_config
    ORDER BY updated_at DESC LIMIT 1;

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

  -- 强制关闭二级
  NEW.l2_enabled := false;
  NEW.l2_rate := 0;

  IF (NEW.l1_rate + COALESCE(v_cfg.platform_rate, 0)) > 1 THEN
    RAISE EXCEPTION 'L1 + 平台抽成 不能超过 100%%';
  END IF;
  RETURN NEW;
END;
$function$;

-- 5. 商家为旗下代理设置/重置单独分成比例
CREATE OR REPLACE FUNCTION public.merchant_set_agent_rate(_user_id uuid, _rate numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_my uuid; v_max numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT id, l1_max_rate INTO v_my, v_max FROM public.merchants
    WHERE user_id=v_uid AND status='approved' AND is_disabled=false;
  IF v_my IS NULL THEN RAISE EXCEPTION '您不是已通过审核的商家'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.agent_relations
      WHERE user_id=_user_id AND bound_merchant_id=v_my AND is_agent=true) THEN
    RAISE EXCEPTION '该用户不是本店代理';
  END IF;
  IF _rate IS NOT NULL THEN
    IF _rate < 0 THEN RAISE EXCEPTION '分成比例不能为负'; END IF;
    IF _rate > v_max THEN RAISE EXCEPTION '分成比例不能超过商家上限 %', v_max; END IF;
  END IF;
  UPDATE public.agent_relations SET l1_rate = _rate WHERE user_id=_user_id;
END $function$;

-- 6. 购买商品：优先按单个代理分成，否则按商家默认；不再有二级
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
  v_agent_l1 UUID;
  v_cfg RECORD;
  v_l1_rate NUMERIC(6,4) := 0;
  v_l1_amount NUMERIC(10,2) := 0;
  v_platform_amount NUMERIC(10,2) := 0;
  v_merchant_amount NUMERIC(10,2) := 0;
  v_l1_user UUID;
  v_agent_rate NUMERIC(6,4);
  v_wallet_enabled BOOLEAN := false;
  v_effective_merchant_id UUID;
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

  SELECT upline_id, l1_rate INTO v_agent_l1, v_agent_rate
    FROM public.agent_relations WHERE user_id = v_buyer;
  SELECT * INTO v_cfg FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  IF v_agent_l1 IS NOT NULL THEN
    SELECT user_id, ar.l1_rate INTO v_l1_user, v_agent_rate
      FROM public.profiles p
      LEFT JOIN public.agent_relations ar ON ar.user_id = p.user_id
      WHERE p.id = v_agent_l1;
    v_l1_rate := COALESCE(v_agent_rate, v_merchant.l1_rate, 0);
    IF v_l1_rate > COALESCE(v_merchant.l1_max_rate, v_l1_rate) THEN v_l1_rate := v_merchant.l1_max_rate; END IF;
    v_l1_amount := round(v_product.price * v_l1_rate, 2);
  END IF;
  v_platform_amount := round(v_product.price * v_cfg.platform_rate, 2);
  v_merchant_amount := v_product.price - v_l1_amount - v_platform_amount;
  IF v_merchant_amount < 0 THEN v_merchant_amount := 0; END IF;

  INSERT INTO public.orders(buyer_id, product_id, issue_id, merchant_id, amount, agent_l1_id, status, paid_at)
    VALUES (v_buyer, _product_id, v_issue.id, v_effective_merchant_id, v_product.price, v_agent_l1, 'paid', now())
    RETURNING id INTO v_order_id;

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

-- 7. 购买套餐：同步去除二级
CREATE OR REPLACE FUNCTION public.purchase_package(_package_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer UUID := auth.uid();
  v_pkg RECORD;
  v_merchant RECORD;
  v_buyer_wallet RECORD;
  v_sub_id UUID;
  v_agent_l1 UUID;
  v_cfg RECORD;
  v_l1_rate NUMERIC(6,4) := 0;
  v_l1_amount NUMERIC(10,2) := 0;
  v_platform_amount NUMERIC(10,2) := 0;
  v_merchant_amount NUMERIC(10,2) := 0;
  v_l1_user UUID;
  v_agent_rate NUMERIC(6,4);
  v_wallet_enabled BOOLEAN := false;
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_buyer IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT * INTO v_pkg FROM public.product_packages WHERE id = _package_id FOR UPDATE;
  IF NOT FOUND OR v_pkg.status <> 'published' THEN RAISE EXCEPTION '套餐不存在或已下架'; END IF;

  IF EXISTS(SELECT 1 FROM public.package_subscriptions
            WHERE buyer_id = v_buyer AND package_id = _package_id AND expires_at > now()) THEN
    RAISE EXCEPTION '该套餐订阅尚未到期';
  END IF;

  SELECT * INTO v_merchant FROM public.merchants WHERE id = v_pkg.merchant_id FOR UPDATE;

  SELECT COALESCE((value)::boolean, false) INTO v_wallet_enabled
    FROM public.app_settings WHERE key = 'wallet_purchase_enabled';

  IF v_wallet_enabled THEN
    SELECT * INTO v_buyer_wallet FROM public.wallets WHERE user_id = v_buyer FOR UPDATE;
    IF v_buyer_wallet.balance < v_pkg.price THEN RAISE EXCEPTION '积分不足，请充值'; END IF;
  END IF;

  SELECT upline_id INTO v_agent_l1 FROM public.agent_relations WHERE user_id = v_buyer;
  SELECT * INTO v_cfg FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  IF v_agent_l1 IS NOT NULL THEN
    SELECT user_id, ar.l1_rate INTO v_l1_user, v_agent_rate
      FROM public.profiles p
      LEFT JOIN public.agent_relations ar ON ar.user_id = p.user_id
      WHERE p.id = v_agent_l1;
    v_l1_rate := COALESCE(v_agent_rate, v_merchant.l1_rate, 0);
    IF v_l1_rate > COALESCE(v_merchant.l1_max_rate, v_l1_rate) THEN v_l1_rate := v_merchant.l1_max_rate; END IF;
    v_l1_amount := round(v_pkg.price * v_l1_rate, 2);
  END IF;
  v_platform_amount := round(v_pkg.price * v_cfg.platform_rate, 2);
  v_merchant_amount := v_pkg.price - v_l1_amount - v_platform_amount;
  IF v_merchant_amount < 0 THEN v_merchant_amount := 0; END IF;

  v_expires := now() + (v_pkg.duration_days || ' days')::interval;

  INSERT INTO public.package_subscriptions(buyer_id, package_id, merchant_id, starts_at, expires_at)
    VALUES (v_buyer, _package_id, v_pkg.merchant_id, now(), v_expires)
    RETURNING id INTO v_sub_id;

  IF v_wallet_enabled THEN
    UPDATE public.wallets SET balance = balance - v_pkg.price, updated_at = now() WHERE user_id = v_buyer;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_buyer, 'purchase', -v_pkg.price, v_buyer_wallet.balance - v_pkg.price, v_sub_id, '购买套餐：' || v_pkg.title);
  END IF;

  UPDATE public.wallets SET balance = balance + v_merchant_amount, updated_at = now() WHERE user_id = v_merchant.user_id;
  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
    SELECT v_merchant.user_id, 'commission', v_merchant_amount, w.balance, v_sub_id, '套餐销售：' || v_pkg.title
    FROM public.wallets w WHERE w.user_id = v_merchant.user_id;
  UPDATE public.merchants SET total_sales = total_sales + v_pkg.price WHERE id = v_merchant.id;
  UPDATE public.product_packages SET sales_count = sales_count + 1 WHERE id = _package_id;

  IF v_l1_user IS NOT NULL AND v_l1_amount > 0 THEN
    UPDATE public.wallets SET balance = balance + v_l1_amount, total_commission = total_commission + v_l1_amount, updated_at = now()
      WHERE user_id = v_l1_user;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      SELECT v_l1_user, 'commission', v_l1_amount, w.balance, v_sub_id, '一级分成（套餐）：' || v_pkg.title
      FROM public.wallets w WHERE w.user_id = v_l1_user;
  END IF;

  RETURN v_sub_id;
END $function$;
