-- 1) commission_config 增加 L1/L2 上限
ALTER TABLE public.commission_config
  ADD COLUMN IF NOT EXISTS l1_max_rate numeric NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS l2_max_rate numeric NOT NULL DEFAULT 0.05;

-- 初始上限至少不低于当前默认值
UPDATE public.commission_config
   SET l1_max_rate = GREATEST(l1_max_rate, l1_rate),
       l2_max_rate = GREATEST(l2_max_rate, l2_rate);

-- 2) merchants 增加每商家的分成配置
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS l1_rate numeric NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS l2_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS l2_rate numeric NOT NULL DEFAULT 0;

-- 把现存商家初始化为全局默认值（向下兼容）
UPDATE public.merchants m
   SET l1_rate = COALESCE((SELECT l1_rate FROM public.commission_config ORDER BY updated_at DESC LIMIT 1), 0.10),
       l2_enabled = false,
       l2_rate = 0;

-- 3) 校验触发器：不超过管理员上限，且 L1+L2+platform <= 1
CREATE OR REPLACE FUNCTION public.validate_merchant_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg RECORD;
BEGIN
  SELECT l1_max_rate, l2_max_rate, platform_rate
    INTO v_cfg
    FROM public.commission_config
    ORDER BY updated_at DESC LIMIT 1;

  IF NEW.l1_rate IS NULL OR NEW.l1_rate < 0 THEN
    RAISE EXCEPTION '一级分成比例不能为空或为负';
  END IF;
  IF NEW.l2_rate IS NULL OR NEW.l2_rate < 0 THEN
    RAISE EXCEPTION '二级分成比例不能为空或为负';
  END IF;
  IF v_cfg.l1_max_rate IS NOT NULL AND NEW.l1_rate > v_cfg.l1_max_rate THEN
    RAISE EXCEPTION '一级分成比例不能超过平台上限 %', v_cfg.l1_max_rate;
  END IF;
  IF NEW.l2_enabled = true AND v_cfg.l2_max_rate IS NOT NULL AND NEW.l2_rate > v_cfg.l2_max_rate THEN
    RAISE EXCEPTION '二级分成比例不能超过平台上限 %', v_cfg.l2_max_rate;
  END IF;
  IF NEW.l2_enabled = false THEN
    NEW.l2_rate := 0;
  END IF;
  IF (NEW.l1_rate + COALESCE(NEW.l2_rate, 0) + COALESCE(v_cfg.platform_rate, 0)) > 1 THEN
    RAISE EXCEPTION 'L1 + L2 + 平台抽成 不能超过 100%%';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_merchant_commission ON public.merchants;
CREATE TRIGGER trg_validate_merchant_commission
  BEFORE INSERT OR UPDATE OF l1_rate, l2_rate, l2_enabled ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.validate_merchant_commission();

-- 4) 重写 purchase_product：按商家分成配置
CREATE OR REPLACE FUNCTION public.purchase_product(_product_id uuid, _issue_id uuid DEFAULT NULL::uuid)
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
  v_agent_l2 UUID;
  v_cfg RECORD;
  v_l1_rate NUMERIC(6,4) := 0;
  v_l2_rate NUMERIC(6,4) := 0;
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

  IF _issue_id IS NULL THEN
    SELECT * INTO v_issue FROM public.product_issues
      WHERE product_id = _product_id
        AND status = 'published'
        AND publish_at <= now()
      ORDER BY publish_at DESC LIMIT 1
      FOR UPDATE;
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

  SELECT * INTO v_merchant FROM public.merchants WHERE id = v_product.merchant_id FOR UPDATE;

  SELECT COALESCE((value)::boolean, false) INTO v_wallet_enabled
    FROM public.app_settings WHERE key = 'wallet_purchase_enabled';

  IF v_wallet_enabled THEN
    SELECT * INTO v_buyer_wallet FROM public.wallets WHERE user_id = v_buyer FOR UPDATE;
    IF v_buyer_wallet.balance < v_product.price THEN RAISE EXCEPTION '余额不足，请充值'; END IF;
  END IF;

  SELECT upline_id, upline_l2_id INTO v_agent_l1, v_agent_l2 FROM public.agent_relations WHERE user_id = v_buyer;
  SELECT * INTO v_cfg FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  -- 使用商家分成配置（默认仅一级；二级需商家显式开启）
  v_l1_rate := COALESCE(v_merchant.l1_rate, v_cfg.l1_rate);
  v_l2_rate := CASE WHEN v_merchant.l2_enabled THEN COALESCE(v_merchant.l2_rate, 0) ELSE 0 END;

  -- 上限保护
  IF v_l1_rate > COALESCE(v_cfg.l1_max_rate, v_l1_rate) THEN v_l1_rate := v_cfg.l1_max_rate; END IF;
  IF v_l2_rate > COALESCE(v_cfg.l2_max_rate, v_l2_rate) THEN v_l2_rate := v_cfg.l2_max_rate; END IF;

  IF v_agent_l1 IS NOT NULL THEN
    v_l1_amount := round(v_product.price * v_l1_rate, 2);
    SELECT user_id INTO v_l1_user FROM public.profiles WHERE id = v_agent_l1;
  END IF;
  IF v_agent_l2 IS NOT NULL AND v_l2_rate > 0 THEN
    v_l2_amount := round(v_product.price * v_l2_rate, 2);
    SELECT user_id INTO v_l2_user FROM public.profiles WHERE id = v_agent_l2;
  END IF;
  v_platform_amount := round(v_product.price * v_cfg.platform_rate, 2);
  v_merchant_amount := v_product.price - v_l1_amount - v_l2_amount - v_platform_amount;
  IF v_merchant_amount < 0 THEN v_merchant_amount := 0; END IF;

  INSERT INTO public.orders(buyer_id, product_id, issue_id, merchant_id, amount, agent_l1_id, agent_l2_id, status, paid_at)
    VALUES (v_buyer, _product_id, v_issue.id, v_product.merchant_id, v_product.price, v_agent_l1, v_agent_l2, 'paid', now())
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

  IF v_l2_user IS NOT NULL AND v_l2_amount > 0 THEN
    UPDATE public.wallets SET balance = balance + v_l2_amount, total_commission = total_commission + v_l2_amount, updated_at = now()
      WHERE user_id = v_l2_user;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      SELECT v_l2_user, 'commission', v_l2_amount, w.balance, v_order_id, '二级分成：' || v_product.title
      FROM public.wallets w WHERE w.user_id = v_l2_user;
    INSERT INTO public.commission_records(order_id, beneficiary_id, level, amount, rate)
      VALUES (v_order_id, v_l2_user, 2, v_l2_amount, v_l2_rate);
  END IF;

  RETURN v_order_id;
END;
$function$;