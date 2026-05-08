
-- 规范化 auth.users.phone：13 位且以 861 开头 → 去掉前两位
UPDATE auth.users
   SET phone = substr(regexp_replace(phone, '\D', '', 'g'), 3)
 WHERE phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) = 13
   AND substr(regexp_replace(phone, '\D', '', 'g'), 1, 3) = '861';

-- 规范化 public.profiles.phone
UPDATE public.profiles
   SET phone = substr(regexp_replace(phone, '\D', '', 'g'), 3)
 WHERE phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) = 13
   AND substr(regexp_replace(phone, '\D', '', 'g'), 1, 3) = '861';
