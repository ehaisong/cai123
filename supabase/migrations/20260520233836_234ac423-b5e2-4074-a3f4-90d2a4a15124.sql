
-- 作者表（按商家归属）
CREATE TABLE public.authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_authors_merchant ON public.authors(merchant_id);
CREATE INDEX idx_authors_sort ON public.authors(merchant_id, sort DESC, created_at DESC);

ALTER TABLE public.authors ENABLE ROW LEVEL SECURITY;

-- 商家本人可以管理自己店铺的作者
CREATE POLICY "Merchant owns authors - select"
ON public.authors FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = authors.merchant_id AND m.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Merchant owns authors - insert"
ON public.authors FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = authors.merchant_id AND m.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Merchant owns authors - update"
ON public.authors FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = authors.merchant_id AND m.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Merchant owns authors - delete"
ON public.authors FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = authors.merchant_id AND m.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

-- 公开可见（用于买家端展示作者名）
CREATE POLICY "Authors public read"
ON public.authors FOR SELECT
TO anon, authenticated
USING (true);

CREATE TRIGGER update_authors_updated_at
BEFORE UPDATE ON public.authors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 期号关联作者（可选）
ALTER TABLE public.product_issues
ADD COLUMN author_id uuid REFERENCES public.authors(id) ON DELETE SET NULL;
