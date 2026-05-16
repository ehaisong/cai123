
CREATE OR REPLACE FUNCTION public.notify_agent_application_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_shop_name text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected') THEN
    SELECT shop_name INTO v_shop_name FROM public.merchants WHERE id = NEW.merchant_id;
    INSERT INTO public.notifications(user_id, category, title, content, reference_id)
    VALUES (
      NEW.user_id,
      'agent_review',
      CASE WHEN NEW.status = 'approved' THEN '代理申请已通过' ELSE '代理申请被驳回' END,
      CASE WHEN NEW.status = 'approved'
        THEN '恭喜！您已成为「' || COALESCE(v_shop_name, '该店铺') || '」的代理，可在「代理中心」查看推广二维码与佣金。'
        ELSE '很遗憾，您申请「' || COALESCE(v_shop_name, '该店铺') || '」代理未通过审核。' ||
             COALESCE(' 驳回理由：' || NEW.reject_reason, '')
      END,
      NEW.id
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_agent_application_review ON public.agent_applications;
CREATE TRIGGER trg_notify_agent_application_review
AFTER UPDATE ON public.agent_applications
FOR EACH ROW EXECUTE FUNCTION public.notify_agent_application_review();
