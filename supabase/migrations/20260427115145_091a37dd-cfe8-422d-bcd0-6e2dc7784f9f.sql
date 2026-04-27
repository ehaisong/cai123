
-- 1. 调整唯一约束：按 (买家, 商品, 期号) 唯一
DROP INDEX IF EXISTS public.idx_orders_paid_unique;
CREATE UNIQUE INDEX idx_orders_paid_unique_issue
  ON public.orders (buyer_id, product_id, COALESCE(issue_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'paid';

-- 2. 修正 ehaijian 上线
UPDATE public.agent_relations
SET upline_id = '46452106-d541-4eea-9b44-3ce5faffd6d8',
    upline_l2_id = '08368782-2a61-4816-b621-0b089b813cf6',
    bound_merchant_id = 'b36f6413-2d03-47ee-83b9-9794f3cefdee'
WHERE user_id = '195024db-9e14-493c-89a5-e177e68a2a1a';

UPDATE public.profiles SET referrer_id = '46452106-d541-4eea-9b44-3ce5faffd6d8'
WHERE user_id = '195024db-9e14-493c-89a5-e177e68a2a1a';

-- 3. 写入演示订单
DO $$
DECLARE
  m_id UUID := 'b36f6413-2d03-47ee-83b9-9794f3cefdee';
  m_user UUID := '725b6638-0d75-4c10-86a7-d210cd934834';
  buyer_normal UUID := '6f6c54b4-7cba-4050-9168-4fc8f31be657';
  buyer_ehai   UUID := '195024db-9e14-493c-89a5-e177e68a2a1a';
  buyer_demo   UUID := '55302183-e3f0-48be-aae7-7490bb28d9ec';
  agent_pid    UUID := '08368782-2a61-4816-b621-0b089b813cf6';
  normal_pid   UUID := '46452106-d541-4eea-9b44-3ce5faffd6d8';
  l1r NUMERIC := 0.10;
  l2r NUMERIC := 0.05;
  pr  NUMERIC := 0.15;
  v_order UUID;
  v_l1_amt NUMERIC;
  v_l2_amt NUMERIC;
  v_merch_amt NUMERIC;
  v_bal NUMERIC;
  l1u UUID;
  l2u UUID;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      (buyer_normal,'97606bfa-ac22-48dd-83fd-e97825eac989'::uuid,'6c981c01-4cac-4a37-892c-79c4550101b8'::uuid,18.00, agent_pid, NULL::uuid, now() - interval '5 days'),
      (buyer_normal,'97606bfa-ac22-48dd-83fd-e97825eac989'::uuid,'9b7c9e91-b339-4e59-84c2-ccc9685b23df'::uuid,18.00, agent_pid, NULL::uuid, now() - interval '3 days'),
      (buyer_normal,'d40c99d7-0bc7-464b-8954-ce0d8d578fce'::uuid,'32543510-6bce-48c4-a412-e32d9eabc9a2'::uuid,12.00, agent_pid, NULL::uuid, now() - interval '6 days'),
      (buyer_normal,'abcf92de-6988-4f26-b788-5144eb4f88bd'::uuid,'5cf3e862-ce24-49f6-9813-248a6f81322f'::uuid,28.00, agent_pid, NULL::uuid, now() - interval '8 days'),
      (buyer_normal,'ee7f2789-180b-4bab-8c1e-166b4740e551'::uuid,'805f873a-3d0e-4868-ab6d-0f8bcb431ea1'::uuid,38.00, agent_pid, NULL::uuid, now() - interval '10 days'),
      (buyer_ehai,'97606bfa-ac22-48dd-83fd-e97825eac989'::uuid,'5894cf6b-6f29-432b-b1e5-afab8db0378c'::uuid,18.00, normal_pid, agent_pid, now() - interval '4 days'),
      (buyer_ehai,'d40c99d7-0bc7-464b-8954-ce0d8d578fce'::uuid,'3b12690a-4301-4469-9076-558fbf16b014'::uuid,12.00, normal_pid, agent_pid, now() - interval '5 days'),
      (buyer_ehai,'abcf92de-6988-4f26-b788-5144eb4f88bd'::uuid,'64bf13db-94f2-4a91-8950-1ccb83f76e08'::uuid,28.00, normal_pid, agent_pid, now() - interval '5 days'),
      (buyer_ehai,'ee7f2789-180b-4bab-8c1e-166b4740e551'::uuid,'a71289b4-3196-4df0-bb6e-319d3d53609c'::uuid,38.00, normal_pid, agent_pid, now() - interval '4 days'),
      (buyer_demo,'d40c99d7-0bc7-464b-8954-ce0d8d578fce'::uuid,'e974dc66-85d8-4bb2-90cb-767091d2d38b'::uuid,12.00, NULL::uuid, NULL::uuid, now() - interval '2 days'),
      (buyer_demo,'abcf92de-6988-4f26-b788-5144eb4f88bd'::uuid,'81c33c93-6af2-4c88-8421-c42e150dee45'::uuid,28.00, NULL::uuid, NULL::uuid, now() - interval '1 day')
    ) AS t(buyer_id, product_id, issue_id, price, agent_l1_id, agent_l2_id, paid_at)
  LOOP
    v_l1_amt := CASE WHEN rec.agent_l1_id IS NOT NULL THEN round(rec.price * l1r, 2) ELSE 0 END;
    v_l2_amt := CASE WHEN rec.agent_l2_id IS NOT NULL THEN round(rec.price * l2r, 2) ELSE 0 END;
    v_merch_amt := rec.price - v_l1_amt - v_l2_amt - round(rec.price * pr, 2);

    INSERT INTO public.orders(buyer_id, product_id, issue_id, merchant_id, amount, agent_l1_id, agent_l2_id, status, paid_at, created_at, updated_at)
    VALUES (rec.buyer_id, rec.product_id, rec.issue_id, m_id, rec.price, rec.agent_l1_id, rec.agent_l2_id, 'paid', rec.paid_at, rec.paid_at, rec.paid_at)
    RETURNING id INTO v_order;

    UPDATE public.wallets SET balance = balance + v_merch_amt, updated_at = now()
      WHERE user_id = m_user RETURNING balance INTO v_bal;
    INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description, created_at)
      VALUES (m_user, 'commission', v_merch_amt, v_bal, v_order, '商品销售（演示数据）', rec.paid_at);

    UPDATE public.merchants SET total_sales = total_sales + rec.price WHERE id = m_id;
    UPDATE public.products SET sales_count = sales_count + 1 WHERE id = rec.product_id;
    UPDATE public.product_issues SET sales_count = sales_count + 1 WHERE id = rec.issue_id;

    IF v_l1_amt > 0 THEN
      SELECT user_id INTO l1u FROM public.profiles WHERE id = rec.agent_l1_id;
      UPDATE public.wallets SET balance = balance + v_l1_amt, total_commission = total_commission + v_l1_amt, updated_at = now()
        WHERE user_id = l1u RETURNING balance INTO v_bal;
      INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description, created_at)
        VALUES (l1u, 'commission', v_l1_amt, v_bal, v_order, '一级分成（演示数据）', rec.paid_at);
      INSERT INTO public.commission_records(order_id, beneficiary_id, level, amount, rate, created_at)
        VALUES (v_order, l1u, 1, v_l1_amt, l1r, rec.paid_at);
    END IF;

    IF v_l2_amt > 0 THEN
      SELECT user_id INTO l2u FROM public.profiles WHERE id = rec.agent_l2_id;
      UPDATE public.wallets SET balance = balance + v_l2_amt, total_commission = total_commission + v_l2_amt, updated_at = now()
        WHERE user_id = l2u RETURNING balance INTO v_bal;
      INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, reference_id, description, created_at)
        VALUES (l2u, 'commission', v_l2_amt, v_bal, v_order, '二级分成（演示数据）', rec.paid_at);
      INSERT INTO public.commission_records(order_id, beneficiary_id, level, amount, rate, created_at)
        VALUES (v_order, l2u, 2, v_l2_amt, l2r, rec.paid_at);
    END IF;
  END LOOP;
END $$;
