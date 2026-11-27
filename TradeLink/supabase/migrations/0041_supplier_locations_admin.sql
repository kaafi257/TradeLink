-- A supplier saves their shop location ONCE. After that only the owner or a manager can change it.
-- Owner and manager also get one call that returns every supplier (with logo, status, contact and saved location)
-- and the extra driver facts (verified, plate, photo flag) for the live map.
-- ADDITIVE: replaces supplier_set_shop_location (same signature) and adds two functions.

create or replace function public.supplier_set_shop_location(p_lat double precision, p_lng double precision, p_accuracy real default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  v_sup := public.my_supplier_id();
  if v_sup is null then raise exception 'This account is not a supplier.'; end if;
  if exists (select 1 from public.supplier_locations where supplier_id = v_sup) then
    raise exception 'Your shop location is already saved and locked. Contact TradeLink to change it.';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid position.'; end if;
  if p_accuracy is not null and p_accuracy > 150 then raise exception 'The GPS signal is too weak. Go outside or near a window and try again.'; end if;
  insert into public.supplier_locations (supplier_id, lat, lng, accuracy_m, captured_at) values (v_sup, p_lat, p_lng, p_accuracy, now());
end $$;

-- Owner or manager sets or changes any supplier's location.
create or replace function public.ops_set_supplier_location(p_supplier uuid, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not exists (select 1 from public.suppliers where id = p_supplier) then raise exception 'Supplier not found.'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid position.'; end if;
  insert into public.supplier_locations (supplier_id, lat, lng, accuracy_m, captured_at) values (p_supplier, p_lat, p_lng, 5, now())
  on conflict (supplier_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = 5, captured_at = now();
end $$;

-- Everything the admin map needs about suppliers and drivers beyond the live snapshot.
create or replace function public.ops_map_places() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'suppliers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'owner', s.owner_name, 'phone', s.phone, 'email', s.email, 'businessType', s.business_type, 'address', coalesce(s.address, s.location),
        'status', s.status, 'active', s.active, 'logo', s.logo_path, 'lat', l.lat, 'lng', l.lng, 'accuracy', l.accuracy_m, 'capturedAt', l.captured_at,
        'openJobs', (select count(distinct d.id) from public.deliveries d join public.order_items oi on oi.order_id = d.order_id join public.products pr on pr.id = oi.product_id
                     where pr.supplier_id = s.id and d.status in ('pending', 'assigned', 'in_transit'))
      ) order by s.name)
      from public.suppliers s left join public.supplier_locations l on l.supplier_id = s.id
      where s.status <> 'rejected'
    ), '[]'::jsonb),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'verified', a.verified, 'plate', a.plate, 'hasPhoto', a.photo is not null,
        'deliveries', (select count(*) from public.deliveries d where d.assigned_to = a.profile_id and d.status = 'delivered')))
      from public.delivery_agents a
    ), '[]'::jsonb));
end $$;

-- Driver photos, fetched once by the admin map (they are too large to poll).
create or replace function public.ops_driver_photos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return coalesce((select jsonb_object_agg(a.id::text, a.photo) from public.delivery_agents a where a.photo is not null), '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array['ops_set_supplier_location(uuid, double precision, double precision)', 'ops_map_places()', 'ops_driver_photos()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
