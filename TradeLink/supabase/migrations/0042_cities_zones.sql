-- TradeLink delivery, Phase 1: cities, optional zones, driver-city assignment, city-restricted assignment, delivery filters.
-- ADDITIVE and re-runnable. New tables and functions; one existing function (assign_delivery) keeps its exact signature and
-- every one of its checks, and only gains the city rule. Existing orders, deliveries, payments, auth and policies are untouched.
-- Safe by default: until the first ACTIVE city is created, assignment behaves exactly as before.
-- Supabase SQL Editor: paste the whole file and press Run.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables (nobody reads or writes these directly; every access goes through the functions below)
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists cities_name_unique on public.cities (lower(btrim(name)));

create table if not exists public.city_zones (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists city_zones_name_unique on public.city_zones (city_id, lower(btrim(name)));

create table if not exists public.driver_cities (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  city_id uuid not null references public.cities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, city_id)
);

alter table public.orders add column if not exists city_id uuid references public.cities(id);
alter table public.orders add column if not exists zone_id uuid references public.city_zones(id);

alter table public.cities enable row level security;
alter table public.city_zones enable row level security;
alter table public.driver_cities enable row level security;
revoke all on public.cities, public.city_zones, public.driver_cities from anon, authenticated, public;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Customers: the active cities and zones for the checkout dropdowns (names only, nothing private)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.public_cities() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name,
    'zones', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name) order by z.name) from public.city_zones z where z.city_id = c.id and z.active), '[]'::jsonb)
  ) order by c.name), '[]'::jsonb)
  from public.cities c where c.active
$$;

-- The customer saves the city of their own order once (order number + phone, like the GPS share). It cannot be changed
-- afterwards by the customer; staff can correct it.
create or replace function public.set_order_city(p_number text, p_phone text, p_city uuid, p_zone uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old uuid; v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
begin
  if not exists (select 1 from public.cities where id = p_city and active) then raise exception 'Please choose a city from the list.'; end if;
  if p_zone is not null and not exists (select 1 from public.city_zones where id = p_zone and city_id = p_city and active) then raise exception 'That area does not belong to the chosen city.'; end if;
  if p_zone is null and exists (select 1 from public.city_zones where city_id = p_city and active) then raise exception 'Please choose your area in this city.'; end if;
  v_id := (select o.id from public.orders o where o.order_number = upper(btrim(coalesce(p_number, ''))) and o.channel = 'checkout'
           and char_length(v_phone) >= 6 and right(o.phone, 9) = right(v_phone, 9));
  if v_id is null then raise exception 'We could not find an order with those details.'; end if;
  v_old := (select o.city_id from public.orders o where o.id = v_id);
  if v_old is not null and v_old <> p_city then raise exception 'The city of this order is already saved. Contact TradeLink to change it.'; end if;
  update public.orders set city_id = p_city, zone_id = p_zone where id = v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Owner / manager: manage cities and zones
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.ops_cities() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'active', c.active,
      'drivers', (select count(*) from public.driver_cities dc where dc.city_id = c.id),
      'orders', (select count(*) from public.orders o where o.city_id = c.id),
      'zones', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'active', z.active) order by z.name) from public.city_zones z where z.city_id = c.id), '[]'::jsonb)
    ) order by c.name)
    from public.cities c
  ), '[]'::jsonb);
end $$;

create or replace function public.ops_save_city(p_id uuid, p_name text, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then raise exception 'Enter a city name (2 to 60 letters).'; end if;
  if exists (select 1 from public.cities where lower(btrim(name)) = lower(v_name) and id is distinct from p_id) then raise exception 'A city with this name already exists.'; end if;
  if p_id is null then
    insert into public.cities (name, active) values (v_name, coalesce(p_active, true)) returning id into v_id;
    perform public.write_activity('city_added', 'delivery', 'City added: ' || v_name, jsonb_build_object('city_id', v_id));
  else
    update public.cities set name = v_name, active = coalesce(p_active, active) where id = p_id;
    if not found then raise exception 'City not found.'; end if;
    perform public.write_activity('city_updated', 'delivery', 'City updated: ' || v_name, jsonb_build_object('city_id', p_id, 'active', p_active));
  end if;
  return v_id;
end $$;

create or replace function public.ops_save_zone(p_id uuid, p_city uuid, p_name text, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_name text := btrim(coalesce(p_name, '')); v_city uuid := p_city;
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then raise exception 'Enter an area name (2 to 60 letters).'; end if;
  if p_id is not null then v_city := (select city_id from public.city_zones where id = p_id); end if;
  if v_city is null or not exists (select 1 from public.cities where id = v_city) then raise exception 'City not found.'; end if;
  if exists (select 1 from public.city_zones where city_id = v_city and lower(btrim(name)) = lower(v_name) and id is distinct from p_id) then raise exception 'This area already exists in the city.'; end if;
  if p_id is null then
    insert into public.city_zones (city_id, name, active) values (v_city, v_name, coalesce(p_active, true)) returning id into v_id;
    perform public.write_activity('zone_added', 'delivery', 'Area added: ' || v_name, jsonb_build_object('zone_id', v_id, 'city_id', v_city));
  else
    update public.city_zones set name = v_name, active = coalesce(p_active, active) where id = p_id;
    perform public.write_activity('zone_updated', 'delivery', 'Area updated: ' || v_name, jsonb_build_object('zone_id', p_id, 'active', p_active));
  end if;
  return v_id;
end $$;

-- Which cities each driver serves, and how busy each driver is (owner and manager only).
create or replace function public.ops_driver_load() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'profileId', p.id,
      'cities', coalesce((select jsonb_agg(dc.city_id) from public.driver_cities dc where dc.profile_id = p.id), '[]'::jsonb),
      'openJobs', (select count(*) from public.deliveries d where d.assigned_to = p.id and d.status in ('assigned', 'in_transit')),
      'online', coalesce(a.status <> 'offline', false),
      'lastSeen', l.updated_at))
    from public.profiles p
    left join public.delivery_agents a on a.profile_id = p.id
    left join public.delivery_live_location l on l.agent_id = a.id
    where p.role = 'delivery' and p.active = true
  ), '[]'::jsonb);
end $$;

create or replace function public.ops_set_driver_cities(p_profile uuid, p_cities uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text; v_ids uuid[] := coalesce(p_cities, '{}'::uuid[]);
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  v_name := (select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = p_profile and role = 'delivery' and active = true);
  if v_name is null then raise exception 'Choose an active delivery driver.'; end if;
  if cardinality(v_ids) > 50 then raise exception 'Too many cities.'; end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.cities c where c.id = x)) then raise exception 'City not found.'; end if;
  delete from public.driver_cities where profile_id = p_profile and not (city_id = any (v_ids));
  insert into public.driver_cities (profile_id, city_id) select distinct p_profile, x from unnest(v_ids) x on conflict do nothing;
  perform public.write_activity('driver_cities_set', 'delivery', 'Cities updated for driver ' || v_name, jsonb_build_object('driver', p_profile, 'cities', v_ids));
end $$;

-- Staff correct the city / area of an order (until it is delivered).
create or replace function public.ops_set_order_city(p_order uuid, p_city uuid, p_zone uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_no text;
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  v_no := (select order_number from public.orders where id = p_order);
  if v_no is null then raise exception 'Order not found.'; end if;
  if not exists (select 1 from public.cities where id = p_city and active) then raise exception 'Choose an active city.'; end if;
  if p_zone is not null and not exists (select 1 from public.city_zones where id = p_zone and city_id = p_city and active) then raise exception 'That area does not belong to the chosen city.'; end if;
  if p_zone is null and exists (select 1 from public.city_zones where city_id = p_city and active) then raise exception 'Choose the area in this city.'; end if;
  if exists (select 1 from public.deliveries where order_id = p_order and status = 'delivered') then raise exception 'This order is already delivered.'; end if;
  update public.orders set city_id = p_city, zone_id = p_zone where id = p_order;
  perform public.write_activity('order_city_set', 'order', 'City set for order ' || v_no, jsonb_build_object('order_id', p_order, 'city_id', p_city, 'zone_id', p_zone));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Assignment: who can take this order, with availability and workload
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.ops_assign_candidates(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_on boolean; v_city uuid; v_zone uuid; v_cname text; v_zname text;
begin
  if auth.uid() is null or not public.has_permission('deliveries.assign') then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not exists (select 1 from public.orders where id = p_order) then raise exception 'Order not found.'; end if;
  v_on := exists (select 1 from public.cities where active);
  v_city := (select city_id from public.orders where id = p_order);
  v_zone := (select zone_id from public.orders where id = p_order);
  v_cname := (select name from public.cities where id = v_city);
  v_zname := (select name from public.city_zones where id = v_zone);
  return jsonb_build_object(
    'citiesOn', v_on, 'cityId', v_city, 'cityName', v_cname, 'zoneId', v_zone, 'zoneName', v_zname,
    'needsCity', v_on and v_city is null,
    'drivers', case when v_on and v_city is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'profileId', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email), 'role', p.role,
        'verified', coalesce(a.verified, false), 'online', coalesce(a.status <> 'offline', false), 'lastSeen', l.updated_at,
        'openJobs', (select count(*) from public.deliveries d where d.assigned_to = p.id and d.status in ('assigned', 'in_transit')))
        order by (p.role <> 'delivery'), coalesce(a.status, 'offline') = 'offline', coalesce(nullif(btrim(p.full_name), ''), p.email))
      from public.profiles p
      left join public.delivery_agents a on a.profile_id = p.id
      left join public.delivery_live_location l on l.agent_id = a.id
      where p.active = true and p.role in ('delivery', 'manager', 'owner')
        and (not v_on or p.role <> 'delivery' or exists (select 1 from public.driver_cities dc where dc.profile_id = p.id and dc.city_id = v_city))
    ), '[]'::jsonb) end);
end $$;

-- assign_delivery: IDENTICAL to the original (0003) with one addition, the city rule. Signature unchanged.
create or replace function public.assign_delivery(p_order uuid, p_assignee uuid, p_scheduled timestamptz, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_id uuid; v_name text; v_role public.app_role; v_on boolean;
begin
  if not public.has_permission('deliveries.assign') then raise exception 'You do not have permission to assign deliveries.'; end if;
  perform 1 from public.orders where id = p_order for update;
  v_o := (select o from public.orders o where o.id = p_order);
  if v_o.id is null then raise exception 'Order not found.'; end if;
  if v_o.status <> 'ready' then raise exception 'Only a sold order that is ready can be assigned (status is %).', v_o.status; end if;
  if exists (select 1 from public.deliveries where order_id = p_order and status <> 'failed') then raise exception 'This order already has a delivery.'; end if;
  v_name := (select coalesce(nullif(full_name,''), email) from public.profiles where id = p_assignee and active = true and role in ('delivery','manager','owner'));
  if v_name is null then raise exception 'Choose an active delivery staff member.'; end if;
  v_role := (select role from public.profiles where id = p_assignee);
  v_on := exists (select 1 from public.cities where active);
  if v_on then
    if v_o.city_id is null then raise exception 'Set the city of this order before assigning a driver.'; end if;
    if v_role = 'delivery' and not exists (select 1 from public.driver_cities where profile_id = p_assignee and city_id = v_o.city_id) then
      raise exception 'This driver does not serve the city of this order (%).', coalesce((select name from public.cities where id = v_o.city_id), 'unknown');
    end if;
  end if;
  insert into public.deliveries (order_id, assigned_to, status, scheduled_at, notes)
  values (p_order, p_assignee, 'assigned', p_scheduled, left(nullif(btrim(coalesce(p_notes,'')), ''), 500)) returning id into v_id;
  perform public.write_activity('delivery_assigned', 'delivery', 'Order ' || v_o.order_number || ' assigned to ' || v_name
    || case when v_on and v_role <> 'delivery' then ' (office staff, city rule not applied)' else '' end,
    jsonb_build_object('order_id', p_order, 'delivery_id', v_id, 'city_id', v_o.city_id));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Delivery list extras for the filters: city, area and "needs attention" (owner and manager only)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.ops_delivery_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_on boolean;
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  v_on := exists (select 1 from public.cities where active);
  return jsonb_build_object(
    'thresholds', jsonb_build_object('notAcceptedMinutes', 30),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'cityId', x.city_id, 'city', x.city, 'zone', x.zone, 'attention', to_jsonb(x.attention)))
      from (
        select d.id, o.city_id, c.name as city, z.name as zone,
          array_remove(array[
            case when d.status = 'assigned' and pr.accepted_at is null and d.created_at < now() - interval '30 minutes' then 'not_accepted' end,
            case when d.status in ('assigned', 'in_transit') and d.scheduled_at is not null and d.scheduled_at < now() then 'late' end,
            case when d.status = 'failed' and not exists (select 1 from public.deliveries d2 where d2.order_id = d.order_id and d2.status <> 'failed') then 'failed_open' end,
            case when d.status in ('assigned', 'in_transit') and not exists (
                select 1 from public.delivery_points(d.id) pt
                where pt.supplier_lat is not null and pt.supplier_lng is not null and pt.customer_lat is not null and pt.customer_lng is not null) then 'no_pins' end,
            case when v_on and o.city_id is null and d.status in ('assigned', 'in_transit') then 'no_city' end
          ], null) as attention
        from public.deliveries d
        join public.orders o on o.id = d.order_id
        left join public.cities c on c.id = o.city_id
        left join public.city_zones z on z.id = o.zone_id
        left join public.delivery_progress pr on pr.delivery_id = d.id
        order by d.created_at desc limit 500
      ) x
    ), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Permissions: callable only by the right people, never by guests (except the two checkout functions)
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'ops_cities()', 'ops_save_city(uuid, text, boolean)', 'ops_save_zone(uuid, uuid, text, boolean)', 'ops_driver_load()',
    'ops_set_driver_cities(uuid, uuid[])', 'ops_set_order_city(uuid, uuid, uuid)', 'ops_assign_candidates(uuid)', 'ops_delivery_list()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['public_cities()', 'set_order_city(text, text, uuid, uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to anon, authenticated';
  end loop;
end $$;
