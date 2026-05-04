-- ============ 1. products 表字段扩展 ============
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS types text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_presale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intro text,
  ADD COLUMN IF NOT EXISTS intro_images text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS paid_images text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS no_win_refund boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_in_zone boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_unlock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_self_issue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'legacy';

-- ============ 2. product_packages 表 ============
CREATE TABLE IF NOT EXISTS public.product_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  title text NOT NULL,
  logo_url text,
  types text[] NOT NULL DEFAULT '{}'::text[],
  duration_days integer NOT NULL DEFAULT 1,
  price numeric NOT NULL DEFAULT 0,
  intro text,
  intro_images text[] NOT NULL DEFAULT '{}'::text[],
  show_on_home boolean NOT NULL DEFAULT true,
  show_in_zone boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'published',
  sales_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pkg_select_public ON public.product_packages;
CREATE POLICY pkg_select_public ON public.product_packages FOR SELECT
  USING (status = 'published'
    OR EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = product_packages.merchant_id AND m.user_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS pkg_merchant_manage ON public.product_packages;
CREATE POLICY pkg_merchant_manage ON public.product_packages FOR ALL
  USING (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = product_packages.merchant_id AND m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = product_packages.merchant_id AND m.user_id = auth.uid()));

DROP POLICY IF EXISTS pkg_admin_all ON public.product_packages;
CREATE POLICY pkg_admin_all ON public.product_packages FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS update_product_packages_updated_at ON public.product_packages;
CREATE TRIGGER update_product_packages_updated_at BEFORE UPDATE ON public.product_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 3. package_subscriptions 表 ============
CREATE TABLE IF NOT EXISTS public.package_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  package_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  order_id uuid,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pkg_subs_buyer ON public.package_subscriptions(buyer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_pkg_subs_package ON public.package_subscriptions(package_id);

ALTER TABLE public.package_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subs_select_self ON public.package_subscriptions;
CREATE POLICY subs_select_self ON public.package_subscriptions FOR SELECT
  USING (auth.uid() = buyer_id
    OR EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = package_subscriptions.merchant_id AND m.user_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS subs_admin_all ON public.package_subscriptions;
CREATE POLICY subs_admin_all ON public.package_subscriptions FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ============ 4. purchase_package RPC ============
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
  v_order_id UUID;
  v_sub_id UUID;
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
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_buyer IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT * INTO v_pkg FROM public.product_packages WHERE id = _package_id FOR UPDATE;
  IF NOT FOUND OR v_pkg.status <> 'published' THEN RAISE EXCEPTION '套餐不存在或已下架'; END IF;

  -- 已有未到期订阅则禁止重复购买
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

  SELECT upline_id, upline_l2_id INTO v_agent_l1, v_agent_l2 FROM public.agent_relations WHERE user_id = v_buyer;
  SELECT * INTO v_cfg FROM public.commission_config ORDER BY updated_at DESC LIMIT 1;

  v_l1_rate := COALESCE(v_merchant.l1_rate, v_cfg.l1_rate);
  v_l2_rate := CASE WHEN v_merchant.l2_enabled THEN COALESCE(v_merchant.l2_rate, 0) ELSE 0 END;
  IF v_l1_rate > COALESCE(v_cfg.l1_max_rate, v_l1_rate) THEN v_l1_rate := v_cfg.l1_max_rate; END IF;
  IF v_l2_rate > COALESCE(v_cfg.l2_max_rate, v_l2_rate) THEN v_l2_rate := v_cfg.l2_max_rate; END IF;

  IF v_agent_l1 IS NOT NULL THEN
    v_l1_amount := round(v_pkg.price * v_l1_rate, 2);
    SELECT user_id INTO v_l1_user FROM public.profiles WHERE id = v_agent_l1;
  END IF;
  IF v_agent_l2 IS NOT NULL AND v_l2_rate > 0 THEN
    v_l2_amount := round(v_pkg.price * v_l2_rate, 2);
    SELECT user_id INTO v_l2_user FROM public.profiles WHERE id = v_agent_l2;
  END IF;
  v_platform_amount := round(v_pkg.price * v_cfg.platform_rate, 2);
  v_merchant_amount := v_pkg.price - v_l1_amount - v_l2_amount - v_platform_amount;
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

  IF v_l2_user IS NOT NULL AND v_l2_amount > 0 THEN
    UPDATE public.wallets SET balance = balance + v_l2_amount, total_commission = total_commission + v_l2_amount, updated_at = now()
      WHERE user_id = v_l2_user;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      SELECT v_l2_user, 'commission', v_l2_amount, w.balance, v_sub_id, '二级分成（套餐）：' || v_pkg.title
      FROM public.wallets w WHERE w.user_id = v_l2_user;
  END IF;

  RETURN v_sub_id;
END;
$function$;

-- ============ 5. storage bucket：商品图片 ============
INSERT INTO storage.buckets (id, name, public)
  VALUES ('product-images', 'product-images', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS product_images_public_read ON storage.objects;
CREATE POLICY product_images_public_read ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS product_images_owner_write ON storage.objects;
CREATE POLICY product_images_owner_write ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS product_images_owner_update ON storage.objects;
CREATE POLICY product_images_owner_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS product_images_owner_delete ON storage.objects;
CREATE POLICY product_images_owner_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images' AND auth.uid()::text = (storage.foldername(name))[1]);