
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES public.authors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS virtual_views integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_limit integer NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_products_author_id ON public.products(author_id);

ALTER TABLE public.product_issues DROP COLUMN IF EXISTS author_id;
