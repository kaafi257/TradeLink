-- TradeLink Food Wholesale: complete schema + security (single migration).
-- Run once in the Supabase SQL Editor. It is idempotent and ALWAYS ends in the hardened state,
-- so running it again (or on a database that already ran the old 0001/0002) is safe.
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('owner','manager','sales','inventory','delivery','staff');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role public.app_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  sku text unique,
  description text,
  image_url text,
  unit text not null default 'bag',
  package_size text,
  wholesale_price numeric(14,2) not null default 0 check (wholesale_price >= 0),
  min_order_quantity numeric(14,3) not null default 1 check (min_order_quantity > 0),
  stock_quantity numeric(14,3) not null default 0 check (stock_quantity >= 0),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products add column if not exists reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0);

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  quote_number text unique default ('QTN-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  customer_name text not null,
  phone text not null,
  email text,
  delivery_location text not null,
  notes text,
  status text not null default 'new' check (status in ('new','reviewing','quoted','accepted','rejected','converted')),
  estimated_total numeric(14,2) not null default 0,
  source_hash text,                       -- sha256 of the submitter IP, used only for rate limiting
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.quotations add column if not exists source_hash text;

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null,
  unit_price numeric(14,2) not null default 0,
  line_total numeric(14,2) generated always as (quantity * unit_price) stored
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique default ('ORD-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  quotation_id uuid references public.quotations(id),
  customer_name text not null,
  phone text not null,
  delivery_location text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','processing','ready','dispatched','completed','cancelled')),
  total_amount numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null,
  unit_price numeric(14,2) not null,
  line_total numeric(14,2) generated always as (quantity * unit_price) stored
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  movement_type text not null check (movement_type in ('purchase','sale','adjustment_in','adjustment_out','damage','return')),
  quantity numeric(14,3) not null check (quantity > 0),
  reference text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  receipt_number text unique default ('SAL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  customer_name text not null,
  total_amount numeric(14,2) not null,
  amount_paid numeric(14,2) not null default 0,
  payment_method text,
  sold_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  assigned_to uuid references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','assigned','in_transit','delivered','failed')),
  scheduled_at timestamptz,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  actor_name text,
  action text not null,
  entity_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists products_category_idx on public.products(category);
create index if not exists quotations_created_idx on public.quotations(created_at desc);
create index if not exists quotations_phone_idx on public.quotations(phone, created_at desc);
create index if not exists quotations_source_idx on public.quotations(source_hash, created_at desc);
create index if not exists orders_created_idx on public.orders(created_at desc);
create index if not exists sales_sold_idx on public.sales(sold_at desc);
create index if not exists activity_logs_created_idx on public.activity_logs(created_at desc);
create index if not exists inventory_product_idx on public.inventory_movements(product_id,created_at desc);

-- ---------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER avoids recursive profile RLS checks.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.app_role language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.has_any_role(roles public.app_role[])
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_user_role() = any(roles), false) $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id,full_name,email,role)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.email,''), 'staff')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Activity log: written ONLY by database triggers (never by the browser).
-- ---------------------------------------------------------------------------
create or replace function public.write_activity(p_action text, p_entity text, p_desc text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_name text;
begin
  if v_actor is not null then
    select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = v_actor;
  end if;
  insert into public.activity_logs(actor_id, actor_name, action, entity_type, description, metadata)
  values (v_actor, v_name, p_action, p_entity, p_desc, coalesce(p_meta, '{}'::jsonb));
end;
$$;

-- Old client-stamping trigger from the previous version is no longer needed.
drop trigger if exists stamp_activity_log on public.activity_logs;
drop function if exists public.stamp_activity_log();

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','products','quotations','orders'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Products: empty SKU -> NULL, created_by stamped, stock changes only via adjust_stock()
-- ---------------------------------------------------------------------------
create or replace function public.products_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.sku := nullif(btrim(coalesce(new.sku, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  elsif auth.uid() is not null
        and new.stock_quantity is distinct from old.stock_quantity
        and coalesce(current_setting('app.stock_rpc', true), '') <> 'on' then
    raise exception 'Stock can only be changed with an inventory adjustment (adjust_stock).';
  end if;
  return new;
end;
$$;
drop trigger if exists products_before_write on public.products;
create trigger products_before_write before insert or update on public.products
for each row execute function public.products_before_write();

-- After a product is created/changed: record opening stock as a movement and log the change.
create or replace function public.products_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.stock_quantity > 0 then
      insert into public.inventory_movements(product_id, movement_type, quantity, notes, created_by)
      values (new.id, 'purchase', new.stock_quantity, 'Opening stock', auth.uid());
    end if;
    perform public.write_activity('product_created', 'product', 'Added product ' || new.name, jsonb_build_object('product_id', new.id));
  elsif (to_jsonb(new) - 'updated_at' - 'stock_quantity') is distinct from (to_jsonb(old) - 'updated_at' - 'stock_quantity') then
    perform public.write_activity('product_updated', 'product', 'Updated product ' || new.name, jsonb_build_object('product_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists products_after_write on public.products;
create trigger products_after_write after insert or update on public.products
for each row execute function public.products_after_write();

-- ---------------------------------------------------------------------------
-- Profiles: role-escalation protection.
-- Non-owners can never touch an owner OR manager account, and can never grant owner/manager.
-- (auth.uid() is null in the SQL editor and for the service role, so those stay allowed.)
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.current_user_role() = 'owner' then
    return new;
  end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Profile id and email cannot be changed here.';
  end if;
  if old.role in ('owner', 'manager') then
    raise exception 'Only an owner can change an owner or manager account.';
  end if;
  if new.role is distinct from old.role and new.role in ('owner', 'manager') then
    raise exception 'Only an owner can grant the owner or manager role.';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_changes on public.profiles;
create trigger protect_profile_changes before update on public.profiles
for each row execute function public.protect_profile_changes();

create or replace function public.log_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_who text := coalesce(nullif(new.full_name, ''), new.email);
begin
  if auth.uid() is null then return new; end if;   -- invitations are logged by the invite function
  if new.role is distinct from old.role then
    perform public.write_activity('staff_updated', 'staff', 'Role of ' || v_who || ' changed from ' || old.role || ' to ' || new.role, jsonb_build_object('profile_id', new.id));
  end if;
  if new.active is distinct from old.active then
    perform public.write_activity('staff_updated', 'staff', 'Account ' || case when new.active then 'activated' else 'deactivated' end || ' for ' || v_who, jsonb_build_object('profile_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists log_profile_change on public.profiles;
create trigger log_profile_change after update on public.profiles
for each row execute function public.log_profile_change();

-- ---------------------------------------------------------------------------
-- Quotations / sales / inventory logging + stamping
-- ---------------------------------------------------------------------------
create or replace function public.log_quotation_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_activity('quotation_received', 'quotation', 'New quote request ' || new.quote_number || ' from ' || new.customer_name, jsonb_build_object('quotation_id', new.id));
  elsif new.status is distinct from old.status then
    perform public.write_activity('quotation_status_changed', 'quotation', 'Quotation ' || new.quote_number || ' changed to ' || new.status, jsonb_build_object('quotation_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists log_quotation_change on public.quotations;
create trigger log_quotation_change after insert or update on public.quotations
for each row execute function public.log_quotation_change();

create or replace function public.sales_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$$;
drop trigger if exists sales_before_insert on public.sales;
create trigger sales_before_insert before insert on public.sales
for each row execute function public.sales_before_insert();

create or replace function public.log_sale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.write_activity('sale_recorded', 'sale', 'Recorded sale ' || new.receipt_number || ' for ' || new.customer_name, jsonb_build_object('sale_id', new.id));
  return new;
end;
$$;
drop trigger if exists log_sale on public.sales;
create trigger log_sale after insert on public.sales
for each row execute function public.log_sale();

create or replace function public.log_inventory_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_unit text;
begin
  select name, unit into v_name, v_unit from public.products where id = new.product_id;
  perform public.write_activity('stock_adjusted', 'inventory',
    'Stock movement (' || new.movement_type || '): ' || new.quantity || ' ' || coalesce(v_unit, '') || ' of ' || coalesce(v_name, 'product'),
    jsonb_build_object('product_id', new.product_id, 'movement_id', new.id));
  return new;
end;
$$;
drop trigger if exists log_inventory_movement on public.inventory_movements;
create trigger log_inventory_movement after insert on public.inventory_movements
for each row execute function public.log_inventory_movement();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.sales enable row level security;
alter table public.deliveries enable row level security;
alter table public.activity_logs enable row level security;

-- Products: the public never queries this table (it sees the public_products view below).
drop policy if exists "Public can view active products" on public.products;
drop policy if exists "View products" on public.products;
create policy "View products" on public.products for select to authenticated
using (public.has_any_role(array['owner','manager','sales','inventory','delivery']::public.app_role[]));
drop policy if exists "Managers manage products" on public.products;
create policy "Managers manage products" on public.products for all to authenticated
using (public.has_any_role(array['owner','manager','inventory']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','inventory']::public.app_role[]));

-- Quotations: customers submit through submit_quote() only (no direct anonymous insert).
drop policy if exists "Public submit quotations" on public.quotations;
drop policy if exists "Staff create quotations" on public.quotations;
create policy "Staff create quotations" on public.quotations for insert to authenticated
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));
drop policy if exists "Staff read quotations" on public.quotations;
create policy "Staff read quotations" on public.quotations for select to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]));
drop policy if exists "Staff update quotations" on public.quotations;
create policy "Staff update quotations" on public.quotations for update to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));

drop policy if exists "Staff manage quotation items" on public.quotation_items;
create policy "Staff manage quotation items" on public.quotation_items for all to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));

-- Orders: delivery staff may READ orders but cannot change totals or payments.
drop policy if exists "Staff manage orders" on public.orders;
create policy "Staff manage orders" on public.orders for all to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));
drop policy if exists "Delivery view orders" on public.orders;
create policy "Delivery view orders" on public.orders for select to authenticated
using (public.has_any_role(array['delivery']::public.app_role[]));

drop policy if exists "Staff manage order items" on public.order_items;
create policy "Staff manage order items" on public.order_items for all to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));

-- Inventory movements: READ-ONLY for everyone. Rows are created only by adjust_stock()/triggers.
drop policy if exists "Staff manage inventory" on public.inventory_movements;
drop policy if exists "Staff read inventory movements" on public.inventory_movements;
create policy "Staff read inventory movements" on public.inventory_movements for select to authenticated
using (public.has_any_role(array['owner','manager','inventory']::public.app_role[]));

-- Sales: staff can record and read; nobody can edit or delete a recorded sale.
drop policy if exists "Staff manage sales" on public.sales;
drop policy if exists "Staff read sales" on public.sales;
create policy "Staff read sales" on public.sales for select to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]));
drop policy if exists "Staff record sales" on public.sales;
create policy "Staff record sales" on public.sales for insert to authenticated
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));

drop policy if exists "Staff manage deliveries" on public.deliveries;
create policy "Staff manage deliveries" on public.deliveries for all to authenticated
using (public.has_any_role(array['owner','manager','delivery']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','delivery']::public.app_role[]));

drop policy if exists "Users view own profile and admins view all" on public.profiles;
create policy "Users view own profile and admins view all" on public.profiles for select to authenticated
using (id = auth.uid() or public.has_any_role(array['owner','manager']::public.app_role[]));
drop policy if exists "Admins manage profiles" on public.profiles;
create policy "Admins manage profiles" on public.profiles for update to authenticated
using (public.has_any_role(array['owner','manager']::public.app_role[]))
with check (public.has_any_role(array['owner','manager']::public.app_role[]));

-- Activity log: owners/managers read; nobody writes from the API (triggers only).
drop policy if exists "Staff read activity logs" on public.activity_logs;
create policy "Staff read activity logs" on public.activity_logs for select to authenticated
using (public.has_any_role(array['owner','manager']::public.app_role[]));
drop policy if exists "Authenticated users append activity logs" on public.activity_logs;

-- ---------------------------------------------------------------------------
-- Table privileges (defence in depth on top of RLS)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke update, delete on public.activity_logs from authenticated;
revoke insert, update, delete, truncate on public.activity_logs from authenticated;
revoke insert, update, delete, truncate on public.inventory_movements from authenticated;
revoke update, delete, truncate on public.sales from authenticated;

-- ---------------------------------------------------------------------------
-- Public catalogue: ONLY harmless columns (no price, stock, reorder level, SKU, creator).
-- The view runs with its owner's rights, so anon needs no access to the products table.
-- ---------------------------------------------------------------------------
drop view if exists public.public_products;
create view public.public_products as
select id, name, category, description, image_url, unit, package_size, min_order_quantity
from public.products
where active = true;
grant select on public.public_products to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quote form: validated, product chosen by id, rate-limited by phone, IP and globally
-- ---------------------------------------------------------------------------
drop function if exists public.submit_quote(text,text,text,text,text,numeric,text,text,text);
create or replace function public.submit_quote(
  p_name text, p_phone text, p_email text, p_location text,
  p_product_id uuid, p_quantity numeric, p_notes text,
  p_website text default ''
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_number text; v_prod public.products%rowtype;
  v_ip text; v_hash text; v_recent int;
begin
  -- Honeypot: real visitors never fill the hidden "website" field. Pretend success, store nothing.
  if btrim(coalesce(p_website, '')) <> '' then return 'QTN-RECEIVED'; end if;

  p_name := btrim(coalesce(p_name, ''));
  p_phone := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');   -- "0911 22 33" and "091122 33" are the same number
  p_email := nullif(btrim(coalesce(p_email, '')), '');
  p_location := btrim(coalesce(p_location, ''));
  p_notes := nullif(btrim(coalesce(p_notes, '')), '');

  if char_length(p_name) not between 2 and 120 then raise exception 'Please enter your name or business name.'; end if;
  if char_length(p_phone) not between 6 and 20 then raise exception 'Please enter a valid phone number.'; end if;
  if char_length(p_location) not between 2 and 120 then raise exception 'Please enter the delivery location.'; end if;
  if p_email is not null and (char_length(p_email) > 160 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'Please enter a valid email address.'; end if;
  if p_notes is not null and char_length(p_notes) > 1000 then raise exception 'Additional details are too long (1000 characters max).'; end if;

  select * into v_prod from public.products where id = p_product_id and active = true;
  if not found then raise exception 'Please choose an available product.'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then raise exception 'Please enter a valid quantity.'; end if;
  if p_quantity < v_prod.min_order_quantity then
    raise exception 'The minimum order for % is % %.', v_prod.name, trim(trailing '.' from trim(trailing '0' from v_prod.min_order_quantity::text)), v_prod.unit;
  end if;

  -- Client IP as seen by the API gateway (stored only as a hash).
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

  insert into public.quotations (customer_name, phone, email, delivery_location, notes, status, source_hash)
  values (p_name, p_phone, p_email, p_location, p_notes, 'new', v_hash)
  returning id, quote_number into v_id, v_number;

  insert into public.quotation_items (quotation_id, product_id, product_name, quantity, unit)
  values (v_id, v_prod.id, v_prod.name || coalesce(' (' || v_prod.package_size || ')', ''), p_quantity, v_prod.unit);

  return v_number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inventory: every stock change is a recorded movement
-- ---------------------------------------------------------------------------
create or replace function public.adjust_stock(p_product uuid, p_type text, p_quantity numeric, p_notes text default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_delta numeric; v_new numeric;
begin
  if not public.has_any_role(array['owner','manager','inventory']::public.app_role[]) then
    raise exception 'You do not have permission to adjust stock.';
  end if;
  if p_type not in ('purchase','adjustment_in','return','adjustment_out','damage') then
    raise exception 'Invalid movement type.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero.'; end if;

  v_delta := case when p_type in ('purchase','adjustment_in','return') then p_quantity else -p_quantity end;
  perform set_config('app.stock_rpc', 'on', true);
  update public.products set stock_quantity = stock_quantity + v_delta where id = p_product
  returning stock_quantity into v_new;
  if not found then raise exception 'Product not found.'; end if;

  insert into public.inventory_movements (product_id, movement_type, quantity, notes, created_by)
  values (p_product, p_type, p_quantity, left(nullif(btrim(coalesce(p_notes, '')), ''), 500), auth.uid());
  return v_new;
exception when check_violation then
  raise exception 'Not enough stock for this adjustment.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales totals per day, computed in the database (the API caps raw rows at ~1000)
-- ---------------------------------------------------------------------------
create or replace function public.sales_by_day(p_from timestamptz)
returns table(day timestamptz, total numeric)
language sql stable security invoker set search_path = public as $$
  select date_trunc('day', sold_at at time zone 'Africa/Addis_Ababa') at time zone 'Africa/Addis_Ababa' as day,
         sum(total_amount) as total
  from public.sales where sold_at >= p_from group by 1 order by 1
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing is callable by the public unless listed here
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.has_any_role(public.app_role[]) to authenticated;
grant execute on function public.adjust_stock(uuid,text,numeric,text) to authenticated;
grant execute on function public.sales_by_day(timestamptz) to authenticated;
grant execute on function public.submit_quote(text,text,text,text,uuid,numeric,text,text) to anon, authenticated;
