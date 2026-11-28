-- TradeLink delivery, Phase 3: distance-based customer delivery fee (separate from driver pay), driver pay rules, earnings summaries,
-- manual driver payouts, cash handover. ADDITIVE and re-runnable. No rates are invented: every rate table starts EMPTY, and until the
-- owner enters a rate for a city the checkout keeps using today's flat fee. Supabase SQL Editor: paste the whole file and press Run.

-- ---------------------------------------------------------------------------------------------------------------------
-- 0. Safety guard
-- ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._deliver(uuid,text)') is null or to_regprocedure('public.ops_reassign_delivery(uuid,uuid,timestamptz,text)') is null then
    raise exception 'Stopped: run migration 0043 first. Nothing was changed.';
  end if;
  if to_regclass('public.cities') is null or to_regclass('public.supplier_locations') is null or to_regclass('public.order_locations') is null then
    raise exception 'Stopped: run migrations up to 0043 first. Nothing was changed.';
  end if;
  if to_regprocedure('public.place_order(jsonb,text,text,text,text,text,text,text,text)') is null then
    raise exception 'Stopped: the live place_order function is missing. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables (no direct access for anyone; everything goes through the functions below)
-- ---------------------------------------------------------------------------------------------------------------------
-- What the CUSTOMER pays for delivery: base + per km, per city, optionally per area. Straight-line distance x road_factor.
create table if not exists public.delivery_fee_rules (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  zone_id uuid references public.city_zones(id) on delete cascade,
  base_fee numeric(12,2) not null check (base_fee >= 0 and base_fee <= 100000),
  per_km numeric(12,2) not null default 0 check (per_km >= 0 and per_km <= 100000),
  min_fee numeric(12,2) check (min_fee is null or min_fee >= 0),
  max_fee numeric(12,2) check (max_fee is null or max_fee >= 0),
  road_factor numeric(4,2) not null default 1 check (road_factor between 1 and 3),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  check (max_fee is null or min_fee is null or max_fee >= min_fee)
);
create unique index if not exists delivery_fee_rules_scope on public.delivery_fee_rules (city_id, coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- What the DRIVER earns by default for a delivered job (a pay set by hand on the delivery always wins).
create table if not exists public.driver_pay_rules (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  zone_id uuid references public.city_zones(id) on delete cascade,
  base_pay numeric(12,2) not null check (base_pay >= 0 and base_pay <= 100000),
  per_km numeric(12,2) not null default 0 check (per_km >= 0 and per_km <= 100000),
  road_factor numeric(4,2) not null default 1 check (road_factor between 1 and 3),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index if not exists driver_pay_rules_scope on public.driver_pay_rules (city_id, coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.orders add column if not exists delivery_distance_km numeric(8,2);
alter table public.orders add column if not exists delivery_fee_source text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_delivery_fee_source_check') then
    alter table public.orders add constraint orders_delivery_fee_source_check check (delivery_fee_source is null or delivery_fee_source in ('flat', 'distance', 'free'));
  end if;
end $$;

-- Payouts to drivers: recorded by hand, never automatic, never edited or deleted. A mistake is cancelled by a "void" record.
create table if not exists public.driver_payouts (
  id uuid primary key default gen_random_uuid(),
  driver uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0 and amount <= 100000000),
  method text not null check (method in ('cash', 'bank_transfer', 'telebirr', 'ebirr', 'other')),
  reference text check (reference is null or char_length(reference) <= 80),
  paid_on date not null,
  period_from date,
  period_to date,
  note text check (note is null or char_length(note) <= 300),
  recorded_by uuid not null,
  recorded_by_name text,
  recorded_at timestamptz not null default now()
);
create index if not exists driver_payouts_driver on public.driver_payouts (driver, paid_on desc);
create table if not exists public.driver_payout_voids (
  payout_id uuid primary key references public.driver_payouts(id),
  reason text not null check (char_length(reason) between 5 and 300),
  voided_by uuid not null,
  voided_by_name text,
  voided_at timestamptz not null default now()
);
drop trigger if exists driver_payouts_permanent on public.driver_payouts;
create trigger driver_payouts_permanent before update or delete on public.driver_payouts for each row execute function public.audit_rows_are_permanent();
drop trigger if exists driver_payouts_no_truncate on public.driver_payouts;
create trigger driver_payouts_no_truncate before truncate on public.driver_payouts for each statement execute function public.audit_rows_are_permanent();
drop trigger if exists driver_payout_voids_permanent on public.driver_payout_voids;
create trigger driver_payout_voids_permanent before update or delete on public.driver_payout_voids for each row execute function public.audit_rows_are_permanent();
drop trigger if exists driver_payout_voids_no_truncate on public.driver_payout_voids;
create trigger driver_payout_voids_no_truncate before truncate on public.driver_payout_voids for each statement execute function public.audit_rows_are_permanent();

-- Cash handover: the driver hands the Cash-on-Delivery money to the office; a manager confirms what was received.
create table if not exists public.cash_handovers (
  id uuid primary key default gen_random_uuid(),
  driver uuid not null references public.profiles(id),
  expected numeric(12,2) not null check (expected >= 0),
  declared numeric(12,2) not null check (declared >= 0 and declared <= 100000000),
  received numeric(12,2) check (received is null or received >= 0),
  difference numeric(12,2),
  status text not null default 'submitted' check (status in ('submitted', 'confirmed')),
  note text check (note is null or char_length(note) <= 300),
  confirm_note text check (confirm_note is null or char_length(confirm_note) <= 300),
  submitted_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz
);
create index if not exists cash_handovers_status on public.cash_handovers (status, submitted_at desc);
alter table public.payments add column if not exists handover_id uuid references public.cash_handovers(id);
create index if not exists payments_handover_idx on public.payments (handover_id) where handover_id is not null;
drop trigger if exists cash_handovers_no_delete on public.cash_handovers;
create trigger cash_handovers_no_delete before delete on public.cash_handovers for each row execute function public.audit_rows_are_permanent();

alter table public.delivery_fee_rules enable row level security;
alter table public.driver_pay_rules enable row level security;
alter table public.driver_payouts enable row level security;
alter table public.driver_payout_voids enable row level security;
alter table public.cash_handovers enable row level security;
revoke all on public.delivery_fee_rules, public.driver_pay_rules, public.driver_payouts, public.driver_payout_voids, public.cash_handovers from anon, authenticated, public;

-- The owner always has these. Managers may confirm cash handovers. Pricing and payouts stay with the owner unless granted on the Staff page.
insert into public.role_permissions (role, permission)
select 'manager', 'cash.handover' where not exists (select 1 from public.role_permissions where role = 'manager' and permission = 'cash.handover');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Internal helpers (not callable from the app)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._km(p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision) returns numeric
language sql immutable as $$
  select round((6371 * 2 * asin(least(1, sqrt(power(sin(radians(p_lat2 - p_lat1) / 2), 2)
         + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)))))::numeric, 2)
$$;

-- The shop the cart is collected from: the first product's supplier that has a saved GPS position (same rule delivery_points uses).
create or replace function public._cart_supplier_point(p_items jsonb) returns table (lat double precision, lng double precision)
language sql stable security definer set search_path = public as $$
  select sl.lat, sl.lng
  from jsonb_array_elements(case when jsonb_typeof(coalesce(p_items, 'null'::jsonb)) = 'array' then p_items else '[]'::jsonb end) with ordinality as it(v, n)
  join public.products pr on pr.id = (case when (it.v->>'product_id') ~ '^[0-9a-fA-F-]{36}$' then (it.v->>'product_id')::uuid end)
  join public.supplier_locations sl on sl.supplier_id = pr.supplier_id
  order by it.n limit 1
$$;

-- Today's cart value from the live catalogue (same price rule as place_order). Used for "free delivery over" in the quote.
create or replace function public._cart_subtotal(p_items jsonb) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(round(q.qty * q.price, 2)), 0) from (
    select least(greatest(case when (it.v->>'quantity') ~ '^[0-9]+(\.[0-9]+)?$' then (it.v->>'quantity')::numeric else 0 end, 0), 100000) as qty,
           case when pr.sale_price is not null and pr.sale_price > 0 and pr.sale_price < pr.retail_price then pr.sale_price else coalesce(pr.retail_price, 0) end as price
    from jsonb_array_elements(case when jsonb_typeof(coalesce(p_items, 'null'::jsonb)) = 'array' then p_items else '[]'::jsonb end) as it(v)
    join public.products pr on pr.id = (case when (it.v->>'product_id') ~ '^[0-9a-fA-F-]{36}$' then (it.v->>'product_id')::uuid end)
    where pr.active
  ) q
$$;

-- The one place a delivery fee is worked out (used by the quote AND by place_order, so the customer is never charged a different fee).
-- No rate for the city (or no positions yet): today's flat fee. Rate + both positions known: base + per km, within min/max.
create or replace function public._delivery_fee(p_items jsonb, p_city uuid, p_zone uuid, p_lat double precision, p_lng double precision, p_sub numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_set public.checkout_settings%rowtype; v_r public.delivery_fee_rules%rowtype; v_slat double precision; v_slng double precision; v_km numeric; v_fee numeric;
begin
  v_set := (select s from public.checkout_settings s where s.id);
  if v_set.free_delivery_over is not null and p_sub >= v_set.free_delivery_over then
    return jsonb_build_object('fee', 0, 'source', 'free', 'distanceKm', null, 'needsLocation', false);
  end if;
  v_r := (select r from public.delivery_fee_rules r where r.city_id = p_city and r.active and r.zone_id is not distinct from p_zone);
  if v_r.id is null and p_zone is not null then
    v_r := (select r from public.delivery_fee_rules r where r.city_id = p_city and r.active and r.zone_id is null);
  end if;
  if v_r.id is null then
    return jsonb_build_object('fee', coalesce(v_set.delivery_fee, 0), 'source', 'flat', 'distanceKm', null, 'needsLocation', false);
  end if;
  if v_r.per_km = 0 then
    v_fee := v_r.base_fee;
    return jsonb_build_object('fee', round(least(greatest(v_fee, coalesce(v_r.min_fee, 0)), coalesce(v_r.max_fee, v_fee)), 2), 'source', 'distance', 'distanceKm', null, 'needsLocation', false);
  end if;
  v_slat := (select s.lat from public._cart_supplier_point(p_items) s);
  v_slng := (select s.lng from public._cart_supplier_point(p_items) s);
  if p_lat is null or p_lng is null or v_slat is null then
    return jsonb_build_object('fee', coalesce(v_set.delivery_fee, 0), 'source', 'flat', 'distanceKm', null, 'needsLocation', p_lat is null or p_lng is null);
  end if;
  v_km := round(public._km(v_slat, v_slng, p_lat, p_lng) * v_r.road_factor, 2);
  v_fee := v_r.base_fee + v_r.per_km * v_km;
  v_fee := round(least(greatest(v_fee, coalesce(v_r.min_fee, 0)), coalesce(v_r.max_fee, v_fee)), 2);
  return jsonb_build_object('fee', v_fee, 'source', 'distance', 'distanceKm', v_km, 'needsLocation', false);
end $$;

-- Default pay for a delivered job from the driver pay rules. Null when there is no rule, or a per-km rule has no positions.
create or replace function public._driver_pay_for(p_delivery uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_r public.driver_pay_rules%rowtype; v_slat double precision; v_slng double precision; v_clat double precision; v_clng double precision; v_km numeric;
begin
  v_o := (select o from public.orders o join public.deliveries d on d.order_id = o.id where d.id = p_delivery);
  if v_o.id is null or v_o.city_id is null then return null; end if;
  v_r := (select r from public.driver_pay_rules r where r.city_id = v_o.city_id and r.active and r.zone_id is not distinct from v_o.zone_id);
  if v_r.id is null and v_o.zone_id is not null then
    v_r := (select r from public.driver_pay_rules r where r.city_id = v_o.city_id and r.active and r.zone_id is null);
  end if;
  if v_r.id is null then return null; end if;
  if v_r.per_km = 0 then return round(v_r.base_pay, 2); end if;
  v_slat := (select p.supplier_lat from public.delivery_points(p_delivery) p);
  v_slng := (select p.supplier_lng from public.delivery_points(p_delivery) p);
  v_clat := (select p.customer_lat from public.delivery_points(p_delivery) p);
  v_clng := (select p.customer_lng from public.delivery_points(p_delivery) p);
  if v_slat is null or v_slng is null or v_clat is null or v_clng is null then return null; end if;
  v_km := public._km(v_slat, v_slng, v_clat, v_clng) * v_r.road_factor;
  return round(v_r.base_pay + v_r.per_km * v_km, 2);
end $$;

-- _deliver is unchanged EXCEPT that a delivery with no hand-set driver pay gets the rule-based pay when one exists.
create or replace function public._deliver(p_delivery uuid, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_no text; v_pay numeric;
begin
  perform 1 from public.deliveries where id = p_delivery for update;
  v_d := (select d from public.deliveries d where d.id = p_delivery);
  if v_d.id is null then raise exception 'Delivery not found.'; end if;
  if v_d.status not in ('assigned', 'in_transit') then raise exception 'A delivery that is % cannot be completed.', v_d.status; end if;
  perform 1 from public.orders where id = v_d.order_id for update;
  v_no := (select order_number from public.orders where id = v_d.order_id);
  update public.deliveries set status = 'delivered', delivered_at = now(), notes = coalesce(left(nullif(btrim(coalesce(p_notes, '')), ''), 500), notes) where id = p_delivery;
  update public.orders set status = 'completed' where id = v_d.order_id;
  if not exists (select 1 from public.delivery_progress where delivery_id = p_delivery and driver_fee is not null) then
    v_pay := public._driver_pay_for(p_delivery);
    if v_pay is not null then
      insert into public.delivery_progress (delivery_id, driver_fee) values (p_delivery, v_pay)
      on conflict (delivery_id) do update set driver_fee = excluded.driver_fee, updated_at = now() where public.delivery_progress.driver_fee is null;
    end if;
  end if;
  perform public.write_activity('delivery_delivered', 'delivery', 'Delivery for order ' || v_no || ' is now delivered', jsonb_build_object('order_id', v_d.order_id, 'delivery_id', p_delivery));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Checkout: the fee quote, and place_order (new version with city + position; the old call keeps working through a wrapper)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.quote_delivery_fee(p_items jsonb, p_city uuid, p_zone uuid, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sub numeric;
begin
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng is null or p_lng not between -180 and 180) then raise exception 'Invalid position.'; end if;
  if p_city is not null and not exists (select 1 from public.cities where id = p_city and active) then raise exception 'Please choose a city from the list.'; end if;
  v_sub := public._cart_subtotal(p_items);
  return public._delivery_fee(p_items, p_city, p_zone, p_lat, p_lng, v_sub) || jsonb_build_object('subtotal', v_sub);
end $$;

create or replace function public.place_order(
  p_items jsonb, p_name text, p_phone text, p_email text, p_location text, p_notes text, p_method text, p_key text, p_website text,
  p_city uuid, p_zone uuid, p_lat double precision, p_lng double precision, p_accuracy real
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_set public.checkout_settings%rowtype; v_o public.orders%rowtype; v_item jsonb; v_p public.products%rowtype; v_qty numeric; v_price numeric;
  v_sub numeric := 0; v_fee numeric := 0; v_n int := 0; v_seen uuid[] := '{}'; v_pid uuid; v_pay uuid; v_ref text; v_recent int; v_q jsonb;
begin
  if btrim(coalesce(p_website, '')) <> '' then raise exception 'Something went wrong. Please try again.'; end if;
  p_name := btrim(coalesce(p_name, '')); p_phone := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
  p_email := nullif(btrim(coalesce(p_email, '')), ''); p_location := btrim(coalesce(p_location, '')); p_notes := nullif(btrim(coalesce(p_notes, '')), '');
  p_key := btrim(coalesce(p_key, ''));
  if char_length(p_key) not between 16 and 80 then raise exception 'Please reload the page and try again.'; end if;
  if char_length(p_name) not between 2 and 120 then raise exception 'Please enter your name.'; end if;
  if char_length(p_phone) not between 6 and 20 then raise exception 'Please enter a valid phone number.'; end if;
  if char_length(p_location) not between 2 and 160 then raise exception 'Please enter the delivery address.'; end if;
  if p_email is not null and (char_length(p_email) > 160 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'Please enter a valid email address.'; end if;
  if p_notes is not null and char_length(p_notes) > 500 then raise exception 'Delivery instructions are too long (500 characters max).'; end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty.'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Please order at most 30 different products at a time.'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Invalid position.'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then raise exception 'Invalid position.'; end if;
  if p_lat is not null and p_accuracy is not null and p_accuracy > 5000 then raise exception 'The GPS signal is too weak.'; end if;
  if p_city is not null then
    if not exists (select 1 from public.cities where id = p_city and active) then raise exception 'Please choose a city from the list.'; end if;
    if p_zone is not null and not exists (select 1 from public.city_zones where id = p_zone and city_id = p_city and active) then raise exception 'That area does not belong to the chosen city.'; end if;
    if p_zone is null and exists (select 1 from public.city_zones where city_id = p_city and active) then raise exception 'Please choose your area in this city.'; end if;
  elsif p_zone is not null then
    raise exception 'Please choose a city from the list.';
  end if;

  v_o := (select o from public.orders o where o.idempotency_key = p_key);
  if v_o.id is not null then
    v_ref := (select reference from public.payments where order_id = v_o.id order by created_at desc limit 1);
    return jsonb_build_object('order_number', v_o.order_number, 'payment_reference', v_ref, 'total', v_o.total_amount, 'delivery_fee', v_o.delivery_fee, 'repeat', true);
  end if;

  v_set := (select s from public.checkout_settings s where s.id);
  if p_method = 'cod' and not v_set.cod_enabled then raise exception 'Cash on Delivery is not available right now.'; end if;
  if p_method = 'bank_transfer' and not (v_set.bank_enabled and v_set.account_number is not null) then raise exception 'Bank transfer is not available right now.'; end if;
  if p_method = 'telebirr' and not (v_set.telebirr_enabled and v_set.telebirr_number is not null) then raise exception 'Telebirr is not available right now.'; end if;
  if p_method = 'ebirr' and not (v_set.ebirr_enabled and v_set.ebirr_number is not null) then raise exception 'eBirr is not available right now.'; end if;
  if p_method not in ('cod', 'bank_transfer', 'telebirr', 'ebirr') then raise exception 'Choose how you want to pay.'; end if;

  v_recent := (select count(*) from public.orders where phone = p_phone and channel = 'checkout' and created_at > now() - interval '1 hour');
  if v_recent >= 5 then raise exception 'Too many orders from this number. Please try again later.'; end if;

  insert into public.orders (customer_name, phone, email, delivery_location, delivery_notes, status, total_amount, amount_paid, channel, customer_id, idempotency_key, city_id, zone_id)
  values (p_name, p_phone, p_email, p_location, p_notes, case when p_method = 'cod' then 'confirmed' else 'pending' end, 0, 0, 'checkout', auth.uid(), p_key, p_city, p_zone)
  returning * into v_o;
  if p_lat is not null then
    insert into public.order_locations (order_id, lat, lng, accuracy_m, captured_at) values (v_o.id, p_lat, p_lng, p_accuracy, now())
    on conflict (order_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, captured_at = now();
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    begin v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'quantity')::numeric;
    exception when others then raise exception 'One of the products in your cart is not valid.'; end;
    if v_pid is null or v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception 'Check the quantities in your cart.'; end if;
    if v_pid = any(v_seen) then raise exception 'A product appears twice in your cart.'; end if;
    v_seen := v_seen || v_pid;
    v_p := (select p from public.products p where p.id = v_pid and p.active and p.audience in ('b2c', 'both') and exists (select 1 from public.public_products pp where pp.id = p.id));
    if v_p.id is null then raise exception 'A product in your cart is no longer available.'; end if;
    if v_p.retail_price is null or v_p.retail_price <= 0 then raise exception '% is sold by quote. Please send a price request for it.', v_p.name; end if;
    if v_p.stock_quantity < v_qty then raise exception 'Only % % of % in stock.', greatest(v_p.stock_quantity, 0), v_p.unit, v_p.name; end if;
    v_price := case when v_p.sale_price is not null and v_p.sale_price > 0 and v_p.sale_price < v_p.retail_price then v_p.sale_price else v_p.retail_price end;
    insert into public.order_items (order_id, product_id, product_name, quantity, unit, unit_price) values (v_o.id, v_p.id, v_p.name, v_qty, v_p.unit, v_price);
    v_sub := v_sub + round(v_qty * v_price, 2); v_n := v_n + 1;
  end loop;

  v_q := public._delivery_fee(p_items, p_city, p_zone, p_lat, p_lng, v_sub);
  v_fee := (v_q->>'fee')::numeric;
  update public.orders set total_amount = v_sub + v_fee, delivery_fee = v_fee, delivery_fee_source = v_q->>'source', delivery_distance_km = (v_q->>'distanceKm')::numeric where id = v_o.id;

  insert into public.payments (order_id, method, amount, status) values (v_o.id, p_method, v_sub + v_fee, 'pending') returning id, reference into v_pay, v_ref;
  perform public.pay_event(v_pay, 'order_placed', null, 'pending', case when p_method = 'cod' then 'Cash on Delivery chosen. Payment is collected on delivery.' else 'Transfer chosen (' || p_method || '). Waiting for the transfer details.' end, 'customer');
  return jsonb_build_object('order_number', v_o.order_number, 'payment_reference', v_ref, 'total', v_sub + v_fee, 'delivery_fee', v_fee, 'method', p_method, 'repeat', false);
end $$;

-- The OLD nine-argument call (today's app, other callers) keeps working exactly as before: no city, no position, flat fee.
create or replace function public.place_order(
  p_items jsonb, p_name text, p_phone text, p_email text, p_location text, p_notes text, p_method text, p_key text, p_website text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.place_order(p_items, p_name, p_phone, p_email, p_location, p_notes, p_method, p_key, p_website, null::uuid, null::uuid, null::double precision, null::double precision, null::real);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Owner: fee rules and driver pay rules
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.ops_pricing() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'canEdit', public.has_permission('pricing.manage'),
    'flat', (select jsonb_build_object('fee', s.delivery_fee, 'freeOver', s.free_delivery_over) from public.checkout_settings s where s.id),
    'fee', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'cityId', r.city_id, 'zoneId', r.zone_id, 'base', r.base_fee, 'perKm', r.per_km, 'min', r.min_fee, 'max', r.max_fee, 'road', r.road_factor, 'active', r.active)) from public.delivery_fee_rules r), '[]'::jsonb),
    'pay', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'cityId', r.city_id, 'zoneId', r.zone_id, 'base', r.base_pay, 'perKm', r.per_km, 'road', r.road_factor, 'active', r.active)) from public.driver_pay_rules r), '[]'::jsonb));
end $$;

create or replace function public._check_scope(p_city uuid, p_zone uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cities where id = p_city) then raise exception 'Choose a city.'; end if;
  if p_zone is not null and not exists (select 1 from public.city_zones where id = p_zone and city_id = p_city) then raise exception 'That area does not belong to this city.'; end if;
end $$;

create or replace function public.ops_save_fee_rule(p_city uuid, p_zone uuid, p_base numeric, p_per_km numeric, p_min numeric, p_max numeric, p_road numeric, p_active boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.has_permission('pricing.manage') then raise exception 'Only the owner can change delivery prices.' using errcode = '42501'; end if;
  perform public._check_scope(p_city, p_zone);
  if p_base is null or p_base < 0 or p_per_km is null or p_per_km < 0 then raise exception 'Enter the base fee and the price per km (0 or more).'; end if;
  if p_min is not null and p_max is not null and p_max < p_min then raise exception 'The highest fee cannot be below the lowest fee.'; end if;
  if coalesce(p_road, 1) not between 1 and 3 then raise exception 'The road factor must be between 1 and 3.'; end if;
  insert into public.delivery_fee_rules (city_id, zone_id, base_fee, per_km, min_fee, max_fee, road_factor, active)
  values (p_city, p_zone, round(p_base, 2), round(p_per_km, 2), p_min, p_max, coalesce(p_road, 1), coalesce(p_active, true))
  on conflict (city_id, coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update
    set base_fee = excluded.base_fee, per_km = excluded.per_km, min_fee = excluded.min_fee, max_fee = excluded.max_fee, road_factor = excluded.road_factor, active = excluded.active, updated_at = now()
  returning id into v_id;
  perform public.write_activity('fee_rule_saved', 'pricing', 'Delivery fee rule saved', jsonb_build_object('rule_id', v_id, 'city_id', p_city, 'zone_id', p_zone));
  return v_id;
end $$;

create or replace function public.ops_save_pay_rule(p_city uuid, p_zone uuid, p_base numeric, p_per_km numeric, p_road numeric, p_active boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.has_permission('pricing.manage') then raise exception 'Only the owner can change driver pay.' using errcode = '42501'; end if;
  perform public._check_scope(p_city, p_zone);
  if p_base is null or p_base < 0 or p_per_km is null or p_per_km < 0 then raise exception 'Enter the base pay and the pay per km (0 or more).'; end if;
  if coalesce(p_road, 1) not between 1 and 3 then raise exception 'The road factor must be between 1 and 3.'; end if;
  insert into public.driver_pay_rules (city_id, zone_id, base_pay, per_km, road_factor, active)
  values (p_city, p_zone, round(p_base, 2), round(p_per_km, 2), coalesce(p_road, 1), coalesce(p_active, true))
  on conflict (city_id, coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update
    set base_pay = excluded.base_pay, per_km = excluded.per_km, road_factor = excluded.road_factor, active = excluded.active, updated_at = now()
  returning id into v_id;
  perform public.write_activity('pay_rule_saved', 'pricing', 'Driver pay rule saved', jsonb_build_object('rule_id', v_id, 'city_id', p_city, 'zone_id', p_zone));
  return v_id;
end $$;

create or replace function public.ops_delete_rule(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('pricing.manage') then raise exception 'Only the owner can change prices.' using errcode = '42501'; end if;
  if p_kind = 'fee' then delete from public.delivery_fee_rules where id = p_id;
  elsif p_kind = 'pay' then delete from public.driver_pay_rules where id = p_id;
  else raise exception 'Unknown rule type.'; end if;
  perform public.write_activity('rule_deleted', 'pricing', 'A ' || p_kind || ' rule was removed', jsonb_build_object('rule_id', p_id));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Earnings, payouts
-- ---------------------------------------------------------------------------------------------------------------------
-- Driver's own earnings: same fields as before (today, week, month, unpriced, days) plus what has been paid and what is still owed,
-- and weekly / monthly summaries.
create or replace function public.driver_earnings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Africa/Addis_Ababa')::date; v_earned numeric; v_paid numeric;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  v_earned := (select coalesce(sum(pr.driver_fee), 0) from public.deliveries d join public.delivery_progress pr on pr.delivery_id = d.id where d.assigned_to = auth.uid() and d.status = 'delivered');
  v_paid := (select coalesce(sum(p.amount), 0) from public.driver_payouts p where p.driver = auth.uid() and not exists (select 1 from public.driver_payout_voids v where v.payout_id = p.id));
  return (
    with mine as (
      select (d.delivered_at at time zone 'Africa/Addis_Ababa')::date as day, coalesce(pr.driver_fee, 0) as fee, pr.driver_fee is null as unpriced
      from public.deliveries d left join public.delivery_progress pr on pr.delivery_id = d.id
      where d.assigned_to = auth.uid() and d.status = 'delivered' and d.delivered_at is not null
    )
    select jsonb_build_object(
      'today', jsonb_build_object('amount', coalesce(sum(fee) filter (where day = v_today), 0), 'count', count(*) filter (where day = v_today)),
      'week', jsonb_build_object('amount', coalesce(sum(fee) filter (where day > v_today - 7), 0), 'count', count(*) filter (where day > v_today - 7)),
      'month', jsonb_build_object('amount', coalesce(sum(fee) filter (where date_trunc('month', day) = date_trunc('month', v_today)), 0), 'count', count(*) filter (where date_trunc('month', day) = date_trunc('month', v_today))),
      'unpriced', count(*) filter (where unpriced and date_trunc('month', day) = date_trunc('month', v_today)),
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', g.day, 'amount', coalesce(s.amount, 0), 'count', coalesce(s.n, 0)) order by g.day)
                        from generate_series(v_today - 13, v_today, interval '1 day') as g(day)
                        left join (select day, sum(fee) as amount, count(*) as n from mine group by day) s on s.day = g.day::date), '[]'::jsonb),
      'earned', v_earned, 'paid', v_paid, 'owed', greatest(v_earned - v_paid, 0),
      'weeks', coalesce((select jsonb_agg(jsonb_build_object('start', w.start, 'amount', w.amount, 'count', w.n) order by w.start desc) from (
                  select date_trunc('week', day)::date as start, sum(fee) as amount, count(*) as n from mine where day >= v_today - 56 group by 1 order by 1 desc limit 8) w), '[]'::jsonb),
      'months', coalesce((select jsonb_agg(jsonb_build_object('start', m.start, 'amount', m.amount, 'count', m.n) order by m.start desc) from (
                  select date_trunc('month', day)::date as start, sum(fee) as amount, count(*) as n from mine group by 1 order by 1 desc limit 6) m), '[]'::jsonb)
    ) from mine);
end $$;

create or replace function public.driver_payouts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'method', p.method, 'reference', p.reference, 'paidOn', p.paid_on) order by p.paid_on desc, p.recorded_at desc)
                   from public.driver_payouts p where p.driver = auth.uid() and not exists (select 1 from public.driver_payout_voids v where v.payout_id = p.id)), '[]'::jsonb);
end $$;

-- Owner / allowed staff: per driver, earned in the period, paid, and still owed (all time).
create or replace function public.ops_driver_earnings(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.has_permission('payouts.manage') or public.ops_can_manage()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'Choose a valid date range.'; end if;
  return jsonb_build_object('canPay', public.has_permission('payouts.manage'), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'driver', x.driver, 'name', x.name, 'deliveries', x.n, 'earned', x.earned, 'unpriced', x.unpriced,
      'earnedAll', x.earned_all, 'paidAll', x.paid_all, 'owed', greatest(x.earned_all - x.paid_all, 0), 'paidInPeriod', x.paid_period) order by x.name)
    from (
      select pr.id as driver, coalesce(nullif(btrim(pr.full_name), ''), pr.email) as name,
        (select count(*) from public.deliveries d where d.assigned_to = pr.id and d.status = 'delivered' and (d.delivered_at at time zone 'Africa/Addis_Ababa')::date between p_from and p_to) as n,
        (select coalesce(sum(dp.driver_fee), 0) from public.deliveries d join public.delivery_progress dp on dp.delivery_id = d.id where d.assigned_to = pr.id and d.status = 'delivered' and (d.delivered_at at time zone 'Africa/Addis_Ababa')::date between p_from and p_to) as earned,
        (select count(*) from public.deliveries d left join public.delivery_progress dp on dp.delivery_id = d.id where d.assigned_to = pr.id and d.status = 'delivered' and dp.driver_fee is null and (d.delivered_at at time zone 'Africa/Addis_Ababa')::date between p_from and p_to) as unpriced,
        (select coalesce(sum(dp.driver_fee), 0) from public.deliveries d join public.delivery_progress dp on dp.delivery_id = d.id where d.assigned_to = pr.id and d.status = 'delivered') as earned_all,
        (select coalesce(sum(p.amount), 0) from public.driver_payouts p where p.driver = pr.id and not exists (select 1 from public.driver_payout_voids v where v.payout_id = p.id)) as paid_all,
        (select coalesce(sum(p.amount), 0) from public.driver_payouts p where p.driver = pr.id and p.paid_on between p_from and p_to and not exists (select 1 from public.driver_payout_voids v where v.payout_id = p.id)) as paid_period
      from public.profiles pr
      where pr.role = 'delivery' or exists (select 1 from public.deliveries d where d.assigned_to = pr.id and d.status = 'delivered')
    ) x
  ), '[]'::jsonb));
end $$;

create or replace function public.ops_driver_payouts(p_driver uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.has_permission('payouts.manage') or public.ops_can_manage()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'method', p.method, 'reference', p.reference, 'paidOn', p.paid_on, 'periodFrom', p.period_from, 'periodTo', p.period_to,
            'note', p.note, 'by', p.recorded_by_name, 'at', p.recorded_at, 'voided', v.payout_id is not null, 'voidReason', v.reason) order by p.paid_on desc, p.recorded_at desc)
          from public.driver_payouts p left join public.driver_payout_voids v on v.payout_id = p.id where p.driver = p_driver), '[]'::jsonb);
end $$;

-- Record a payout that was already made by hand. It can never exceed what is owed, so an unpaid amount is never shown as paid.
create or replace function public.ops_record_payout(p_driver uuid, p_amount numeric, p_method text, p_reference text, p_paid_on date, p_from date, p_to date, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_owed numeric; v_id uuid; v_name text; v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if auth.uid() is null or not public.has_permission('payouts.manage') then raise exception 'Only the owner can record payouts.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_driver) then raise exception 'Choose a driver.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount paid.'; end if;
  if p_method not in ('cash', 'bank_transfer', 'telebirr', 'ebirr', 'other') then raise exception 'Choose how it was paid.'; end if;
  if p_method <> 'cash' and v_ref is null then raise exception 'Enter the transfer reference.'; end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Africa/Addis_Ababa')::date then raise exception 'Enter the date it was paid (not in the future).'; end if;
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'The period is not valid.'; end if;
  perform pg_advisory_xact_lock(hashtext('payout:' || p_driver::text));
  v_owed := (select coalesce(sum(dp.driver_fee), 0) from public.deliveries d join public.delivery_progress dp on dp.delivery_id = d.id where d.assigned_to = p_driver and d.status = 'delivered')
          - (select coalesce(sum(p.amount), 0) from public.driver_payouts p where p.driver = p_driver and not exists (select 1 from public.driver_payout_voids v where v.payout_id = p.id));
  if round(p_amount, 2) > round(v_owed, 2) then raise exception 'This is more than the driver is owed (% ETB).', round(greatest(v_owed, 0), 2); end if;
  v_name := (select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = auth.uid());
  insert into public.driver_payouts (driver, amount, method, reference, paid_on, period_from, period_to, note, recorded_by, recorded_by_name)
  values (p_driver, round(p_amount, 2), p_method, left(v_ref, 80), p_paid_on, p_from, p_to, left(nullif(btrim(coalesce(p_note, '')), ''), 300), auth.uid(), v_name) returning id into v_id;
  perform public.write_activity('driver_payout', 'payouts', 'Payout of ' || round(p_amount, 2) || ' ETB recorded', jsonb_build_object('payout_id', v_id, 'driver', p_driver));
  perform public.notify(p_driver, 'driver_payout', 'Payment recorded', round(p_amount, 2) || ' ETB was paid to you (' || replace(p_method, '_', ' ') || ').', '/admin/deliveries');
  return v_id;
end $$;

create or replace function public.ops_void_payout(p_payout uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null or not public.has_permission('payouts.manage') then raise exception 'Only the owner can cancel a payout record.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Write why this record is cancelled.'; end if;
  if not exists (select 1 from public.driver_payouts where id = p_payout) then raise exception 'Payout not found.'; end if;
  if exists (select 1 from public.driver_payout_voids where payout_id = p_payout) then raise exception 'This payout record is already cancelled.'; end if;
  v_name := (select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = auth.uid());
  insert into public.driver_payout_voids (payout_id, reason, voided_by, voided_by_name) values (p_payout, left(btrim(p_reason), 300), auth.uid(), v_name);
  perform public.write_activity('driver_payout_voided', 'payouts', 'A payout record was cancelled', jsonb_build_object('payout_id', p_payout));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Cash handover
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.driver_cash() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  return jsonb_build_object(
    'holding', (select coalesce(sum(p.amount), 0) from public.payments p where p.method = 'cod' and p.status = 'paid' and p.collected_by = auth.uid() and p.handover_id is null),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('order', o.order_number, 'amount', p.amount, 'at', p.collected_at) order by p.collected_at)
                        from public.payments p join public.orders o on o.id = p.order_id where p.method = 'cod' and p.status = 'paid' and p.collected_by = auth.uid() and p.handover_id is null), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'expected', h.expected, 'declared', h.declared, 'received', h.received, 'difference', h.difference, 'status', h.status, 'at', h.submitted_at) order by h.submitted_at desc)
                        from (select * from public.cash_handovers where driver = auth.uid() order by submitted_at desc limit 10) h), '[]'::jsonb));
end $$;

create or replace function public.driver_submit_handover(p_declared numeric, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_exp numeric; v_id uuid; v_name text; v_n int;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if p_declared is null or p_declared < 0 or p_declared > 100000000 then raise exception 'Enter the cash you are handing over.'; end if;
  perform pg_advisory_xact_lock(hashtext('handover:' || auth.uid()::text));
  perform 1 from public.payments p where p.method = 'cod' and p.status = 'paid' and p.collected_by = auth.uid() and p.handover_id is null for update;
  v_exp := (select coalesce(sum(p.amount), 0) from public.payments p where p.method = 'cod' and p.status = 'paid' and p.collected_by = auth.uid() and p.handover_id is null);
  v_n := (select count(*) from public.payments p where p.method = 'cod' and p.status = 'paid' and p.collected_by = auth.uid() and p.handover_id is null);
  if v_n = 0 then raise exception 'You have no collected cash to hand over.'; end if;
  insert into public.cash_handovers (driver, expected, declared, note) values (auth.uid(), v_exp, round(p_declared, 2), left(nullif(btrim(coalesce(p_note, '')), ''), 300)) returning id into v_id;
  update public.payments set handover_id = v_id where method = 'cod' and status = 'paid' and collected_by = auth.uid() and handover_id is null;
  v_name := (select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = auth.uid());
  perform public.notify_managers('cash_handover', 'Cash handover waiting', coalesce(v_name, 'A driver') || ' is handing over ' || round(p_declared, 2) || ' ETB' || case when round(p_declared, 2) <> v_exp then ' (expected ' || v_exp || ')' else '' end || '.', '/admin/deliveries');
  return v_id;
end $$;

create or replace function public.ops_cash_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.has_permission('cash.handover') or public.ops_can_manage()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return jsonb_build_object('canConfirm', public.has_permission('cash.handover'),
    'holding', coalesce((select jsonb_agg(jsonb_build_object('driver', x.driver, 'name', x.name, 'amount', x.amount, 'orders', x.n) order by x.name) from (
        select p.collected_by as driver, coalesce(nullif(btrim(pr.full_name), ''), pr.email) as name, sum(p.amount) as amount, count(*) as n
        from public.payments p join public.profiles pr on pr.id = p.collected_by
        where p.method = 'cod' and p.status = 'paid' and p.handover_id is null group by 1, 2) x), '[]'::jsonb),
    'handovers', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'driver', h.driver, 'name', h.name, 'expected', h.expected, 'declared', h.declared, 'received', h.received, 'difference', h.difference,
          'status', h.status, 'note', h.note, 'confirmNote', h.confirm_note, 'at', h.submitted_at, 'orders', h.orders) order by (h.status = 'submitted') desc, h.submitted_at desc) from (
        select ch.*, coalesce(nullif(btrim(pr.full_name), ''), pr.email) as name,
          (select coalesce(string_agg(o.order_number, ', ' order by o.order_number), '') from public.payments p join public.orders o on o.id = p.order_id where p.handover_id = ch.id) as orders
        from public.cash_handovers ch join public.profiles pr on pr.id = ch.driver order by ch.submitted_at desc limit 60) h), '[]'::jsonb));
end $$;

create or replace function public.ops_confirm_handover(p_handover uuid, p_received numeric, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_h public.cash_handovers%rowtype; v_diff numeric; v_name text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not public.has_permission('cash.handover') then raise exception 'You are not allowed to confirm cash handovers.' using errcode = '42501'; end if;
  perform 1 from public.cash_handovers where id = p_handover for update;
  v_h := (select h from public.cash_handovers h where h.id = p_handover);
  if v_h.id is null then raise exception 'Handover not found.'; end if;
  if v_h.status <> 'submitted' then raise exception 'This handover is already confirmed.'; end if;
  if p_received is null or p_received < 0 or p_received > 100000000 then raise exception 'Enter the cash you received.'; end if;
  v_diff := round(p_received, 2) - v_h.expected;
  if v_diff <> 0 and char_length(coalesce(v_note, '')) < 5 then raise exception 'The amount differs from what was expected (% ETB). Write what happened.', v_h.expected; end if;
  update public.cash_handovers set status = 'confirmed', received = round(p_received, 2), difference = v_diff, confirm_note = left(v_note, 300), confirmed_by = auth.uid(), confirmed_at = now() where id = p_handover;
  v_name := (select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = auth.uid());
  perform public.write_activity('cash_handover_confirmed', 'payments', 'Cash handover confirmed' || case when v_diff <> 0 then ' with a difference of ' || v_diff || ' ETB' else '' end, jsonb_build_object('handover_id', p_handover, 'difference', v_diff));
  perform public.notify(v_h.driver, 'cash_handover', 'Cash handover confirmed', 'The office received ' || round(p_received, 2) || ' ETB' || case when v_diff <> 0 then ' (' || case when v_diff > 0 then '+' else '' end || v_diff || ' ETB difference)' else '' end || '.', '/admin/deliveries');
  if v_diff <> 0 then
    perform public.notify_managers('cash_difference', 'Cash handover has a difference', 'Handover of ' || v_h.expected || ' ETB expected, ' || round(p_received, 2) || ' received by ' || coalesce(v_name, 'a manager') || '.', '/admin/deliveries');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Permissions
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['_km(double precision, double precision, double precision, double precision)', '_cart_supplier_point(jsonb)', '_cart_subtotal(jsonb)',
      '_delivery_fee(jsonb, uuid, uuid, double precision, double precision, numeric)', '_driver_pay_for(uuid)', '_deliver(uuid, text)', '_check_scope(uuid, uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'ops_pricing()', 'ops_save_fee_rule(uuid, uuid, numeric, numeric, numeric, numeric, numeric, boolean)', 'ops_save_pay_rule(uuid, uuid, numeric, numeric, numeric, boolean)', 'ops_delete_rule(text, uuid)',
    'driver_earnings()', 'driver_payouts()', 'ops_driver_earnings(date, date)', 'ops_driver_payouts(uuid)',
    'ops_record_payout(uuid, numeric, text, text, date, date, date, text)', 'ops_void_payout(uuid, text)',
    'driver_cash()', 'driver_submit_handover(numeric, text)', 'ops_cash_overview()', 'ops_confirm_handover(uuid, numeric, text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['quote_delivery_fee(jsonb, uuid, uuid, double precision, double precision)',
      'place_order(jsonb, text, text, text, text, text, text, text, text, uuid, uuid, double precision, double precision, real)',
      'place_order(jsonb, text, text, text, text, text, text, text, text)'] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to anon, authenticated';
  end loop;
end $$;
