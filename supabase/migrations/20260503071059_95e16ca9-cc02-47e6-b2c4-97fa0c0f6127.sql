
ALTER TABLE public.merchant_applications
  ADD COLUMN IF NOT EXISTS shop_avatar_url text;
