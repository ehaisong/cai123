-- =====================================================================
-- E2E 测试：店内归属 / 申请代理 / 扫码进店 / 首登绑定 / 分佣结算
-- 运行方式：在 Supabase SQL Editor 以 service_role 身份执行整个文件。
-- 全程包裹在事务里，最后 ROLLBACK，不会污染生产数据。
-- 任一断言失败都会 RAISE EXCEPTION 中止并回滚。
-- =====================================================================
BEGIN;

DO $TEST$
DECLARE
  -- 演员
  uid_m1 uuid := gen_random_uuid();   -- 商家1 owner
  uid_m2 uuid := gen_random_uuid();   -- 商家2 owner
  uid_a  uuid := gen_random_uuid();   -- 代理 A（M1 已是代理）
  uid_c  uuid := gen_random_uuid();   -- 客户 C（升级 M2 代理）
  uid_b  uuid := gen_random_uuid();   -- 普通买家 B
  m1 uuid; m2 uuid;
  cat uuid;
  prod_m1 uuid; prod_m2 uuid;
  iss_m1 uuid; iss_m2 uuid;
  app_id uuid;
  ord1 uuid; ord2 uuid; ord_dup uuid;
  comm_count int;
  rate numeric;
  membership uuid;
BEGIN
  ----------------------------------------------------------------------
  -- 0. 种子：auth.users / profiles / merchants / category / product / config
  ----------------------------------------------------------------------
  INSERT INTO auth.users(id, email, instance_id, aud, role)
  VALUES
    (uid_m1,'m1@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (uid_m2,'m2@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (uid_a, 'a@test.local', '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (uid_c, 'c@test.local', '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (uid_b, 'b@test.local', '00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  INSERT INTO public.profiles(user_id, user_code, nickname) VALUES
    (uid_m1,'TM1','商家一'),(uid_m2,'TM2','商家二'),
    (uid_a,'TAA','代理A'),(uid_c,'TCC','客户C'),(uid_b,'TBB','买家B');

  INSERT INTO public.merchants(user_id, shop_name, status, l1_rate, l1_max_rate)
    VALUES (uid_m1,'店一','approved',0.20,0.50) RETURNING id INTO m1;
  INSERT INTO public.merchants(user_id, shop_name, status, l1_rate, l1_max_rate)
    VALUES (uid_m2,'店二','approved',0.10,0.50) RETURNING id INTO m2;

  -- 平台抽成
  INSERT INTO public.commission_config(platform_rate, l1_rate, l1_max_rate, l2_rate, l2_max_rate)
    VALUES (0.05, 0.10, 0.92, 0, 0);

  INSERT INTO public.lottery_categories(code,name,sort_order) VALUES ('t','测试',1)
    RETURNING id INTO cat;

  INSERT INTO public.products(merchant_id, category_id, issue_no, title, price, status, publish_at)
    VALUES (m1, cat, '20260101', 'P-M1', 100, 'published', now()) RETURNING id INTO prod_m1;
  INSERT INTO public.product_issues(product_id, issue_no, status, publish_at)
    VALUES (prod_m1, '20260101', 'published', now()) RETURNING id INTO iss_m1;

  INSERT INTO public.products(merchant_id, category_id, issue_no, title, price, status, publish_at)
    VALUES (m2, cat, '20260102', 'P-M2', 200, 'published', now()) RETURNING id INTO prod_m2;
  INSERT INTO public.product_issues(product_id, issue_no, status, publish_at)
    VALUES (prod_m2, '20260102', 'published', now()) RETURNING id INTO iss_m2;

  -- A 已是 M1 代理（前置条件）
  CALL NULL; -- placeholder
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role','authenticated')::text, true);
  PERFORM public.become_agent_for_merchant(m1);

  ----------------------------------------------------------------------
  -- 用例 1：扫 M1 商家二维码（M_<m1>） → 客户 C 入 M1，无上线
  ----------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_c::text, 'role','authenticated')::text, true);
  PERFORM public.bind_shop_referrer(m1, 'M_'||m1::text);
  IF (SELECT upline_user_id FROM public.shop_memberships WHERE user_id=uid_c AND merchant_id=m1) IS NOT NULL THEN
    RAISE EXCEPTION '[1] 商家直扫不应有上线';
  END IF;
  RAISE NOTICE '[1] OK 商家二维码进店无上线';

  ----------------------------------------------------------------------
  -- 用例 2：客户 B 扫 A 的 M1 推广码（A_TAA_M_<m1>） → upline=A
  ----------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role','authenticated')::text, true);
  PERFORM public.bind_shop_referrer(m1, 'A_TAA_M_'||m1::text);
  IF (SELECT upline_user_id FROM public.shop_memberships WHERE user_id=uid_b AND merchant_id=m1) <> uid_a THEN
    RAISE EXCEPTION '[2] B 在 M1 的上线应为 A';
  END IF;
  RAISE NOTICE '[2] OK B 扫 A 的码归属 A';

  ----------------------------------------------------------------------
  -- 用例 3：再次扫码（换成 M_xxx）不能改写已有归属
  ----------------------------------------------------------------------
  PERFORM public.bind_shop_referrer(m1, 'M_'||m1::text);
  IF (SELECT upline_user_id FROM public.shop_memberships WHERE user_id=uid_b AND merchant_id=m1) <> uid_a THEN
    RAISE EXCEPTION '[3] 已有归属不可被覆盖';
  END IF;
  RAISE NOTICE '[3] OK 归属一次写死';

  ----------------------------------------------------------------------
  -- 用例 4：C 申请 M2 代理 → M2 审核通过 → C 在 M2 是代理，M1 不变
  ----------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_c::text, 'role','authenticated')::text, true);
  app_id := public.apply_agent_for_merchant(m2, '想做你家代理');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_m2::text, 'role','authenticated')::text, true);
  PERFORM public.review_agent_application(app_id, true, NULL);

  IF NOT EXISTS(SELECT 1 FROM public.shop_memberships
                 WHERE user_id=uid_c AND merchant_id=m2 AND is_agent=true) THEN
    RAISE EXCEPTION '[4] C 未成为 M2 代理';
  END IF;
  IF EXISTS(SELECT 1 FROM public.shop_memberships
              WHERE user_id=uid_c AND merchant_id=m1 AND is_agent=true) THEN
    RAISE EXCEPTION '[4] C 不应在 M1 自动获得代理身份';
  END IF;
  RAISE NOTICE '[4] OK 跨店代理身份隔离';

  ----------------------------------------------------------------------
  -- 用例 5：M2 给 C 单独设置分成 30%（不影响 M1）
  ----------------------------------------------------------------------
  PERFORM public.merchant_set_agent_rate(uid_c, 0.30);
  SELECT l1_rate INTO rate FROM public.shop_memberships
    WHERE user_id=uid_c AND merchant_id=m2;
  IF rate <> 0.30 THEN RAISE EXCEPTION '[5] 分成比例未生效 got=%', rate; END IF;
  RAISE NOTICE '[5] OK 按店设置分成比例';

  ----------------------------------------------------------------------
  -- 用例 6：B 扫 C 在 M2 的推广码 → 进入 M2，upline=C
  ----------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role','authenticated')::text, true);
  PERFORM public.bind_shop_referrer(m2, 'A_TCC_M_'||m2::text);
  IF (SELECT upline_user_id FROM public.shop_memberships WHERE user_id=uid_b AND merchant_id=m2) <> uid_c THEN
    RAISE EXCEPTION '[6] B 在 M2 的上线应为 C';
  END IF;
  RAISE NOTICE '[6] OK B 在 M2 归属 C';

  ----------------------------------------------------------------------
  -- 用例 7：B 在 M2 购买 → C 拿 30% 分佣 = 60.00
  ----------------------------------------------------------------------
  ord2 := public._fulfill_product_purchase(uid_b, prod_m2, iss_m2, m2);
  SELECT count(*) INTO comm_count FROM public.commission_records
    WHERE order_id=ord2 AND beneficiary_id=uid_c AND level=1 AND amount=60.00;
  IF comm_count <> 1 THEN
    RAISE EXCEPTION '[7] M2 订单 L1 分佣未生成或金额错误 (期望 60.00)';
  END IF;
  RAISE NOTICE '[7] OK M2 按店分成 30%% 生效，C 得 60.00';

  ----------------------------------------------------------------------
  -- 用例 8：B 在 M1 购买 → A 拿 M1 默认 20% = 20.00
  ----------------------------------------------------------------------
  ord1 := public._fulfill_product_purchase(uid_b, prod_m1, iss_m1, m1);
  SELECT count(*) INTO comm_count FROM public.commission_records
    WHERE order_id=ord1 AND beneficiary_id=uid_a AND level=1 AND amount=20.00;
  IF comm_count <> 1 THEN RAISE EXCEPTION '[8] M1 订单分佣应=20.00 给 A'; END IF;
  RAISE NOTICE '[8] OK M1 按店默认 20%% 生效，A 得 20.00';

  ----------------------------------------------------------------------
  -- 用例 9：幂等 —— 同 issue 再次履约不重复下单/不重复分佣
  ----------------------------------------------------------------------
  ord_dup := public._fulfill_product_purchase(uid_b, prod_m2, iss_m2, m2);
  IF ord_dup <> ord2 THEN RAISE EXCEPTION '[9] 重复履约应返回原订单'; END IF;
  SELECT count(*) INTO comm_count FROM public.commission_records WHERE order_id=ord2;
  IF comm_count <> 1 THEN RAISE EXCEPTION '[9] 重复履约导致重复分佣 % 条', comm_count; END IF;
  RAISE NOTICE '[9] OK 履约幂等';

  ----------------------------------------------------------------------
  -- 用例 10：商家越权读取 —— M1 owner 看不到 M2 的 membership
  ----------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_m1::text, 'role','authenticated')::text, true);
  PERFORM set_config('role','authenticated', true);
  IF EXISTS(SELECT 1 FROM public.shop_memberships WHERE merchant_id=m2) THEN
    RAISE EXCEPTION '[10] M1 owner 不应看到 M2 membership';
  END IF;
  PERFORM set_config('role','postgres', true);
  RAISE NOTICE '[10] OK RLS 跨店隔离';

  ----------------------------------------------------------------------
  -- 用例 11：钱包余额 = 商家入账 + 代理入账 + 平台抽成 = 订单金额
  ----------------------------------------------------------------------
  PERFORM 1;
  -- M2 订单 200：C=60，平台=10，商家=130
  IF (SELECT balance FROM public.wallets WHERE user_id=uid_m2) <> 130 THEN
    RAISE EXCEPTION '[11] M2 商家入账应=130';
  END IF;
  IF (SELECT balance FROM public.wallets WHERE user_id=uid_c) <> 60 THEN
    RAISE EXCEPTION '[11] C 钱包应=60';
  END IF;
  RAISE NOTICE '[11] OK 资金平账';

  RAISE NOTICE '==== ALL E2E TESTS PASSED ====';
END;
$TEST$;

ROLLBACK;
