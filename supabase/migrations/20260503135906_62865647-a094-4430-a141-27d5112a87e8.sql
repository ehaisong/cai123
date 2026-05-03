CREATE OR REPLACE FUNCTION public.find_user_by_phone(_phone text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_norm TEXT;
BEGIN
  v_norm := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
  IF v_norm = '' THEN RETURN NULL; END IF;

  -- auth.users.phone 在 Supabase 中通常存为不带 + 的纯数字（如 "8613800001111"）
  SELECT id INTO v_uid
    FROM auth.users
   WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = v_norm
   ORDER BY created_at ASC
   LIMIT 1;

  RETURN v_uid;
END;
$$;