
-- 1) Seed admin phone whitelist
INSERT INTO public.app_settings(key, value, updated_at)
VALUES ('admin_phones', '["13807674808","+8613807674808"]'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- 2) Bootstrap admin role function
CREATE OR REPLACE FUNCTION public.bootstrap_admin_role()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_phone TEXT;
  v_phone_norm TEXT;
  v_whitelist JSONB;
  v_match BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT phone INTO v_phone FROM auth.users WHERE id = v_uid;
  IF v_phone IS NULL OR v_phone = '' THEN RETURN false; END IF;

  -- normalize: strip leading + and 86 country code
  v_phone_norm := regexp_replace(v_phone, '^\+?86', '');
  v_phone_norm := regexp_replace(v_phone_norm, '\D', '', 'g');

  SELECT value INTO v_whitelist FROM public.app_settings WHERE key = 'admin_phones';
  IF v_whitelist IS NULL THEN RETURN false; END IF;

  SELECT EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(v_whitelist) AS p
    WHERE regexp_replace(regexp_replace(p, '^\+?86', ''), '\D', '', 'g') = v_phone_norm
  ) INTO v_match;

  IF NOT v_match THEN RETURN false; END IF;

  INSERT INTO public.user_roles(user_id, role)
    VALUES (v_uid, 'admin')
    ON CONFLICT DO NOTHING;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bootstrap_admin_role() TO authenticated;
