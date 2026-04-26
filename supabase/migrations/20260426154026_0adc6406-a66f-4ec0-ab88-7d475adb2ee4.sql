
-- 1. 重置「Demo 普通用户」的代理资格
UPDATE public.agent_relations
   SET is_agent = false,
       agent_code = NULL
 WHERE user_id = '6f6c54b4-7cba-4050-9168-4fc8f31be657';

DELETE FROM public.user_roles
 WHERE user_id = '6f6c54b4-7cba-4050-9168-4fc8f31be657'
   AND role = 'agent';

-- 2. 把「Demo 代理」绑定到「Demo 演示店铺」
UPDATE public.agent_relations
   SET is_agent = true,
       bound_merchant_id = 'b36f6413-2d03-47ee-83b9-9794f3cefdee',
       agent_code = 'u98614811'
 WHERE user_id = '2ad55e1c-6f58-4092-82ce-ca8c7bc51269';

-- 3. 确保 Demo 普通用户的上线 = Demo 代理（profile_id 08368782...），构成"引流用户"
UPDATE public.agent_relations
   SET upline_id = '08368782-2a61-4816-b621-0b089b813cf6',
       bound_merchant_id = 'b36f6413-2d03-47ee-83b9-9794f3cefdee'
 WHERE user_id = '6f6c54b4-7cba-4050-9168-4fc8f31be657';

UPDATE public.profiles
   SET referrer_id = '08368782-2a61-4816-b621-0b089b813cf6'
 WHERE user_id = '6f6c54b4-7cba-4050-9168-4fc8f31be657';

-- 4. 清理 Demo 代理已有的演示流水（防重复）
DELETE FROM public.commission_records
 WHERE beneficiary_id = '2ad55e1c-6f58-4092-82ce-ca8c7bc51269';
DELETE FROM public.wallet_transactions
 WHERE user_id = '2ad55e1c-6f58-4092-82ce-ca8c7bc51269'
   AND description LIKE 'Demo 演示%';
UPDATE public.wallets
   SET balance = 0, total_commission = 0, updated_at = now()
 WHERE user_id = '2ad55e1c-6f58-4092-82ce-ca8c7bc51269';

-- 5. 基于现有 demo buyer 订单生成多条演示分成记录与钱包流水（最近 7 天）
DO $$
DECLARE
  v_agent_user_id UUID := '2ad55e1c-6f58-4092-82ce-ca8c7bc51269';
  v_order_ids UUID[];
  v_amounts NUMERIC[];
  v_day INT;
  v_count INT;
  v_level INT;
  v_rate NUMERIC;
  v_idx INT;
  v_amount NUMERIC;
  v_balance NUMERIC := 0;
  v_total_comm NUMERIC := 0;
  v_created TIMESTAMPTZ;
BEGIN
  SELECT array_agg(id ORDER BY created_at), array_agg(amount ORDER BY created_at)
    INTO v_order_ids, v_amounts
  FROM public.orders
  WHERE buyer_id = '6f6c54b4-7cba-4050-9168-4fc8f31be657';

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) = 0 THEN
    RAISE NOTICE 'no demo orders to attach commissions to';
    RETURN;
  END IF;

  FOR v_day IN 0..6 LOOP
    FOR v_count IN 1..(2 + (v_day % 2)) LOOP
      IF (v_day + v_count) % 3 = 0 THEN
        v_level := 2; v_rate := 0.05;
      ELSE
        v_level := 1; v_rate := 0.10;
      END IF;
      v_idx := 1 + ((v_day + v_count) % array_length(v_order_ids, 1));
      v_amount := round(v_amounts[v_idx] * v_rate, 2);
      v_created := (now() - (v_day || ' days')::interval - (v_count * 2 || ' hours')::interval);

      INSERT INTO public.commission_records (order_id, beneficiary_id, level, amount, rate, created_at)
      VALUES (v_order_ids[v_idx], v_agent_user_id, v_level, v_amount, v_rate, v_created);

      v_balance := v_balance + v_amount;
      v_total_comm := v_total_comm + v_amount;
      INSERT INTO public.wallet_transactions (
        user_id, type, amount, balance_after, reference_id, description, created_at
      ) VALUES (
        v_agent_user_id, 'commission', v_amount, v_balance, v_order_ids[v_idx],
        'Demo 演示·' || (CASE WHEN v_level = 1 THEN '一级' ELSE '二级' END) || '分成',
        v_created
      );
    END LOOP;
  END LOOP;

  UPDATE public.wallets
     SET balance = v_balance,
         total_commission = v_total_comm,
         updated_at = now()
   WHERE user_id = v_agent_user_id;
END $$;
