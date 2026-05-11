
-- Agent applications: customers apply to be agent of a specific merchant; merchant reviews

CREATE TABLE IF NOT EXISTS public.agent_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  note text,
  reject_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_apps_merchant_status ON public.agent_applications(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_apps_user ON public.agent_applications(user_id);
-- 同一用户对同一商家只允许一条 pending
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_apps_pending
  ON public.agent_applications(user_id, merchant_id) WHERE status = 'pending';

ALTER TABLE public.agent_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY aa_admin_all ON public.agent_applications
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY aa_select_self ON public.agent_applications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY aa_select_merchant_owner ON public.agent_applications
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = agent_applications.merchant_id AND m.user_id = auth.uid()
  ));

CREATE POLICY aa_insert_self ON public.agent_applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_agent_apps_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_agent_apps_updated_at ON public.agent_applications;
CREATE TRIGGER trg_agent_apps_updated_at
  BEFORE UPDATE ON public.agent_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_agent_apps_updated_at();


-- 用户提交代理申请
CREATE OR REPLACE FUNCTION public.apply_agent_for_merchant(_merchant_id uuid, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_merchant RECORD;
  v_id uuid;
  v_existing RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT id, status, user_id INTO v_merchant FROM public.merchants WHERE id = _merchant_id;
  IF NOT FOUND OR v_merchant.status <> 'approved' THEN
    RAISE EXCEPTION '商家不存在或未通过审核';
  END IF;
  IF v_merchant.user_id = v_uid THEN
    RAISE EXCEPTION '商家本人无法申请代理';
  END IF;

  -- 已是该店代理：直接复用 become 逻辑（保持现状不变）
  SELECT is_agent, bound_merchant_id INTO v_existing FROM public.agent_relations WHERE user_id = v_uid;
  IF v_existing.is_agent = true AND v_existing.bound_merchant_id = _merchant_id THEN
    RAISE EXCEPTION '您已是本店代理';
  END IF;

  INSERT INTO public.agent_applications(user_id, merchant_id, note, status)
  VALUES (v_uid, _merchant_id, _note, 'pending')
  ON CONFLICT (user_id, merchant_id) WHERE status = 'pending'
    DO UPDATE SET note = EXCLUDED.note, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;


-- 商家审核代理申请
CREATE OR REPLACE FUNCTION public.review_agent_application(_id uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app RECORD;
  v_merchant RECORD;
  v_code text;
  v_existing RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT * INTO v_app FROM public.agent_applications WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION '申请不存在'; END IF;
  IF v_app.status <> 'pending' THEN RAISE EXCEPTION '该申请已处理'; END IF;

  SELECT id, user_id INTO v_merchant FROM public.merchants WHERE id = v_app.merchant_id;
  IF NOT FOUND THEN RAISE EXCEPTION '商家不存在'; END IF;
  IF v_merchant.user_id <> v_uid AND NOT has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION '无权审核';
  END IF;

  IF _approve THEN
    SELECT user_code INTO v_code FROM public.profiles WHERE user_id = v_app.user_id;
    SELECT is_agent, bound_merchant_id INTO v_existing FROM public.agent_relations WHERE user_id = v_app.user_id;

    IF v_existing.is_agent = true AND v_existing.bound_merchant_id IS NOT NULL
       AND v_existing.bound_merchant_id <> v_app.merchant_id THEN
      -- 已是其他商家代理：仅新增绑定，不抢占活跃归属
      INSERT INTO public.agent_merchant_bindings(user_id, merchant_id)
        VALUES (v_app.user_id, v_app.merchant_id) ON CONFLICT DO NOTHING;
    ELSE
      UPDATE public.agent_relations
        SET is_agent = true,
            agent_code = COALESCE(agent_code, v_code),
            bound_merchant_id = v_app.merchant_id
        WHERE user_id = v_app.user_id;
      INSERT INTO public.user_roles(user_id, role) VALUES (v_app.user_id, 'agent') ON CONFLICT DO NOTHING;
      INSERT INTO public.agent_merchant_bindings(user_id, merchant_id)
        VALUES (v_app.user_id, v_app.merchant_id) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  UPDATE public.agent_applications
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         reject_reason = CASE WHEN _approve THEN NULL ELSE _reason END,
         reviewed_by = v_uid,
         reviewed_at = now()
   WHERE id = _id;

  RETURN true;
END $$;
