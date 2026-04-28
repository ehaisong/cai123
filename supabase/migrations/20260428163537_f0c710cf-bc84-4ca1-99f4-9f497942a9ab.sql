-- Simplify merchant_applications: allow shop-name-only quick apply
ALTER TABLE public.merchant_applications
  ADD COLUMN IF NOT EXISTS shop_name TEXT,
  ALTER COLUMN real_name DROP NOT NULL,
  ALTER COLUMN phone DROP NOT NULL;

-- Backfill phone from auth.users for existing apps where missing
UPDATE public.merchant_applications ma
SET phone = u.phone
FROM auth.users u
WHERE ma.user_id = u.id AND (ma.phone IS NULL OR ma.phone = '') AND u.phone IS NOT NULL;
