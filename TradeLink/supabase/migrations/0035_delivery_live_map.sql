-- Delivery live map: drivers share their phone location, staff pin pickup and drop-off for a real delivery,
-- and the admin Live Map / Operations pages read one snapshot. ADDITIVE and re-runnable: new tables and functions
-- only; orders, deliveries, payments, products, auth and every existing policy are untouched.
-- A "driver" is a staff account with the delivery role. A job is a real row of public.deliveries.

create table if not exists public.delivery_agents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  phone text,
  vehicle text not null default 'Motorbike' check (char_length(vehicle) <= 30),
  status text not null default 'offline' check (status in ('free', 'offline')),
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_live_location (
  agent_id uuid primary key references public.delivery_agents(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  heading real check (heading is null or heading between 0 and 360),
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_pins (
  delivery_id uuid primary key references public.deliveries(id) on delete cascade,
  supplier_name text not null check (char_length(supplier_name) between 2 and 120),
  supplier_lat double precision not null check (supplier_lat between -90 and 90),
  supplier_lng double precision not null check (supplier_lng between -180 and 180),
  customer_lat double precision not null check (customer_lat between -90 and 90),
  customer_lng double precision not null check (customer_lng between -180 and 180),
  promised_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Nobody reads or writes these tables directly except through the functions below (security definer).
alter table public.delivery_agents enable row level security;
alter table public.delivery_live_location enable row level security;
alter table public.delivery_pins enable row level security;
revoke all on public.delivery_agents, public.delivery_live_location, public.delivery_pins from anon, authenticated, public;

create or replace function public.ops_can_manage() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.has_any_role(array['owner', 'manager']::public.app_role[]), false)
$$;
revoke all on function public.ops_can_manage() from public, anon;
grant execute on function public.ops_can_manage() to authenticated;

-- 1. Everything the Live Map and Operations pages show, in one call (owner and manager only).
create or replace function public.ops_live_snapshot() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  result := jsonb_build_object(
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'phone', a.phone, 'vehicle', a.vehicle,
        'status', case when a.status = 'offline' then 'offline'
                       when exists (select 1 from public.deliveries d where d.assigned_to = a.profile_id and d.status = 'in_transit') then 'delivering'
                       when exists (select 1 from public.deliveries d where d.assigned_to = a.profile_id and d.status = 'assigned') then 'to_pickup'
                       else 'free' end,
        'lat', l.lat, 'lng', l.lng, 'updatedAt', l.updated_at,
        'jobId', (select d.id from public.deliveries d where d.assigned_to = a.profile_id and d.status in ('assigned', 'in_transit') order by d.created_at limit 1)
      ) order by a.name)
      from public.delivery_agents a left join public.delivery_live_location l on l.agent_id = a.id
    ), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'ref', o.order_number,
        'status', case d.status when 'pending' then 'waiting' when 'assigned' then 'assigned' else 'picked_up' end,
        'agentId', (select a.id from public.delivery_agents a where a.profile_id = d.assigned_to),
        'items', coalesce((select string_agg(oi.quantity || ' ' || oi.unit || ' ' || oi.product_name, ', ') from public.order_items oi where oi.order_id = o.id), ''),
        'fee', 0, 'distanceKm', null, 'readyAt', d.created_at, 'promisedAt', coalesce(p.promised_at, d.scheduled_at),
        'supplier', jsonb_build_object('name', p.supplier_name, 'lat', p.supplier_lat, 'lng', p.supplier_lng),
        'customer', jsonb_build_object('name', o.customer_name, 'area', coalesce(o.delivery_location, ''), 'lat', p.customer_lat, 'lng', p.customer_lng)
      ) order by d.created_at)
      from public.deliveries d join public.orders o on o.id = d.order_id join public.delivery_pins p on p.delivery_id = d.id
      where d.status in ('pending', 'assigned', 'in_transit')
    ), '[]'::jsonb),
    'unpinned', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'ref', o.order_number, 'customer', o.customer_name, 'area', coalesce(o.delivery_location, ''), 'status', d.status) order by d.created_at)
      from public.deliveries d join public.orders o on o.id = d.order_id
      where d.status in ('pending', 'assigned', 'in_transit') and not exists (select 1 from public.delivery_pins p where p.delivery_id = d.id)
    ), '[]'::jsonb)
  );
  return result;
end $$;
revoke all on function public.ops_live_snapshot() from public, anon;
grant execute on function public.ops_live_snapshot() to authenticated;

-- 2. Staff set the pickup and drop-off points of a real delivery (owner and manager only).
create or replace function public.ops_set_pins(p_delivery uuid, p_supplier_name text, p_supplier_lat double precision, p_supplier_lng double precision,
                                               p_customer_lat double precision, p_customer_lng double precision, p_promised timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not exists (select 1 from public.deliveries where id = p_delivery) then raise exception 'Delivery not found.'; end if;
  if p_supplier_lat is null or p_supplier_lng is null or p_customer_lat is null or p_customer_lng is null
     or p_supplier_lat not between -90 and 90 or p_customer_lat not between -90 and 90 or p_supplier_lng not between -180 and 180 or p_customer_lng not between -180 and 180 then
    raise exception 'Invalid map position.';
  end if;
  if char_length(btrim(coalesce(p_supplier_name, ''))) < 2 then raise exception 'Enter the pickup place name.'; end if;
  insert into public.delivery_pins (delivery_id, supplier_name, supplier_lat, supplier_lng, customer_lat, customer_lng, promised_at, updated_at)
  values (p_delivery, btrim(p_supplier_name), p_supplier_lat, p_supplier_lng, p_customer_lat, p_customer_lng, p_promised, now())
  on conflict (delivery_id) do update set supplier_name = excluded.supplier_name, supplier_lat = excluded.supplier_lat, supplier_lng = excluded.supplier_lng,
    customer_lat = excluded.customer_lat, customer_lng = excluded.customer_lng, promised_at = excluded.promised_at, updated_at = now();
end $$;
revoke all on function public.ops_set_pins(uuid, text, double precision, double precision, double precision, double precision, timestamptz) from public, anon;
grant execute on function public.ops_set_pins(uuid, text, double precision, double precision, double precision, double precision, timestamptz) to authenticated;

-- 3. A driver goes online or offline (creates their driver record on first use).
create or replace function public.driver_set_online(p_online boolean, p_vehicle text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_p public.profiles%rowtype; v_status text := case when p_online then 'free' else 'offline' end;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  v_p := (select p from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('delivery', 'owner', 'manager'));
  if v_p.id is null then raise exception 'This account cannot be a delivery driver.'; end if;
  insert into public.delivery_agents (profile_id, name, vehicle, status)
  values (v_p.id, coalesce(nullif(btrim(v_p.full_name), ''), v_p.email, 'Driver'), coalesce(nullif(btrim(p_vehicle), ''), 'Motorbike'), v_status)
  on conflict (profile_id) do update set status = v_status, vehicle = coalesce(nullif(btrim(p_vehicle), ''), public.delivery_agents.vehicle);
end $$;
revoke all on function public.driver_set_online(boolean, text) from public, anon;
grant execute on function public.driver_set_online(boolean, text) to authenticated;

-- 4. The driver's phone reports its position. It can only ever write the caller's own record, and only while online.
create or replace function public.agent_report_location(p_lat double precision, p_lng double precision, p_heading real default null, p_accuracy real default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_agent uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid position.'; end if;
  v_agent := (select a.id from public.delivery_agents a join public.profiles p on p.id = a.profile_id
              where a.profile_id = auth.uid() and p.active = true and a.status <> 'offline');
  if v_agent is null then raise exception 'Go online first.'; end if;
  insert into public.delivery_live_location (agent_id, lat, lng, heading, accuracy_m, updated_at) values (v_agent, p_lat, p_lng, p_heading, p_accuracy, now())
  on conflict (agent_id) do update set lat = excluded.lat, lng = excluded.lng, heading = excluded.heading, accuracy_m = excluded.accuracy_m, updated_at = now();
end $$;
revoke all on function public.agent_report_location(double precision, double precision, real, real) from public, anon;
grant execute on function public.agent_report_location(double precision, double precision, real, real) to authenticated;

-- 5. The driver's own screen: online state and only the deliveries assigned to them.
create or replace function public.driver_my_jobs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_agent public.delivery_agents%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  v_agent := (select a from public.delivery_agents a where a.profile_id = auth.uid());
  return jsonb_build_object(
    'online', coalesce(v_agent.status, 'offline') <> 'offline', 'vehicle', coalesce(v_agent.vehicle, 'Motorbike'),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'ref', o.order_number, 'status', d.status, 'customer', o.customer_name, 'phone', o.phone, 'address', coalesce(o.delivery_location, ''),
        'items', coalesce((select string_agg(oi.quantity || ' ' || oi.unit || ' ' || oi.product_name, ', ') from public.order_items oi where oi.order_id = o.id), ''),
        'supplier', case when p.delivery_id is null then null else jsonb_build_object('name', p.supplier_name, 'lat', p.supplier_lat, 'lng', p.supplier_lng) end,
        'dropoff', case when p.delivery_id is null then null else jsonb_build_object('lat', p.customer_lat, 'lng', p.customer_lng) end
      ) order by d.created_at)
      from public.deliveries d join public.orders o on o.id = d.order_id left join public.delivery_pins p on p.delivery_id = d.id
      where d.assigned_to = auth.uid() and d.status in ('assigned', 'in_transit')
    ), '[]'::jsonb));
end $$;
revoke all on function public.driver_my_jobs() from public, anon;
grant execute on function public.driver_my_jobs() to authenticated;
