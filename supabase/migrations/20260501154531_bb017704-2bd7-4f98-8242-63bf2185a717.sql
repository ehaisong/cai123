ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wechat_openid TEXT,
  ADD COLUMN IF NOT EXISTS wechat_unionid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_wechat_openid_key
  ON public.profiles (wechat_openid)
  WHERE wechat_openid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_wechat_unionid_key
  ON public.profiles (wechat_unionid)
  WHERE wechat_unionid IS NOT NULL;

CREATE OR REPLACE FUNCTION public.find_user_by_wechat(_openid TEXT, _unionid TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  IF _unionid IS NOT NULL THEN
    SELECT user_id INTO v_uid FROM public.profiles
      WHERE wechat_unionid = _unionid LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;
  IF _openid IS NOT NULL THEN
    SELECT user_id INTO v_uid FROM public.profiles
      WHERE wechat_openid = _openid LIMIT 1;
  END IF;
  RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.bind_wechat_to_profile(
  _user_id UUID,
  _openid TEXT,
  _unionid TEXT,
  _nickname TEXT,
  _avatar TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET wechat_openid = COALESCE(_openid, wechat_openid),
         wechat_unionid = COALESCE(_unionid, wechat_unionid),
         nickname = COALESCE(NULLIF(nickname, ''), _nickname),
         avatar_url = COALESCE(avatar_url, _avatar),
         updated_at = now()
   WHERE user_id = _user_id;
END;
$$;