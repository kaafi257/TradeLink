-- Lets a pickup or drop-off point be saved on its own, so the assigned driver can mark either one with their phone GPS.
-- ADDITIVE: relaxes NOT NULL on the pin columns and replaces three delivery functions. Nothing outside delivery changes.

alter table public.delivery_pins alter column supplier_name drop not null;
alter table public.delivery_pins alter column supplier_lat drop not null;
alter table public.delivery_pins alter column supplier_lng drop not null;
alter table public.delivery_pins alter column customer_lat drop not null;
alter table public.delivery_pins alter column customer_lng drop not null;

-- Staff pins (owner/manager): either side may be left empty and filled later.
create or replace function public.ops_set_pins(p_delivery uuid, p_supplier_name text, p_supplier_lat double precision, p_supplier_lng double precision,
                                               p_customer_lat double precision, p_customer_lng double precision, p_promised timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not exists (select 1 from public.deliveries where id = p_delivery) then raise exception 'Delivery not found.'; end if;
  if (p_supplier_lat is null) <> (p_supplier_lng is null) or (p_customer_lat is null) <> (p_customer_lng is null) then raise exception 'Invalid map position.'; end if;
  if p_supplier_lat not between -90 and 90 or p_customer_lat not between -90 and 90 or p_supplier_lng not between -180 and 180 or p_customer_lng not between -180 and 180 then raise exception 'Invalid map position.'; end if;
  insert into public.delivery_pins (delivery_id, supplier_name, supplier_lat, supplier_lng, customer_lat, customer_lng, promised_at, updated_at)
  values (p_delivery, nullif(btrim(coalesce(p_supplier_name, '')), ''), p_supplier_lat, p_supplier_lng, p_customer_lat, p_customer_lng, p_promised, now())
  on conflict (delivery_id) do update set supplier_name = excluded.supplier_name, supplier_lat = excluded.supplier_lat, supplier_lng = excluded.supplier_lng,
    customer_lat = excluded.customer_lat, customer_lng = excluded.customer_lng, promised_at = excluded.promised_at, updated_at = now();
end $$;

-- The assigned driver marks the pickup or the drop-off with the phone GPS. Only their own open delivery, only that one point.
create or replace function public.driver_set_pin(p_delivery uuid, p_kind text, p_lat double precision, p_lng double precision, p_supplier_name text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if p_kind not in ('pickup', 'dropoff') then raise exception 'Invalid pin.'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid position.'; end if;
  if not exists (select 1 from public.deliveries where id = p_delivery and assigned_to = auth.uid() and status in ('assigned', 'in_transit')) then
    raise exception 'This delivery is not assigned to you.' using errcode = '42501';
  end if;
  if p_kind = 'pickup' then
    insert into public.delivery_pins (delivery_id, supplier_name, supplier_lat, supplier_lng) values (p_delivery, nullif(btrim(coalesce(p_supplier_name, '')), ''), p_lat, p_lng)
    on conflict (delivery_id) do update set supplier_lat = p_lat, supplier_lng = p_lng, supplier_name = coalesce(nullif(btrim(coalesce(p_supplier_name, '')), ''), public.delivery_pins.supplier_name), updated_at = now();
  else
    insert into public.delivery_pins (delivery_id, customer_lat, customer_lng) values (p_delivery, p_lat, p_lng)
    on conflict (delivery_id) do update set customer_lat = p_lat, customer_lng = p_lng, updated_at = now();
  end if;
end $$;
revoke all on function public.driver_set_pin(uuid, text, double precision, double precision, text) from public, anon;
grant execute on function public.driver_set_pin(uuid, text, double precision, double precision, text) to authenticated;

-- Driver's own list: points may be missing until someone marks them.
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
        'supplier', case when p.supplier_lat is null then null else jsonb_build_object('name', coalesce(p.supplier_name, 'Pickup'), 'lat', p.supplier_lat, 'lng', p.supplier_lng) end,
        'dropoff', case when p.customer_lat is null then null else jsonb_build_object('lat', p.customer_lat, 'lng', p.customer_lng) end
      ) order by d.created_at)
      from public.deliveries d join public.orders o on o.id = d.order_id left join public.delivery_pins p on p.delivery_id = d.id
      where d.assigned_to = auth.uid() and d.status in ('assigned', 'in_transit')
    ), '[]'::jsonb));
end $$;

-- Live snapshot: a job is on the map only when both points exist; otherwise it is listed as "unpinned" with what is missing.
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
        'supplier', jsonb_build_object('name', coalesce(p.supplier_name, 'Pickup'), 'lat', p.supplier_lat, 'lng', p.supplier_lng),
        'customer', jsonb_build_object('name', o.customer_name, 'area', coalesce(o.delivery_location, ''), 'lat', p.customer_lat, 'lng', p.customer_lng)
      ) order by d.created_at)
      from public.deliveries d join public.orders o on o.id = d.order_id join public.delivery_pins p on p.delivery_id = d.id
      where d.status in ('pending', 'assigned', 'in_transit') and p.supplier_lat is not null and p.customer_lat is not null
    ), '[]'::jsonb),
    'unpinned', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'ref', o.order_number, 'customer', o.customer_name, 'area', coalesce(o.delivery_location, ''), 'status', d.status,
        'missing', case when p.supplier_lat is null and p.customer_lat is null then 'both' when p.supplier_lat is null then 'pickup' else 'dropoff' end) order by d.created_at)
      from public.deliveries d join public.orders o on o.id = d.order_id left join public.delivery_pins p on p.delivery_id = d.id
      where d.status in ('pending', 'assigned', 'in_transit') and (p.delivery_id is null or p.supplier_lat is null or p.customer_lat is null)
    ), '[]'::jsonb)
  );
  return result;
end $$;
