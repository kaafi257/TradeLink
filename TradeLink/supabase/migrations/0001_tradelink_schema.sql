-- TradeLink Food Wholesale: initial schema
-- Run this migration in Supabase SQL Editor.
create extension if not exists pgcrypto;

create type public.app_role as enum ('owner','manager','sales','inventory','delivery','staff');

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
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
create index if not exists orders_created_idx on public.orders(created_at desc);
create index if not exists activity_logs_created_idx on public.activity_logs(created_at desc);
create index if not exists inventory_product_idx on public.inventory_movements(product_id,created_at desc);

-- Helper functions for role-based access. SECURITY DEFINER avoids recursive profile RLS checks.
create or replace function public.current_user_role()
returns public.app_role language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.has_any_role(roles public.app_role[])
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_user_role() = any(roles), false) $$;

-- Create a staff profile automatically when an auth user is created.
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

-- Public catalogue read; authenticated management.
create policy "Public can view active products" on public.products for select using (active = true or auth.uid() is not null);
create policy "Managers manage products" on public.products for all to authenticated
using (public.has_any_role(array['owner','manager','inventory']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','inventory']::public.app_role[]));

-- Public customers may submit a quote request; only authenticated staff can read/manage it.
create policy "Public submit quotations" on public.quotations for insert to anon, authenticated with check (status = 'new');
create policy "Staff read quotations" on public.quotations for select to authenticated using (public.has_any_role(array['owner','manager','sales']::public.app_role[]));
create policy "Staff update quotations" on public.quotations for update to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));

create policy "Staff manage quotation items" on public.quotation_items for all to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));

create policy "Staff manage orders" on public.orders for all to authenticated
using (public.has_any_role(array['owner','manager','sales','delivery']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','sales','delivery']::public.app_role[]));
create policy "Staff manage order items" on public.order_items for all to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));

create policy "Staff manage inventory" on public.inventory_movements for all to authenticated
using (public.has_any_role(array['owner','manager','inventory']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','inventory']::public.app_role[]));

create policy "Staff manage sales" on public.sales for all to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));

create policy "Staff manage deliveries" on public.deliveries for all to authenticated
using (public.has_any_role(array['owner','manager','delivery']::public.app_role[]))
with check (public.has_any_role(array['owner','manager','delivery']::public.app_role[]));

create policy "Users view own profile and admins view all" on public.profiles for select to authenticated
using (id = auth.uid() or public.has_any_role(array['owner','manager']::public.app_role[]));
create policy "Admins manage profiles" on public.profiles for update to authenticated
using (public.has_any_role(array['owner','manager']::public.app_role[]))
with check (public.has_any_role(array['owner','manager']::public.app_role[]));

create policy "Staff read activity logs" on public.activity_logs for select to authenticated
using (public.has_any_role(array['owner','manager']::public.app_role[]));
create policy "Authenticated users append activity logs" on public.activity_logs for insert to authenticated
with check (actor_id = auth.uid() or actor_id is null);

-- Activity rows cannot be updated or deleted by app users.
revoke update, delete on public.activity_logs from anon, authenticated;

-- Seed product categories only; add real products through admin.
