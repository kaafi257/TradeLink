-- Marketing upgrade: scheduled start/end for promotions, coupon codes, and results per promotion/coupon.
-- Run AFTER 0017_admin_suite.sql. Safe to run more than once. Existing data is kept.
--
-- Also: a running sale price is now the price used when a retail request is quoted (before, the storefront showed the sale price but the
-- request was priced at the full retail price).

-- ---------------------------------------------------------------------------
-- 1. Scheduled promotions
-- ---------------------------------------------------------------------------
alter table public.promotions add column if not exists starts_at timestamptz;
alter table public.promotions add column if not exists note text;
alter table public.promotions drop constraint if exists promotions_status_check;
alter table public.promotions add constraint promotions_status_check check (status in ('draft','scheduled','active','ended'));
alter table public.promotions drop constraint if exists promotions_window_check;
alter table public.promotions add constraint promotions_window_check check (starts_at is null or ends_at is null or ends_at > starts_at);

drop function if exists public.create_promotion(text, text, uuid, uuid, numeric, timestamptz);
create or replace function public.create_promotion(p_name text, p_scope text, p_category uuid, p_product uuid, p_percent numeric, p_starts timestamptz, p_ends timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.has_permission('marketing.manage') then raise exception 'You do not have permission to manage promotions.'; end if;
  if p_scope not in ('all','category','product') then raise exception 'Choose what the promotion covers.'; end if;
  if p_scope = 'category' and p_category is null then raise exception 'Choose a category.'; end if;
  if p_scope = 'product' and p_product is null then raise exception 'Choose a product.'; end if;
  if p_starts is not null and p_starts <= now() then raise exception 'The start must be in the future. Leave it empty to start by hand.'; end if;
  if p_ends is not null and p_ends <= coalesce(p_starts, now()) then raise exception 'The end must be after the start.'; end if;
  insert into public.promotions (name, scope, category_id, product_id, percent, starts_at, ends_at, status, created_by)
  values (btrim(p_name), p_scope, case when p_scope = 'category' then p_category end, case when p_scope = 'product' then p_product end, p_percent,
          p_starts, p_ends, case when p_starts is null then 'draft' else 'scheduled' end, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Internal: puts the discounted price on every qualifying product. Used by Start and by the schedule.
create or replace function public.promotion_activate(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v public.promotions%rowtype; n int;
begin
  select * into v from public.promotions where id = p_id for update;
  if v.id is null then raise exception 'Promotion not found.'; end if;
  if v.status not in ('draft','scheduled') then raise exception 'Only a draft or scheduled promotion can be started.'; end if;
  if v.ends_at is not null and v.ends_at <= now() then raise exception 'The end date has passed.'; end if;
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
  update public.promotions set status = 'active', started_at = now(), note = null where id = v.id;
  perform public.write_activity('promotion_started', 'marketing', 'Started promotion ' || v.name || ' (' || v.percent || '% off, ' || n || ' products)', jsonb_build_object('promotion_id', v.id));
  return n;
end $$;

create or replace function public.start_promotion(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('marketing.manage') then raise exception 'You do not have permission to manage promotions.'; end if;
  return public.promotion_activate(p_id);
end $$;

-- Internal: ends a promotion (restores earlier sale prices unless changed by hand). A scheduled one is simply cancelled.
create or replace function public.promotion_finish(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.promotions%rowtype;
begin
  select * into v from public.promotions where id = p_id for update;
  if v.id is null then raise exception 'Promotion not found.'; end if;
  if v.status not in ('active','scheduled') then raise exception 'Only a running or scheduled promotion can be ended.'; end if;
  update public.products p set sale_price = pi.prior_sale_price
  from public.promotion_items pi where pi.promotion_id = v.id and pi.product_id = p.id and p.sale_price = pi.applied_price;
  update public.promotions set status = 'ended', ended_at = now() where id = v.id;
  perform public.write_activity('promotion_ended', 'marketing', 'Ended promotion ' || v.name, jsonb_build_object('promotion_id', v.id));
end $$;

create or replace function public.end_promotion(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('marketing.manage') then raise exception 'You do not have permission to manage promotions.'; end if;
  perform public.promotion_finish(p_id);
end $$;

-- Starts scheduled promotions whose time has come and ends running ones whose end has passed. Cheap when there is nothing to do,
-- so it is safe to call often: every minute from pg_cron (below), when staff open Marketing, and when the public site loads.
create or replace function public.sync_promotions() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not exists (select 1 from public.promotions where (status = 'scheduled' and starts_at <= now()) or (status = 'active' and ends_at <= now())) then return 0; end if;
  for r in select id from public.promotions where status = 'scheduled' and starts_at <= now() order by starts_at loop
    begin
      perform public.promotion_activate(r.id); n := n + 1;
    exception when others then
      update public.promotions set status = 'ended', ended_at = now(), note = 'Did not start: ' || sqlerrm where id = r.id;
    end;
  end loop;
  for r in select id from public.promotions where status = 'active' and ends_at <= now() loop
    perform public.promotion_finish(r.id); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.expire_promotions() returns int
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not (public.has_permission('marketing.manage') or public.is_tl_staff()) then return 0; end if;
  return public.sync_promotions();
end $$;

revoke execute on function public.promotion_activate(uuid), public.promotion_finish(uuid) from public, anon, authenticated;
revoke execute on function public.create_promotion(text, text, uuid, uuid, numeric, timestamptz, timestamptz), public.start_promotion(uuid), public.end_promotion(uuid), public.expire_promotions(), public.sync_promotions() from public, anon;
grant execute on function public.create_promotion(text, text, uuid, uuid, numeric, timestamptz, timestamptz), public.start_promotion(uuid), public.end_promotion(uuid), public.expire_promotions() to authenticated;
grant execute on function public.sync_promotions() to anon, authenticated;

-- Run the schedule every minute when pg_cron is available (Supabase: it is). If not, the page-load calls above still keep it current.
do $$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'tradelink-promotions') then perform cron.unschedule('tradelink-promotions'); end if;
  perform cron.schedule('tradelink-promotions', '* * * * *', 'select public.sync_promotions()');
exception when others then
  raise notice 'pg_cron is not available (%). Promotions will still update when staff open Marketing or the public site loads.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Coupon codes: a customer enters a code with a request; the discount comes off the price when it is quoted
-- ---------------------------------------------------------------------------
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{4,20}$'),
  name text check (char_length(name) <= 80),
  percent numeric(5,2) not null check (percent between 1 and 90),
  max_uses int check (max_uses is null or max_uses > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id),
  quotation_id uuid not null unique references public.quotations(id) on delete cascade,
  phone_key text not null,
  percent numeric(5,2) not null,
  order_id uuid references public.orders(id) on delete set null,
  discount_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists coupon_redemptions_coupon_idx on public.coupon_redemptions(coupon_id);
alter table public.quotations add column if not exists coupon_code text;
alter table public.quotations add column if not exists discount_percent numeric(5,2) not null default 0;
alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists discount_amount numeric(14,2) not null default 0;

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
drop policy if exists "Staff read coupons" on public.coupons;
create policy "Staff read coupons" on public.coupons for select to authenticated using (public.has_permission('marketing.manage') or public.is_tl_staff());
drop policy if exists "Staff read redemptions" on public.coupon_redemptions;
create policy "Staff read redemptions" on public.coupon_redemptions for select to authenticated using (public.has_permission('marketing.manage') or public.is_tl_staff());
revoke insert, update, delete on public.coupons, public.coupon_redemptions from authenticated, anon;
grant select on public.coupons, public.coupon_redemptions to authenticated;

create or replace function public.create_coupon(p_code text, p_name text, p_percent numeric, p_max_uses int, p_starts timestamptz, p_ends timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if auth.uid() is null or not public.has_permission('marketing.manage') then raise exception 'You do not have permission to manage coupons.'; end if;
  if v_code !~ '^[A-Z0-9_-]{4,20}$' then raise exception 'A code is 4 to 20 letters, numbers, - or _.'; end if;
  if exists (select 1 from public.coupons where code = v_code) then raise exception 'That code already exists.'; end if;
  if p_percent is null or p_percent < 1 or p_percent > 90 then raise exception 'The discount must be between 1 and 90 percent.'; end if;
  if p_ends is not null and p_ends <= coalesce(p_starts, now()) then raise exception 'The end must be after the start.'; end if;
  insert into public.coupons (code, name, percent, max_uses, starts_at, ends_at, created_by)
  values (v_code, nullif(btrim(p_name), ''), p_percent, p_max_uses, p_starts, p_ends, auth.uid()) returning id into v_id;
  perform public.write_activity('coupon_created', 'marketing', 'Created coupon ' || v_code || ' (' || p_percent || '% off)', jsonb_build_object('coupon_id', v_id));
  return v_id;
end $$;

create or replace function public.set_coupon_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('marketing.manage') then raise exception 'You do not have permission to manage coupons.'; end if;
  update public.coupons set active = coalesce(p_active, false) where id = p_id;
  if not found then raise exception 'Coupon not found.'; end if;
end $$;

-- Customer side: called right after a request is sent. Needs the quote number AND the phone used, so codes cannot be tried on their own.
create or replace function public.apply_coupon(p_quote_number text, p_phone text, p_code text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_q public.quotations%rowtype; v_c public.coupons%rowtype; v_phone text; v_key text; v_used int;
begin
  v_phone := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
  select * into v_q from public.quotations where quote_number = btrim(coalesce(p_quote_number, '')) and phone = v_phone;
  if v_q.id is null or v_q.status <> 'new' or v_q.created_at < now() - interval '2 hours' then raise exception 'We could not apply the coupon to this request.'; end if;
  if v_q.coupon_code is not null then raise exception 'A coupon is already applied to this request.'; end if;
  select * into v_c from public.coupons where code = upper(btrim(coalesce(p_code, ''))) for update;
  if v_c.id is null or not v_c.active then raise exception 'That coupon code is not valid.'; end if;
  if v_c.starts_at is not null and v_c.starts_at > now() then raise exception 'That coupon is not active yet.'; end if;
  if v_c.ends_at is not null and v_c.ends_at <= now() then raise exception 'That coupon has expired.'; end if;
  v_key := right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 9);
  select count(*) into v_used from public.coupon_redemptions r join public.quotations q on q.id = r.quotation_id where r.coupon_id = v_c.id and q.status <> 'rejected';
  if v_c.max_uses is not null and v_used >= v_c.max_uses then raise exception 'That coupon has been fully used.'; end if;
  if exists (select 1 from public.coupon_redemptions r join public.quotations q on q.id = r.quotation_id where r.coupon_id = v_c.id and r.phone_key = v_key and q.status <> 'rejected') then
    raise exception 'This phone number has already used that coupon.';
  end if;
  insert into public.coupon_redemptions (coupon_id, quotation_id, phone_key, percent) values (v_c.id, v_q.id, v_key, v_c.percent);
  perform set_config('app.workflow_rpc', 'on', true);
  update public.quotations set coupon_code = v_c.code, discount_percent = v_c.percent where id = v_q.id;
  return v_c.percent;
end $$;
revoke execute on function public.apply_coupon(text, text, text) from public;
grant execute on function public.apply_coupon(text, text, text) to anon, authenticated;

-- Staff can take a coupon off a quotation that has not become an order.
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
  update public.quotations set coupon_code = null, discount_percent = 0,
    estimated_total = (select coalesce(sum(line_total), 0) from public.quotation_items where quotation_id = p_quote) where id = p_quote;
end $$;
revoke execute on function public.remove_quote_coupon(uuid) from public, anon;
grant execute on function public.remove_quote_coupon(uuid) to authenticated;

-- Pricing: the total now includes the coupon. Each line is discounted and rounded, so the lines always add up to the total.
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

  select sum(round(quantity * round(unit_price * (1 - v_q.discount_percent / 100), 2), 2)) into v_total from public.quotation_items where quotation_id = p_quote;
  update public.quotations set estimated_total = v_total, status = 'quoted' where id = p_quote;
  return v_total;
end;
$$;

create or replace function public.convert_quote_to_order(p_quote uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_q public.quotations%rowtype; v_order uuid; v_number text; v_total numeric; v_full numeric; v_d numeric;
begin
  if not public.has_permission('quotes.convert') then raise exception 'You do not have permission to create orders.'; end if;
  select * into v_q from public.quotations where id = p_quote for update;
  if not found then raise exception 'Quotation not found.'; end if;
  if v_q.status not in ('quoted','accepted') then raise exception 'Price the quotation first (status is %).', v_q.status; end if;
  if exists (select 1 from public.orders where quotation_id = p_quote) then raise exception 'This quotation already has an order.'; end if;
  if exists (select 1 from public.quotation_items where quotation_id = p_quote and (unit_price <= 0 or product_id is null)) then
    raise exception 'Every line needs a price and an existing product.';
  end if;

  v_d := coalesce(v_q.discount_percent, 0);
  select sum(line_total), sum(round(quantity * round(unit_price * (1 - v_d / 100), 2), 2)) into v_full, v_total from public.quotation_items where quotation_id = p_quote;
  insert into public.orders (quotation_id, customer_name, phone, delivery_location, status, total_amount, coupon_code, discount_amount)
  values (v_q.id, v_q.customer_name, v_q.phone, v_q.delivery_location, 'confirmed', v_total, v_q.coupon_code, v_full - v_total)
  returning id, order_number into v_order, v_number;
  insert into public.order_items (order_id, product_id, product_name, quantity, unit, unit_price)
  select v_order, product_id, product_name, quantity, unit, round(unit_price * (1 - v_d / 100), 2) from public.quotation_items where quotation_id = p_quote;
  update public.coupon_redemptions set order_id = v_order, discount_amount = v_full - v_total where quotation_id = p_quote;

  perform set_config('app.workflow_rpc', 'on', true);
  update public.quotations set status = 'converted' where id = p_quote;
  perform public.write_activity('order_created', 'order', 'Order ' || v_number || ' created from quotation ' || v_q.quote_number, jsonb_build_object('order_id', v_order));
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Retail requests are quoted at the running sale price (see the note at the top)
-- ---------------------------------------------------------------------------
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
  return v_number;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Results, from real sales
-- ---------------------------------------------------------------------------
-- Per sale promotion: units, revenue and orders for its products while it ran (only orders that were paid and recorded as sales).
create or replace function public.promotion_results() returns table (promotion_id uuid, units numeric, revenue numeric, orders bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.has_permission('marketing.manage') or public.is_tl_staff()) then raise exception 'Not allowed'; end if;
  return query
  select p.id, coalesce(x.u, 0), coalesce(x.r, 0), coalesce(x.n, 0)
  from public.promotions p
  left join lateral (
    select sum(oi.quantity) as u, round(sum(oi.quantity * oi.unit_price), 2) as r, count(distinct o.id) as n
    from public.promotion_items pi
    join public.order_items oi on oi.product_id = pi.product_id
    join public.orders o on o.id = oi.order_id
    join public.sales s on s.order_id = o.id
    where pi.promotion_id = p.id and s.sold_at >= p.started_at and (p.ended_at is null or s.sold_at < p.ended_at)
  ) x on true
  where p.started_at is not null;
end $$;

-- Per coupon: how many requests used it, how many became orders, the discount given and the revenue.
create or replace function public.coupon_results() returns table (coupon_id uuid, uses bigint, orders bigint, discount numeric, revenue numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.has_permission('marketing.manage') or public.is_tl_staff()) then raise exception 'Not allowed'; end if;
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
  group by c.id;
end $$;
revoke execute on function public.promotion_results(), public.coupon_results() from public, anon;
grant execute on function public.promotion_results(), public.coupon_results() to authenticated;
