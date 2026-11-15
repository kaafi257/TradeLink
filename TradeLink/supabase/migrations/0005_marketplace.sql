-- TradeLink marketplace: configurable industries + categories, retail pricing, B2B/B2C audiences,
-- multi-item customer requests. Run ONCE in the Supabase SQL Editor after 0001-0004. Idempotent.

-- ---------------------------------------------------------------------------
-- Industries and categories (managed in Admin -> Categories; no code changes needed for a new industry)
-- ---------------------------------------------------------------------------
create table if not exists public.industries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 2 and 60),
  description text check (char_length(description) <= 200),
  icon text not null default 'package' check (char_length(icon) <= 30),
  sort_order int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  industry_id uuid not null references public.industries(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text check (char_length(description) <= 200),
  image_url text,
  sort_order int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (industry_id, name)
);
create index if not exists categories_industry_idx on public.categories(industry_id, sort_order);

do $$
declare t text;
begin
  foreach t in array array['industries','categories'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Products: category link, retail price, who can buy it.
alter table public.products add column if not exists category_id uuid references public.categories(id) on delete restrict;
alter table public.products add column if not exists retail_price numeric(14,2) not null default 0 check (retail_price >= 0);
alter table public.products add column if not exists audience text not null default 'both' check (audience in ('b2b','b2c','both'));
create index if not exists products_category_id_idx on public.products(category_id);
alter table public.quotations add column if not exists customer_type text not null default 'business' check (customer_type in ('business','individual'));

-- Starter data: the existing food business becomes the first industry.
insert into public.industries (name, description, icon, sort_order)
values ('Food & Groceries', 'Rice, sugar, cooking oil and other staples', 'wheat', 10)
on conflict (name) do nothing;
insert into public.categories (industry_id, name, sort_order, image_url)
select i.id, c.name, c.ord, c.img from public.industries i,
  (values ('Rice',10,'/img/rice.jpg'),('Sugar',20,'/img/sugar.jpg'),('Cooking Oil',30,'/img/oil.jpg'),('Other Food Products',40,null)) as c(name,ord,img)
where i.name = 'Food & Groceries'
on conflict (industry_id, name) do nothing;
-- Any other category text already used by products becomes a category too.
insert into public.categories (industry_id, name)
select distinct (select id from public.industries where name = 'Food & Groceries'), btrim(p.category)
from public.products p
where btrim(p.category) <> '' and not exists (select 1 from public.categories c where lower(c.name) = lower(btrim(p.category)));
update public.products p set category_id = c.id from public.categories c where p.category_id is null and lower(c.name) = lower(btrim(p.category));

-- products.category (text) stays as a copy of the category name so older screens keep working.
create or replace function public.products_sync_category()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.category_id is not null then
    select name into v_name from public.categories where id = new.category_id;
    new.category := v_name;
  elsif nullif(btrim(coalesce(new.category, '')), '') is not null then
    select id, name into new.category_id, v_name from public.categories where lower(name) = lower(btrim(new.category)) limit 1;
    if v_name is not null then new.category := v_name; end if;
  end if;
  if nullif(btrim(coalesce(new.category, '')), '') is null then raise exception 'Choose a category for this product.'; end if;
  return new;
end;
$$;
drop trigger if exists products_sync_category on public.products;
create trigger products_sync_category before insert or update on public.products
for each row execute function public.products_sync_category();

-- Renaming a category updates the copied name on its products (without flooding the activity log).
create or replace function public.categories_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name then
    perform set_config('app.category_sync', 'on', true);
    update public.products set category = new.name where category_id = new.id;
  end if;
  perform public.write_activity('category_updated', 'catalogue', 'Updated category ' || new.name, jsonb_build_object('category_id', new.id));
  return new;
end;
$$;
drop trigger if exists categories_after_update on public.categories;
create trigger categories_after_update after update on public.categories
for each row execute function public.categories_after_update();

create or replace function public.log_catalogue_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.write_activity(tg_table_name || '_created', 'catalogue', 'Added ' || (case tg_table_name when 'industries' then 'industry ' else 'category ' end) || new.name, '{}'::jsonb);
  return new;
end;
$$;
drop trigger if exists log_industry_insert on public.industries;
create trigger log_industry_insert after insert on public.industries for each row execute function public.log_catalogue_insert();
drop trigger if exists log_category_insert on public.categories;
create trigger log_category_insert after insert on public.categories for each row execute function public.log_catalogue_insert();

-- Product change log: skip the bulk rename above.
create or replace function public.products_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.stock_quantity > 0 then
      insert into public.inventory_movements(product_id, movement_type, quantity, notes, created_by)
      values (new.id, 'purchase', new.stock_quantity, 'Opening stock', auth.uid());
    end if;
    perform public.write_activity('product_created', 'product', 'Added product ' || new.name, jsonb_build_object('product_id', new.id));
  elsif coalesce(current_setting('app.category_sync', true), '') <> 'on'
        and (to_jsonb(new) - 'updated_at' - 'stock_quantity') is distinct from (to_jsonb(old) - 'updated_at' - 'stock_quantity') then
    perform public.write_activity('product_updated', 'product', 'Updated product ' || new.name, jsonb_build_object('product_id', new.id));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions and row-level security
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values ('manager', 'catalogue.manage') on conflict do nothing;

alter table public.industries enable row level security;
alter table public.categories enable row level security;
drop policy if exists "Staff read industries" on public.industries;
create policy "Staff read industries" on public.industries for select to authenticated
using (public.has_any_role(array['owner','manager','sales','inventory','delivery']::public.app_role[]));
drop policy if exists "Manage industries" on public.industries;
create policy "Manage industries" on public.industries for all to authenticated
using (public.has_permission('catalogue.manage')) with check (public.has_permission('catalogue.manage'));
drop policy if exists "Staff read categories" on public.categories;
create policy "Staff read categories" on public.categories for select to authenticated
using (public.has_any_role(array['owner','manager','sales','inventory','delivery']::public.app_role[]));
drop policy if exists "Manage categories" on public.categories;
create policy "Manage categories" on public.categories for all to authenticated
using (public.has_permission('catalogue.manage')) with check (public.has_permission('catalogue.manage'));

-- Table privileges (some projects do not grant these automatically). RLS above still decides who may do what.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.industries, public.categories to authenticated;
grant select, insert, update, delete on public.role_permissions to authenticated;
grant select, update on public.contact_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Public views: only harmless columns. Wholesale price is never exposed; the retail price only for retail products.
-- ---------------------------------------------------------------------------
drop view if exists public.public_products;
create view public.public_products as
select p.id, p.name, p.category, p.description, p.image_url, p.unit, p.package_size, p.min_order_quantity,
       p.category_id, p.audience,
       case when p.audience in ('b2c','both') and p.retail_price > 0 then p.retail_price end as retail_price
from public.products p
left join public.categories c on c.id = p.category_id
left join public.industries i on i.id = c.industry_id
where p.active = true and (c.id is null or (c.active and i.active));
grant select on public.public_products to anon, authenticated;

drop view if exists public.public_industries;
create view public.public_industries as
select id, name, description, icon, sort_order from public.industries where active = true;
grant select on public.public_industries to anon, authenticated;

drop view if exists public.public_categories;
create view public.public_categories as
select c.id, c.industry_id, c.name, c.description, c.image_url, c.sort_order
from public.categories c join public.industries i on i.id = c.industry_id
where c.active = true and i.active = true;
grant select on public.public_categories to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Customer requests: several products at once, for businesses (wholesale) or individuals (retail).
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
    v_price := case when p_customer_type = 'individual' and v_prod.retail_price > 0 then v_prod.retail_price else 0 end;
    insert into public.quotation_items (quotation_id, product_id, product_name, quantity, unit, unit_price)
    values (v_id, v_prod.id, v_prod.name || coalesce(' (' || v_prod.package_size || ')', ''), v_qty, v_prod.unit, v_price);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Please add at least one product.'; end if;
  return v_number;
end;
$$;

-- The old single-product form keeps working: it now calls submit_request.
create or replace function public.submit_quote(
  p_name text, p_phone text, p_email text, p_location text,
  p_product_id uuid, p_quantity numeric, p_notes text,
  p_website text default ''
) returns text
language sql security definer set search_path = public as $$
  select public.submit_request(p_name, p_phone, p_email, p_location,
    jsonb_build_array(jsonb_build_object('product_id', p_product_id, 'quantity', p_quantity)), p_notes, p_website, 'business')
$$;

revoke execute on function public.submit_request(text,text,text,text,jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_request(text,text,text,text,jsonb,text,text,text) to anon, authenticated;
revoke execute on function public.submit_quote(text,text,text,text,uuid,numeric,text,text) from public, anon, authenticated;
grant execute on function public.submit_quote(text,text,text,text,uuid,numeric,text,text) to anon, authenticated;
revoke execute on function public.products_sync_category() from public, anon, authenticated;
revoke execute on function public.categories_after_update() from public, anon, authenticated;
revoke execute on function public.log_catalogue_insert() from public, anon, authenticated;
revoke execute on function public.products_after_write() from public, anon, authenticated;
