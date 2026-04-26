-- 给 profiles 加禁用字段
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

-- 给 merchants 加禁用字段（注意 status 已有 approved/pending/rejected 枚举，不复用，单独加 is_disabled 表示"通过审核但被管理员封禁"）
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

-- 当前用户是否被禁用
CREATE OR REPLACE FUNCTION public.is_user_disabled(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_disabled FROM public.profiles WHERE user_id = _user_id), false);
$$;