-- 允许代理读取所有 upline_id 指向自己 profile 的下级 agent_relations 行
DROP POLICY IF EXISTS ar_select_upline ON public.agent_relations;
CREATE POLICY ar_select_upline ON public.agent_relations
  FOR SELECT
  USING (
    upline_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    OR upline_l2_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  );