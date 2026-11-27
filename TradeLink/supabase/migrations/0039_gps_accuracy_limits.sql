-- Reject rough GPS readings so a saved shop or delivery point is the real place, not a guess.
-- Shop location: accuracy must be 150 m or better. Customer delivery point: 300 m or better.
-- Re-creates two functions from 0037 with the stricter limit. Nothing else changes.

create or replace function public.supplier_set_shop_location(p_lat double precision, p_lng double precision, p_accuracy real default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  v_sup := public.my_supplier_id();
  if v_sup is null then raise exception 'This account is not a supplier.'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid position.'; end if;
  if p_accuracy is not null and p_accuracy > 150 then raise exception 'The GPS signal is too weak. Go outside or near a window and try again.'; end if;
  insert into public.supplier_locations (supplier_id, lat, lng, accuracy_m, captured_at) values (v_sup, p_lat, p_lng, p_accuracy, now())
  on conflict (supplier_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, captured_at = now();
end $$;

create or replace function public.set_order_location(p_number text, p_phone text, p_lat double precision, p_lng double precision, p_accuracy real default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid position.'; end if;
  if p_accuracy is not null and p_accuracy > 300 then raise exception 'The GPS signal is too weak.'; end if;
  v_id := (select o.id from public.orders o where o.order_number = upper(btrim(coalesce(p_number, ''))) and o.channel = 'checkout'
           and char_length(v_phone) >= 6 and right(o.phone, 9) = right(v_phone, 9));
  if v_id is null then raise exception 'We could not find an order with those details.'; end if;
  insert into public.order_locations (order_id, lat, lng, accuracy_m, captured_at) values (v_id, p_lat, p_lng, p_accuracy, now())
  on conflict (order_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, captured_at = now();
end $$;
