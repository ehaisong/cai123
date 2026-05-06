
DO $$ BEGIN
  CREATE TYPE public.affiliation_status AS ENUM ('pending','approved','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.merchant_affiliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_merchant_id uuid NOT NULL,
  host_merchant_id uuid NOT NULL,
  status public.affiliation_status NOT NULL DEFAULT 'pending',
  note text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (affiliate_merchant_id <> host_merchant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_affiliation
  ON public.merchant_affiliations (affiliate_merchant_id, host_merchant_id)
  WHERE status IN ('pending','approved');

CREATE INDEX IF NOT EXISTS idx_aff_affiliate ON public.merchant_affiliations(affiliate_merchant_id);
CREATE INDEX IF NOT EXISTS idx_aff_host ON public.merchant_affiliations(host_merchant_id);

ALTER TABLE public.merchant_affiliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aff_select_related ON public.merchant_affiliations;
CREATE POLICY aff_select_related ON public.merchant_affiliations
  FOR SELECT USING (
    has_role(auth.uid(),'admin'::app_role)
    OR EXISTS(SELECT 1 FROM public.merchants m WHERE m.user_id = auth.uid() AND m.id IN (affiliate_merchant_id, host_merchant_id))
  );

DROP POLICY IF EXISTS aff_admin_all ON public.merchant_affiliations;
CREATE POLICY aff_admin_all ON public.merchant_affiliations
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_aff_updated ON public.merchant_affiliations;
CREATE TRIGGER trg_aff_updated BEFORE UPDATE ON public.merchant_affiliations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.apply_affiliation(_host_merchant_id uuid, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_my uuid; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT id INTO v_my FROM public.merchants WHERE user_id = v_uid AND status='approved' AND is_disabled=false;
  IF v_my IS NULL THEN RAISE EXCEPTION '您不是已通过审核的商家'; END IF;
  IF v_my = _host_merchant_id THEN RAISE EXCEPTION '不能挂靠自己'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=_host_merchant_id AND status='approved' AND is_disabled=false) THEN
    RAISE EXCEPTION '目标商家不存在或不可用';
  END IF;
  IF EXISTS(SELECT 1 FROM public.merchant_affiliations WHERE affiliate_merchant_id=v_my AND host_merchant_id=_host_merchant_id AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION '已存在挂靠申请或关系';
  END IF;
  INSERT INTO public.merchant_affiliations(affiliate_merchant_id, host_merchant_id, note)
    VALUES (v_my, _host_merchant_id, _note) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.review_affiliation(_id uuid, _approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_row RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT * INTO v_row FROM public.merchant_affiliations WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '记录不存在'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=v_row.host_merchant_id AND user_id=v_uid) THEN
    RAISE EXCEPTION '无权审核';
  END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION '该申请已处理'; END IF;
  UPDATE public.merchant_affiliations
    SET status = CASE WHEN _approve THEN 'approved'::affiliation_status ELSE 'rejected'::affiliation_status END,
        reviewed_at = now(), reviewed_by = v_uid
    WHERE id=_id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_affiliation(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_row RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT * INTO v_row FROM public.merchant_affiliations WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '记录不存在'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.merchants WHERE id IN (v_row.affiliate_merchant_id, v_row.host_merchant_id) AND user_id=v_uid) THEN
    RAISE EXCEPTION '无权操作';
  END IF;
  IF v_row.status NOT IN ('pending','approved') THEN RAISE EXCEPTION '当前状态不可取消'; END IF;
  UPDATE public.merchant_affiliations SET status='cancelled', reviewed_at=now(), reviewed_by=v_uid WHERE id=_id;
END $$;

CREATE OR REPLACE FUNCTION public.shop_source_merchant_ids(_merchant_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT _merchant_id
  UNION
  SELECT host_merchant_id FROM public.merchant_affiliations
   WHERE affiliate_merchant_id = _merchant_id AND status='approved'
$$;

-- Drop old purchase_product overload to allow renaming the second param
DROP FUNCTION IF EXISTS public.purchase_product(uuid, uuid);

CREATE OR REPLACE FUNCTION public.purchase_product(_product_id uuid, _issue_id uuid DEFAULT NULL::uuid, _shop_merchant_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
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

  SELECT * INTO v_merchant FROM public.merchants WHERE id = v_effective_merchant_id FOR UPDATE;

  SELECT COALESCE((value)::boolean, false) INTO v_wallet_enabled
    FROM public.app_settings WHERE key = 'wallet_purchase_enabled';

  IF v_wallet_enabled THEN
    SELECT * INTO v_buyer_wallet FROM public.wallets WHERE user_id = v_buyer FOR UPDATE;
    IF v_buyer_wallet.balance < v_product.price THEN RAISE EXCEPTION '余额不足，请充值'; END IF;
  END IF;

  SELECT upline_id, upline_l2_id INTO v_agent_l1, v_agent_l2 FROM public.agent_relations WHERE user_id = v_buyer;
  SELECT * INTO v_cfg FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  v_l1_rate := COALESCE(v_merchant.l1_rate, v_cfg.l1_rate);
  v_l2_rate := CASE WHEN v_merchant.l2_enabled THEN COALESCE(v_merchant.l2_rate, 0) ELSE 0 END;
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
    VALUES (v_buyer, _product_id, v_issue.id, v_effective_merchant_id, v_product.price, v_agent_l1, v_agent_l2, 'paid', now())
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
END $function$;
