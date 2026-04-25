-- 客户端错误日志表，用于前端 RPC/操作错误的持久化追溯
CREATE TABLE public.client_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  op TEXT NOT NULL,
  scope TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  error_code TEXT,
  error_details TEXT,
  error_hint TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.client_error_logs ENABLE ROW LEVEL SECURITY;

-- 任何已登录用户都可写入自己的错误日志（user_id 必须等于自己，或为 null 用于未登录上下文）
CREATE POLICY "cel_insert_self"
ON public.client_error_logs
FOR INSERT
WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- 用户可看自己的日志；管理员可看全部
CREATE POLICY "cel_select_self"
ON public.client_error_logs
FOR SELECT
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- 管理员可全权管理
CREATE POLICY "cel_admin_all"
ON public.client_error_logs
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_cel_created_at ON public.client_error_logs (created_at DESC);
CREATE INDEX idx_cel_op ON public.client_error_logs (op);
CREATE INDEX idx_cel_user ON public.client_error_logs (user_id);
