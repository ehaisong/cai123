
-- 1) 订单表新增冻结字段
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS platform_fee numeric(12,2),
  ADD COLUMN IF NOT EXISTS platform_rate numeric(6,4);

-- 2) 回填历史已支付订单
WITH cfg AS (
  SELECT COALESCE(platform_rate, 0) AS r FROM public.commission_config ORDER BY updated_at DESC LIMIT 1
)
UPDATE public.orders o
   SET platform_rate = COALESCE(m.platform_rate, (SELECT r FROM cfg), 0),
       platform_fee  = round(o.amount * COALESCE(m.platform_rate, (SELECT r FROM cfg), 0), 2)
  FROM public.merchants m
 WHERE m.id = o.merchant_id
   AND o.platform_fee IS NULL;

-- 3) 更新 purchase_product
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

  INSERT INTO public.orders(buyer_id, product_id, issue_id, merchant_id, amount, agent_l1_id, status, paid_at, platform_fee, platform_rate)
    VALUES (v_buyer, _product_id, v_issue.id, v_effective_merchant_id, v_product.price, v_agent_l1_pid, 'paid', now(), v_platform_amount, v_platform_rate)
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

-- 4) 更新 _fulfill_product_purchase（在线支付成功后履约）
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
  v_platform_rate NUMERIC(6,4) := 0;
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

  INSERT INTO public.orders(buyer_id, product_id, issue_id, merchant_id, amount, agent_l1_id, status, paid_at, platform_fee, platform_rate)
    VALUES (_buyer, _product_id, v_issue.id, v_effective_merchant_id, v_product.price, v_agent_l1_pid, 'paid', now(), v_platform_amount, v_platform_rate)
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

-- 5) 平台财务统计：优先使用订单冻结字段
CREATE OR REPLACE FUNCTION public.admin_platform_income(
  _from timestamptz DEFAULT NULL,
  _to   timestamptz DEFAULT NULL,
  _merchant_id uuid DEFAULT NULL,
  _limit int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_default_rate numeric;
  v_today_start timestamptz;
  v_yest_start timestamptz;
  v_month_start timestamptz;
  v_from timestamptz;
  v_to timestamptz;
  v_summary jsonb;
  v_by_merchant jsonb;
  v_orders jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION '无权访问';
  END IF;

  SELECT COALESCE(platform_rate, 0) INTO v_default_rate
    FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;
  v_default_rate := COALESCE(v_default_rate, 0);

  v_today_start := date_trunc('day', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';
  v_yest_start  := v_today_start - interval '1 day';
  v_month_start := date_trunc('month', (now() AT TIME ZONE 'Asia/Shanghai')) AT TIME ZONE 'Asia/Shanghai';

  v_from := COALESCE(_from, '1970-01-01'::timestamptz);
  v_to   := COALESCE(_to,   now() + interval '1 day');

  WITH base AS (
    SELECT o.amount,
           COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, m.platform_rate, v_default_rate), 2)) AS plat,
           o.paid_at
      FROM public.orders o
      JOIN public.merchants m ON m.id = o.merchant_id
     WHERE o.status = 'paid'
       AND (_merchant_id IS NULL OR o.merchant_id = _merchant_id)
  )
  SELECT jsonb_build_object(
    'today',     COALESCE((SELECT sum(plat) FROM base WHERE paid_at >= v_today_start), 0),
    'yesterday', COALESCE((SELECT sum(plat) FROM base WHERE paid_at >= v_yest_start AND paid_at < v_today_start), 0),
    'month',     COALESCE((SELECT sum(plat) FROM base WHERE paid_at >= v_month_start), 0),
    'range',     COALESCE((SELECT sum(plat) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0),
    'range_orders', COALESCE((SELECT count(*) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0),
    'range_amount', COALESCE((SELECT sum(amount) FROM base WHERE paid_at >= v_from AND paid_at < v_to), 0),
    'total',     COALESCE((SELECT sum(plat) FROM base), 0),
    'total_orders', COALESCE((SELECT count(*) FROM base), 0),
    'default_rate', v_default_rate
  ) INTO v_summary;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY (t->>'platform_amount')::numeric DESC), '[]'::jsonb)
    INTO v_by_merchant
  FROM (
    SELECT m.id AS merchant_id,
           m.shop_name,
           COALESCE(m.platform_rate, v_default_rate) AS rate,
           count(o.id) AS order_count,
           COALESCE(sum(o.amount), 0) AS total_amount,
           COALESCE(sum(COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, m.platform_rate, v_default_rate), 2))), 0) AS platform_amount
      FROM public.orders o
      JOIN public.merchants m ON m.id = o.merchant_id
     WHERE o.status = 'paid'
       AND o.paid_at >= v_from AND o.paid_at < v_to
       AND (_merchant_id IS NULL OR o.merchant_id = _merchant_id)
     GROUP BY m.id, m.shop_name, m.platform_rate
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    INTO v_orders
  FROM (
    SELECT o.id AS order_id,
           o.amount,
           COALESCE(o.platform_fee, round(o.amount * COALESCE(o.platform_rate, m.platform_rate, v_default_rate), 2)) AS platform_amount,
           COALESCE(o.platform_rate, m.platform_rate, v_default_rate) AS rate,
           o.paid_at,
           o.merchant_id,
           m.shop_name,
           o.buyer_id,
           bp.nickname AS buyer_nickname,
           bp.user_code AS buyer_code,
           p.title AS product_title
      FROM public.orders o
      JOIN public.merchants m ON m.id = o.merchant_id
      LEFT JOIN public.profiles bp ON bp.user_id = o.buyer_id
      LEFT JOIN public.products p ON p.id = o.product_id
     WHERE o.status = 'paid'
       AND o.paid_at >= v_from AND o.paid_at < v_to
       AND (_merchant_id IS NULL OR o.merchant_id = _merchant_id)
     ORDER BY o.paid_at DESC
     LIMIT GREATEST(_limit, 1)
  ) t;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'by_merchant', v_by_merchant,
    'orders', v_orders
  );
END $$;
