-- 测试数据注入：DEMO 测试店铺
-- merchant_id: b36f6413-2d03-47ee-83b9-9794f3cefdee
-- admin (c3a6...) 作为代理
-- 永乐 (76af...) 作为客户，upline=admin

INSERT INTO public.shop_memberships (user_id, merchant_id, is_agent, agent_code, l1_rate)
VALUES ('c3a6b5f6-801b-4358-9691-462dd6e7490e',
        'b36f6413-2d03-47ee-83b9-9794f3cefdee',
        true, 'u88952647', 0.20)
ON CONFLICT (user_id, merchant_id) DO UPDATE
  SET is_agent=true, agent_code=EXCLUDED.agent_code, l1_rate=EXCLUDED.l1_rate;

INSERT INTO public.shop_memberships (user_id, merchant_id, is_agent, upline_user_id)
VALUES ('76afb930-7b1a-42a9-9bd4-3f1bc351f01d',
        'b36f6413-2d03-47ee-83b9-9794f3cefdee',
        false, 'c3a6b5f6-801b-4358-9691-462dd6e7490e')
ON CONFLICT (user_id, merchant_id) DO UPDATE
  SET upline_user_id=EXCLUDED.upline_user_id, is_agent=false;