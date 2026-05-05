
-- 1) 重写 find_user_by_phone：双向去 86 国码比较
CREATE OR REPLACE FUNCTION public.find_user_by_phone(_phone text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID;
  v_norm TEXT;
BEGIN
  v_norm := regexp_replace(COALESCE(_phone,''), '\D','','g');
  -- 去掉前导 86（中国手机号 11 位且以 1 开头）
  IF length(v_norm) = 13 AND substr(v_norm,1,2) = '86' AND substr(v_norm,3,1) = '1' THEN
    v_norm := substr(v_norm, 3);
  END IF;
  IF v_norm = '' THEN RETURN NULL; END IF;

  SELECT id INTO v_uid
    FROM auth.users u
   WHERE
     CASE
       WHEN length(regexp_replace(coalesce(u.phone,''),'\D','','g')) = 13
        AND substr(regexp_replace(coalesce(u.phone,''),'\D','','g'),1,2) = '86'
        AND substr(regexp_replace(coalesce(u.phone,''),'\D','','g'),3,1) = '1'
       THEN substr(regexp_replace(coalesce(u.phone,''),'\D','','g'),3)
       ELSE regexp_replace(coalesce(u.phone,''),'\D','','g')
     END = v_norm
   ORDER BY (u.email NOT LIKE '%@phone.local') DESC NULLS LAST,
            u.created_at ASC
   LIMIT 1;

  RETURN v_uid;
END;
$function$;

-- 2) 删除影子账号（这些账号没有交易/订单/商家数据）
-- 13807674808：保留 456ed039（最近创建，作为该手机号的正式账号），删除 2c69bfed
-- 15120857030：保留商家 725b6638，删除影子 9e296d21
DELETE FROM public.user_roles WHERE user_id IN (
  '2c69bfed-973e-4b18-8f54-25c2908eabfa'::uuid,
  '9e296d21-a5e3-409d-b8ec-e75529bb0035'::uuid
);
DELETE FROM public.wallets WHERE user_id IN (
  '2c69bfed-973e-4b18-8f54-25c2908eabfa'::uuid,
  '9e296d21-a5e3-409d-b8ec-e75529bb0035'::uuid
);
DELETE FROM public.agent_relations WHERE user_id IN (
  '2c69bfed-973e-4b18-8f54-25c2908eabfa'::uuid,
  '9e296d21-a5e3-409d-b8ec-e75529bb0035'::uuid
);
DELETE FROM public.profiles WHERE user_id IN (
  '2c69bfed-973e-4b18-8f54-25c2908eabfa'::uuid,
  '9e296d21-a5e3-409d-b8ec-e75529bb0035'::uuid
);
DELETE FROM auth.users WHERE id IN (
  '2c69bfed-973e-4b18-8f54-25c2908eabfa'::uuid,
  '9e296d21-a5e3-409d-b8ec-e75529bb0035'::uuid
);

-- 3) 把保留账号的手机号统一为带 86 的格式
UPDATE auth.users SET phone = '8613807674808'
  WHERE id = '456ed039-a440-43d7-bd19-dc4db8042af8'::uuid;
UPDATE auth.users SET phone = '8615120857030'
  WHERE id = '725b6638-0d75-4c10-86a7-d210cd934834'::uuid;

UPDATE public.profiles SET phone = '13807674808'
  WHERE user_id = '456ed039-a440-43d7-bd19-dc4db8042af8'::uuid;
UPDATE public.profiles SET phone = '15120857030'
  WHERE user_id = '725b6638-0d75-4c10-86a7-d210cd934834'::uuid;

-- 4) handle_new_user 写 profiles.phone 时去掉 86，存裸号便于显示
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code TEXT;
  v_phone TEXT;
BEGIN
  v_code := 'u' || lpad(floor(random()*100000000)::text, 8, '0');
  v_phone := regexp_replace(COALESCE(NEW.phone,''), '\D','','g');
  IF length(v_phone) = 13 AND substr(v_phone,1,2) = '86' AND substr(v_phone,3,1) = '1' THEN
    v_phone := substr(v_phone, 3);
  END IF;
  INSERT INTO public.profiles(user_id, user_code, nickname, phone)
    VALUES (NEW.id, v_code, COALESCE(NEW.raw_user_meta_data->>'nickname', '用户' || substr(v_code, 2, 4)), NULLIF(v_phone,''));
  INSERT INTO public.wallets(user_id) VALUES (NEW.id);
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'buyer');
  INSERT INTO public.agent_relations(user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$function$;
