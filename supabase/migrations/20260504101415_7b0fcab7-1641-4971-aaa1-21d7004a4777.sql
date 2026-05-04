
insert into storage.buckets (id, name, public)
values ('shop-avatars', 'shop-avatars', true)
on conflict (id) do nothing;

create policy "shop_avatars_public_read"
on storage.objects for select
using (bucket_id = 'shop-avatars');

create policy "shop_avatars_user_insert"
on storage.objects for insert
with check (
  bucket_id = 'shop-avatars'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "shop_avatars_user_update"
on storage.objects for update
using (
  bucket_id = 'shop-avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "shop_avatars_user_delete"
on storage.objects for delete
using (
  bucket_id = 'shop-avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);
