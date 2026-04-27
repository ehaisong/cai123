-- ============ 1. 新表 product_issues ============
CREATE TABLE public.product_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  issue_no TEXT NOT NULL,
  paid_content TEXT,
  publish_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reveal_at TIMESTAMPTZ,
  result public.product_result NOT NULL DEFAULT 'pending',
  result_note TEXT,
  status public.product_status NOT NULL DEFAULT 'published',
  sales_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, issue_no)
);

CREATE INDEX idx_product_issues_product_publish ON public.product_issues(product_id, publish_at DESC);
CREATE INDEX idx_product_issues_pending_reveal ON public.product_issues(reveal_at)
  WHERE reveal_at IS NOT NULL AND result = 'pending';

ALTER TABLE public.product_issues ENABLE ROW LEVEL SECURITY;

-- 任何人可看「已发布且公开时间已到」的期
CREATE POLICY pi_select_public ON public.product_issues
  FOR SELECT USING (
    (status = 'published' AND publish_at <= now())
    OR EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.merchants m ON m.id = p.merchant_id
      WHERE p.id = product_issues.product_id AND m.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  );

-- 商家管理自己系列下的所有期
CREATE POLICY pi_merchant_manage ON public.product_issues
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.merchants m ON m.id = p.merchant_id
      WHERE p.id = product_issues.product_id AND m.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.merchants m ON m.id = p.merchant_id
      WHERE p.id = product_issues.product_id AND m.user_id = auth.uid()
    )
  );

-- 管理员
CREATE POLICY pi_admin_all ON public.product_issues
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- updated_at 触发器
CREATE TRIGGER trg_product_issues_updated_at
  BEFORE UPDATE ON public.product_issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 2. orders 增加 issue_id ============
ALTER TABLE public.orders ADD COLUMN issue_id UUID;
CREATE INDEX idx_orders_issue ON public.orders(issue_id) WHERE issue_id IS NOT NULL;

-- ============ 3. 数据回填 ============
-- 3.1 每个 product 的当期 → 一条 issue
INSERT INTO public.product_issues (
  product_id, issue_no, paid_content, publish_at, reveal_at,
  result, result_note, status, sales_count, created_at, updated_at
)
SELECT
  p.id, p.issue_no, p.paid_content, p.publish_at, p.reveal_at,
  p.result, p.result_note, p.status, p.sales_count, p.created_at, p.updated_at
FROM public.products p
WHERE p.issue_no IS NOT NULL AND p.issue_no <> ''
ON CONFLICT (product_id, issue_no) DO NOTHING;

-- 3.2 product_history → issue（仅保留尚未存在的期号）
INSERT INTO public.product_issues (
  product_id, issue_no, paid_content, publish_at, result, status, created_at
)
SELECT
  h.product_id, h.issue_no, h.content, h.publish_at, h.result, 'published'::product_status, h.created_at
FROM public.product_history h
ON CONFLICT (product_id, issue_no) DO NOTHING;

-- 3.3 老订单回填 issue_id（取该 product 的最新一期）
UPDATE public.orders o
SET issue_id = sub.issue_id
FROM (
  SELECT DISTINCT ON (product_id) product_id, id AS issue_id
  FROM public.product_issues
  ORDER BY product_id, publish_at DESC
) sub
WHERE o.product_id = sub.product_id AND o.issue_id IS NULL;

-- ============ 4. 升级 purchase_product 支持 _issue_id ============
CREATE OR REPLACE FUNCTION public.purchase_product(_product_id uuid, _issue_id uuid DEFAULT NULL)
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

  -- 期号：未传时取最新一期(已发布且 publish_at <= now())
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

  -- 同一买家同一期只能买一次（向下兼容：未取到 issue 时退回按 product 判重）
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
      VALUES (v_order_id, v_l1_user, 1, v_l1_amount, v_cfg.l1_rate);
  END IF;

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