UPDATE public.shop_memberships
   SET upline_user_id = '054bd012-91aa-4404-8772-99f0fb52e5aa'
 WHERE user_id      = '231139e8-0602-44cf-b61c-32002901ce6c'
   AND merchant_id  = '2bb2376f-58a6-432c-b372-3aa74368f748'
   AND upline_user_id IS NULL;