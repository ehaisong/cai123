
drop policy if exists "shop_avatars_public_read" on storage.objects;

create policy "shop_avatars_public_read"
on storage.objects for select
using (
  bucket_id = 'shop-avatars'
  and (storage.foldername(name))[1] is not null
);
