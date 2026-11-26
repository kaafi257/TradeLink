-- Saved GPS for every party of a delivery. ADDITIVE: two new tables, new functions, and delivery functions replaced.
--  * a supplier saves the GPS of their shop (they must be standing in it) at registration or from Business profile;
--  * a customer shares GPS when placing the order, so the driver knows where to drop off;
--  * a delivery's pickup defaults to the supplier's shop and its drop-off to the customer's GPS; staff or the driver can still override with a pin.
-- Nothing is readable directly: the tables have no policies and no grants, only the functions below can touch them.

create table if not exists public.supplier_locations (
  supplier_id uuid primary key references public.suppliers(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  captured_at timestamptz not null default now()
);
create table if not exists public.order_locations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  captured_at timestamptz not null default now()
);
alter table public.supplier_locations enable row level security;
alter table public.order_locations enable row level security;
revoke all on public.supplier_locations, public.order_locations from anon, authenticated, public;

-- A supplier saves the GPS of their shop.
create or replace function public.supplier_set_shop_location(p_lat double precision, p_lng double precision, p_accuracy real default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  v_sup := public.my_supplier_id();
  if v_sup is null then raise exception 'This account is not a supplier.'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid position.'; end if;
  if p_accuracy is not null and p_accuracy > 1000 then raise exception 'The GPS signal is too weak. Move near a window or outside and try again.'; end if;
  insert into public.supplier_locations (supplier_id, lat, lng, accuracy_m, captured_at) values (v_sup, p_lat, p_lng, p_accuracy, now())
  on conflict (supplier_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, captured_at = now();
end $$;
revoke all on function public.supplier_set_shop_location(double precision, double precision, real) from public, anon;
grant execute on function public.supplier_set_shop_location(double precision, double precision, real) to authenticated;

-- The supplier's own saved shop location (for Business profile).
create or replace function public.supplier_my_shop_location() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when l.supplier_id is null then null else jsonb_build_object('lat', l.lat, 'lng', l.lng, 'accuracy', l.accuracy_m, 'capturedAt', l.captured_at) end
  from public.suppliers s left join public.supplier_locations l on l.supplier_id = s.id where s.id = public.my_supplier_id()
$$;
revoke all on function public.supplier_my_shop_location() from public, anon;
grant execute on function public.supplier_my_shop_location() to authenticated;

-- A customer shares GPS for an order. Proved by order number plus the phone used for it, the same check as tracking an order.
create or replace function public.set_order_location(p_number text, p_phone text, p_lat double precision, p_lng double precision, p_accuracy real default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid position.'; end if;
  if p_accuracy is not null and p_accuracy > 5000 then raise exception 'The GPS signal is too weak.'; end if;
  v_id := (select o.id from public.orders o where o.order_number = upper(btrim(coalesce(p_number, ''))) and o.channel = 'checkout'
           and char_length(v_phone) >= 6 and right(o.phone, 9) = right(v_phone, 9));
  if v_id is null then raise exception 'We could not find an order with those details.'; end if;
  insert into public.order_locations (order_id, lat, lng, accuracy_m, captured_at) values (v_id, p_lat, p_lng, p_accuracy, now())
  on conflict (order_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, captured_at = now();
end $$;
revoke all on function public.set_order_location(text, text, double precision, double precision, real) from public;
grant execute on function public.set_order_location(text, text, double precision, double precision, real) to anon, authenticated;

-- The points of a delivery: a pin wins; otherwise the supplier's shop GPS and the customer's GPS. Internal helper.
create or replace function public.delivery_points(p_delivery uuid)
returns table (supplier_name text, supplier_lat double precision, supplier_lng double precision, customer_lat double precision, customer_lng double precision, promised_at timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(p.supplier_name, s.name), coalesce(p.supplier_lat, s.lat), coalesce(p.supplier_lng, s.lng),
         coalesce(p.customer_lat, ol.lat), coalesce(p.customer_lng, ol.lng), p.promised_at
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  left join public.delivery_pins p on p.delivery_id = d.id
  left join public.order_locations ol on ol.order_id = o.id
  left join lateral (
    select su.name, sl.lat, sl.lng
    from public.order_items oi join public.products pr on pr.id = oi.product_id join public.suppliers su on su.id = pr.supplier_id
    left join public.supplier_locations sl on sl.supplier_id = su.id
    where oi.order_id = o.id order by (sl.lat is null), oi.id limit 1
  ) s on true
  where d.id = p_delivery
$$;
revoke all on function public.delivery_points(uuid) from public, anon, authenticated;

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
        'fee', 0, 'distanceKm', null, 'readyAt', d.created_at, 'promisedAt', coalesce(x.promised_at, d.scheduled_at),
        'supplier', jsonb_build_object('name', coalesce(x.supplier_name, 'Pickup'), 'lat', x.supplier_lat, 'lng', x.supplier_lng),
        'customer', jsonb_build_object('name', o.customer_name, 'area', coalesce(o.delivery_location, ''), 'lat', x.customer_lat, 'lng', x.customer_lng)
      ) order by d.created_at)
      from public.deliveries d join public.orders o on o.id = d.order_id cross join lateral public.delivery_points(d.id) x
      where d.status in ('pending', 'assigned', 'in_transit') and x.supplier_lat is not null and x.customer_lat is not null
    ), '[]'::jsonb),
    'unpinned', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'ref', o.order_number, 'customer', o.customer_name, 'area', coalesce(o.delivery_location, ''), 'status', d.status,
        'missing', case when x.supplier_lat is null and x.customer_lat is null then 'both' when x.supplier_lat is null then 'pickup' else 'dropoff' end) order by d.created_at)
      from public.deliveries d join public.orders o on o.id = d.order_id cross join lateral public.delivery_points(d.id) x
      where d.status in ('pending', 'assigned', 'in_transit') and (x.supplier_lat is null or x.customer_lat is null)
    ), '[]'::jsonb)
  );
  return result;
end $$;

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
        'supplier', case when x.supplier_lat is null then null else jsonb_build_object('name', coalesce(x.supplier_name, 'Pickup'), 'lat', x.supplier_lat, 'lng', x.supplier_lng) end,
        'dropoff', case when x.customer_lat is null then null else jsonb_build_object('lat', x.customer_lat, 'lng', x.customer_lng) end
      ) order by d.created_at)
      from public.deliveries d join public.orders o on o.id = d.order_id cross join lateral public.delivery_points(d.id) x
      where d.assigned_to = auth.uid() and d.status in ('assigned', 'in_transit')
    ), '[]'::jsonb));
end $$;
