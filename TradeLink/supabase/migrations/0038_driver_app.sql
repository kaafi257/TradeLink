-- Driver app: accept or reject a job, picked up, proof photo, earnings, history, driver profile, problem reports,
-- notifications, and live tracking for the customer. ADDITIVE: new tables and functions, one new trigger.
-- Existing delivery statuses (pending, assigned, in_transit, delivered, failed) are unchanged; extra steps live in delivery_progress.

alter table public.delivery_agents add column if not exists photo text check (photo is null or char_length(photo) <= 400000);
alter table public.delivery_agents add column if not exists plate text check (plate is null or char_length(plate) <= 20);
alter table public.delivery_agents add column if not exists verified boolean not null default false;

create table if not exists public.delivery_progress (
  delivery_id uuid primary key references public.deliveries(id) on delete cascade,
  accepted_at timestamptz,
  picked_up_at timestamptz,
  rejected_at timestamptz,
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 300),
  driver_fee numeric(12,2) check (driver_fee is null or driver_fee >= 0),
  proof_photo text check (proof_photo is null or char_length(proof_photo) <= 900000),
  updated_at timestamptz not null default now()
);
create table if not exists public.delivery_issues (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references public.deliveries(id) on delete set null,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('customer_unreachable', 'wrong_address', 'vehicle_problem', 'safety', 'other')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
alter table public.delivery_progress enable row level security;
alter table public.delivery_issues enable row level security;
revoke all on public.delivery_progress, public.delivery_issues from anon, authenticated, public;

-- ---------- notifications ----------
create or replace function public.notify_managers(p_kind text, p_title text, p_body text default null, p_link text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.profiles where active = true and role in ('owner', 'manager') loop
    perform public.notify(r.id, p_kind, p_title, p_body, p_link);
  end loop;
end $$;
revoke all on function public.notify_managers(text, text, text, text) from public, anon, authenticated;

create or replace function public.deliveries_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_no text;
begin
  v_no := (select order_number from public.orders where id = new.order_id);
  if (tg_op = 'INSERT' or old.assigned_to is distinct from new.assigned_to) and new.assigned_to is not null and new.status = 'assigned' then
    perform public.notify(new.assigned_to, 'delivery_new', 'New delivery request', 'Order ' || coalesce(v_no, '') || '. Open Deliveries to accept or reject it.', '/admin/deliveries');
  end if;
  if tg_op = 'UPDATE' and new.status = 'delivered' and old.status <> 'delivered' then
    perform public.notify_managers('delivery_done', 'Delivered', 'Order ' || coalesce(v_no, '') || ' was delivered.', '/admin/deliveries');
  end if;
  return new;
end $$;
drop trigger if exists deliveries_notify_trg on public.deliveries;
create trigger deliveries_notify_trg after insert or update on public.deliveries for each row execute function public.deliveries_notify();

-- ---------- the driver's steps ----------
create or replace function public.driver_respond(p_delivery uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_no text; v_why text := left(nullif(btrim(coalesce(p_reason, '')), ''), 300);
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  v_d := (select d from public.deliveries d where d.id = p_delivery and d.assigned_to = auth.uid() and d.status = 'assigned');
  if v_d.id is null then raise exception 'This delivery is not waiting for your answer.'; end if;
  v_no := (select order_number from public.orders where id = v_d.order_id);
  if p_accept then
    insert into public.delivery_progress (delivery_id, accepted_at) values (p_delivery, now())
    on conflict (delivery_id) do update set accepted_at = coalesce(public.delivery_progress.accepted_at, now()), updated_at = now();
    perform public.notify_managers('delivery_accepted', 'Driver accepted', 'Order ' || coalesce(v_no, '') || ' was accepted by the driver.', '/admin/deliveries');
  else
    -- Rejecting hands the order back: the delivery fails, the order returns to ready, and staff can assign it again.
    insert into public.delivery_progress (delivery_id, rejected_at, reject_reason) values (p_delivery, now(), v_why)
    on conflict (delivery_id) do update set rejected_at = now(), reject_reason = v_why, updated_at = now();
    update public.deliveries set status = 'failed', notes = left('Rejected by driver' || coalesce(': ' || v_why, ''), 500) where id = p_delivery;
    update public.orders set status = 'ready' where id = v_d.order_id;
    perform public.notify_managers('delivery_rejected', 'Driver rejected a delivery', 'Order ' || coalesce(v_no, '') || coalesce('. Reason: ' || v_why, '') || '. Assign it to someone else.', '/admin/orders');
  end if;
end $$;

create or replace function public.driver_mark_picked_up(p_delivery uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.deliveries d join public.delivery_progress p on p.delivery_id = d.id
                 where d.id = p_delivery and d.assigned_to = auth.uid() and d.status = 'assigned' and p.accepted_at is not null) then
    raise exception 'Accept the delivery first.';
  end if;
  update public.delivery_progress set picked_up_at = coalesce(picked_up_at, now()), updated_at = now() where delivery_id = p_delivery;
end $$;

create or replace function public.driver_start(p_delivery uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.delivery_progress where delivery_id = p_delivery and picked_up_at is not null)
     or not exists (select 1 from public.deliveries where id = p_delivery and assigned_to = auth.uid() and status = 'assigned') then
    raise exception 'Mark the order as picked up first.';
  end if;
  perform public.update_delivery(p_delivery, 'in_transit', null);
end $$;

create or replace function public.driver_complete(p_delivery uuid, p_photo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.deliveries where id = p_delivery and assigned_to = auth.uid() and status = 'in_transit') then raise exception 'This delivery is not on the way.'; end if;
  if p_photo is null or p_photo !~ '^data:image/(jpeg|png|webp);base64,' or char_length(p_photo) < 1000 or char_length(p_photo) > 900000 then
    raise exception 'Take a clear photo of the delivered order first.';
  end if;
  update public.delivery_progress set proof_photo = p_photo, updated_at = now() where delivery_id = p_delivery;
  if not found then insert into public.delivery_progress (delivery_id, proof_photo) values (p_delivery, p_photo); end if;
  perform public.update_delivery(p_delivery, 'delivered', null);
end $$;

create or replace function public.driver_fail(p_delivery uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.deliveries where id = p_delivery and assigned_to = auth.uid() and status in ('assigned', 'in_transit')) then raise exception 'This delivery is not yours to cancel.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Tell us why it could not be delivered.'; end if;
  perform public.update_delivery(p_delivery, 'failed', left(btrim(p_reason), 300));
  perform public.notify_managers('delivery_failed', 'Delivery could not be completed', left(btrim(p_reason), 200), '/admin/deliveries');
end $$;

create or replace function public.driver_report_issue(p_delivery uuid, p_kind text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_no text; v_name text;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and active = true and role in ('delivery', 'owner', 'manager')) then raise exception 'Not allowed.'; end if;
  if p_kind not in ('customer_unreachable', 'wrong_address', 'vehicle_problem', 'safety', 'other') then raise exception 'Choose a problem type.'; end if;
  insert into public.delivery_issues (delivery_id, driver_id, kind, note) values (p_delivery, auth.uid(), p_kind, left(nullif(btrim(coalesce(p_note, '')), ''), 500));
  v_no := (select o.order_number from public.deliveries d join public.orders o on o.id = d.order_id where d.id = p_delivery);
  v_name := (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid());
  perform public.notify_managers('delivery_issue', 'Driver reported a problem', coalesce(v_name, 'A driver') || ': ' || replace(p_kind, '_', ' ') || coalesce(' (order ' || v_no || ')', '') || coalesce('. ' || nullif(btrim(coalesce(p_note, '')), ''), ''), '/admin/deliveries');
end $$;

-- ---------- the driver's screens ----------
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
        'notes', o.delivery_notes, 'accepted', pr.accepted_at is not null, 'pickedUp', pr.picked_up_at is not null, 'fee', pr.driver_fee, 'createdAt', d.created_at,
        'items', coalesce((select string_agg(oi.quantity || ' ' || oi.unit || ' ' || oi.product_name, ', ') from public.order_items oi where oi.order_id = o.id), ''),
        'supplier', case when x.supplier_lat is null then null else jsonb_build_object('name', coalesce(x.supplier_name, 'Pickup'), 'lat', x.supplier_lat, 'lng', x.supplier_lng) end,
        'dropoff', case when x.customer_lat is null then null else jsonb_build_object('lat', x.customer_lat, 'lng', x.customer_lng) end
      ) order by d.created_at)
      from public.deliveries d join public.orders o on o.id = d.order_id
      left join public.delivery_progress pr on pr.delivery_id = d.id
      cross join lateral public.delivery_points(d.id) x
      where d.assigned_to = auth.uid() and d.status in ('assigned', 'in_transit')
    ), '[]'::jsonb));
end $$;

create or replace function public.driver_history(p_limit integer default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  return coalesce((
    select jsonb_agg(h order by (h->>'at') desc) from (
      select jsonb_build_object('id', d.id, 'ref', o.order_number, 'customer', o.customer_name, 'address', coalesce(o.delivery_location, ''), 'status', d.status,
        'rejected', pr.rejected_at is not null, 'fee', pr.driver_fee, 'note', d.notes, 'at', coalesce(d.delivered_at, pr.rejected_at, d.created_at)) as h
      from public.deliveries d join public.orders o on o.id = d.order_id left join public.delivery_progress pr on pr.delivery_id = d.id
      where d.assigned_to = auth.uid() and d.status in ('delivered', 'failed')
      order by coalesce(d.delivered_at, pr.rejected_at, d.created_at) desc limit greatest(1, least(coalesce(p_limit, 60), 200))
    ) q), '[]'::jsonb);
end $$;

create or replace function public.driver_earnings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tz text := 'Africa/Addis_Ababa'; v_today date := (now() at time zone 'Africa/Addis_Ababa')::date;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  return (
    with mine as (
      select (d.delivered_at at time zone v_tz)::date as day, coalesce(pr.driver_fee, 0) as fee, pr.driver_fee is null as unpriced
      from public.deliveries d left join public.delivery_progress pr on pr.delivery_id = d.id
      where d.assigned_to = auth.uid() and d.status = 'delivered' and d.delivered_at is not null
    )
    select jsonb_build_object(
      'today', jsonb_build_object('amount', coalesce(sum(fee) filter (where day = v_today), 0), 'count', count(*) filter (where day = v_today)),
      'week', jsonb_build_object('amount', coalesce(sum(fee) filter (where day > v_today - 7), 0), 'count', count(*) filter (where day > v_today - 7)),
      'month', jsonb_build_object('amount', coalesce(sum(fee) filter (where date_trunc('month', day) = date_trunc('month', v_today)), 0), 'count', count(*) filter (where date_trunc('month', day) = date_trunc('month', v_today))),
      'unpriced', count(*) filter (where unpriced and date_trunc('month', day) = date_trunc('month', v_today)),
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', g.day, 'amount', coalesce(s.amount, 0), 'count', coalesce(s.n, 0)) order by g.day)
                        from generate_series(v_today - 13, v_today, interval '1 day') as g(day)
                        left join (select day, sum(fee) as amount, count(*) as n from mine group by day) s on s.day = g.day::date), '[]'::jsonb)
    ) from mine);
end $$;

create or replace function public.driver_profile() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_p public.profiles%rowtype; v_a public.delivery_agents%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  v_p := (select p from public.profiles p where p.id = auth.uid());
  v_a := (select a from public.delivery_agents a where a.profile_id = auth.uid());
  return jsonb_build_object('name', coalesce(nullif(btrim(v_p.full_name), ''), v_p.email), 'email', v_p.email, 'phone', v_a.phone, 'vehicle', coalesce(v_a.vehicle, 'Motorbike'),
    'plate', v_a.plate, 'photo', v_a.photo, 'verified', coalesce(v_a.verified, false),
    'delivered', (select count(*) from public.deliveries where assigned_to = auth.uid() and status = 'delivered'));
end $$;

create or replace function public.driver_update_profile(p_phone text, p_vehicle text, p_plate text, p_photo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_p public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  v_p := (select p from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('delivery', 'owner', 'manager'));
  if v_p.id is null then raise exception 'This account cannot be a delivery driver.'; end if;
  if p_photo is not null and (p_photo !~ '^data:image/(jpeg|png|webp);base64,' or char_length(p_photo) > 400000) then raise exception 'That photo is too large.'; end if;
  insert into public.delivery_agents (profile_id, name, phone, vehicle, plate, photo, status)
  values (v_p.id, coalesce(nullif(btrim(v_p.full_name), ''), v_p.email, 'Driver'), left(nullif(btrim(coalesce(p_phone, '')), ''), 40), coalesce(left(nullif(btrim(p_vehicle), ''), 30), 'Motorbike'),
          left(nullif(btrim(coalesce(p_plate, '')), ''), 20), p_photo, 'offline')
  on conflict (profile_id) do update set phone = left(nullif(btrim(coalesce(p_phone, '')), ''), 40), vehicle = coalesce(left(nullif(btrim(p_vehicle), ''), 30), public.delivery_agents.vehicle),
    plate = left(nullif(btrim(coalesce(p_plate, '')), ''), 20), photo = coalesce(p_photo, public.delivery_agents.photo);
end $$;

-- ---------- staff side ----------
create or replace function public.ops_set_driver_fee(p_delivery uuid, p_fee numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 1000000 then raise exception 'Enter the driver pay in ETB.'; end if;
  if not exists (select 1 from public.deliveries where id = p_delivery) then raise exception 'Delivery not found.'; end if;
  insert into public.delivery_progress (delivery_id, driver_fee) values (p_delivery, round(p_fee, 2))
  on conflict (delivery_id) do update set driver_fee = round(p_fee, 2), updated_at = now();
end $$;

-- Progress for the staff delivery list (no photos here, they are fetched one at a time).
create or replace function public.ops_delivery_progress() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', delivery_id, 'accepted', accepted_at is not null, 'pickedUp', picked_up_at is not null, 'fee', driver_fee, 'hasProof', proof_photo is not null)) from public.delivery_progress), '[]'::jsonb);
end $$;
create or replace function public.ops_delivery_proof(p_delivery uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return (select proof_photo from public.delivery_progress where delivery_id = p_delivery);
end $$;

create or replace function public.ops_drivers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'phone', a.phone, 'vehicle', a.vehicle, 'plate', a.plate, 'verified', a.verified, 'hasPhoto', a.photo is not null) order by a.name) from public.delivery_agents a), '[]'::jsonb);
end $$;
create or replace function public.ops_set_driver_verified(p_agent uuid, p_verified boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.ops_can_manage() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update public.delivery_agents set verified = coalesce(p_verified, false) where id = p_agent;
end $$;

-- ---------- the customer sees the driver while the order is on the way ----------
create or replace function public.track_driver(p_number text, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_d public.deliveries%rowtype; v_a public.delivery_agents%rowtype; v_l public.delivery_live_location%rowtype; v_pr public.delivery_progress%rowtype;
        v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'); v_dlat double precision; v_dlng double precision; v_stage text;
begin
  v_o := (select o from public.orders o where o.order_number = upper(btrim(coalesce(p_number, ''))) and o.channel = 'checkout' and char_length(v_phone) >= 6 and right(o.phone, 9) = right(v_phone, 9));
  if v_o.id is null then raise exception 'We could not find an order with those details.'; end if;
  v_d := (select d from public.deliveries d where d.order_id = v_o.id and d.status <> 'failed' order by d.created_at desc limit 1);
  if v_d.id is null then return null; end if;
  v_pr := (select p from public.delivery_progress p where p.delivery_id = v_d.id);
  v_stage := case v_d.status when 'delivered' then 'delivered' when 'in_transit' then 'on_the_way' when 'assigned' then case when v_pr.picked_up_at is not null then 'picked_up' when v_pr.accepted_at is not null then 'accepted' else 'assigned' end else 'preparing' end;
  if v_stage <> 'on_the_way' then return jsonb_build_object('stage', v_stage); end if;
  v_a := (select a from public.delivery_agents a where a.profile_id = v_d.assigned_to);
  v_l := (select l from public.delivery_live_location l where l.agent_id = v_a.id);
  v_dlat := (select customer_lat from public.delivery_points(v_d.id));
  v_dlng := (select customer_lng from public.delivery_points(v_d.id));
  return jsonb_build_object('stage', v_stage, 'driverName', split_part(coalesce(v_a.name, 'Driver'), ' ', 1), 'vehicle', v_a.vehicle, 'verified', coalesce(v_a.verified, false),
    'lat', v_l.lat, 'lng', v_l.lng, 'updatedAt', v_l.updated_at, 'dropLat', v_dlat, 'dropLng', v_dlng);
end $$;
revoke all on function public.track_driver(text, text) from public;
grant execute on function public.track_driver(text, text) to anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'driver_respond(uuid, boolean, text)', 'driver_mark_picked_up(uuid)', 'driver_start(uuid)', 'driver_complete(uuid, text)', 'driver_fail(uuid, text)', 'driver_report_issue(uuid, text, text)',
    'driver_my_jobs()', 'driver_history(integer)', 'driver_earnings()', 'driver_profile()', 'driver_update_profile(text, text, text, text)',
    'ops_set_driver_fee(uuid, numeric)', 'ops_delivery_progress()', 'ops_delivery_proof(uuid)', 'ops_drivers()', 'ops_set_driver_verified(uuid, boolean)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
