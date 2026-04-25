
-- ============ 角色枚举 ============
CREATE TYPE public.app_role AS ENUM ('buyer', 'agent', 'merchant', 'admin');
CREATE TYPE public.merchant_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE public.product_status AS ENUM ('draft', 'published', 'unpublished');
CREATE TYPE public.product_result AS ENUM ('pending', 'won', 'lost');
CREATE TYPE public.order_status AS ENUM ('pending', 'paid', 'refunded', 'cancelled');
CREATE TYPE public.tx_type AS ENUM ('recharge', 'purchase', 'commission', 'withdraw', 'refund', 'admin_adjust');
CREATE TYPE public.withdraw_status AS ENUM ('pending', 'approved', 'rejected', 'paid');

-- ============ 通用更新时间戳 ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============ profiles ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  user_code TEXT NOT NULL UNIQUE,
  nickname TEXT,
  avatar_url TEXT,
  phone TEXT,
  referrer_id UUID REFERENCES public.profiles(id),
  referred_merchant_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);

-- ============ user_roles ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- ============ merchants ============
CREATE TABLE public.merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_name TEXT NOT NULL,
  shop_avatar_url TEXT,
  shop_description TEXT,
  real_name TEXT,
  wechat_id TEXT,
  fans_count INTEGER DEFAULT 0,
  public_account TEXT,
  status merchant_status NOT NULL DEFAULT 'pending',
  total_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_merchants_updated BEFORE UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ merchant_applications ============
CREATE TABLE public.merchant_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  real_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  wechat_id TEXT,
  fans_count INTEGER DEFAULT 0,
  public_account TEXT,
  description TEXT,
  status merchant_status NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_applications ENABLE ROW LEVEL SECURITY;

-- ============ lottery_categories ============
CREATE TABLE public.lottery_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.lottery_categories ENABLE ROW LEVEL SECURITY;

-- ============ products ============
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.lottery_categories(id),
  issue_no TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  is_recommended BOOLEAN NOT NULL DEFAULT false,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid_content TEXT,
  disclaimer TEXT,
  publish_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reveal_at TIMESTAMPTZ,
  status product_status NOT NULL DEFAULT 'published',
  result product_result NOT NULL DEFAULT 'pending',
  result_note TEXT,
  sales_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_products_merchant ON public.products(merchant_id);
CREATE INDEX idx_products_category ON public.products(category_id);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ product_history（往期记录） ============
CREATE TABLE public.product_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  issue_no TEXT NOT NULL,
  content TEXT NOT NULL,
  result product_result NOT NULL DEFAULT 'pending',
  publish_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.product_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_history_product ON public.product_history(product_id);

-- ============ wallets ============
CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_recharge NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_commission NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

-- ============ wallet_transactions ============
CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type tx_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  reference_id UUID,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tx_user ON public.wallet_transactions(user_id, created_at DESC);

-- ============ orders ============
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id),
  amount NUMERIC(10,2) NOT NULL,
  agent_l1_id UUID REFERENCES public.profiles(id),
  agent_l2_id UUID REFERENCES public.profiles(id),
  status order_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_orders_buyer ON public.orders(buyer_id);
CREATE INDEX idx_orders_merchant ON public.orders(merchant_id);
CREATE UNIQUE INDEX idx_orders_paid_unique ON public.orders(buyer_id, product_id) WHERE status = 'paid';

-- ============ agent_relations ============
CREATE TABLE public.agent_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  upline_id UUID REFERENCES public.profiles(id),
  upline_l2_id UUID REFERENCES public.profiles(id),
  bound_merchant_id UUID REFERENCES public.merchants(id),
  agent_code TEXT UNIQUE,
  is_agent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_relations ENABLE ROW LEVEL SECURITY;

-- ============ commission_records ============
CREATE TABLE public.commission_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  beneficiary_id UUID NOT NULL REFERENCES auth.users(id),
  level INTEGER NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  rate NUMERIC(5,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.commission_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_commission_beneficiary ON public.commission_records(beneficiary_id);

-- ============ commission_config ============
CREATE TABLE public.commission_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  l1_rate NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  l2_rate NUMERIC(5,4) NOT NULL DEFAULT 0.05,
  platform_rate NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.commission_config ENABLE ROW LEVEL SECURITY;

-- ============ withdrawals ============
CREATE TABLE public.withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  channel TEXT,
  account_info TEXT,
  status withdraw_status NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- ============ announcements ============
CREATE TABLE public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- ============ feedback ============
CREATE TABLE public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  contact TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- ============ 注册时自动创建 profile + wallet + buyer 角色 ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
BEGIN
  v_code := 'u' || lpad(floor(random()*100000000)::text, 8, '0');
  INSERT INTO public.profiles(user_id, user_code, nickname, phone)
    VALUES (NEW.id, v_code, COALESCE(NEW.raw_user_meta_data->>'nickname', '用户' || substr(v_code, 2, 4)), NEW.phone);
  INSERT INTO public.wallets(user_id) VALUES (NEW.id);
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'buyer');
  INSERT INTO public.agent_relations(user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ RLS 策略 ============

-- profiles: 自己可读改，其他人只读公开字段（这里允许全读，敏感字段在前端不展示）
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- user_roles: 用户读自己；管理员管所有
CREATE POLICY "roles_select_self" ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "roles_admin_manage" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- merchants: 已通过的对外可见；自己可读改；管理员所有
CREATE POLICY "merchants_select_public" ON public.merchants FOR SELECT USING (status = 'approved' OR auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "merchants_update_self" ON public.merchants FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "merchants_admin_all" ON public.merchants FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- merchant_applications: 自己读改；管理员所有
CREATE POLICY "ma_select_self" ON public.merchant_applications FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "ma_insert_self" ON public.merchant_applications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ma_admin_all" ON public.merchant_applications FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- lottery_categories: 公开读
CREATE POLICY "cat_select_all" ON public.lottery_categories FOR SELECT USING (true);
CREATE POLICY "cat_admin_manage" ON public.lottery_categories FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- products: 已发布对外可见，但 paid_content 在前端通过 server function 控制
-- 这里策略层面让所有人能 SELECT，前端默认 .select 字段时不取 paid_content；详情页解锁后通过 server function 返回
CREATE POLICY "products_select_published" ON public.products FOR SELECT
  USING (status = 'published' OR EXISTS(SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "products_merchant_manage" ON public.products FOR ALL
  USING (EXISTS(SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.user_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.user_id = auth.uid()));
CREATE POLICY "products_admin_all" ON public.products FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- product_history: 公开读；商家管自己的
CREATE POLICY "history_select_all" ON public.product_history FOR SELECT USING (true);
CREATE POLICY "history_merchant_manage" ON public.product_history FOR ALL
  USING (EXISTS(SELECT 1 FROM public.products p JOIN public.merchants m ON m.id = p.merchant_id WHERE p.id = product_id AND m.user_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.products p JOIN public.merchants m ON m.id = p.merchant_id WHERE p.id = product_id AND m.user_id = auth.uid()));
CREATE POLICY "history_admin_all" ON public.product_history FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- wallets: 自己读；管理员所有；不允许直接UPDATE，只能通过 RPC（这里给admin）
CREATE POLICY "wallets_select_self" ON public.wallets FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "wallets_admin_all" ON public.wallets FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- wallet_transactions: 自己读；admin 所有
CREATE POLICY "tx_select_self" ON public.wallet_transactions FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "tx_admin_all" ON public.wallet_transactions FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- orders: 买家读自己；商家读自己店铺；admin 所有
CREATE POLICY "orders_select_buyer" ON public.orders FOR SELECT USING (
  auth.uid() = buyer_id
  OR EXISTS(SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);
CREATE POLICY "orders_admin_all" ON public.orders FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- agent_relations: 自己读；admin 所有
CREATE POLICY "ar_select_self" ON public.agent_relations FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "ar_update_self" ON public.agent_relations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ar_admin_all" ON public.agent_relations FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- commission_records: 受益人可读；admin 所有
CREATE POLICY "comm_select_self" ON public.commission_records FOR SELECT USING (auth.uid() = beneficiary_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "comm_admin_all" ON public.commission_records FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- commission_config: 公开读，仅 admin 可改
CREATE POLICY "cc_select_all" ON public.commission_config FOR SELECT USING (true);
CREATE POLICY "cc_admin_manage" ON public.commission_config FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- withdrawals: 自己读改；admin 所有
CREATE POLICY "wd_select_self" ON public.withdrawals FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "wd_insert_self" ON public.withdrawals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wd_admin_all" ON public.withdrawals FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- announcements: 公开读
CREATE POLICY "ann_select_active" ON public.announcements FOR SELECT USING (is_active = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "ann_admin_manage" ON public.announcements FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- feedback: 任何登录用户可写，自己可读，admin 全部
CREATE POLICY "fb_insert_any" ON public.feedback FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "fb_select_self" ON public.feedback FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "fb_admin_all" ON public.feedback FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ============ 默认数据 ============
INSERT INTO public.lottery_categories(code, name, sort_order) VALUES
  ('fc3d', '福彩3D', 1),
  ('lhc', '六合彩', 2),
  ('fc', '足彩', 3);

INSERT INTO public.commission_config(l1_rate, l2_rate, platform_rate) VALUES (0.10, 0.05, 0.15);

INSERT INTO public.announcements(title, content, is_active) VALUES
  ('平台公告', '欢迎来到内容预测平台。所有付费内容仅供参考，请理性消费。', true);
