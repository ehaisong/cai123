
-- ============================================================
-- Phase 2: 分佣 / 代理 读路径全部切到 shop_memberships
-- ============================================================

-- 1) 购买商品（钱包支付直购）
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

  -- 读取 buyer 在本店的归属（shop_memberships 优先，找不到则不发放L1）
  SELECT sm.upline_user_id, sm.l1_rate
    INTO v_l1_user, v_agent_rate
    FROM public.shop_memberships sm
    WHERE sm.user_id = v_buyer AND sm.merchant_id = v_effective_merchant_id
    LIMIT 1;

  SELECT * INTO v_cfg FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  IF v_l1_user IS NOT NULL THEN
    -- 读取该上线代理在本店的分成比例（优先 shop_memberships，再退回商家默认）
    SELECT COALESCE(v_agent_rate, sm2.l1_rate, v_merchant.l1_rate, 0)
      INTO v_l1_rate
      FROM (SELECT 1) x
      LEFT JOIN public.shop_memberships sm2
        ON sm2.user_id = v_l1_user AND sm2.merchant_id = v_effective_merchant_id;
    v_l1_rate := COALESCE(v_l1_rate, 0);
    IF v_l1_rate > COALESCE(v_merchant.l1_max_rate, v_l1_rate) THEN v_l1_rate := v_merchant.l1_max_rate; END IF;
    v_l1_amount := round(v_product.price * v_l1_rate, 2);
    -- orders.agent_l1_id 历史是 profiles.id，保持兼容
    SELECT id INTO v_agent_l1_pid FROM public.profiles WHERE user_id = v_l1_user;
  END IF;

  v_platform_amount := round(v_product.price * COALESCE(v_cfg.platform_rate,0), 2);
  v_merchant_amount := v_product.price - v_l1_amount - v_platform_amount;
  IF v_merchant_amount < 0 THEN v_merchant_amount := 0; END IF;

  INSERT INTO public.orders(buyer_id, product_id, issue_id, merchant_id, amount, agent_l1_id, status, paid_at)
    VALUES (v_buyer, _product_id, v_issue.id, v_effective_merchant_id, v_product.price, v_agent_l1_pid, 'paid', now())
    RETURNING id INTO v_order_id;

  -- 自动登记 buyer 加入本店（首次购买视为入店；不覆盖既有归属）
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


-- 2) 真实支付到账后履约
CREATE OR REPLACE FUNCTION public._fulfill_product_purchase(_buyer uuid, _product_id uuid, _issue_id uuid, _shop_merchant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_issue RECORD;
  v_merchant RECORD;
  v_order_id uuid;
  v_cfg RECORD;
  v_l1_rate NUMERIC(6,4) := 0;
  v_l1_amount NUMERIC(10,2) := 0;
  v_platform_amount NUMERIC(10,2) := 0;
  v_merchant_amount NUMERIC(10,2) := 0;
  v_l1_user uuid;
  v_agent_rate NUMERIC(6,4);
  v_effective_merchant_id uuid;
  v_agent_l1_pid uuid;
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

  IF v_issue.id IS NOT NULL THEN
    SELECT id INTO v_order_id FROM public.orders
      WHERE buyer_id=_buyer AND issue_id=v_issue.id AND status='paid' LIMIT 1;
    IF v_order_id IS NOT NULL THEN RETURN v_order_id; END IF;
  END IF;

  SELECT * INTO v_merchant FROM public.merchants WHERE id = v_effective_merchant_id FOR UPDATE;

  SELECT sm.upline_user_id, sm.l1_rate
    INTO v_l1_user, v_agent_rate
    FROM public.shop_memberships sm
    WHERE sm.user_id = _buyer AND sm.merchant_id = v_effective_merchant_id
    LIMIT 1;

  SELECT * INTO v_cfg FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

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

  v_platform_amount := round(v_product.price * COALESCE(v_cfg.platform_rate,0), 2);
  v_merchant_amount := v_product.price - v_l1_amount - v_platform_amount;
  IF v_merchant_amount < 0 THEN v_merchant_amount := 0; END IF;

  INSERT INTO public.orders(buyer_id, product_id, issue_id, merchant_id, amount, agent_l1_id, status, paid_at)
    VALUES (_buyer, _product_id, v_issue.id, v_effective_merchant_id, v_product.price, v_agent_l1_pid, 'paid', now())
    RETURNING id INTO v_order_id;

  INSERT INTO public.shop_memberships(user_id, merchant_id, upline_user_id)
    VALUES (_buyer, v_effective_merchant_id, v_l1_user)
    ON CONFLICT (user_id, merchant_id) DO NOTHING;

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
END $function$;


-- 3) 套餐购买
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

  SELECT sm.upline_user_id, sm.l1_rate
    INTO v_l1_user, v_agent_rate
    FROM public.shop_memberships sm
    WHERE sm.user_id = v_buyer AND sm.merchant_id = v_pkg.merchant_id
    LIMIT 1;

  SELECT * INTO v_cfg FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  IF v_l1_user IS NOT NULL THEN
    SELECT COALESCE(v_agent_rate, sm2.l1_rate, v_merchant.l1_rate, 0)
      INTO v_l1_rate
      FROM (SELECT 1) x
      LEFT JOIN public.shop_memberships sm2
        ON sm2.user_id = v_l1_user AND sm2.merchant_id = v_pkg.merchant_id;
    v_l1_rate := COALESCE(v_l1_rate, 0);
    IF v_l1_rate > COALESCE(v_merchant.l1_max_rate, v_l1_rate) THEN v_l1_rate := v_merchant.l1_max_rate; END IF;
    v_l1_amount := round(v_pkg.price * v_l1_rate, 2);
  END IF;
  v_platform_amount := round(v_pkg.price * COALESCE(v_cfg.platform_rate,0), 2);
  v_merchant_amount := v_pkg.price - v_l1_amount - v_platform_amount;
  IF v_merchant_amount < 0 THEN v_merchant_amount := 0; END IF;

  v_expires := now() + (v_pkg.duration_days || ' days')::interval;

  INSERT INTO public.package_subscriptions(buyer_id, package_id, merchant_id, starts_at, expires_at)
    VALUES (v_buyer, _package_id, v_pkg.merchant_id, now(), v_expires)
    RETURNING id INTO v_sub_id;

  INSERT INTO public.shop_memberships(user_id, merchant_id, upline_user_id)
    VALUES (v_buyer, v_pkg.merchant_id, v_l1_user)
    ON CONFLICT (user_id, merchant_id) DO NOTHING;

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


-- 4) 申请代理 / 直接成为代理 / 审核
CREATE OR REPLACE FUNCTION public.apply_agent_for_merchant(_merchant_id uuid, _note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_merchant RECORD;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT id, status, user_id INTO v_merchant FROM public.merchants WHERE id = _merchant_id;
  IF NOT FOUND OR v_merchant.status <> 'approved' THEN
    RAISE EXCEPTION '商家不存在或未通过审核';
  END IF;
  IF v_merchant.user_id = v_uid THEN
    RAISE EXCEPTION '商家本人无法申请代理';
  END IF;

  IF EXISTS(SELECT 1 FROM public.shop_memberships
             WHERE user_id = v_uid AND merchant_id = _merchant_id AND is_agent = true) THEN
    RAISE EXCEPTION '您已是本店代理';
  END IF;

  INSERT INTO public.agent_applications(user_id, merchant_id, note, status)
  VALUES (v_uid, _merchant_id, _note, 'pending')
  ON CONFLICT (user_id, merchant_id) WHERE status = 'pending'
    DO UPDATE SET note = EXCLUDED.note, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;


CREATE OR REPLACE FUNCTION public.become_agent_for_merchant(_merchant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT;
  v_merchant RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT id, status INTO v_merchant FROM public.merchants WHERE id = _merchant_id;
  IF NOT FOUND OR v_merchant.status <> 'approved' THEN
    RAISE EXCEPTION '商家不存在或未通过审核';
  END IF;

  IF EXISTS (SELECT 1 FROM public.merchants WHERE id = _merchant_id AND user_id = v_uid) THEN
    RAISE EXCEPTION '商家本人无法申请代理';
  END IF;

  SELECT user_code INTO v_code FROM public.profiles WHERE user_id = v_uid;

  INSERT INTO public.shop_memberships(user_id, merchant_id, is_agent, agent_code)
    VALUES (v_uid, _merchant_id, true, v_code)
    ON CONFLICT (user_id, merchant_id) DO UPDATE
      SET is_agent = true,
          agent_code = COALESCE(public.shop_memberships.agent_code, EXCLUDED.agent_code);

  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'agent') ON CONFLICT DO NOTHING;

  -- 兼容老表（仍有少量历史读路径）
  UPDATE public.agent_relations SET is_agent = true, agent_code = COALESCE(agent_code, v_code)
    WHERE user_id = v_uid;
  INSERT INTO public.agent_merchant_bindings(user_id, merchant_id) VALUES (v_uid, _merchant_id)
    ON CONFLICT DO NOTHING;

  RETURN v_code;
END;
$function$;


CREATE OR REPLACE FUNCTION public.review_agent_application(_id uuid, _approve boolean, _reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_app RECORD;
  v_merchant RECORD;
  v_code text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT * INTO v_app FROM public.agent_applications WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION '申请不存在'; END IF;
  IF v_app.status <> 'pending' THEN RAISE EXCEPTION '该申请已处理'; END IF;

  SELECT id, user_id INTO v_merchant FROM public.merchants WHERE id = v_app.merchant_id;
  IF NOT FOUND THEN RAISE EXCEPTION '商家不存在'; END IF;
  IF v_merchant.user_id <> v_uid AND NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION '无权审核';
  END IF;

  IF _approve THEN
    SELECT user_code INTO v_code FROM public.profiles WHERE user_id = v_app.user_id;
    INSERT INTO public.shop_memberships(user_id, merchant_id, is_agent, agent_code)
      VALUES (v_app.user_id, v_app.merchant_id, true, v_code)
      ON CONFLICT (user_id, merchant_id) DO UPDATE
        SET is_agent = true,
            agent_code = COALESCE(public.shop_memberships.agent_code, EXCLUDED.agent_code);

    INSERT INTO public.user_roles(user_id, role) VALUES (v_app.user_id, 'agent') ON CONFLICT DO NOTHING;

    -- 兼容老表
    UPDATE public.agent_relations SET is_agent = true, agent_code = COALESCE(agent_code, v_code)
      WHERE user_id = v_app.user_id;
    INSERT INTO public.agent_merchant_bindings(user_id, merchant_id)
      VALUES (v_app.user_id, v_app.merchant_id) ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.agent_applications
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         reject_reason = CASE WHEN _approve THEN NULL ELSE _reason END,
         reviewed_by = v_uid,
         reviewed_at = now()
   WHERE id = _id;

  RETURN true;
END $function$;


-- 5) 商家后台代理列表 / 详情
CREATE OR REPLACE FUNCTION public.merchant_agents_with_stats()
 RETURNS TABLE(user_id uuid, agent_code text, l1_rate numeric, created_at timestamp with time zone, nickname text, phone text, user_code text, customer_count bigint, yesterday_income numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_my uuid;
  v_y_start timestamptz;
  v_y_end timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT m.id INTO v_my FROM public.merchants m WHERE m.user_id = v_uid;
  IF v_my IS NULL THEN RAISE EXCEPTION '不是商家'; END IF;

  v_y_start := (date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) - interval '1 day') AT TIME ZONE 'Asia/Shanghai';
  v_y_end   := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';

  RETURN QUERY
  SELECT
    sm.user_id,
    sm.agent_code,
    sm.l1_rate,
    sm.joined_at AS created_at,
    p.nickname,
    p.phone,
    p.user_code,
    COALESCE((
      SELECT count(*) FROM public.shop_memberships sm2
      WHERE sm2.upline_user_id = sm.user_id
        AND sm2.merchant_id = v_my
        AND sm2.is_agent = false
    ), 0) AS customer_count,
    COALESCE((
      SELECT sum(cr.amount) FROM public.commission_records cr
      JOIN public.orders o ON o.id = cr.order_id
      WHERE cr.beneficiary_id = sm.user_id
        AND o.merchant_id = v_my
        AND cr.created_at >= v_y_start
        AND cr.created_at <  v_y_end
    ), 0) AS yesterday_income
  FROM public.shop_memberships sm
  JOIN public.profiles p ON p.user_id = sm.user_id
  WHERE sm.is_agent = true AND sm.merchant_id = v_my
  ORDER BY sm.joined_at DESC;
END $function$;


CREATE OR REPLACE FUNCTION public.merchant_agent_detail(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_my uuid;
  v_y_start timestamptz;
  v_y_end timestamptz;
  v_today_start timestamptz;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT id INTO v_my FROM public.merchants WHERE user_id = v_uid;
  IF v_my IS NULL THEN RAISE EXCEPTION '不是商家'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.shop_memberships
                WHERE user_id = _user_id AND merchant_id = v_my AND is_agent = true) THEN
    RAISE EXCEPTION '该用户不是本店代理';
  END IF;

  v_today_start := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_y_start := v_today_start - interval '1 day';
  v_y_end   := v_today_start;

  SELECT jsonb_build_object(
    'user_id', _user_id,
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.user_id = _user_id),
    'membership', (SELECT to_jsonb(sm) FROM public.shop_memberships sm
                    WHERE sm.user_id = _user_id AND sm.merchant_id = v_my),
    'customer_count', (SELECT count(*) FROM public.shop_memberships
                        WHERE upline_user_id = _user_id AND merchant_id = v_my AND is_agent = false),
    'agent_invitee_count', (SELECT count(*) FROM public.shop_memberships
                              WHERE upline_user_id = _user_id AND merchant_id = v_my AND is_agent = true),
    'yesterday_income', COALESCE((SELECT sum(cr.amount) FROM public.commission_records cr
       JOIN public.orders o ON o.id = cr.order_id
       WHERE cr.beneficiary_id = _user_id AND o.merchant_id = v_my
         AND cr.created_at >= v_y_start AND cr.created_at < v_y_end), 0),
    'today_income', COALESCE((SELECT sum(cr.amount) FROM public.commission_records cr
       JOIN public.orders o ON o.id = cr.order_id
       WHERE cr.beneficiary_id = _user_id AND o.merchant_id = v_my
         AND cr.created_at >= v_today_start), 0),
    'total_income', COALESCE((SELECT sum(cr.amount) FROM public.commission_records cr
       JOIN public.orders o ON o.id = cr.order_id
       WHERE cr.beneficiary_id = _user_id AND o.merchant_id = v_my), 0),
    'order_count', COALESCE((SELECT count(*) FROM public.commission_records cr
       JOIN public.orders o ON o.id = cr.order_id
       WHERE cr.beneficiary_id = _user_id AND o.merchant_id = v_my), 0),
    'customers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', cp.user_id,
        'nickname', cp.nickname,
        'phone', cp.phone,
        'user_code', cp.user_code,
        'created_at', sm2.joined_at
      ) ORDER BY sm2.joined_at DESC)
      FROM public.shop_memberships sm2
      JOIN public.profiles cp ON cp.user_id = sm2.user_id
      WHERE sm2.upline_user_id = _user_id AND sm2.merchant_id = v_my AND sm2.is_agent = false
      LIMIT 200
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $function$;


-- 6) 商家给本店发消息 / 群发
CREATE OR REPLACE FUNCTION public.merchant_send_message(_user_id uuid, _title text, _content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_my uuid; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT id INTO v_my FROM public.merchants WHERE user_id=v_uid AND status='approved' AND is_disabled=false;
  IF v_my IS NULL THEN RAISE EXCEPTION '您不是已通过审核的商家'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.shop_memberships
     WHERE user_id=_user_id AND merchant_id=v_my
  ) THEN
    RAISE EXCEPTION '只能给本店代理或客户发送消息';
  END IF;
  INSERT INTO public.notifications(user_id, category, title, content, sender_id, sender_role)
    VALUES (_user_id, 'merchant_message', _title, _content, v_uid, 'merchant')
    RETURNING id INTO v_id;
  RETURN v_id;
END $function$;


CREATE OR REPLACE FUNCTION public.merchant_broadcast(_title text, _content text, _audience text DEFAULT 'all'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_my uuid; v_count int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT id INTO v_my FROM public.merchants WHERE user_id=v_uid AND status='approved' AND is_disabled=false;
  IF v_my IS NULL THEN RAISE EXCEPTION '您不是已通过审核的商家'; END IF;
  IF length(coalesce(_title,''))=0 THEN RAISE EXCEPTION '标题必填'; END IF;

  WITH targets AS (
    SELECT DISTINCT sm.user_id FROM public.shop_memberships sm
    WHERE sm.merchant_id = v_my
      AND (
        _audience='all'
        OR (_audience='agents' AND sm.is_agent=true)
        OR (_audience='customers' AND sm.is_agent=false)
      )
  ), ins AS (
    INSERT INTO public.notifications(user_id, category, title, content, sender_id, sender_role)
    SELECT user_id, 'merchant_message', _title, _content, v_uid, 'merchant' FROM targets
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;
  RETURN v_count;
END $function$;


-- 7) 商家给代理设置分成比例（写 shop_memberships.l1_rate）
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
  IF NOT EXISTS(SELECT 1 FROM public.shop_memberships
      WHERE user_id=_user_id AND merchant_id=v_my AND is_agent=true) THEN
    RAISE EXCEPTION '该用户不是本店代理';
  END IF;
  IF _rate IS NOT NULL THEN
    IF _rate < 0 THEN RAISE EXCEPTION '分成比例不能为负'; END IF;
    IF _rate > v_max THEN RAISE EXCEPTION '分成比例不能超过商家上限 %', v_max; END IF;
  END IF;
  UPDATE public.shop_memberships SET l1_rate = _rate
    WHERE user_id=_user_id AND merchant_id=v_my;
END $function$;
