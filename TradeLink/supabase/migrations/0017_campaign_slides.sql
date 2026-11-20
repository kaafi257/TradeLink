-- TradeLink: homepage advertising campaign, managed from Admin -> Marketing.
-- Additive and safe to run more than once. Run after 0016.
create table if not exists public.campaign_slides (
  id uuid primary key default gen_random_uuid(),
  scene text not null check (scene in ('wholesale','retail','supplier','quote')),   -- which animation plays
  tag text not null check (char_length(tag) between 1 and 24),
  title text not null check (char_length(title) between 1 and 70),
  body text not null default '' check (char_length(body) <= 160),
  cta_label text not null check (char_length(cta_label) between 1 and 28),
  cta_action text not null check (cta_action in ('shop_wholesale','shop_retail','register','quote')),
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_updated_at on public.campaign_slides;
create trigger set_updated_at before update on public.campaign_slides for each row execute function public.set_updated_at();

alter table public.campaign_slides enable row level security;
drop policy if exists "Staff read campaign" on public.campaign_slides;
create policy "Staff read campaign" on public.campaign_slides for select to authenticated
using (public.has_any_role(array['owner','manager']::public.app_role[]));
drop policy if exists "Manage campaign" on public.campaign_slides;
create policy "Manage campaign" on public.campaign_slides for all to authenticated
using (public.has_any_role(array['owner','manager']::public.app_role[])) with check (public.has_any_role(array['owner','manager']::public.app_role[]));
grant select, insert, update, delete on public.campaign_slides to authenticated;

-- The website only ever sees the active scenes, in order.
drop view if exists public.public_campaign;
create view public.public_campaign as
select id, scene, tag, title, body, cta_label, cta_action, sort_order
from public.campaign_slides where active order by sort_order, created_at;
grant select on public.public_campaign to anon, authenticated;

-- Starting scenes (only when the table is empty). Edit, reorder or switch them off in Admin -> Marketing.
insert into public.campaign_slides (scene, tag, title, body, cta_label, cta_action, sort_order)
select * from (values
  ('wholesale','Wholesale','Buy in bulk, straight from suppliers','Minimum orders shown up front. Compare suppliers and order in one place.','Shop wholesale','shop_wholesale',10),
  ('retail','Retail','Just need a few? Shop retail too','Switch between wholesale and retail in one tap. Same marketplace, same trusted suppliers.','Shop retail','shop_retail',20),
  ('supplier','For suppliers','Open your store on TradeLink','Register your business, list your products and reach buyers across the marketplace.','Register your business','register',30),
  ('quote','Bulk orders','Need a price for a big order?','Send your requirements and get a quote from the team.','Request a quote','quote',40)
) v(scene, tag, title, body, cta_label, cta_action, sort_order)
where not exists (select 1 from public.campaign_slides);
