-- TradeLink marketplace administration: additive migration, preserving all existing business data.
-- Marketplace tables from the marketplace foundation migration are reused.
-- Support tickets are the only new workflow table.

create table if not exists public.marketplace_support_tickets (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 120),
  email text check (email is null or char_length(email) <= 160),
  phone text check (phone is null or char_length(phone) <= 40),
  subject text not null check (char_length(btrim(subject)) between 1 and 160),
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting_customer','resolved','closed')),
  internal_note text,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketplace_support_tickets enable row level security;
drop policy if exists "marketplace support permissions" on public.marketplace_support_tickets;
create policy "marketplace support permissions"
on public.marketplace_support_tickets for all to authenticated
using (public.has_permission('support.manage'))
with check (public.has_permission('support.manage'));

drop trigger if exists marketplace_support_tickets_updated_at on public.marketplace_support_tickets;
create trigger marketplace_support_tickets_updated_at
before update on public.marketplace_support_tickets
for each row execute function public.set_updated_at();

grant select, insert, update on public.marketplace_support_tickets to authenticated;

-- Replace broad staff-only policies on marketplace admin tables with the existing
-- database-backed role_permissions mechanism. The owner always passes has_permission().
drop policy if exists "tl staff manage payment providers" on public.marketplace_payment_providers;
drop policy if exists "tl staff manage marketplace_payment_records" on public.marketplace_payment_records;
drop policy if exists "tl staff manage marketplace_payouts" on public.marketplace_payouts;
drop policy if exists "tl staff manage marketplace_category_commissions" on public.marketplace_category_commissions;
drop policy if exists "tl staff manage marketplace_returns" on public.marketplace_returns;
drop policy if exists "tl staff manage marketplace_disputes" on public.marketplace_disputes;
drop policy if exists "tl staff manage marketplace_promotions" on public.marketplace_promotions;
drop policy if exists "tl staff manage marketplace_reviews" on public.marketplace_reviews;

create policy "marketplace payments permissions" on public.marketplace_payment_providers
for all to authenticated using (public.has_permission('marketplace.payments')) with check (public.has_permission('marketplace.payments'));
create policy "marketplace payment records permissions" on public.marketplace_payment_records
for all to authenticated using (public.has_permission('marketplace.payments')) with check (public.has_permission('marketplace.payments'));
create policy "marketplace payout permissions" on public.marketplace_payouts
for all to authenticated using (public.has_permission('marketplace.payouts')) with check (public.has_permission('marketplace.payouts'));
create policy "marketplace commission permissions" on public.marketplace_category_commissions
for all to authenticated using (public.has_permission('marketplace.commissions')) with check (public.has_permission('marketplace.commissions'));
create policy "marketplace returns permissions" on public.marketplace_returns
for all to authenticated using (public.has_permission('marketplace.cases')) with check (public.has_permission('marketplace.cases'));
create policy "marketplace disputes permissions" on public.marketplace_disputes
for all to authenticated using (public.has_permission('marketplace.cases')) with check (public.has_permission('marketplace.cases'));
create policy "marketplace promotions permissions" on public.marketplace_promotions
for all to authenticated using (public.has_permission('marketplace.marketing')) with check (public.has_permission('marketplace.marketing'));
create policy "marketplace review permissions" on public.marketplace_reviews
for all to authenticated using (public.has_permission('marketplace.reviews')) with check (public.has_permission('marketplace.reviews'));

-- Manager access is enabled by default, and the owner can adjust it in Settings.
insert into public.role_permissions(role, permission) values
 ('manager','marketplace.payments'),
 ('manager','marketplace.payouts'),
 ('manager','marketplace.commissions'),
 ('manager','marketplace.cases'),
 ('manager','marketplace.marketing'),
 ('manager','marketplace.reviews'),
 ('manager','marketplace.website'),
 ('manager','support.manage'),
 ('manager','suppliers.verify')
on conflict do nothing;

-- Website events already contain anonymous storefront analytics. Restrict reads to
-- users with the website permission; public writes remain through track_event().
drop policy if exists "Staff can read site events" on public.site_events;
drop policy if exists "staff read site events" on public.site_events;
create policy "website analytics permission"
on public.site_events for select to authenticated
using (public.has_permission('marketplace.website'));

-- Supplier applications continue to be reviewed through the existing review_supplier()
-- RPC and supplier status columns; no duplicate verification table is introduced.
