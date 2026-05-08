-- Allow product_purchase as a payment_orders.purpose
ALTER TABLE public.payment_orders DROP CONSTRAINT IF EXISTS payment_orders_purpose_check;
ALTER TABLE public.payment_orders ADD CONSTRAINT payment_orders_purpose_check
  CHECK (purpose IN ('recharge','test','product_purchase'));

-- Internal helper: fulfill a product purchase for a given buyer (called by webhook after successful payment)
-- Mirrors purchase_product but takes explicit buyer and skips wallet deduction (buyer paid with real money).
CREATE OR REPLACE FUNCTION public._fulfill_product_purchase(
  _buyer uuid, _product_id uuid, _issue_id uuid, _shop_merchant_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product RECORD;
  v_issue RECORD;
  v_merchant RECORD;
  v_order_id uuid;
  v_agent_l1 uuid;
  v_cfg RECORD;
  v_l1_rate NUMERIC(6,4) := 0;
  v_l1_amount NUMERIC(10,2) := 0;
  v_platform_amount NUMERIC(10,2) := 0;
  v_merchant_amount NUMERIC(10,2) := 0;
  v_l1_user uuid;
  v_agent_rate NUMERIC(6,4);
  v_effective_merchant_id uuid;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '商品不存在'; END IF;

  v_effective_merchant_id := v_product.merchant_id;
  IF _shop_merchant_id IS NOT NULL AND _shop_merchant_id <> v_product.merchant_id THEN
    IF EXISTS(SELECT 1 FROM public.merchant_affiliations
               WHERE affiliate_merchant_id = _shop_merchant_id
                 AND host_merchant_id = v_product.merchant_id
                 AND status='approved') THEN
      v_effective_merchant_id := _shop_merchant_id;
    END IF;
  END IF;

  IF _issue_id IS NOT NULL THEN
    SELECT * INTO v_issue FROM public.product_issues
      WHERE id = _issue_id AND product_id = _product_id FOR UPDATE;
  ELSE
    SELECT * INTO v_issue FROM public.product_issues
      WHERE product_id = _product_id AND status='published' AND publish_at <= now()
      ORDER BY publish_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  -- idempotency: if buyer already has paid order for this issue, return it
  IF v_issue.id IS NOT NULL THEN
    SELECT id INTO v_order_id FROM public.orders
      WHERE buyer_id=_buyer AND issue_id=v_issue.id AND status='paid' LIMIT 1;
    IF v_order_id IS NOT NULL THEN RETURN v_order_id; END IF;
  END IF;

  SELECT * INTO v_merchant FROM public.merchants WHERE id = v_effective_merchant_id FOR UPDATE;

  SELECT upline_id, l1_rate INTO v_agent_l1, v_agent_rate
    FROM public.agent_relations WHERE user_id = _buyer;
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
  v_platform_amount := round(v_product.price * COALESCE(v_cfg.platform_rate,0), 2);
  v_merchant_amount := v_product.price - v_l1_amount - v_platform_amount;
  IF v_merchant_amount < 0 THEN v_merchant_amount := 0; END IF;

  INSERT INTO public.orders(buyer_id, product_id, issue_id, merchant_id, amount, agent_l1_id, status, paid_at)
    VALUES (_buyer, _product_id, v_issue.id, v_effective_merchant_id, v_product.price, v_agent_l1, 'paid', now())
    RETURNING id INTO v_order_id;

  -- Merchant share
  UPDATE public.wallets SET balance = balance + v_merchant_amount, updated_at = now() WHERE user_id = v_merchant.user_id;
  IF NOT FOUND THEN
    INSERT INTO public.wallets(user_id, balance) VALUES (v_merchant.user_id, v_merchant_amount);
  END IF;
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
    IF NOT FOUND THEN
      INSERT INTO public.wallets(user_id, balance, total_commission) VALUES (v_l1_user, v_l1_amount, v_l1_amount);
    END IF;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      SELECT v_l1_user, 'commission', v_l1_amount, w.balance, v_order_id, '一级分成：' || v_product.title
      FROM public.wallets w WHERE w.user_id = v_l1_user;
    INSERT INTO public.commission_records(order_id, beneficiary_id, level, amount, rate)
      VALUES (v_order_id, v_l1_user, 1, v_l1_amount, v_l1_rate);
  END IF;

  RETURN v_order_id;
END $$;

-- Public RPC to create a payment order for purchasing a product/issue
CREATE OR REPLACE FUNCTION public.create_product_payment_order(
  _product_id uuid, _issue_id uuid, _pay_type text, _shop_merchant_id uuid DEFAULT NULL
) RETURNS TABLE(order_no text, amount numeric, subject text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_product RECORD;
  v_issue RECORD;
  v_no text;
  v_subject text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF _pay_type NOT IN ('wechat','alipay') THEN RAISE EXCEPTION '支付方式无效'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id=_product_id;
  IF NOT FOUND OR v_product.status<>'published' THEN RAISE EXCEPTION '商品不存在或已下架'; END IF;
  SELECT * INTO v_issue FROM public.product_issues WHERE id=_issue_id AND product_id=_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION '期号不存在'; END IF;
  IF v_issue.status<>'published' THEN RAISE EXCEPTION '该期未发布'; END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE buyer_id=v_uid AND issue_id=_issue_id AND status='paid') THEN
    RAISE EXCEPTION '您已购买过该期';
  END IF;
  v_subject := COALESCE(v_product.title,'付费内容');
  v_no := 'PROD_' || to_char(now(),'YYYYMMDDHH24MISS') || '_' || substr(replace(gen_random_uuid()::text,'-',''),1,8);
  INSERT INTO public.payment_orders(order_no, user_id, amount, pay_type, subject, purpose, metadata)
    VALUES (v_no, v_uid, v_product.price, _pay_type, v_subject, 'product_purchase',
            jsonb_build_object('product_id',_product_id,'issue_id',_issue_id,'shop_merchant_id',_shop_merchant_id));
  RETURN QUERY SELECT v_no, v_product.price, v_subject;
END $$;

-- Update mark_payment_paid: handle product_purchase by calling fulfillment helper
CREATE OR REPLACE FUNCTION public.mark_payment_paid(
  _order_no TEXT, _amount NUMERIC, _trade_no TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD;
  v_balance NUMERIC;
BEGIN
  SELECT * INTO v_order FROM public.payment_orders WHERE order_no = _order_no FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_order.status = 'paid' THEN RETURN TRUE; END IF;
  IF abs(v_order.amount - _amount) > 0.001 THEN
    RAISE EXCEPTION 'amount mismatch: expected % got %', v_order.amount, _amount;
  END IF;

  UPDATE public.payment_orders
    SET status='paid', trade_no=_trade_no, paid_at=now(), updated_at=now()
    WHERE order_no=_order_no;

  IF v_order.purpose = 'recharge' THEN
    UPDATE public.wallets
      SET balance = balance + v_order.amount,
          total_recharge = total_recharge + v_order.amount,
          updated_at = now()
      WHERE user_id = v_order.user_id
      RETURNING balance INTO v_balance;
    IF NOT FOUND THEN
      INSERT INTO public.wallets(user_id, balance, total_recharge)
        VALUES (v_order.user_id, v_order.amount, v_order.amount)
        RETURNING balance INTO v_balance;
    END IF;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_order.user_id, 'recharge', v_order.amount, v_balance, v_order.id,
              '在线充值 ' || v_order.order_no);
  ELSIF v_order.purpose = 'product_purchase' THEN
    PERFORM public._fulfill_product_purchase(
      v_order.user_id,
      (v_order.metadata->>'product_id')::uuid,
      NULLIF(v_order.metadata->>'issue_id','')::uuid,
      NULLIF(v_order.metadata->>'shop_merchant_id','')::uuid
    );
  END IF;

  RETURN TRUE;
END;
$$;