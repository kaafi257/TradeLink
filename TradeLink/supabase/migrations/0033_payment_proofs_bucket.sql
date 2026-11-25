-- Re-assert the receipt bucket and its upload policy (idempotent) so a customer can always attach a receipt.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Customers upload payment proof" on storage.objects;
create policy "Customers upload payment proof" on storage.objects for insert to anon, authenticated
with check (bucket_id = 'payment-proofs' and name ~ '^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$');
drop policy if exists "Finance reads payment proof" on storage.objects;
create policy "Finance reads payment proof" on storage.objects for select to authenticated
using (bucket_id = 'payment-proofs' and (coalesce(public.has_permission('payments.view'), false) or public.is_tl_staff()));
