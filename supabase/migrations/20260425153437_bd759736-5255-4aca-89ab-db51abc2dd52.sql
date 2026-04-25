
-- 购买商品（原子）
CREATE OR REPLACE FUNCTION public.purchase_product(_product_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
BEGIN
  IF v_buyer IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT * INTO v_product FROM public.products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND OR v_product.status <> 'published' THEN RAISE EXCEPTION '商品不存在或已下架'; END IF;

  -- 已购买
  IF EXISTS(SELECT 1 FROM public.orders WHERE buyer_id = v_buyer AND product_id = _product_id AND status = 'paid') THEN
    RAISE EXCEPTION '已购买过该商品';
  END IF;

  SELECT * INTO v_merchant FROM public.merchants WHERE id = v_product.merchant_id FOR UPDATE;
  SELECT * INTO v_buyer_wallet FROM public.wallets WHERE user_id = v_buyer FOR UPDATE;

  IF v_buyer_wallet.balance < v_product.price THEN RAISE EXCEPTION '余额不足，请充值'; END IF;

  -- 取上级代理
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

  -- 创建订单
  INSERT INTO public.orders(buyer_id, product_id, merchant_id, amount, agent_l1_id, agent_l2_id, status, paid_at)
    VALUES (v_buyer, _product_id, v_product.merchant_id, v_product.price, v_agent_l1, v_agent_l2, 'paid', now())
    RETURNING id INTO v_order_id;

  -- 扣买家
  UPDATE public.wallets SET balance = balance - v_product.price, updated_at = now() WHERE user_id = v_buyer;
  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_buyer, 'purchase', -v_product.price, v_buyer_wallet.balance - v_product.price, v_order_id, '购买：' || v_product.title);

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
$$;

-- 管理员充值
CREATE OR REPLACE FUNCTION public.admin_recharge_user(_user_id UUID, _amount NUMERIC, _note TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_tx UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION '无权限'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION '金额必须大于0'; END IF;
  UPDATE public.wallets SET balance = balance + _amount, total_recharge = total_recharge + _amount, updated_at = now()
    WHERE user_id = _user_id RETURNING balance INTO v_balance;
  IF NOT FOUND THEN RAISE EXCEPTION '用户钱包不存在'; END IF;
  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description)
    VALUES (_user_id, 'recharge', _amount, v_balance, COALESCE(_note, '管理员充值'))
    RETURNING id INTO v_tx;
  RETURN v_tx;
END;
$$;

-- 提现
CREATE OR REPLACE FUNCTION public.submit_withdraw(_amount NUMERIC, _channel TEXT, _account_info TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_balance NUMERIC;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION '金额必须大于0'; END IF;
  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_balance < _amount THEN RAISE EXCEPTION '余额不足'; END IF;
  UPDATE public.wallets SET balance = balance - _amount, updated_at = now() WHERE user_id = v_uid;
  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, description)
    VALUES (v_uid, 'withdraw', -_amount, v_balance - _amount, '提现申请');
  INSERT INTO public.withdrawals(user_id, amount, channel, account_info)
    VALUES (v_uid, _amount, _channel, _account_info)
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 通过推广码绑定上级 + 商家
CREATE OR REPLACE FUNCTION public.bind_referrer(_agent_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_my RECORD;
  v_upline RECORD;
  v_upline_profile UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT * INTO v_my FROM public.agent_relations WHERE user_id = v_uid;
  IF v_my.upline_id IS NOT NULL THEN RETURN false; END IF; -- 已绑定

  -- 商家直码：MERCHANT_<id>  或  代理码：profiles.user_code
  IF _agent_code LIKE 'M_%' THEN
    UPDATE public.agent_relations SET bound_merchant_id = (SUBSTR(_agent_code, 3))::uuid WHERE user_id = v_uid;
    RETURN true;
  END IF;

  SELECT p.id, p.user_id INTO v_upline FROM public.profiles p WHERE p.user_code = _agent_code;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_upline.user_id = v_uid THEN RETURN false; END IF;

  -- 取上级的上级
  UPDATE public.agent_relations SET
    upline_id = v_upline.id,
    upline_l2_id = (SELECT upline_id FROM public.agent_relations WHERE user_id = v_upline.user_id),
    bound_merchant_id = COALESCE(bound_merchant_id, (SELECT bound_merchant_id FROM public.agent_relations WHERE user_id = v_upline.user_id))
  WHERE user_id = v_uid;

  UPDATE public.profiles SET referrer_id = v_upline.id WHERE user_id = v_uid;
  RETURN true;
END;
$$;

-- 申请成为代理（自助开通）
CREATE OR REPLACE FUNCTION public.become_agent()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT user_code INTO v_code FROM public.profiles WHERE user_id = v_uid;
  UPDATE public.agent_relations SET is_agent = true, agent_code = v_code WHERE user_id = v_uid;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;
  RETURN v_code;
END;
$$;
