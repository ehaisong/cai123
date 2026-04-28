-- Prevent multiple pending applications per user (and per phone) at the database level
CREATE UNIQUE INDEX IF NOT EXISTS merchant_applications_user_pending_uniq
  ON public.merchant_applications(user_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS merchant_applications_phone_pending_uniq
  ON public.merchant_applications(phone)
  WHERE status = 'pending' AND phone IS NOT NULL;