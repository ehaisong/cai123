-- Reset demo agent test bindings so the demo flow can be re-tested cleanly
-- 1) Demo 普通用户 (buyer) was elevated to agent during testing — revert it
UPDATE public.agent_relations
   SET is_agent = false,
       agent_code = NULL,
       bound_merchant_id = NULL,
       upline_id = NULL,
       upline_l2_id = NULL
 WHERE user_id = '6f6c54b4-7cba-4050-9168-4fc8f31be657';

DELETE FROM public.user_roles
 WHERE user_id = '6f6c54b4-7cba-4050-9168-4fc8f31be657'
   AND role = 'agent';

-- 2) Demo 代理 — clear any merchant binding/upline so the switch-merchant flow can be retested from scratch
UPDATE public.agent_relations
   SET bound_merchant_id = NULL,
       upline_id = NULL,
       upline_l2_id = NULL
 WHERE user_id = '2ad55e1c-6f58-4092-82ce-ca8c7bc51269';