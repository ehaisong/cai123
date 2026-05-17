
CREATE OR REPLACE FUNCTION public.resolve_my_shop()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_merchant uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  -- 1) 自己作为代理绑定的店铺优先（取最近加入的一家）
  SELECT sm.merchant_id INTO v_merchant
    FROM public.shop_memberships sm
    JOIN public.merchants m ON m.id = sm.merchant_id
   WHERE sm.user_id = v_uid
     AND sm.is_agent = true
     AND m.status = 'approved'
     AND COALESCE(m.is_disabled, false) = false
   ORDER BY sm.joined_at DESC
   LIMIT 1;

  IF v_merchant IS NOT NULL THEN RETURN v_merchant; END IF;

  -- 2) 否则作为客户，按"上级所属店铺"解析（最近加入的一条客户关系）
  SELECT sm.merchant_id INTO v_merchant
    FROM public.shop_memberships sm
    JOIN public.merchants m ON m.id = sm.merchant_id
   WHERE sm.user_id = v_uid
     AND sm.is_agent = false
     AND m.status = 'approved'
     AND COALESCE(m.is_disabled, false) = false
   ORDER BY sm.joined_at DESC
   LIMIT 1;

  RETURN v_merchant;
END;
$function$;
