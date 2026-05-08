
-- KYC实名信息表
CREATE TABLE public.user_kyc (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  real_name TEXT NOT NULL,
  id_card_no TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  bank_account TEXT NOT NULL,
  bank_branch TEXT,
  phone TEXT,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE public.user_kyc ENABLE ROW LEVEL SECURITY;

-- 管理员全部权限
CREATE POLICY kyc_admin_all ON public.user_kyc
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 用户查看本人
CREATE POLICY kyc_select_self ON public.user_kyc
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- 用户可插入本人，但仅当无现有记录（绑定后不能改）
CREATE POLICY kyc_insert_self ON public.user_kyc
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (SELECT 1 FROM public.user_kyc k WHERE k.user_id = auth.uid())
  );

-- 用户禁止 UPDATE / DELETE（无策略即拒绝）

-- 时间戳触发器
CREATE TRIGGER trg_user_kyc_updated_at
  BEFORE UPDATE ON public.user_kyc
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 管理员更新KYC的函数（绕过UPDATE限制 - 通过SECURITY DEFINER）
CREATE OR REPLACE FUNCTION public.admin_update_user_kyc(
  _user_id UUID,
  _real_name TEXT,
  _id_card_no TEXT,
  _bank_name TEXT,
  _bank_account TEXT,
  _bank_branch TEXT DEFAULT NULL,
  _phone TEXT DEFAULT NULL,
  _remark TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION '无权限'; END IF;
  IF _real_name IS NULL OR length(trim(_real_name))=0 THEN RAISE EXCEPTION '姓名必填'; END IF;
  IF _id_card_no IS NULL OR length(trim(_id_card_no))=0 THEN RAISE EXCEPTION '身份证号必填'; END IF;
  IF _bank_name IS NULL OR length(trim(_bank_name))=0 THEN RAISE EXCEPTION '开户银行必填'; END IF;
  IF _bank_account IS NULL OR length(trim(_bank_account))=0 THEN RAISE EXCEPTION '银行卡号必填'; END IF;

  INSERT INTO public.user_kyc(user_id, real_name, id_card_no, bank_name, bank_account, bank_branch, phone, remark, updated_by)
    VALUES (_user_id, _real_name, _id_card_no, _bank_name, _bank_account, _bank_branch, _phone, _remark, v_uid)
  ON CONFLICT (user_id) DO UPDATE
    SET real_name = EXCLUDED.real_name,
        id_card_no = EXCLUDED.id_card_no,
        bank_name = EXCLUDED.bank_name,
        bank_account = EXCLUDED.bank_account,
        bank_branch = EXCLUDED.bank_branch,
        phone = EXCLUDED.phone,
        remark = EXCLUDED.remark,
        updated_by = v_uid,
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 管理员查询单用户KYC
CREATE OR REPLACE FUNCTION public.admin_get_user_kyc(_user_id UUID)
RETURNS SETOF public.user_kyc
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.user_kyc WHERE user_id = _user_id
    AND public.has_role(auth.uid(), 'admin');
$$;
