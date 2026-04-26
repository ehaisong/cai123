-- 1) 支付通道表
CREATE TABLE public.payment_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('wechat','alipay','custom')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY pc_admin_all ON public.payment_channels
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY pc_select_enabled ON public.payment_channels
  FOR SELECT USING (is_enabled = true OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER pc_set_updated_at
  BEFORE UPDATE ON public.payment_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) 商家关联通道
ALTER TABLE public.merchants
  ADD COLUMN payment_channel_id UUID REFERENCES public.payment_channels(id) ON DELETE SET NULL;

CREATE INDEX idx_merchants_payment_channel ON public.merchants(payment_channel_id);

-- 3) 清理旧的单条配置（按用户要求清空）
DELETE FROM public.app_settings WHERE key IN ('payment_wechat','payment_alipay');