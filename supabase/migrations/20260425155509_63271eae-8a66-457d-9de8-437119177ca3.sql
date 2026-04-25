-- ========== notifications 表 ==========
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  category TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  content TEXT,
  reference_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 用户可看自己的；管理员可看全部
CREATE POLICY "notif_select_self"
ON public.notifications
FOR SELECT
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- 用户可更新自己的（标记已读）
CREATE POLICY "notif_update_self"
ON public.notifications
FOR UPDATE
USING (auth.uid() = user_id);

-- 用户可删除自己的
CREATE POLICY "notif_delete_self"
ON public.notifications
FOR DELETE
USING (auth.uid() = user_id);

-- 管理员可全权管理
CREATE POLICY "notif_admin_all"
ON public.notifications
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_notif_user_unread ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX idx_notif_user_created ON public.notifications (user_id, created_at DESC);

-- ========== 触发器：商家申请审核 ==========
CREATE OR REPLACE FUNCTION public.notify_merchant_application_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected') THEN
    INSERT INTO public.notifications (user_id, category, title, content, reference_id)
    VALUES (
      NEW.user_id,
      'merchant_review',
      CASE WHEN NEW.status = 'approved' THEN '商家申请已通过' ELSE '商家申请被驳回' END,
      CASE WHEN NEW.status = 'approved'
        THEN '恭喜！您的商家入驻申请已审核通过，现在可以前往商家后台发布商品。'
        ELSE COALESCE('驳回理由：' || NEW.reject_reason, '很遗憾，您的商家入驻申请未通过审核。')
      END,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_merchant_application_review ON public.merchant_applications;
CREATE TRIGGER trg_notify_merchant_application_review
AFTER UPDATE ON public.merchant_applications
FOR EACH ROW
EXECUTE FUNCTION public.notify_merchant_application_review();

-- ========== 触发器：提现进度 ==========
CREATE OR REPLACE FUNCTION public.notify_withdraw_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_content TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'approved' THEN
      v_title := '提现申请已审核通过';
      v_content := '提现金额 ¥' || NEW.amount || ' 已审核通过，等待打款。';
    ELSIF NEW.status = 'paid' THEN
      v_title := '提现已打款';
      v_content := '提现金额 ¥' || NEW.amount || ' 已成功打款到您的 ' || COALESCE(NEW.channel, '账户') || '。';
    ELSIF NEW.status = 'rejected' THEN
      v_title := '提现申请被驳回';
      v_content := '提现金额 ¥' || NEW.amount || ' 已驳回。' || COALESCE('原因：' || NEW.reject_reason, '请联系客服了解详情。');
    ELSE
      RETURN NEW;
    END IF;
    INSERT INTO public.notifications (user_id, category, title, content, reference_id)
    VALUES (NEW.user_id, 'withdraw', v_title, v_content, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_withdraw_status ON public.withdrawals;
CREATE TRIGGER trg_notify_withdraw_status
AFTER UPDATE ON public.withdrawals
FOR EACH ROW
EXECUTE FUNCTION public.notify_withdraw_status();

-- ========== 触发器：系统公告广播 ==========
CREATE OR REPLACE FUNCTION public.notify_announcement_broadcast()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active = true THEN
    INSERT INTO public.notifications (user_id, category, title, content, reference_id)
    SELECT p.user_id, 'announcement', NEW.title, NEW.content, NEW.id
    FROM public.profiles p;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_announcement_broadcast ON public.announcements;
CREATE TRIGGER trg_notify_announcement_broadcast
AFTER INSERT ON public.announcements
FOR EACH ROW
EXECUTE FUNCTION public.notify_announcement_broadcast();

-- ========== RPC：批量已读 ==========
CREATE OR REPLACE FUNCTION public.mark_notifications_read(_ids UUID[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    UPDATE public.notifications
      SET is_read = true, read_at = now()
      WHERE user_id = v_uid AND is_read = false;
  ELSE
    UPDATE public.notifications
      SET is_read = true, read_at = now()
      WHERE user_id = v_uid AND id = ANY(_ids) AND is_read = false;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;