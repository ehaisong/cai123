-- 回填：把每个代理的 bound_merchant_id 设为他最近一次"审核通过"的商家
WITH latest AS (
  SELECT DISTINCT ON (user_id) user_id, merchant_id
  FROM public.agent_applications
  WHERE status = 'approved'
  ORDER BY user_id, reviewed_at DESC NULLS LAST
)
UPDATE public.agent_relations ar
   SET bound_merchant_id = latest.merchant_id,
       is_agent = true
  FROM latest
 WHERE ar.user_id = latest.user_id
   AND (ar.bound_merchant_id IS DISTINCT FROM latest.merchant_id OR ar.is_agent = false);