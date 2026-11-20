-- TradeLink admin suite: Payments & Payouts, category commissions, Returns & Disputes, Supplier Verification,
-- Marketing & Promotions, Reviews & Ratings, Website Management, Customer Support.
-- Run AFTER 0016_commissions.sql. Safe to run more than once. Adds tables and functions only: nothing existing is changed or removed.
--
-- Access: every action is a permission (see role_permissions). The owner has them all; the manager gets them by default; the owner can
-- change any role in Settings -> Permissions. All writes go through guarded functions or permission-checked policies.

-- ---------------------------------------------------------------------------
-- 0. Permissions
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('manager','payments.view'),('manager','payments.manage'),('manager','commissions.manage'),('manager','returns.manage'),
  ('manager','verification.manage'),('manager','marketing.manage'),('manager','reviews.moderate'),('manager','website.manage'),('manager','support.manage'),
  ('sales','returns.manage'),('sales','reviews.moderate'),('sales','support.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. Category-based commissions (a category rate wins over the supplier's own rate)
-- ---------------------------------------------------------------------------
create table if not exists public.category_commission_rates (
  category_id uuid primary key references public.categories(id) on delete cascade,
  rate numeric(5,2) not null check (rate between 0 and 100),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.category_commission_rates enable row level security;
drop policy if exists "Staff read category rates" on public.category_commission_rates;
create policy "Staff read category rates" on public.category_commission_rates for select to authenticated
using (public.is_tl_staff() or public.has_permission('commissions.manage'));
revoke insert, update, delete on public.category_commission_rates from authenticated;
grant select on public.category_commission_rates to authenticated;

create or replace function public.set_category_commission(p_category uuid, p_rate numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null or not public.has_permission('commissions.manage') then raise exception 'You do not have permission to set commission rates.'; end if;
  select name into v_name from public.categories where id = p_category;
  if v_name is null then raise exception 'Category not found.'; end if;
  if p_rate is null then
    delete from public.category_commission_rates where category_id = p_category;
    perform public.write_activity('category_commission', 'commissions', 'Removed the commission rate for category ' || v_name, jsonb_build_object('category_id', p_category));
  else
    if p_rate < 0 or p_rate > 100 then raise exception 'The commission rate must be between 0 and 100.'; end if;
    insert into public.category_commission_rates (category_id, rate, updated_by) values (p_category, round(p_rate, 2), auth.uid())
    on conflict (category_id) do update set rate = excluded.rate, updated_by = excluded.updated_by, updated_at = now();
    perform public.write_activity('category_commission', 'commissions', 'Set commission for category ' || v_name || ' to ' || round(p_rate, 2) || '%', jsonb_build_object('category_id', p_category, 'rate', p_rate));
  end if;
end $$;
revoke execute on function public.set_category_commission(uuid, numeric) from public, anon;
grant execute on function public.set_category_commission(uuid, numeric) to authenticated;

-- When a sale records a commission, a rate set for the product's category replaces the supplier's rate (the rate used is stored on the row, as before).
create or replace function public.commission_apply_category_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rate numeric;
begin
  select r.rate into v_rate from public.products p
  join public.category_commission_rates r on r.category_id = p.category_id
  where p.id = new.product_id;
  if v_rate is not null then
    new.rate := v_rate;
    new.commission := round(new.supplier_amount * v_rate / 100, 2);
    new.supplier_earning := new.supplier_amount - new.commission;
  end if;
  return new;
end $$;
drop trigger if exists sale_commissions_category_rate on public.sale_commissions;
create trigger sale_commissions_category_rate before insert on public.sale_commissions
for each row execute function public.commission_apply_category_rate();

-- Per category: the rate that applies, with how much it has earned.
create or replace function public.commission_categories() returns table (
  category_id uuid, category_name text, industry_name text, rate numeric, sales_count bigint, commission numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.is_tl_staff() or public.has_permission('commissions.manage')) then raise exception 'Not allowed'; end if;
  return query
  select c.id, c.name, i.name, r.rate, coalesce(x.n, 0), coalesce(x.c, 0)
  from public.categories c
  join public.industries i on i.id = c.industry_id
  left join public.category_commission_rates r on r.category_id = c.id
  left join (select p.category_id cid, count(*) n, sum(sc.commission) c
             from public.sale_commissions sc join public.products p on p.id = sc.product_id group by p.category_id) x on x.cid = c.id
  order by i.name, c.name;
end $$;
revoke execute on function public.commission_categories() from public, anon;
grant execute on function public.commission_categories() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Supplier verification (a checklist the reviewer completes; payouts require it)
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_checks (
  supplier_id uuid primary key references public.suppliers(id) on delete cascade,
  identity_ok boolean not null default false,
  registration_ok boolean not null default false,
  address_ok boolean not null default false,
  contact_ok boolean not null default false,
  notes text check (char_length(notes) <= 500),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.supplier_checks enable row level security;
drop policy if exists "Read supplier checks" on public.supplier_checks;
create policy "Read supplier checks" on public.supplier_checks for select to authenticated
using (supplier_id = public.my_supplier_id() or public.is_tl_staff() or public.has_permission('verification.manage'));
revoke insert, update, delete on public.supplier_checks from authenticated;
grant select on public.supplier_checks to authenticated;

create or replace function public.set_supplier_checks(p_supplier uuid, p_identity boolean, p_registration boolean, p_address boolean, p_contact boolean, p_notes text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_name text; v_all boolean; v_at timestamptz;
begin
  if auth.uid() is null or not public.has_permission('verification.manage') then raise exception 'You do not have permission to verify suppliers.'; end if;
  select name into v_name from public.suppliers where id = p_supplier;
  if v_name is null then raise exception 'Supplier not found.'; end if;
  v_all := coalesce(p_identity,false) and coalesce(p_registration,false) and coalesce(p_address,false) and coalesce(p_contact,false);
  insert into public.supplier_checks (supplier_id, identity_ok, registration_ok, address_ok, contact_ok, notes, verified_at, verified_by)
  values (p_supplier, coalesce(p_identity,false), coalesce(p_registration,false), coalesce(p_address,false), coalesce(p_contact,false), nullif(btrim(p_notes),''),
          case when v_all then now() end, case when v_all then auth.uid() end)
  on conflict (supplier_id) do update set identity_ok = excluded.identity_ok, registration_ok = excluded.registration_ok, address_ok = excluded.address_ok,
    contact_ok = excluded.contact_ok, notes = excluded.notes, updated_at = now(),
    verified_at = case when v_all then coalesce(public.supplier_checks.verified_at, now()) end,
    verified_by = case when v_all then coalesce(public.supplier_checks.verified_by, auth.uid()) end
  returning verified_at into v_at;
  perform public.write_activity('supplier_verification', 'suppliers', case when v_all then 'Verified supplier ' else 'Updated verification checks for ' end || v_name, jsonb_build_object('supplier_id', p_supplier, 'verified', v_all));
  return v_at;
end $$;
revoke execute on function public.set_supplier_checks(uuid, boolean, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.set_supplier_checks(uuid, boolean, boolean, boolean, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Payments & supplier payouts
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_payouts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('bank_transfer','mobile_money','cash')),
  reference text check (char_length(reference) <= 80),
  note text check (char_length(note) <= 300),
  paid_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
create index if not exists supplier_payouts_supplier_idx on public.supplier_payouts(supplier_id, paid_at desc);
alter table public.supplier_payouts enable row level security;
drop policy if exists "Own or finance read payouts" on public.supplier_payouts;
create policy "Own or finance read payouts" on public.supplier_payouts for select to authenticated
using (supplier_id = public.my_supplier_id() or public.has_permission('payments.view') or public.is_tl_staff());
revoke insert, update, delete on public.supplier_payouts from authenticated;
grant select on public.supplier_payouts to authenticated;

-- What each supplier has earned (from sale_commissions), been paid, and is still owed.
create or replace function public.payout_balances() returns table (
  supplier_id uuid, supplier_name text, earned numeric, paid numeric, balance numeric, verified boolean, last_paid timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('payments.view') then raise exception 'You do not have permission to view payments.'; end if;
  return query
  select s.id, s.name, coalesce(e.v, 0), coalesce(p.v, 0), coalesce(e.v, 0) - coalesce(p.v, 0),
         (c.verified_at is not null), p.last
  from public.suppliers s
  left join (select sc.supplier_id sid, sum(sc.supplier_earning) v from public.sale_commissions sc group by sc.supplier_id) e on e.sid = s.id
  left join (select sp.supplier_id sid, sum(sp.amount) v, max(sp.paid_at) last from public.supplier_payouts sp group by sp.supplier_id) p on p.sid = s.id
  left join public.supplier_checks c on c.supplier_id = s.id
  where e.v is not null or p.v is not null
  order by (coalesce(e.v, 0) - coalesce(p.v, 0)) desc, s.name;
end $$;
revoke execute on function public.payout_balances() from public, anon;
grant execute on function public.payout_balances() to authenticated;

create or replace function public.record_payout(p_supplier uuid, p_amount numeric, p_method text, p_reference text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_name text; v_earned numeric; v_paid numeric; v_id uuid;
begin
  if auth.uid() is null or not public.has_permission('payments.manage') then raise exception 'You do not have permission to record payouts.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero.'; end if;
  if p_method is null or p_method not in ('bank_transfer','mobile_money','cash') then raise exception 'Choose how the supplier was paid.'; end if;
  select name into v_name from public.suppliers where id = p_supplier for update;       -- serialises payouts to one supplier
  if v_name is null then raise exception 'Supplier not found.'; end if;
  if not exists (select 1 from public.supplier_checks where supplier_id = p_supplier and verified_at is not null) then
    raise exception 'Verify this supplier first (Supplier Verification) before paying them.';
  end if;
  select coalesce(sum(supplier_earning), 0) into v_earned from public.sale_commissions where supplier_id = p_supplier;
  select coalesce(sum(amount), 0) into v_paid from public.supplier_payouts where supplier_id = p_supplier;
  if round(p_amount, 2) > v_earned - v_paid then raise exception 'That is more than the balance owed (%).', to_char(v_earned - v_paid, 'FM999,999,990.00'); end if;
  insert into public.supplier_payouts (supplier_id, amount, method, reference, note, created_by)
  values (p_supplier, round(p_amount, 2), p_method, nullif(btrim(p_reference),''), nullif(btrim(p_note),''), auth.uid()) returning id into v_id;
  perform public.write_activity('supplier_payout', 'payments', 'Paid ' || to_char(round(p_amount, 2), 'FM999,999,990.00') || ' to supplier ' || v_name, jsonb_build_object('supplier_id', p_supplier, 'payout_id', v_id));
  return v_id;
end $$;
revoke execute on function public.record_payout(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.record_payout(uuid, numeric, text, text, text) to authenticated;

-- Money received from customers (from recorded sales), for finance staff even if their role cannot open Sales.
create or replace function public.payments_received(p_from timestamptz, p_to timestamptz, p_limit int default 200) returns table (
  sale_id uuid, receipt_number text, customer_name text, total_amount numeric, amount_paid numeric, outstanding numeric, payment_method text, sold_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('payments.view') then raise exception 'You do not have permission to view payments.'; end if;
  return query
  select s.id, s.receipt_number, s.customer_name, s.total_amount, s.amount_paid, greatest(s.total_amount - s.amount_paid, 0), s.payment_method, s.sold_at
  from public.sales s where s.sold_at >= p_from and s.sold_at < p_to order by s.sold_at desc limit least(greatest(p_limit, 1), 1000);
end $$;
revoke execute on function public.payments_received(timestamptz, timestamptz, int) from public, anon;
grant execute on function public.payments_received(timestamptz, timestamptz, int) to authenticated;

create or replace function public.payments_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if auth.uid() is null or not public.has_permission('payments.view') then raise exception 'You do not have permission to view payments.'; end if;
  select jsonb_build_object(
    'received', coalesce(sum(amount_paid), 0),
    'outstanding', coalesce(sum(greatest(total_amount - amount_paid, 0)), 0),
    'sales', count(*),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', coalesce(m.payment_method, 'other'), 'amount', m.a) order by m.a desc)
                           from (select payment_method, sum(amount_paid) a from public.sales where sold_at >= p_from and sold_at < p_to group by payment_method) m), '[]'::jsonb),
    'paid_out', coalesce((select sum(amount) from public.supplier_payouts where paid_at >= p_from and paid_at < p_to), 0))
  into r from public.sales where sold_at >= p_from and sold_at < p_to;
  return r;
end $$;
revoke execute on function public.payments_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.payments_summary(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Returns & disputes (logged by staff when a customer reports a problem; customers have no accounts)
-- ---------------------------------------------------------------------------
create table if not exists public.returns_disputes (
  id uuid primary key default gen_random_uuid(),
  ref text unique default ('RTN-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  kind text not null check (kind in ('return','dispute')),
  order_id uuid not null references public.orders(id),
  customer_name text not null,
  phone text,
  supplier_id uuid references public.suppliers(id),
  product_name text,
  quantity numeric(14,3) check (quantity is null or quantity > 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 600),
  status text not null default 'open' check (status in ('open','investigating','approved','rejected','resolved')),
  resolution text check (resolution in ('refund','replacement','credit','none')),
  refund_amount numeric(14,2) not null default 0 check (refund_amount >= 0),
  notes text check (char_length(notes) <= 600),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists returns_disputes_status_idx on public.returns_disputes(status, created_at desc);
alter table public.returns_disputes enable row level security;
drop policy if exists "Staff read returns" on public.returns_disputes;
create policy "Staff read returns" on public.returns_disputes for select to authenticated
using (public.has_permission('returns.manage') or public.is_tl_staff());
revoke insert, update, delete on public.returns_disputes from authenticated;
grant select on public.returns_disputes to authenticated;

create or replace function public.open_return(p_order uuid, p_kind text, p_product text, p_quantity numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_sup uuid; v_id uuid; v_ord numeric;
begin
  if auth.uid() is null or not public.has_permission('returns.manage') then raise exception 'You do not have permission to manage returns.'; end if;
  if p_kind not in ('return','dispute') then raise exception 'Choose return or dispute.'; end if;
  select * into v_o from public.orders where id = p_order;
  if v_o.id is null then raise exception 'Order not found.'; end if;
  if p_product is not null and btrim(p_product) <> '' then
    select oi.quantity, p.supplier_id into v_ord, v_sup from public.order_items oi left join public.products p on p.id = oi.product_id
    where oi.order_id = p_order and oi.product_name = p_product limit 1;
    if v_ord is null then raise exception 'That product is not on this order.'; end if;
    if p_quantity is not null and p_quantity > v_ord then raise exception 'The order only had % of that product.', v_ord; end if;
  end if;
  insert into public.returns_disputes (kind, order_id, customer_name, phone, supplier_id, product_name, quantity, reason, created_by)
  values (p_kind, p_order, v_o.customer_name, v_o.phone, v_sup, nullif(btrim(p_product),''), p_quantity, btrim(p_reason), auth.uid()) returning id into v_id;
  perform public.write_activity('return_opened', 'returns', 'Opened a ' || p_kind || ' for order ' || v_o.order_number, jsonb_build_object('return_id', v_id, 'order_id', p_order));
  return v_id;
end $$;
revoke execute on function public.open_return(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.open_return(uuid, text, text, numeric, text) to authenticated;

create or replace function public.update_return(p_id uuid, p_status text, p_resolution text, p_refund numeric, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.returns_disputes%rowtype; v_paid numeric; v_done numeric;
begin
  if auth.uid() is null or not public.has_permission('returns.manage') then raise exception 'You do not have permission to manage returns.'; end if;
  if p_status not in ('open','investigating','approved','rejected','resolved') then raise exception 'Unknown status.'; end if;
  select * into v from public.returns_disputes where id = p_id for update;
  if v.id is null then raise exception 'Not found.'; end if;
  if v.status in ('rejected','resolved') then raise exception 'This case is closed.'; end if;
  if p_resolution is not null and p_resolution not in ('refund','replacement','credit','none') then raise exception 'Unknown resolution.'; end if;
  if p_status = 'resolved' and p_resolution is null then raise exception 'Choose how it was resolved.'; end if;
  if coalesce(p_refund, 0) < 0 then raise exception 'The refund cannot be negative.'; end if;
  if p_resolution = 'refund' and p_status in ('approved','resolved') then
    if coalesce(p_refund, 0) <= 0 then raise exception 'Enter the refund amount.'; end if;
    select amount_paid into v_paid from public.orders where id = v.order_id;
    select coalesce(sum(refund_amount), 0) into v_done from public.returns_disputes
      where order_id = v.order_id and id <> p_id and resolution = 'refund' and status in ('approved','resolved');
    if p_refund + v_done > coalesce(v_paid, 0) then raise exception 'Refunds on this order cannot exceed what the customer paid (%).', to_char(coalesce(v_paid,0) - v_done, 'FM999,999,990.00'); end if;
  end if;
  update public.returns_disputes set status = p_status, resolution = p_resolution,
    refund_amount = case when p_resolution = 'refund' then round(coalesce(p_refund, 0), 2) else 0 end,
    notes = coalesce(nullif(btrim(p_notes), ''), notes), updated_at = now(),
    resolved_at = case when p_status in ('rejected','resolved') then now() end
  where id = p_id;
  perform public.write_activity('return_updated', 'returns', 'Case ' || v.ref || ' set to ' || p_status, jsonb_build_object('return_id', p_id));
end $$;
revoke execute on function public.update_return(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.update_return(uuid, text, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Marketing & promotions: a percentage off retail for all products, one category or one product.
--    Starting a promotion sets the product's sale price (storefronts already show sale prices); ending it puts the old price back.
-- ---------------------------------------------------------------------------
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  scope text not null check (scope in ('all','category','product')),
  category_id uuid references public.categories(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  percent numeric(5,2) not null check (percent between 1 and 90),
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft','active','ended')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);
create table if not exists public.promotion_items (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  prior_sale_price numeric(14,2),
  applied_price numeric(14,2) not null,
  primary key (promotion_id, product_id)
);
alter table public.promotions enable row level security;
alter table public.promotion_items enable row level security;
drop policy if exists "Staff read promotions" on public.promotions;
create policy "Staff read promotions" on public.promotions for select to authenticated
using (public.has_permission('marketing.manage') or public.is_tl_staff());
drop policy if exists "Staff read promotion items" on public.promotion_items;
create policy "Staff read promotion items" on public.promotion_items for select to authenticated
using (public.has_permission('marketing.manage') or public.is_tl_staff());
revoke insert, update, delete on public.promotions, public.promotion_items from authenticated;
grant select on public.promotions, public.promotion_items to authenticated;

create or replace function public.create_promotion(p_name text, p_scope text, p_category uuid, p_product uuid, p_percent numeric, p_ends timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.has_permission('marketing.manage') then raise exception 'You do not have permission to manage promotions.'; end if;
  if p_scope not in ('all','category','product') then raise exception 'Choose what the promotion covers.'; end if;
  if p_scope = 'category' and p_category is null then raise exception 'Choose a category.'; end if;
  if p_scope = 'product' and p_product is null then raise exception 'Choose a product.'; end if;
  if p_ends is not null and p_ends <= now() then raise exception 'The end date must be in the future.'; end if;
  insert into public.promotions (name, scope, category_id, product_id, percent, ends_at, created_by)
  values (btrim(p_name), p_scope, case when p_scope = 'category' then p_category end, case when p_scope = 'product' then p_product end, p_percent, p_ends, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.start_promotion(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v public.promotions%rowtype; n int;
begin
  if auth.uid() is null or not public.has_permission('marketing.manage') then raise exception 'You do not have permission to manage promotions.'; end if;
  select * into v from public.promotions where id = p_id for update;
  if v.id is null then raise exception 'Promotion not found.'; end if;
  if v.status <> 'draft' then raise exception 'Only a draft promotion can be started.'; end if;
  if v.ends_at is not null and v.ends_at <= now() then raise exception 'The end date has passed.'; end if;
  -- Only live retail products with a retail price, not already in another running promotion.
  insert into public.promotion_items (promotion_id, product_id, prior_sale_price, applied_price)
  select v.id, p.id, p.sale_price, round(p.retail_price * (1 - v.percent / 100), 2)
  from public.products p
  where p.active and p.retail_price > 0 and p.audience in ('b2c','both')
    and round(p.retail_price * (1 - v.percent / 100), 2) < p.retail_price
    and (v.scope = 'all' or (v.scope = 'category' and p.category_id = v.category_id) or (v.scope = 'product' and p.id = v.product_id))
    and not exists (select 1 from public.promotion_items pi join public.promotions pr on pr.id = pi.promotion_id where pi.product_id = p.id and pr.status = 'active');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No products qualify: they need a retail price, must be live for retail, and not already be in another running promotion.'; end if;
  update public.products p set sale_price = pi.applied_price from public.promotion_items pi where pi.promotion_id = v.id and pi.product_id = p.id;
  update public.promotions set status = 'active', started_at = now() where id = v.id;
  perform public.write_activity('promotion_started', 'marketing', 'Started promotion ' || v.name || ' (' || v.percent || '% off, ' || n || ' products)', jsonb_build_object('promotion_id', v.id));
  return n;
end $$;

create or replace function public.end_promotion(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.promotions%rowtype;
begin
  if auth.uid() is not null and not public.has_permission('marketing.manage') then raise exception 'You do not have permission to manage promotions.'; end if;
  select * into v from public.promotions where id = p_id for update;
  if v.id is null then raise exception 'Promotion not found.'; end if;
  if v.status <> 'active' then raise exception 'Only a running promotion can be ended.'; end if;
  -- Restore the earlier sale price, unless someone changed the price by hand in the meantime.
  update public.products p set sale_price = pi.prior_sale_price
  from public.promotion_items pi where pi.promotion_id = v.id and pi.product_id = p.id and p.sale_price = pi.applied_price;
  update public.promotions set status = 'ended', ended_at = now() where id = v.id;
  perform public.write_activity('promotion_ended', 'marketing', 'Ended promotion ' || v.name, jsonb_build_object('promotion_id', v.id));
end $$;

-- Ends promotions whose end date has passed (runs when staff open Marketing, and can be scheduled).
create or replace function public.expire_promotions() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if auth.uid() is not null and not (public.has_permission('marketing.manage') or public.is_tl_staff()) then return 0; end if;
  for r in select id from public.promotions where status = 'active' and ends_at is not null and ends_at <= now() loop
    perform public.end_promotion(r.id); n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.create_promotion(text, text, uuid, uuid, numeric, timestamptz), public.start_promotion(uuid), public.end_promotion(uuid), public.expire_promotions() from public, anon;
grant execute on function public.create_promotion(text, text, uuid, uuid, numeric, timestamptz), public.start_promotion(uuid), public.end_promotion(uuid), public.expire_promotions() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Reviews & ratings (recorded by staff from customer feedback, then published or hidden)
-- ---------------------------------------------------------------------------
create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 80),
  rating int not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  verified_purchase boolean not null default false,
  status text not null default 'pending' check (status in ('pending','published','hidden')),
  reply text check (char_length(reply) <= 600),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  moderated_by uuid references public.profiles(id),
  moderated_at timestamptz
);
create unique index if not exists product_reviews_one_per_order on public.product_reviews(order_id, product_id) where order_id is not null;
create index if not exists product_reviews_product_idx on public.product_reviews(product_id, status);
alter table public.product_reviews enable row level security;
drop policy if exists "Staff read reviews" on public.product_reviews;
create policy "Staff read reviews" on public.product_reviews for select to authenticated
using (public.has_permission('reviews.moderate') or public.is_tl_staff());
drop policy if exists "Public reads published reviews" on public.product_reviews;
create policy "Public reads published reviews" on public.product_reviews for select to anon, authenticated using (status = 'published');
revoke insert, update, delete on public.product_reviews from authenticated, anon;
grant select (id, product_id, customer_name, rating, comment, verified_purchase, reply, created_at, status) on public.product_reviews to anon;
grant select on public.product_reviews to authenticated;

create or replace function public.add_review(p_product uuid, p_name text, p_rating int, p_comment text, p_order uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_verified boolean := false;
begin
  if auth.uid() is null or not public.has_permission('reviews.moderate') then raise exception 'You do not have permission to manage reviews.'; end if;
  if not exists (select 1 from public.products where id = p_product) then raise exception 'Product not found.'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1 to 5.'; end if;
  if p_order is not null then
    if not exists (select 1 from public.order_items where order_id = p_order and product_id = p_product) then raise exception 'That product is not on this order.'; end if;
    if exists (select 1 from public.product_reviews where order_id = p_order and product_id = p_product) then raise exception 'This order already has a review for that product.'; end if;
    v_verified := exists (select 1 from public.sales where order_id = p_order);   -- only a sold order counts as a verified purchase
  end if;
  insert into public.product_reviews (product_id, order_id, customer_name, rating, comment, verified_purchase, status, created_by)
  values (p_product, p_order, btrim(p_name), p_rating, nullif(btrim(p_comment),''), v_verified, 'pending', auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.moderate_review(p_id uuid, p_status text, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('reviews.moderate') then raise exception 'You do not have permission to manage reviews.'; end if;
  if p_status not in ('pending','published','hidden') then raise exception 'Unknown status.'; end if;
  update public.product_reviews set status = p_status, reply = nullif(btrim(p_reply),''), moderated_by = auth.uid(), moderated_at = now() where id = p_id;
  if not found then raise exception 'Review not found.'; end if;
  perform public.write_activity('review_' || p_status, 'reviews', 'Review set to ' || p_status, jsonb_build_object('review_id', p_id));
end $$;
revoke execute on function public.add_review(uuid, text, int, text, uuid), public.moderate_review(uuid, text, text) from public, anon;
grant execute on function public.add_review(uuid, text, int, text, uuid), public.moderate_review(uuid, text, text) to authenticated;

-- Average rating of published reviews, safe to show on the storefront.
create or replace view public.public_product_ratings as
select product_id, round(avg(rating)::numeric, 1) as average, count(*)::int as reviews
from public.product_reviews where status = 'published' group by product_id;
grant select on public.public_product_ratings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Website management: announcement banners shown at the top of the public site
-- ---------------------------------------------------------------------------
create table if not exists public.site_banners (
  id uuid primary key default gen_random_uuid(),
  message text not null check (char_length(btrim(message)) between 3 and 160),
  link text check (link is null or (char_length(link) <= 300 and link ~ '^(/|https://)')),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order int not null default 100,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
alter table public.site_banners enable row level security;
drop policy if exists "Everyone reads live banners" on public.site_banners;
create policy "Everyone reads live banners" on public.site_banners for select to anon, authenticated
using (active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
drop policy if exists "Staff read all banners" on public.site_banners;
create policy "Staff read all banners" on public.site_banners for select to authenticated using (public.has_permission('website.manage'));
drop policy if exists "Website managers write banners" on public.site_banners;
create policy "Website managers write banners" on public.site_banners for all to authenticated
using (public.has_permission('website.manage')) with check (public.has_permission('website.manage'));
grant select on public.site_banners to anon;
grant select, insert, update, delete on public.site_banners to authenticated;

-- Visits per day for the Website page (counts only; no visitor details).
create or replace function public.site_traffic(p_days int default 14) returns table (day date, visits bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.has_permission('website.manage') or public.is_tl_staff()) then raise exception 'Not allowed'; end if;
  return query
  select d::date, count(e.id)
  from generate_series(current_date - (least(greatest(p_days,1),90) - 1), current_date, interval '1 day') d
  left join public.site_events e on e.created_at >= d and e.created_at < d + interval '1 day' and e.kind = 'visit'
  group by d order by d;
end $$;
revoke execute on function public.site_traffic(int) from public, anon;
grant execute on function public.site_traffic(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Customer support tickets
-- ---------------------------------------------------------------------------
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ref text unique default ('SUP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 80),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 160),
  subject text not null check (char_length(btrim(subject)) between 3 and 140),
  category text not null default 'other' check (category in ('order','payment','delivery','product','account','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','pending','resolved','closed')),
  order_id uuid references public.orders(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  kind text not null default 'reply' check (kind in ('reply','note','customer')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  author_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists support_tickets_status_idx on public.support_tickets(status, updated_at desc);
create index if not exists support_messages_ticket_idx on public.support_messages(ticket_id, created_at);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
drop policy if exists "Support staff tickets" on public.support_tickets;
drop policy if exists "Support staff update tickets" on public.support_tickets;
drop policy if exists "Support read tickets" on public.support_tickets;
drop policy if exists "Support add tickets" on public.support_tickets;
drop policy if exists "Support change tickets" on public.support_tickets;
create policy "Support read tickets" on public.support_tickets for select to authenticated using (public.has_permission('support.manage'));
create policy "Support add tickets" on public.support_tickets for insert to authenticated with check (public.has_permission('support.manage') and created_by = auth.uid());
create policy "Support change tickets" on public.support_tickets for update to authenticated using (public.has_permission('support.manage')) with check (public.has_permission('support.manage'));
drop policy if exists "Support staff messages" on public.support_messages;
create policy "Support staff messages" on public.support_messages for select to authenticated using (public.has_permission('support.manage'));
drop policy if exists "Support staff add messages" on public.support_messages;
create policy "Support staff add messages" on public.support_messages for insert to authenticated
with check (public.has_permission('support.manage') and author_id = auth.uid());
revoke delete, truncate on public.support_tickets, public.support_messages from authenticated;
revoke update on public.support_messages from authenticated;
grant select, insert, update on public.support_tickets to authenticated;
grant select, insert on public.support_messages to authenticated;

create or replace function public.support_ticket_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.resolved_at := case when new.status in ('resolved','closed') then coalesce(old.resolved_at, now()) end;
  return new;
end $$;
drop trigger if exists support_tickets_touch on public.support_tickets;
create trigger support_tickets_touch before update on public.support_tickets for each row execute function public.support_ticket_touch();

create or replace function public.support_message_bump() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.support_tickets set updated_at = now(),
    status = case when status = 'open' and new.kind = 'reply' then 'pending' else status end
  where id = new.ticket_id;
  return new;
end $$;
drop trigger if exists support_messages_bump on public.support_messages;
create trigger support_messages_bump after insert on public.support_messages for each row execute function public.support_message_bump();
