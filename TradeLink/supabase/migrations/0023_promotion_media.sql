-- TradeLink: a picture or short video for the homepage advertising area.
-- Run ONCE in Supabase -> SQL Editor (safe to re-run). Needs 0021_promotions_v2.sql first.
-- Adds promotions.media_url, a public "promo-media" storage bucket (only staff who manage marketing can upload),
-- set_promotion_media() to attach or remove the file, and exposes media_url on the public view of live campaigns.

alter table public.promotions add column if not exists media_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('promo-media', 'promo-media', true, 62914560, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Marketing upload promo media" on storage.objects;
create policy "Marketing upload promo media" on storage.objects for insert to authenticated
with check (bucket_id = 'promo-media' and coalesce(public.has_permission('marketing.manage'), false));

drop policy if exists "Marketing update promo media" on storage.objects;
create policy "Marketing update promo media" on storage.objects for update to authenticated
using (bucket_id = 'promo-media' and coalesce(public.has_permission('marketing.manage'), false))
with check (bucket_id = 'promo-media' and coalesce(public.has_permission('marketing.manage'), false));

drop policy if exists "Marketing delete promo media" on storage.objects;
create policy "Marketing delete promo media" on storage.objects for delete to authenticated
using (bucket_id = 'promo-media' and coalesce(public.has_permission('marketing.manage'), false));

create or replace function public.set_promotion_media(p_id uuid, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if auth.uid() is null or not coalesce(public.has_permission('marketing.manage'), false) then
    raise exception 'You do not have permission to manage promotions.';
  end if;
  if v_url is not null and v_url !~ '^https://' then raise exception 'The picture or video link is not valid.'; end if;
  update public.promotions set media_url = v_url where id = p_id;
  if not found then raise exception 'That promotion no longer exists.'; end if;
end $$;
revoke all on function public.set_promotion_media(uuid, text) from public;
grant execute on function public.set_promotion_media(uuid, text) to authenticated;

create or replace view public.public_promotions as
select v.id, v.name, v.kind, v.scope, v.supplier_id, v.category_id, v.product_id, v.discount_type, v.percent, v.amount, v.max_discount,
       v.buy_qty, v.get_qty, v.starts_at, v.ends_at, v.started_at, v.show_banner, v.banner_text, v.media_url
from public.promotions v
where v.status = 'active' and (v.supplier_id is null or exists (select 1 from public.public_suppliers s where s.id = v.supplier_id));
grant select on public.public_promotions to anon, authenticated;
