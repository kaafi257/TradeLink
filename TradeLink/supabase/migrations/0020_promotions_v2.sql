-- Promotion management v2: campaigns for TradeLink and for suppliers, with approval.
-- Run AFTER 0018 and 0019. Safe to run more than once. Existing promotions, coupons and their results are kept.
--
-- What is new
--  * Campaign kinds: sale (percentage or fixed amount off), flash sale (short, must end within 72 hours), and Buy X Get Y.
--  * Statuses: draft, pending (waiting for TradeLink), scheduled, active, paused, expired. The old "ended" becomes "expired".
--  * Suppliers create store-wide or single-product campaigns and coupon codes for their OWN products, then submit them.
--    TradeLink approves or rejects (with a note). Nothing a supplier makes goes live without approval.
--  * Limits: start/end, maximum discount per unit (campaigns) or per order (coupons), minimum order and usage limit (coupons).
--  * One promotion per product at a time: overlapping campaigns on the same product are refused when submitted, started or approved.
--  * Free units (Buy X Get Y) and coupons are applied automatically when a request is priced; free units show as their own zero-price
--    line on the order so stock and delivery stay correct. A coupon is not applied to lines that already carry a Buy X Get Y offer.
--  * Featured products and stores, homepage campaign banners, public views of live campaigns, and results for staff and suppliers.

-- ---------------------------------------------------------------------------
-- 1. Campaign columns
-- ---------------------------------------------------------------------------
alter table public.promotions
  add column if not exists supplier_id uuid references public.suppliers(id) on delete cascade,
  add column if not exists owner text not null default 'store',
  add column if not exists kind text not null default 'sale',
  add column if not exists discount_type text not null default 'percent',
  add column if not exists amount numeric(14,2),
  add column if not exists max_discount numeric(14,2),
  add column if not exists buy_qty int,
  add column if not exists get_qty int,
  add column if not exists show_banner boolean not null default false,
  add column if not exists banner_text text,
  add column if not exists review_note text,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by text;

alter table public.promotions drop constraint if exists promotions_status_check;
update public.promotions set status = 'expired' where status = 'ended';
alter table public.promotions add constraint promotions_status_check check (status in ('draft','pending','scheduled','active','paused','expired'));
alter table public.promotions drop constraint if exists promotions_scope_check;
alter table public.promotions add constraint promotions_scope_check check (scope in ('all','category','product','store'));
alter table public.promotions drop constraint if exists promotions_percent_check;
alter table public.promotions alter column percent drop not null;
alter table public.promotions drop constraint if exists promotions_terms_check;
alter table public.promotions add constraint promotions_terms_check check (
  kind in ('sale','flash','bogo') and discount_type in ('percent','fixed') and owner in ('store','supplier')
  and (owner = 'store' or supplier_id is not null)
  and (scope <> 'store' or supplier_id is not null)
  and (max_discount is null or max_discount > 0)
  and (
    (kind = 'bogo' and buy_qty between 1 and 20 and get_qty between 1 and 20)
    or (kind in ('sale','flash') and ((discount_type = 'percent' and percent between 1 and 90) or (discount_type = 'fixed' and amount > 0)))
  )
);
alter table public.promotions drop constraint if exists promotions_banner_check;
alter table public.promotions add constraint promotions_banner_check check (banner_text is null or char_length(banner_text) <= 80);
create index if not exists promotions_supplier_idx on public.promotions(supplier_id) where supplier_id is not null;
create index if not exists promotions_status_idx on public.promotions(status);

-- Every time a promotion is live: results only count sales inside these windows (so a pause is not counted).
create table if not exists public.promotion_runs (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists promotion_runs_idx on public.promotion_runs(promotion_id);
insert into public.promotion_runs (promotion_id, started_at, ended_at)
select p.id, p.started_at, case when p.status = 'active' then null else coalesce(p.ended_at, p.started_at) end
from public.promotions p where p.started_at is not null and not exists (select 1 from public.promotion_runs r where r.promotion_id = p.id);

-- Who can read what. Nobody writes these tables directly: every change goes through the functions below.
alter table public.promotion_runs enable row level security;
drop policy if exists "Staff read promotions" on public.promotions;
drop policy if exists "Read promotions" on public.promotions;
create policy "Read promotions" on public.promotions for select to authenticated
using (public.has_permission('marketing.manage') or public.is_tl_staff() or (supplier_id is not null and supplier_id = public.my_supplier_id()));
drop policy if exists "Staff read promotion items" on public.promotion_items;
drop policy if exists "Read promotion items" on public.promotion_items;
create policy "Read promotion items" on public.promotion_items for select to authenticated
using (public.has_permission('marketing.manage') or public.is_tl_staff()
       or exists (select 1 from public.promotions v where v.id = promotion_id and v.supplier_id is not null and v.supplier_id = public.my_supplier_id()));
drop policy if exists "Read promotion runs" on public.promotion_runs;
create policy "Read promotion runs" on public.promotion_runs for select to authenticated
using (public.has_permission('marketing.manage') or public.is_tl_staff());
revoke insert, update, delete on public.promotions, public.promotion_items, public.promotion_runs from authenticated, anon;
grant select on public.promotions, public.promotion_items, public.promotion_runs to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers (internal)
-- ---------------------------------------------------------------------------
create or replace function public.promo_unit_price(p_retail numeric, p_type text, p_percent numeric, p_amount numeric, p_cap numeric) returns numeric
language sql immutable as $$
  select round(p_retail - least(coalesce(p_cap, 1000000000000::numeric),
         case when p_type = 'percent' then p_retail * coalesce(p_percent, 0) / 100 else coalesce(p_amount, 0) end), 2)
$$;

-- The products a campaign covers right now. A supplier's campaign can only ever cover that supplier's own products.
create or replace function public.promo_products(p_id uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.promotions v join public.products p on p.active
  where v.id = p_id
    and (v.owner <> 'supplier' or p.supplier_id = v.supplier_id)
    and (v.scope = 'all' or (v.scope = 'category' and p.category_id = v.category_id) or (v.scope = 'product' and p.id = v.product_id)
         or (v.scope = 'store' and p.supplier_id = v.supplier_id))
    and (v.kind = 'bogo' or (p.retail_price > 0 and p.audience in ('b2c','both')))
$$;

-- Returns a sentence when another campaign (waiting, scheduled, running or paused) overlaps this one on any product, otherwise null.
create or replace function public.promo_conflict(p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v public.promotions%rowtype; r record; v_lo timestamptz; v_hi timestamptz;
begin
  select * into v from public.promotions where id = p_id;
  if v.id is null then return null; end if;
  v_lo := coalesce(v.starts_at, v.started_at, now());
  v_hi := coalesce(v.ends_at, 'infinity'::timestamptz);
  select o.name, count(*) as n into r
  from public.promotions o
  cross join lateral public.promo_products(o.id) as op(pid)
  where o.id <> v.id and o.status in ('pending','scheduled','active','paused')
    and coalesce(o.starts_at, o.started_at, now()) < v_hi
    and v_lo < coalesce(o.ends_at, 'infinity'::timestamptz)
    and op.pid in (select public.promo_products(v.id))
  group by o.name order by count(*) desc limit 1;
  if r.name is null then return null; end if;
  return 'This overlaps "' || r.name || '" on ' || r.n || ' product' || case when r.n = 1 then '' else 's' end || '. A product can be in only one promotion at a time.';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Start, stop, schedule
-- ---------------------------------------------------------------------------
create or replace function public.promotion_activate(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v public.promotions%rowtype; n int;
begin
  select * into v from public.promotions where id = p_id for update;
  if v.id is null then raise exception 'Promotion not found.'; end if;
  if v.status not in ('draft','scheduled','pending','paused') then raise exception 'This promotion cannot be started (it is %).', v.status; end if;
  if v.ends_at is not null and v.ends_at <= now() then raise exception 'The end date has passed.'; end if;
  if v.owner = 'supplier' and not exists (select 1 from public.suppliers s where s.id = v.supplier_id and s.status = 'approved' and s.active) then
    raise exception 'This supplier is not active.';
  end if;
  delete from public.promotion_items where promotion_id = v.id;
  if v.kind = 'bogo' then
    insert into public.promotion_items (promotion_id, product_id, prior_sale_price, applied_price)
    select v.id, p.id, null, coalesce(p.retail_price, 0) from public.products p
    where p.id in (select public.promo_products(v.id))
      and not exists (select 1 from public.promotion_items pi join public.promotions pr on pr.id = pi.promotion_id where pi.product_id = p.id and pr.status = 'active' and pr.id <> v.id);
  else
    insert into public.promotion_items (promotion_id, product_id, prior_sale_price, applied_price)
    select v.id, p.id, p.sale_price, public.promo_unit_price(p.retail_price, v.discount_type, v.percent, v.amount, v.max_discount)
    from public.products p
    where p.id in (select public.promo_products(v.id))
      and public.promo_unit_price(p.retail_price, v.discount_type, v.percent, v.amount, v.max_discount) > 0
      and public.promo_unit_price(p.retail_price, v.discount_type, v.percent, v.amount, v.max_discount) < p.retail_price
      and not exists (select 1 from public.promotion_items pi join public.promotions pr on pr.id = pi.promotion_id where pi.product_id = p.id and pr.status = 'active' and pr.id <> v.id);
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No products qualify: they must be live, have a retail price (for sales), and not already be in another running promotion.'; end if;
  if v.kind <> 'bogo' then
    update public.products p set sale_price = pi.applied_price from public.promotion_items pi where pi.promotion_id = v.id and pi.product_id = p.id;
  end if;
  update public.promotions set status = 'active', started_at = coalesce(started_at, now()), paused_at = null, paused_by = null, note = null where id = v.id;
  insert into public.promotion_runs (promotion_id) values (v.id);
  perform public.write_activity('promotion_started', 'marketing', 'Started promotion ' || v.name || ' (' || n || ' products)', jsonb_build_object('promotion_id', v.id));
  return n;
end $$;

-- Internal: take a running promotion off the shelf. to = 'expired' | 'paused'. Earlier prices come back unless someone changed them by hand.
create or replace function public.promotion_stop(p_id uuid, p_to text, p_by text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.promotions%rowtype;
begin
  select * into v from public.promotions where id = p_id for update;
  if v.id is null then raise exception 'Promotion not found.'; end if;
  if v.status not in ('active','paused') then raise exception 'Only a running or paused promotion can be %.', case when p_to = 'paused' then 'paused' else 'ended' end; end if;
  if v.status = 'active' then
    if v.kind <> 'bogo' then
      update public.products p set sale_price = pi.prior_sale_price
      from public.promotion_items pi where pi.promotion_id = v.id and pi.product_id = p.id and p.sale_price = pi.applied_price;
    end if;
    update public.promotion_runs set ended_at = now() where promotion_id = v.id and ended_at is null;
  end if;
  if p_to = 'paused' then
    update public.promotions set status = 'paused', paused_at = now(), paused_by = p_by where id = v.id;
  else
    update public.promotions set status = 'expired', ended_at = now(), paused_at = null, paused_by = null where id = v.id;
  end if;
  perform public.write_activity('promotion_' || p_to, 'marketing', initcap(p_to) || ' promotion ' || v.name, jsonb_build_object('promotion_id', v.id));
end $$;

-- Older name, still used by the previous Marketing page: end a running/paused promotion, or cancel a scheduled one.
create or replace function public.promotion_finish(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s text;
begin
  select status into s from public.promotions where id = p_id;
  if s = 'scheduled' then update public.promotions set status = 'draft' where id = p_id;
  else perform public.promotion_stop(p_id, 'expired'); end if;
end $$;

-- Starts scheduled campaigns when their time comes, ends finished ones, and pauses those of a supplier that is no longer active.
create or replace function public.sync_promotions() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not exists (select 1 from public.promotions where (status = 'scheduled' and starts_at <= now()) or (status in ('active','paused') and ends_at <= now()))
     and not exists (select 1 from public.promotions v join public.suppliers s on s.id = v.supplier_id
                     where v.status = 'active' and v.owner = 'supplier' and not (s.status = 'approved' and s.active)) then return 0; end if;
  for r in select id from public.promotions where status = 'scheduled' and starts_at <= now() order by starts_at loop
    begin
      perform public.promotion_activate(r.id); n := n + 1;
    exception when others then
      update public.promotions set status = 'draft', note = 'Did not start: ' || sqlerrm where id = r.id;
    end;
  end loop;
  for r in select id from public.promotions where status in ('active','paused') and ends_at <= now() loop
    perform public.promotion_stop(r.id, 'expired'); n := n + 1;
  end loop;
  for r in select v.id from public.promotions v join public.suppliers s on s.id = v.supplier_id
           where v.status = 'active' and v.owner = 'supplier' and not (s.status = 'approved' and s.active) loop
    perform public.promotion_stop(r.id, 'paused', 'store'); n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Create / edit a campaign draft (TradeLink staff or an approved supplier)
-- ---------------------------------------------------------------------------
create or replace function public.save_promotion(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sup uuid := public.my_supplier_id();
  v_staff boolean := coalesce(public.has_permission('marketing.manage'), false);
  v_id uuid := nullif(p->>'id', '')::uuid;
  old public.promotions%rowtype;
  v_owner text; v_name text := btrim(coalesce(p->>'name', ''));
  v_kind text := coalesce(nullif(p->>'kind', ''), 'sale');
  v_scope text := coalesce(p->>'scope', '');
  v_cat uuid := nullif(p->>'category_id', '')::uuid; v_prod uuid := nullif(p->>'product_id', '')::uuid; v_store uuid := nullif(p->>'supplier_id', '')::uuid;
  v_type text := coalesce(nullif(p->>'discount_type', ''), 'percent');
  v_pct numeric := nullif(p->>'percent', '')::numeric; v_amt numeric := nullif(p->>'amount', '')::numeric; v_cap numeric := nullif(p->>'max_discount', '')::numeric;
  v_buy int := nullif(p->>'buy_qty', '')::int; v_get int := nullif(p->>'get_qty', '')::int;
  v_starts timestamptz := nullif(p->>'starts_at', '')::timestamptz; v_ends timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_banner boolean := coalesce((p->>'show_banner')::boolean, false); v_btext text := nullif(btrim(coalesce(p->>'banner_text', '')), '');
begin
  if auth.uid() is null or (v_sup is null and not v_staff) then raise exception 'You do not have permission to manage promotions.'; end if;
  v_owner := case when v_sup is not null then 'supplier' else 'store' end;
  if char_length(v_name) not between 2 and 80 then raise exception 'Give the promotion a name (2 to 80 characters).'; end if;
  if v_kind not in ('sale','flash','bogo') then raise exception 'Choose a promotion type.'; end if;
  if v_type not in ('percent','fixed') then raise exception 'Choose percentage or fixed amount.'; end if;

  if v_owner = 'supplier' then
    if v_scope not in ('store','product') then raise exception 'Choose your whole store or one product.'; end if;
    v_store := v_sup; v_cat := null;
    if v_scope = 'product' then
      if v_prod is null or not exists (select 1 from public.products where id = v_prod and supplier_id = v_sup and active) then raise exception 'Choose one of your live products.'; end if;
    else v_prod := null; end if;
    v_banner := false; v_btext := null;
  else
    if v_scope not in ('all','category','product','store') then raise exception 'Choose what the promotion covers.'; end if;
    if v_scope = 'category' and not exists (select 1 from public.categories where id = v_cat) then raise exception 'Choose a category.'; end if;
    if v_scope = 'product' and not exists (select 1 from public.products where id = v_prod and active) then raise exception 'Choose a product.'; end if;
    if v_scope = 'store' and not exists (select 1 from public.suppliers where id = v_store and status = 'approved' and active) then raise exception 'Choose a supplier.'; end if;
    if v_scope <> 'category' then v_cat := null; end if;
    if v_scope <> 'product' then v_prod := null; end if;
    if v_scope <> 'store' then v_store := null; end if;
  end if;

  if v_kind = 'bogo' then
    if v_buy is null or v_buy not between 1 and 20 or v_get is null or v_get not between 1 and 20 then raise exception 'Buy and Get must each be 1 to 20.'; end if;
    v_pct := null; v_amt := null; v_cap := null; v_type := 'percent';
  else
    v_buy := null; v_get := null;
    if v_type = 'percent' then
      if v_pct is null or v_pct < 1 or v_pct > 90 then raise exception 'The discount must be between 1 and 90 percent.'; end if;
      v_amt := null;
    else
      if v_amt is null or v_amt <= 0 or v_amt > 100000000 then raise exception 'Enter the amount taken off each unit.'; end if;
      v_pct := null;
    end if;
    if v_cap is not null and (v_cap <= 0 or v_cap > 100000000) then raise exception 'The maximum discount must be more than zero.'; end if;
  end if;

  if v_ends is not null and v_ends <= now() then raise exception 'The end must be in the future.'; end if;
  if v_ends is not null and v_starts is not null and v_ends <= v_starts then raise exception 'The end must be after the start.'; end if;
  if v_kind = 'flash' then
    if v_ends is null then raise exception 'A flash sale needs an end time.'; end if;
    if v_ends - greatest(coalesce(v_starts, now()), now()) > interval '72 hours' then raise exception 'A flash sale can run for 72 hours at most.'; end if;
    if v_ends - greatest(coalesce(v_starts, now()), now()) < interval '10 minutes' then raise exception 'A flash sale must run for at least 10 minutes.'; end if;
  end if;
  if v_btext is not null and char_length(v_btext) > 80 then raise exception 'Banner text is 80 characters at most.'; end if;

  if v_id is null then
    insert into public.promotions (name, kind, scope, category_id, product_id, supplier_id, owner, discount_type, percent, amount, max_discount, buy_qty, get_qty,
                                   starts_at, ends_at, show_banner, banner_text, status, created_by)
    values (v_name, v_kind, v_scope, v_cat, v_prod, case when v_owner = 'supplier' then v_sup else v_store end, v_owner, v_type, v_pct, v_amt, v_cap, v_buy, v_get,
            v_starts, v_ends, v_banner, v_btext, 'draft', auth.uid())
    returning id into v_id;
  else
    select * into old from public.promotions where id = v_id for update;
    if old.id is null then raise exception 'Promotion not found.'; end if;
    if old.status <> 'draft' then raise exception 'Only a draft can be edited. Pause or end it first.'; end if;
    if old.owner = 'supplier' and old.supplier_id is distinct from v_sup then raise exception 'You can only edit your own promotions.'; end if;
    if old.owner = 'store' and not v_staff then raise exception 'You can only edit your own promotions.'; end if;
    if old.owner = 'supplier' and v_staff then raise exception 'A supplier''s promotion is edited by the supplier.'; end if;
    update public.promotions set name = v_name, kind = v_kind, scope = v_scope, category_id = v_cat, product_id = v_prod,
           supplier_id = case when owner = 'supplier' then v_sup else v_store end, discount_type = v_type, percent = v_pct, amount = v_amt, max_discount = v_cap,
           buy_qty = v_buy, get_qty = v_get, starts_at = v_starts, ends_at = v_ends, show_banner = v_banner, banner_text = v_btext, note = null
    where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Workflow: submit, approve, reject, start, pause, resume, end, cancel, delete
-- ---------------------------------------------------------------------------
create or replace function public.promotion_action(p_id uuid, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v public.promotions%rowtype; v_staff boolean := coalesce(public.has_permission('marketing.manage'), false);
  v_sup uuid := public.my_supplier_id(); v_mine boolean; v_msg text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or (v_sup is null and not v_staff) then raise exception 'You do not have permission to manage promotions.'; end if;
  select * into v from public.promotions where id = p_id for update;
  if v.id is null then raise exception 'Promotion not found.'; end if;
  v_mine := v_sup is not null and v.owner = 'supplier' and v.supplier_id = v_sup;
  if not (v_mine or v_staff) then raise exception 'You can only change your own promotions.'; end if;

  if p_action = 'submit' then
    if not v_mine then raise exception 'Only the supplier submits its own campaign.'; end if;
    if v.status <> 'draft' then raise exception 'Only a draft can be submitted.'; end if;
    if v.ends_at is not null and v.ends_at <= now() then raise exception 'The end date has passed. Edit the dates first.'; end if;
    if not exists (select 1 from public.promo_products(v.id)) then raise exception 'No products qualify for this campaign.'; end if;
    v_msg := public.promo_conflict(v.id); if v_msg is not null then raise exception '%', v_msg; end if;
    update public.promotions set status = 'pending', submitted_at = now(), review_note = null where id = v.id;
    perform public.write_activity('promotion_submitted', 'marketing', 'Supplier campaign submitted: ' || v.name, jsonb_build_object('promotion_id', v.id));
  elsif p_action = 'withdraw' then
    if not v_mine or v.status <> 'pending' then raise exception 'Only your own pending campaign can be withdrawn.'; end if;
    update public.promotions set status = 'draft' where id = v.id;
  elsif p_action = 'approve' then
    if not v_staff or v.status <> 'pending' then raise exception 'Only a pending campaign can be approved, by TradeLink.'; end if;
    if v.ends_at is not null and v.ends_at <= now() then raise exception 'The end date has passed.'; end if;
    v_msg := public.promo_conflict(v.id); if v_msg is not null then raise exception '%', v_msg; end if;
    update public.promotions set reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note where id = v.id;
    if v.starts_at is not null and v.starts_at > now() then
      update public.promotions set status = 'scheduled' where id = v.id;
      perform public.write_activity('promotion_approved', 'marketing', 'Approved campaign ' || v.name || ' (scheduled)', jsonb_build_object('promotion_id', v.id));
    else
      perform public.promotion_activate(v.id);
    end if;
  elsif p_action = 'reject' then
    if not v_staff or v.status <> 'pending' then raise exception 'Only a pending campaign can be rejected, by TradeLink.'; end if;
    if v_note is null then raise exception 'Write a short reason so the supplier knows what to change.'; end if;
    update public.promotions set status = 'draft', review_note = left(v_note, 500), reviewed_by = auth.uid(), reviewed_at = now() where id = v.id;
    perform public.write_activity('promotion_rejected', 'marketing', 'Rejected campaign ' || v.name, jsonb_build_object('promotion_id', v.id));
  elsif p_action = 'start' then
    if not v_staff or v.owner <> 'store' or v.status <> 'draft' then raise exception 'Only a TradeLink draft can be started here.'; end if;
    if v.ends_at is not null and v.ends_at <= now() then raise exception 'The end date has passed. Edit the dates first.'; end if;
    v_msg := public.promo_conflict(v.id); if v_msg is not null then raise exception '%', v_msg; end if;
    if v.starts_at is not null and v.starts_at > now() then update public.promotions set status = 'scheduled' where id = v.id;
    else perform public.promotion_activate(v.id); end if;
  elsif p_action = 'pause' then
    if v.status <> 'active' then raise exception 'Only a running promotion can be paused.'; end if;
    perform public.promotion_stop(v.id, 'paused', case when v_mine then 'supplier' else 'store' end);
  elsif p_action = 'resume' then
    if v.status <> 'paused' then raise exception 'Only a paused promotion can be resumed.'; end if;
    if v_mine and v.paused_by = 'store' then raise exception 'TradeLink paused this promotion. Please contact TradeLink.'; end if;
    perform public.promotion_activate(v.id);
  elsif p_action = 'end' then
    if v.status not in ('active','paused') then raise exception 'Only a running or paused promotion can be ended.'; end if;
    perform public.promotion_stop(v.id, 'expired');
  elsif p_action = 'cancel' then
    if v.status <> 'scheduled' then raise exception 'Only a scheduled promotion can be cancelled.'; end if;
    update public.promotions set status = 'draft' where id = v.id;
  elsif p_action = 'delete' then
    if v.status <> 'draft' then raise exception 'Only a draft can be deleted.'; end if;
    delete from public.promotions where id = v.id;
    return 'deleted';
  else
    raise exception 'Unknown action.';
  end if;
  return (select status from public.promotions where id = p_id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Coupons v2: fixed or percentage, minimum order, maximum discount, supplier-owned with approval
-- ---------------------------------------------------------------------------
alter table public.coupons
  add column if not exists supplier_id uuid references public.suppliers(id) on delete cascade,
  add column if not exists owner text not null default 'store',
  add column if not exists discount_type text not null default 'percent',
  add column if not exists amount numeric(14,2),
  add column if not exists min_order numeric(14,2),
  add column if not exists max_discount numeric(14,2),
  add column if not exists approval text not null default 'approved',
  add column if not exists review_note text,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz;
alter table public.coupons drop constraint if exists coupons_percent_check;
alter table public.coupons alter column percent drop not null;
alter table public.coupons drop constraint if exists coupons_terms_check;
alter table public.coupons add constraint coupons_terms_check check (
  discount_type in ('percent','fixed') and owner in ('store','supplier') and approval in ('draft','pending','approved')
  and (owner = 'store' or supplier_id is not null)
  and ((discount_type = 'percent' and percent between 1 and 90) or (discount_type = 'fixed' and amount > 0))
  and (min_order is null or min_order > 0) and (max_discount is null or max_discount > 0)
);
alter table public.coupon_redemptions alter column percent set default 0;
alter table public.quotations add column if not exists coupon_note text;
alter table public.quotation_items
  add column if not exists free_qty numeric(14,3) not null default 0 check (free_qty >= 0),
  add column if not exists coupon_pct numeric(9,6) not null default 0 check (coupon_pct between 0 and 100);

drop policy if exists "Staff read coupons" on public.coupons;
drop policy if exists "Read coupons" on public.coupons;
create policy "Read coupons" on public.coupons for select to authenticated
using (public.has_permission('marketing.manage') or public.is_tl_staff() or (supplier_id is not null and supplier_id = public.my_supplier_id()));

create or replace function public.save_coupon(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sup uuid := public.my_supplier_id(); v_staff boolean := coalesce(public.has_permission('marketing.manage'), false);
  v_id uuid := nullif(p->>'id', '')::uuid; old public.coupons%rowtype;
  v_code text := upper(btrim(coalesce(p->>'code', ''))); v_name text := nullif(btrim(coalesce(p->>'name', '')), '');
  v_type text := coalesce(nullif(p->>'discount_type', ''), 'percent');
  v_pct numeric := nullif(p->>'percent', '')::numeric; v_amt numeric := nullif(p->>'amount', '')::numeric;
  v_min numeric := nullif(p->>'min_order', '')::numeric; v_cap numeric := nullif(p->>'max_discount', '')::numeric; v_uses int := nullif(p->>'max_uses', '')::int;
  v_starts timestamptz := nullif(p->>'starts_at', '')::timestamptz; v_ends timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_owner text;
begin
  if auth.uid() is null or (v_sup is null and not v_staff) then raise exception 'You do not have permission to manage coupons.'; end if;
  v_owner := case when v_sup is not null then 'supplier' else 'store' end;
  if v_code !~ '^[A-Z0-9_-]{4,20}$' then raise exception 'A code is 4 to 20 letters, numbers, - or _.'; end if;
  if char_length(coalesce(v_name, '')) > 80 then raise exception 'The note is 80 characters at most.'; end if;
  if v_type not in ('percent','fixed') then raise exception 'Choose percentage or fixed amount.'; end if;
  if v_type = 'percent' then
    if v_pct is null or v_pct < 1 or v_pct > 90 then raise exception 'The discount must be between 1 and 90 percent.'; end if; v_amt := null;
  else
    if v_amt is null or v_amt <= 0 or v_amt > 100000000 then raise exception 'Enter the amount taken off the order.'; end if; v_pct := null;
  end if;
  if v_min is not null and (v_min <= 0 or v_min > 1000000000) then raise exception 'The minimum order must be more than zero.'; end if;
  if v_cap is not null and (v_cap <= 0 or v_cap > 1000000000) then raise exception 'The maximum discount must be more than zero.'; end if;
  if v_uses is not null and v_uses <= 0 then raise exception 'The usage limit must be at least 1.'; end if;
  if v_ends is not null and v_ends <= now() then raise exception 'The end must be in the future.'; end if;
  if v_ends is not null and v_starts is not null and v_ends <= v_starts then raise exception 'The end must be after the start.'; end if;

  if v_id is null then
    if exists (select 1 from public.coupons where code = v_code) then raise exception 'That code already exists.'; end if;
    insert into public.coupons (code, name, discount_type, percent, amount, min_order, max_discount, max_uses, starts_at, ends_at, owner, supplier_id, approval, active, created_by)
    values (v_code, v_name, v_type, v_pct, v_amt, v_min, v_cap, v_uses, v_starts, v_ends, v_owner, v_sup,
            case when v_owner = 'supplier' then 'draft' else 'approved' end, true, auth.uid()) returning id into v_id;
    if v_owner = 'store' then perform public.write_activity('coupon_created', 'marketing', 'Created coupon ' || v_code, jsonb_build_object('coupon_id', v_id)); end if;
  else
    select * into old from public.coupons where id = v_id for update;
    if old.id is null then raise exception 'Coupon not found.'; end if;
    if old.owner = 'supplier' and (old.supplier_id is distinct from v_sup or old.approval <> 'draft') then raise exception 'Only your own draft coupon can be edited.'; end if;
    if old.owner = 'store' and not v_staff then raise exception 'You can only edit your own coupons.'; end if;
    if exists (select 1 from public.coupon_redemptions where coupon_id = v_id) then raise exception 'This coupon has been used, so it can no longer be edited. Pause it and create a new one.'; end if;
    if exists (select 1 from public.coupons where code = v_code and id <> v_id) then raise exception 'That code already exists.'; end if;
    update public.coupons set code = v_code, name = v_name, discount_type = v_type, percent = v_pct, amount = v_amt, min_order = v_min, max_discount = v_cap,
           max_uses = v_uses, starts_at = v_starts, ends_at = v_ends where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.coupon_action(p_id uuid, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  c public.coupons%rowtype; v_staff boolean := coalesce(public.has_permission('marketing.manage'), false); v_sup uuid := public.my_supplier_id();
  v_mine boolean; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or (v_sup is null and not v_staff) then raise exception 'You do not have permission to manage coupons.'; end if;
  select * into c from public.coupons where id = p_id for update;
  if c.id is null then raise exception 'Coupon not found.'; end if;
  v_mine := v_sup is not null and c.owner = 'supplier' and c.supplier_id = v_sup;
  if not (v_mine or v_staff) then raise exception 'You can only change your own coupons.'; end if;
  if p_action = 'submit' then
    if not v_mine or c.approval <> 'draft' then raise exception 'Only your own draft coupon can be submitted.'; end if;
    update public.coupons set approval = 'pending', submitted_at = now(), review_note = null where id = c.id;
    perform public.write_activity('coupon_submitted', 'marketing', 'Supplier coupon submitted: ' || c.code, jsonb_build_object('coupon_id', c.id));
  elsif p_action = 'withdraw' then
    if not v_mine or c.approval <> 'pending' then raise exception 'Only your own pending coupon can be withdrawn.'; end if;
    update public.coupons set approval = 'draft' where id = c.id;
  elsif p_action = 'approve' then
    if not v_staff or c.approval <> 'pending' then raise exception 'Only a pending coupon can be approved, by TradeLink.'; end if;
    update public.coupons set approval = 'approved', active = true, reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note where id = c.id;
    perform public.write_activity('coupon_approved', 'marketing', 'Approved coupon ' || c.code, jsonb_build_object('coupon_id', c.id));
  elsif p_action = 'reject' then
    if not v_staff or c.approval <> 'pending' then raise exception 'Only a pending coupon can be rejected, by TradeLink.'; end if;
    if v_note is null then raise exception 'Write a short reason so the supplier knows what to change.'; end if;
    update public.coupons set approval = 'draft', review_note = left(v_note, 500), reviewed_by = auth.uid(), reviewed_at = now() where id = c.id;
  elsif p_action = 'pause' then
    if c.approval <> 'approved' then raise exception 'Only an approved coupon can be paused.'; end if;
    update public.coupons set active = false where id = c.id;
  elsif p_action = 'resume' then
    if c.approval <> 'approved' then raise exception 'Only an approved coupon can be resumed.'; end if;
    update public.coupons set active = true where id = c.id;
  elsif p_action = 'delete' then
    if exists (select 1 from public.coupon_redemptions where coupon_id = c.id) then raise exception 'A used coupon cannot be deleted. Pause it instead.'; end if;
    if c.owner = 'supplier' and c.approval <> 'draft' and not v_staff then raise exception 'Withdraw the coupon before deleting it.'; end if;
    delete from public.coupons where id = c.id;
    return 'deleted';
  else
    raise exception 'Unknown action.';
  end if;
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Pricing: free units and coupons are applied automatically whenever a request is priced
-- ---------------------------------------------------------------------------
-- Internal. Works out free units (Buy X Get Y) and the coupon discount per line, and the quote total when every line has a price.
create or replace function public.reprice_quote(p_quote uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_q public.quotations%rowtype; c public.coupons%rowtype; v_priced boolean; v_base numeric; v_disc numeric; v_ratio numeric := 0; v_note text; v_total numeric;
begin
  select * into v_q from public.quotations where id = p_quote;
  if v_q.id is null then return; end if;
  perform set_config('app.workflow_rpc', 'on', true);
  update public.quotation_items qi set coupon_pct = 0, free_qty = coalesce((
      select floor(qi.quantity / (pr.buy_qty + pr.get_qty)) * pr.get_qty
      from public.promotion_items pi join public.promotions pr on pr.id = pi.promotion_id and pr.status = 'active' and pr.kind = 'bogo'
      where pi.product_id = qi.product_id limit 1), 0)
  where qi.quotation_id = p_quote;
  select not exists (select 1 from public.quotation_items where quotation_id = p_quote and unit_price <= 0) into v_priced;
  if not v_priced then
    update public.quotations set coupon_note = null where id = p_quote;
    return;
  end if;

  if v_q.coupon_code is not null then
    select * into c from public.coupons where code = v_q.coupon_code;
    if c.id is null or not c.active or c.approval <> 'approved' then
      v_note := 'The coupon is no longer available.';
    else
      select coalesce(sum(qi.quantity * qi.unit_price), 0) into v_base from public.quotation_items qi
      where qi.quotation_id = p_quote and qi.free_qty = 0
        and (c.supplier_id is null or exists (select 1 from public.products p where p.id = qi.product_id and p.supplier_id = c.supplier_id));
      if v_base = 0 then v_note := 'The coupon does not apply to the items in this request.';
      elsif c.min_order is not null and v_base < c.min_order then
        v_note := 'The coupon needs an order of at least ' || to_char(c.min_order, 'FM999,999,999,990.00') || ' ETB.';
      else
        v_disc := case when c.discount_type = 'percent' then v_base * c.percent / 100 else least(c.amount, v_base) end;
        if c.max_discount is not null then v_disc := least(v_disc, c.max_discount); end if;
        v_ratio := least(100, v_disc / v_base * 100);
        update public.quotation_items qi set coupon_pct = v_ratio
        where qi.quotation_id = p_quote and qi.free_qty = 0
          and (c.supplier_id is null or exists (select 1 from public.products p where p.id = qi.product_id and p.supplier_id = c.supplier_id));
      end if;
    end if;
  end if;

  select sum(round((quantity - free_qty) * round(unit_price * (1 - coupon_pct / 100), 2), 2)) into v_total from public.quotation_items where quotation_id = p_quote;
  update public.quotations set estimated_total = v_total, coupon_note = v_note,
         discount_percent = case when v_q.coupon_code is not null and v_note is null then round(least(v_ratio, 999.99), 2) else 0 end
  where id = p_quote;
end $$;

create or replace function public.apply_coupon(p_quote_number text, p_phone text, p_code text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_q public.quotations%rowtype; v_c public.coupons%rowtype; v_phone text; v_key text; v_used int; v_note text;
begin
  v_phone := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
  select * into v_q from public.quotations where quote_number = btrim(coalesce(p_quote_number, '')) and phone = v_phone;
  if v_q.id is null or v_q.status <> 'new' or v_q.created_at < now() - interval '2 hours' then raise exception 'We could not apply the coupon to this request.'; end if;
  if v_q.coupon_code is not null then raise exception 'A coupon is already applied to this request.'; end if;
  select * into v_c from public.coupons where code = upper(btrim(coalesce(p_code, ''))) for update;
  if v_c.id is null or not v_c.active or v_c.approval <> 'approved' then raise exception 'That coupon code is not valid.'; end if;
  if v_c.starts_at is not null and v_c.starts_at > now() then raise exception 'That coupon is not active yet.'; end if;
  if v_c.ends_at is not null and v_c.ends_at <= now() then raise exception 'That coupon has expired.'; end if;
  if v_c.supplier_id is not null and not exists (
       select 1 from public.quotation_items qi join public.products p on p.id = qi.product_id where qi.quotation_id = v_q.id and p.supplier_id = v_c.supplier_id) then
    raise exception 'That coupon is for another store''s products.';
  end if;
  v_key := right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 9);
  select count(*) into v_used from public.coupon_redemptions r join public.quotations q on q.id = r.quotation_id where r.coupon_id = v_c.id and q.status <> 'rejected';
  if v_c.max_uses is not null and v_used >= v_c.max_uses then raise exception 'That coupon has been fully used.'; end if;
  if exists (select 1 from public.coupon_redemptions r join public.quotations q on q.id = r.quotation_id where r.coupon_id = v_c.id and r.phone_key = v_key and q.status <> 'rejected') then
    raise exception 'This phone number has already used that coupon.';
  end if;
  insert into public.coupon_redemptions (coupon_id, quotation_id, phone_key, percent) values (v_c.id, v_q.id, v_key, coalesce(v_c.percent, 0));
  perform set_config('app.workflow_rpc', 'on', true);
  update public.quotations set coupon_code = v_c.code, discount_percent = coalesce(v_c.percent, 0) where id = v_q.id;
  perform public.reprice_quote(v_q.id);
  select coupon_note into v_note from public.quotations where id = v_q.id;
  if v_note is not null then raise exception '%', v_note; end if;     -- the transaction is undone: the code is not used up
  return coalesce(v_c.percent, v_c.amount);
end $$;

create or replace function public.remove_quote_coupon(p_quote uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_q public.quotations%rowtype;
begin
  if auth.uid() is null or not public.has_permission('quotes.price') then raise exception 'You do not have permission to change quotations.'; end if;
  select * into v_q from public.quotations where id = p_quote for update;
  if v_q.id is null then raise exception 'Quotation not found.'; end if;
  if v_q.status in ('converted','rejected') then raise exception 'A quotation that is % cannot be changed.', v_q.status; end if;
  delete from public.coupon_redemptions where quotation_id = p_quote;
  perform set_config('app.workflow_rpc', 'on', true);
  update public.quotations set coupon_code = null, discount_percent = 0, coupon_note = null where id = p_quote;
  perform public.reprice_quote(p_quote);
end $$;

create or replace function public.price_quote(p_quote uuid, p_prices jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_q public.quotations%rowtype; v_item record; v_price numeric; v_total numeric; v_n int := 0;
begin
  if not public.has_permission('quotes.price') then raise exception 'You do not have permission to price quotations.'; end if;
  select * into v_q from public.quotations where id = p_quote for update;
  if not found then raise exception 'Quotation not found.'; end if;
  if v_q.status not in ('new','reviewing','quoted') then raise exception 'A quotation that is % cannot be re-priced.', v_q.status; end if;
  if jsonb_typeof(coalesce(p_prices, 'null'::jsonb)) <> 'array' then raise exception 'Prices are missing.'; end if;
  perform set_config('app.workflow_rpc', 'on', true);
  for v_item in select id from public.quotation_items where quotation_id = p_quote loop
    v_n := v_n + 1;
    select (e->>'unit_price')::numeric into v_price from jsonb_array_elements(p_prices) e where (e->>'item_id')::uuid = v_item.id;
    if v_price is null or v_price <= 0 or v_price > 100000000 then raise exception 'Enter a valid price for every line.'; end if;
    update public.quotation_items set unit_price = round(v_price, 2) where id = v_item.id;
  end loop;
  if v_n = 0 then raise exception 'This quotation has no items.'; end if;
  perform public.reprice_quote(p_quote);
  update public.quotations set status = 'quoted' where id = p_quote;
  select estimated_total into v_total from public.quotations where id = p_quote;
  return v_total;
end;
$$;

create or replace function public.convert_quote_to_order(p_quote uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_q public.quotations%rowtype; v_order uuid; v_number text; v_total numeric; v_full numeric; v_coupon numeric;
begin
  if not public.has_permission('quotes.convert') then raise exception 'You do not have permission to create orders.'; end if;
  select * into v_q from public.quotations where id = p_quote for update;
  if not found then raise exception 'Quotation not found.'; end if;
  if v_q.status not in ('quoted','accepted') then raise exception 'Price the quotation first (status is %).', v_q.status; end if;
  if exists (select 1 from public.orders where quotation_id = p_quote) then raise exception 'This quotation already has an order.'; end if;
  if exists (select 1 from public.quotation_items where quotation_id = p_quote and (unit_price <= 0 or product_id is null)) then
    raise exception 'Every line needs a price and an existing product.';
  end if;
  select sum(quantity * unit_price),
         sum(round((quantity - free_qty) * round(unit_price * (1 - coupon_pct / 100), 2), 2)),
         sum((quantity - free_qty) * (unit_price - round(unit_price * (1 - coupon_pct / 100), 2)))
    into v_full, v_total, v_coupon from public.quotation_items where quotation_id = p_quote;
  insert into public.orders (quotation_id, customer_name, phone, delivery_location, status, total_amount, coupon_code, discount_amount)
  values (v_q.id, v_q.customer_name, v_q.phone, v_q.delivery_location, 'confirmed', v_total, v_q.coupon_code, v_full - v_total)
  returning id, order_number into v_order, v_number;
  insert into public.order_items (order_id, product_id, product_name, quantity, unit, unit_price)
  select v_order, product_id, product_name, quantity - free_qty, unit, round(unit_price * (1 - coupon_pct / 100), 2)
  from public.quotation_items where quotation_id = p_quote and quantity - free_qty > 0;
  insert into public.order_items (order_id, product_id, product_name, quantity, unit, unit_price)
  select v_order, product_id, product_name || ' (free)', free_qty, unit, 0 from public.quotation_items where quotation_id = p_quote and free_qty > 0;
  update public.coupon_redemptions set order_id = v_order, discount_amount = coalesce(v_coupon, 0) where quotation_id = p_quote;
  perform set_config('app.workflow_rpc', 'on', true);
  update public.quotations set status = 'converted' where id = p_quote;
  perform public.write_activity('order_created', 'order', 'Order ' || v_number || ' created from quotation ' || v_q.quote_number, jsonb_build_object('order_id', v_order));
  return v_order;
end;
$$;

-- Retail requests are priced when they are sent, so the free units and total are known immediately.
create or replace function public.submit_request(
  p_name text, p_phone text, p_email text, p_location text, p_items jsonb, p_notes text,
  p_website text default '', p_customer_type text default 'business'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_number text; v_prod public.products%rowtype; v_item jsonb; v_qty numeric; v_n int := 0;
  v_ip text; v_hash text; v_recent int; v_seen uuid[] := '{}'; v_pid uuid; v_min numeric; v_price numeric;
begin
  if btrim(coalesce(p_website, '')) <> '' then return 'QTN-RECEIVED'; end if;   -- honeypot

  p_name := btrim(coalesce(p_name, ''));
  p_phone := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
  p_email := nullif(btrim(coalesce(p_email, '')), '');
  p_location := btrim(coalesce(p_location, ''));
  p_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if p_customer_type not in ('business','individual') then p_customer_type := 'business'; end if;

  if char_length(p_name) not between 2 and 120 then raise exception 'Please enter your name or business name.'; end if;
  if char_length(p_phone) not between 6 and 20 then raise exception 'Please enter a valid phone number.'; end if;
  if char_length(p_location) not between 2 and 120 then raise exception 'Please enter the delivery location.'; end if;
  if p_email is not null and (char_length(p_email) > 160 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'Please enter a valid email address.'; end if;
  if p_notes is not null and char_length(p_notes) > 1000 then raise exception 'Additional details are too long (1000 characters max).'; end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Please add at least one product.'; end if;
  if jsonb_array_length(p_items) > 20 then raise exception 'Please request at most 20 products at a time.'; end if;

  begin
    v_ip := nullif(btrim(split_part(coalesce((nullif(current_setting('request.headers', true), '')::json)->>'x-forwarded-for', ''), ',', 1)), '');
  exception when others then v_ip := null;
  end;
  v_hash := case when v_ip is null then null else encode(sha256(convert_to(v_ip, 'utf8')), 'hex') end;

  select count(*) into v_recent from public.quotations where phone = p_phone and created_at > now() - interval '1 hour';
  if v_recent >= 3 then raise exception 'Too many requests from this number. Please try again later.'; end if;
  if v_hash is not null then
    select count(*) into v_recent from public.quotations where source_hash = v_hash and created_at > now() - interval '1 hour';
    if v_recent >= 8 then raise exception 'Too many requests from your connection. Please try again later.'; end if;
  end if;
  select count(*) into v_recent from public.quotations where created_at > now() - interval '1 hour';
  if v_recent >= 300 then raise exception 'We are receiving many requests right now. Please try again shortly.'; end if;

  insert into public.quotations (customer_name, phone, email, delivery_location, notes, status, source_hash, customer_type)
  values (p_name, p_phone, p_email, p_location, p_notes, 'new', v_hash, p_customer_type)
  returning id, quote_number into v_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid := (v_item->>'product_id')::uuid;
      v_qty := (v_item->>'quantity')::numeric;
    exception when others then raise exception 'One of the products is not valid. Please check your list.';
    end;
    if v_pid = any(v_seen) then raise exception 'A product is listed twice. Please combine the quantities.'; end if;
    v_seen := v_seen || v_pid;
    select * into v_prod from public.products where id = v_pid and active = true
      and (audience = 'both' or audience = case when p_customer_type = 'individual' then 'b2c' else 'b2b' end);
    if not found then raise exception 'A product on your list is no longer available. Please remove it and try again.'; end if;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 then raise exception 'Please enter a valid quantity for %.', v_prod.name; end if;
    v_min := case when p_customer_type = 'individual' then 1 else v_prod.min_order_quantity end;
    if v_qty < v_min then
      raise exception 'The minimum order for % is % %.', v_prod.name, trim(trailing '.' from trim(trailing '0' from v_min::text)), v_prod.unit;
    end if;
    v_price := case when p_customer_type = 'individual' and v_prod.retail_price > 0
      then case when v_prod.sale_price is not null and v_prod.sale_price > 0 and v_prod.sale_price < v_prod.retail_price then v_prod.sale_price else v_prod.retail_price end
      else 0 end;   -- a running sale price is the price the customer saw, so it is the price they are quoted
    insert into public.quotation_items (quotation_id, product_id, product_name, quantity, unit, unit_price)
    values (v_id, v_prod.id, v_prod.name || coalesce(' (' || v_prod.package_size || ')', ''), v_qty, v_prod.unit, v_price);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Please add at least one product.'; end if;
  perform public.reprice_quote(v_id);   -- free units (Buy X Get Y) show up on retail requests straight away
  return v_number;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Featured products and stores
-- ---------------------------------------------------------------------------
create table if not exists public.featured_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('product','supplier')),
  ref_id uuid not null,
  position int not null default 100,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (kind, ref_id)
);
alter table public.featured_items enable row level security;
drop policy if exists "Everyone reads featured" on public.featured_items;
create policy "Everyone reads featured" on public.featured_items for select to anon, authenticated using (true);
revoke insert, update, delete on public.featured_items from authenticated, anon;
grant select on public.featured_items to anon, authenticated;

create or replace function public.set_featured(p_kind text, p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('marketing.manage') then raise exception 'You do not have permission to manage promotions.'; end if;
  if p_kind not in ('product','supplier') then raise exception 'Choose a product or a store.'; end if;
  if coalesce(p_on, false) then
    if p_kind = 'product' and not exists (select 1 from public.products where id = p_id and active) then raise exception 'Product not found.'; end if;
    if p_kind = 'supplier' and not exists (select 1 from public.suppliers where id = p_id and status = 'approved' and active) then raise exception 'Store not found.'; end if;
    if (select count(*) from public.featured_items where kind = p_kind) >= 24 then raise exception 'You can feature up to 24 at a time. Remove one first.'; end if;
    insert into public.featured_items (kind, ref_id, created_by) values (p_kind, p_id, auth.uid()) on conflict do nothing;
  else
    delete from public.featured_items where kind = p_kind and ref_id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. What the public site can see: live campaigns only
-- ---------------------------------------------------------------------------
create or replace view public.public_promotions as
select v.id, v.name, v.kind, v.scope, v.supplier_id, v.category_id, v.product_id, v.discount_type, v.percent, v.amount, v.max_discount,
       v.buy_qty, v.get_qty, v.starts_at, v.ends_at, v.started_at, v.show_banner, v.banner_text
from public.promotions v
where v.status = 'active' and (v.supplier_id is null or exists (select 1 from public.public_suppliers s where s.id = v.supplier_id));
grant select on public.public_promotions to anon, authenticated;

create or replace view public.public_promo_products as
select pi.promotion_id, pi.product_id
from public.promotion_items pi
join public.promotions v on v.id = pi.promotion_id and v.status = 'active'
join public.public_products p on p.id = pi.product_id;
grant select on public.public_promo_products to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Results: TradeLink sees everything, a supplier sees its own
-- ---------------------------------------------------------------------------
drop function if exists public.promotion_results();
create or replace function public.promotion_results() returns table (promotion_id uuid, units numeric, revenue numeric, orders bigint, free_units numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_staff boolean; v_sup uuid := public.my_supplier_id();
begin
  v_staff := coalesce(public.has_permission('marketing.manage'), false) or coalesce(public.is_tl_staff(), false);
  if auth.uid() is null or not (v_staff or v_sup is not null) then raise exception 'Not allowed'; end if;
  return query
  select p.id, coalesce(x.u, 0), coalesce(x.r, 0), coalesce(x.n, 0), coalesce(x.f, 0)
  from public.promotions p
  left join lateral (
    select sum(oi.quantity) filter (where oi.unit_price > 0) as u,
           round(sum(oi.quantity * oi.unit_price), 2) as r,
           count(distinct o.id) as n,
           sum(oi.quantity) filter (where oi.unit_price = 0) as f
    from public.promotion_items pi
    join public.order_items oi on oi.product_id = pi.product_id
    join public.orders o on o.id = oi.order_id
    join public.sales s on s.order_id = o.id
    join public.promotion_runs r on r.promotion_id = p.id and s.sold_at >= r.started_at and (r.ended_at is null or s.sold_at < r.ended_at)
    where pi.promotion_id = p.id
  ) x on true
  where p.started_at is not null and (v_staff or p.supplier_id = v_sup);
end $$;

create or replace function public.coupon_results() returns table (coupon_id uuid, uses bigint, orders bigint, discount numeric, revenue numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_staff boolean; v_sup uuid := public.my_supplier_id();
begin
  v_staff := coalesce(public.has_permission('marketing.manage'), false) or coalesce(public.is_tl_staff(), false);
  if auth.uid() is null or not (v_staff or v_sup is not null) then raise exception 'Not allowed'; end if;
  return query
  select c.id,
         count(r.id) filter (where q.status <> 'rejected'),
         count(r.id) filter (where s.id is not null),
         coalesce(sum(r.discount_amount) filter (where s.id is not null), 0),
         coalesce(sum(o.total_amount) filter (where s.id is not null), 0)
  from public.coupons c
  left join public.coupon_redemptions r on r.coupon_id = c.id
  left join public.quotations q on q.id = r.quotation_id
  left join public.orders o on o.id = r.order_id
  left join public.sales s on s.order_id = o.id
  where v_staff or c.supplier_id = v_sup
  group by c.id;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.promo_unit_price(numeric, text, numeric, numeric, numeric), public.promo_products(uuid), public.promo_conflict(uuid),
  public.promotion_activate(uuid), public.promotion_stop(uuid, text, text), public.promotion_finish(uuid), public.reprice_quote(uuid) from public, anon, authenticated;
revoke execute on function public.save_promotion(jsonb), public.promotion_action(uuid, text, text), public.save_coupon(jsonb), public.coupon_action(uuid, text, text),
  public.set_featured(text, uuid, boolean), public.promotion_results(), public.coupon_results(), public.remove_quote_coupon(uuid), public.price_quote(uuid, jsonb),
  public.convert_quote_to_order(uuid) from public, anon;
grant execute on function public.save_promotion(jsonb), public.promotion_action(uuid, text, text), public.save_coupon(jsonb), public.coupon_action(uuid, text, text),
  public.set_featured(text, uuid, boolean), public.promotion_results(), public.coupon_results(), public.remove_quote_coupon(uuid), public.price_quote(uuid, jsonb),
  public.convert_quote_to_order(uuid) to authenticated;
revoke execute on function public.apply_coupon(text, text, text) from public;
grant execute on function public.apply_coupon(text, text, text) to anon, authenticated;
