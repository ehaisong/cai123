CREATE OR REPLACE FUNCTION public.find_user_by_wechat(_openid TEXT, _unionid TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_open TEXT := NULLIF(_openid, '');
  v_union TEXT := NULLIF(_unionid, '');
BEGIN
  IF v_union IS NOT NULL THEN
    SELECT user_id INTO v_uid FROM public.profiles
      WHERE wechat_unionid = v_union LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;
  IF v_open IS NOT NULL THEN
    SELECT user_id INTO v_uid FROM public.profiles
      WHERE wechat_openid = v_open LIMIT 1;
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
     SET wechat_openid = COALESCE(NULLIF(_openid, ''), wechat_openid),
         wechat_unionid = COALESCE(NULLIF(_unionid, ''), wechat_unionid),
         nickname = COALESCE(NULLIF(nickname, ''), NULLIF(_nickname, '')),
         avatar_url = COALESCE(avatar_url, NULLIF(_avatar, '')),
         updated_at = now()
   WHERE user_id = _user_id;
END;
$$;