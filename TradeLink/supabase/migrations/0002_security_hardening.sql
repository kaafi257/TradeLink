-- TradeLink 0002: security hardening and workflow fixes.
-- Run AFTER 0001_tradelink_schema.sql, in the Supabase SQL Editor. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0);

-- ---------------------------------------------------------------------------
-- Generic triggers: updated_at, product defaults
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

-- Products: empty SKU becomes NULL (SKU is unique, so "" would collide), created_by is stamped,
-- and stock can only change through public.adjust_stock() so every change leaves an audit row.
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

-- ---------------------------------------------------------------------------
-- 1. Role escalation: only an owner may grant owner/manager or touch an owner account
--    (auth.uid() is null in the SQL editor and for the service role, so those stay allowed)
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
  if old.role = 'owner' then
    raise exception 'Only an owner can change an owner account.';
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

-- ---------------------------------------------------------------------------
-- 2. Products: inactive products are visible to staff roles only, not to any signed-in user
-- ---------------------------------------------------------------------------
drop policy if exists "Public can view active products" on public.products;
drop policy if exists "View products" on public.products;
create policy "View products" on public.products for select
using (active = true or public.has_any_role(array['owner','manager','sales','inventory','delivery']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- 3. Activity log: the database, not the browser, decides who the actor is
-- ---------------------------------------------------------------------------
create or replace function public.stamp_activity_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.actor_id := auth.uid();
    select coalesce(nullif(full_name, ''), email) into new.actor_name
    from public.profiles where id = auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists stamp_activity_log on public.activity_logs;
create trigger stamp_activity_log before insert on public.activity_logs
for each row execute function public.stamp_activity_log();

drop policy if exists "Authenticated users append activity logs" on public.activity_logs;
create policy "Authenticated users append activity logs" on public.activity_logs for insert to authenticated
with check (actor_id = auth.uid() and public.current_user_role() is not null);

-- ---------------------------------------------------------------------------
-- 4. Quote form: no direct anonymous inserts; use a validated, rate-limited function
-- ---------------------------------------------------------------------------
drop policy if exists "Public submit quotations" on public.quotations;
drop policy if exists "Staff create quotations" on public.quotations;
create policy "Staff create quotations" on public.quotations for insert to authenticated
with check (public.has_any_role(array['owner','manager','sales']::public.app_role[]));

create or replace function public.submit_quote(
  p_name text, p_phone text, p_email text, p_location text,
  p_product text, p_quantity numeric, p_unit text, p_notes text,
  p_website text default ''
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_number text; v_product uuid; v_recent int; v_global int;
begin
  -- Honeypot: real visitors never fill the hidden "website" field. Pretend success, store nothing.
  if btrim(coalesce(p_website, '')) <> '' then return 'QTN-RECEIVED'; end if;

  p_name := btrim(coalesce(p_name, ''));
  p_phone := btrim(coalesce(p_phone, ''));
  p_email := nullif(btrim(coalesce(p_email, '')), '');
  p_location := btrim(coalesce(p_location, ''));
  p_notes := nullif(btrim(coalesce(p_notes, '')), '');
  p_product := btrim(coalesce(p_product, ''));
  p_unit := lower(btrim(coalesce(p_unit, '')));

  if char_length(p_name) not between 2 and 120 then raise exception 'Please enter your name or business name.'; end if;
  if char_length(p_phone) not between 6 and 30 then raise exception 'Please enter a valid phone number.'; end if;
  if char_length(p_location) not between 2 and 120 then raise exception 'Please enter the delivery location.'; end if;
  if p_email is not null and (char_length(p_email) > 160 or position('@' in p_email) < 2) then raise exception 'Please enter a valid email address.'; end if;
  if p_notes is not null and char_length(p_notes) > 1000 then raise exception 'Additional details are too long (1000 characters max).'; end if;
  if p_product = '' or char_length(p_product) > 160 then raise exception 'Please choose a product.'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then raise exception 'Please enter a valid quantity.'; end if;
  if p_unit not in ('bag','kg','ton','container','carton') then raise exception 'Please choose a valid unit.'; end if;

  select count(*) into v_recent from public.quotations where phone = p_phone and created_at > now() - interval '1 hour';
  if v_recent >= 3 then raise exception 'Too many requests from this number. Please try again later.'; end if;
  select count(*) into v_global from public.quotations where created_at > now() - interval '1 hour';
  if v_global >= 100 then raise exception 'We are receiving many requests right now. Please try again shortly.'; end if;

  insert into public.quotations (customer_name, phone, email, delivery_location, notes, status)
  values (p_name, p_phone, p_email, p_location, p_notes, 'new')
  returning id, quote_number into v_id, v_number;

  select id into v_product from public.products where name = p_product and active = true limit 1;
  insert into public.quotation_items (quotation_id, product_id, product_name, quantity, unit)
  values (v_id, v_product, p_product, p_quantity, p_unit);

  return v_number;
end;
$$;
revoke all on function public.submit_quote(text,text,text,text,text,numeric,text,text,text) from public;
grant execute on function public.submit_quote(text,text,text,text,text,numeric,text,text,text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Inventory: every stock change is a recorded movement
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
  values (p_product, p_type, p_quantity, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid());
  return v_new;
exception when check_violation then
  raise exception 'Not enough stock for this adjustment.';
end;
$$;
revoke all on function public.adjust_stock(uuid,text,numeric,text) from public, anon;
grant execute on function public.adjust_stock(uuid,text,numeric,text) to authenticated;
