ALTER TABLE public.payment_channels
  ADD COLUMN IF NOT EXISTS fee_rate numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS payment_channels_default_uniq
  ON public.payment_channels (provider) WHERE is_default;