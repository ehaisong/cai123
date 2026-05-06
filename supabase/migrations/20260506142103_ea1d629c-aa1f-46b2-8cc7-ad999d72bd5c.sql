CREATE POLICY "ar_select_merchant_owner"
ON public.agent_relations
FOR SELECT
USING (
  bound_merchant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = agent_relations.bound_merchant_id
      AND m.user_id = auth.uid()
  )
);