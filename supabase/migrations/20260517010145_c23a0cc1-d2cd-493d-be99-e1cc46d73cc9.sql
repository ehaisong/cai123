
-- 1) 回填：为已发布但没有 product_issues 的商品自动建一期
INSERT INTO public.product_issues (product_id, issue_no, paid_content, publish_at, reveal_at, status, result, result_note)
SELECT p.id,
       COALESCE(NULLIF(p.issue_no,'—'), NULLIF(p.issue_no,''), to_char(p.publish_at,'YYYYMMDD')),
       p.paid_content,
       p.publish_at,
       p.reveal_at,
       'published'::product_status,
       COALESCE(p.result,'pending'::product_result),
       p.result_note
FROM public.products p
WHERE p.status='published'
  AND NOT EXISTS (SELECT 1 FROM public.product_issues pi WHERE pi.product_id=p.id);

-- 2) 触发器：发布商品时自动建一期（如果没有的话）
CREATE OR REPLACE FUNCTION public.ensure_product_issue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published' THEN
    IF NOT EXISTS (SELECT 1 FROM public.product_issues WHERE product_id = NEW.id) THEN
      INSERT INTO public.product_issues (product_id, issue_no, paid_content, publish_at, reveal_at, status, result, result_note)
      VALUES (
        NEW.id,
        COALESCE(NULLIF(NEW.issue_no,'—'), NULLIF(NEW.issue_no,''), to_char(NEW.publish_at,'YYYYMMDD')),
        NEW.paid_content,
        NEW.publish_at,
        NEW.reveal_at,
        'published'::product_status,
        COALESCE(NEW.result,'pending'::product_result),
        NEW.result_note
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_product_issue ON public.products;
CREATE TRIGGER trg_ensure_product_issue
AFTER INSERT OR UPDATE OF status ON public.products
FOR EACH ROW EXECUTE FUNCTION public.ensure_product_issue();
