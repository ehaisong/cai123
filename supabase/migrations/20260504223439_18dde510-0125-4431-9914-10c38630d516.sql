CREATE TABLE IF NOT EXISTS public.sms_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_codes_phone_created ON public.sms_codes (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_codes_expires ON public.sms_codes (expires_at);

ALTER TABLE public.sms_codes ENABLE ROW LEVEL SECURITY;

-- 仅服务端（service role）能访问；不创建任何 policy，等同 deny 所有客户端访问
CREATE POLICY "deny all to anon and authenticated"
  ON public.sms_codes
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
