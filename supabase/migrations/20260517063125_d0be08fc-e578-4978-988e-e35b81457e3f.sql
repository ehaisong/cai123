CREATE POLICY "sm_select_upline" ON public.shop_memberships
FOR SELECT TO authenticated
USING (auth.uid() = upline_user_id);