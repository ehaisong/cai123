
-- payment_orders table
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  pay_type TEXT NOT NULL CHECK (pay_type IN ('wechat','alipay')),
  subject TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'recharge' CHECK (purpose IN ('recharge','test')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','closed')),
  trade_no TEXT,
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON public.payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON public.payment_orders(status);

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user view own payment orders" ON public.payment_orders;
CREATE POLICY "user view own payment orders" ON public.payment_orders
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_payment_orders_updated
  BEFORE UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- create_payment_order RPC
CREATE OR REPLACE FUNCTION public.create_payment_order(
  _amount NUMERIC,
  _pay_type TEXT,
  _subject TEXT,
  _purpose TEXT DEFAULT 'recharge'
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_no TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION '金额必须大于0'; END IF;
  IF _pay_type NOT IN ('wechat','alipay') THEN RAISE EXCEPTION '支付方式无效'; END IF;
  IF _purpose NOT IN ('recharge','test') THEN RAISE EXCEPTION '用途无效'; END IF;
  v_no := upper(_purpose) || '_' || to_char(now(),'YYYYMMDDHH24MISS') || '_' || substr(replace(gen_random_uuid()::text,'-',''),1,8);
  INSERT INTO public.payment_orders(order_no, user_id, amount, pay_type, subject, purpose)
    VALUES (v_no, v_uid, _amount, _pay_type, _subject, _purpose);
  RETURN v_no;
END;
$$;

-- mark_payment_paid: idempotent, called by edge function (service role bypasses RLS)
CREATE OR REPLACE FUNCTION public.mark_payment_paid(
  _order_no TEXT,
  _amount NUMERIC,
  _trade_no TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD;
  v_balance NUMERIC;
BEGIN
  SELECT * INTO v_order FROM public.payment_orders WHERE order_no = _order_no FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_order.status = 'paid' THEN RETURN TRUE; END IF;
  IF abs(v_order.amount - _amount) > 0.001 THEN
    RAISE EXCEPTION 'amount mismatch: expected % got %', v_order.amount, _amount;
  END IF;

  UPDATE public.payment_orders
    SET status='paid', trade_no=_trade_no, paid_at=now(), updated_at=now()
    WHERE order_no=_order_no;

  IF v_order.purpose = 'recharge' THEN
    UPDATE public.wallets
      SET balance = balance + v_order.amount,
          total_recharge = total_recharge + v_order.amount,
          updated_at = now()
      WHERE user_id = v_order.user_id
      RETURNING balance INTO v_balance;
    IF NOT FOUND THEN
      INSERT INTO public.wallets(user_id, balance, total_recharge)
        VALUES (v_order.user_id, v_order.amount, v_order.amount)
        RETURNING balance INTO v_balance;
    END IF;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_order.user_id, 'recharge', v_order.amount, v_balance, v_order.id,
              '在线充值 ' || v_order.order_no);
  END IF;

  RETURN TRUE;
END;
$$;
