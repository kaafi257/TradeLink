-- TradeLink: product image uploads. Run ONCE in Supabase -> SQL Editor (safe to re-run).
-- Creates a public "product-images" bucket. Anyone can view an image (the public site needs that),
-- but only owner, manager and inventory staff can add, replace or delete images.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Staff read product images" on storage.objects;
create policy "Staff read product images" on storage.objects for select to authenticated
using (bucket_id = 'product-images' and public.has_any_role(array['owner','manager','inventory']::public.app_role[]));

drop policy if exists "Staff upload product images" on storage.objects;
create policy "Staff upload product images" on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and public.has_any_role(array['owner','manager','inventory']::public.app_role[]));

drop policy if exists "Staff update product images" on storage.objects;
create policy "Staff update product images" on storage.objects for update to authenticated
using (bucket_id = 'product-images' and public.has_any_role(array['owner','manager','inventory']::public.app_role[]))
with check (bucket_id = 'product-images' and public.has_any_role(array['owner','manager','inventory']::public.app_role[]));

drop policy if exists "Staff delete product images" on storage.objects;
create policy "Staff delete product images" on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and public.has_any_role(array['owner','manager','inventory']::public.app_role[]));
