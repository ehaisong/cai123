
-- 1) 扩展 notifications：增加发件人字段
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS sender_id uuid,
  ADD COLUMN IF NOT EXISTS sender_role text;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read, created_at DESC);

-- 2) 管理员发送一对一消息给指定用户
CREATE OR REPLACE FUNCTION public.admin_send_message(_user_id uuid, _title text, _content text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION '无权限'; END IF;
  IF _user_id IS NULL OR length(coalesce(_title,''))=0 THEN RAISE EXCEPTION '参数无效'; END IF;
  INSERT INTO public.notifications(user_id, category, title, content, sender_id, sender_role)
    VALUES (_user_id, 'admin_message', _title, _content, v_uid, 'admin')
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 3) 管理员群发：audience = 'all' | 'merchants' | 'agents'
CREATE OR REPLACE FUNCTION public.admin_broadcast(_title text, _content text, _audience text DEFAULT 'all')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_count int;
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION '无权限'; END IF;
  IF length(coalesce(_title,''))=0 THEN RAISE EXCEPTION '标题必填'; END IF;

  WITH targets AS (
    SELECT DISTINCT user_id FROM (
      SELECT p.user_id FROM public.profiles p WHERE _audience='all'
      UNION
      SELECT m.user_id FROM public.merchants m WHERE _audience='merchants' AND m.status='approved'
      UNION
      SELECT ar.user_id FROM public.agent_relations ar WHERE _audience='agents' AND ar.is_agent=true
    ) t
  ), ins AS (
    INSERT INTO public.notifications(user_id, category, title, content, sender_id, sender_role)
    SELECT user_id, 'admin_message', _title, _content, v_uid, 'admin' FROM targets
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;
  RETURN v_count;
END $$;

-- 4) 商家发送一对一消息（仅限本店代理或本店客户）
CREATE OR REPLACE FUNCTION public.merchant_send_message(_user_id uuid, _title text, _content text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_my uuid; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT id INTO v_my FROM public.merchants WHERE user_id=v_uid AND status='approved' AND is_disabled=false;
  IF v_my IS NULL THEN RAISE EXCEPTION '您不是已通过审核的商家'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.agent_relations
     WHERE user_id=_user_id AND bound_merchant_id=v_my
  ) THEN
    RAISE EXCEPTION '只能给本店代理或客户发送消息';
  END IF;
  INSERT INTO public.notifications(user_id, category, title, content, sender_id, sender_role)
    VALUES (_user_id, 'merchant_message', _title, _content, v_uid, 'merchant')
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 5) 商家群发：audience = 'agents' | 'customers' | 'all'（本店所有绑定用户）
CREATE OR REPLACE FUNCTION public.merchant_broadcast(_title text, _content text, _audience text DEFAULT 'all')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_my uuid; v_count int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT id INTO v_my FROM public.merchants WHERE user_id=v_uid AND status='approved' AND is_disabled=false;
  IF v_my IS NULL THEN RAISE EXCEPTION '您不是已通过审核的商家'; END IF;
  IF length(coalesce(_title,''))=0 THEN RAISE EXCEPTION '标题必填'; END IF;

  WITH targets AS (
    SELECT DISTINCT ar.user_id FROM public.agent_relations ar
    WHERE ar.bound_merchant_id = v_my
      AND (
        _audience='all'
        OR (_audience='agents' AND ar.is_agent=true)
        OR (_audience='customers' AND ar.is_agent=false)
      )
  ), ins AS (
    INSERT INTO public.notifications(user_id, category, title, content, sender_id, sender_role)
    SELECT user_id, 'merchant_message', _title, _content, v_uid, 'merchant' FROM targets
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;
  RETURN v_count;
END $$;
