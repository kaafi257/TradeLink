-- TradeLink delivery, Phase 2: customer code (OTP) on every delivery, secure server-side completion, manager override with a permanent
-- audit record, failure categories, retry / reassign. ADDITIVE and re-runnable. Existing data, statuses and table permissions are untouched.
-- Supabase SQL Editor: paste the whole file and press Run (run it right after the new app version is live).

-- ---------------------------------------------------------------------------------------------------------------------
-- 0. Safety guard: stop (changing nothing) if the live functions are not the ones this file was written against.
-- ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if position('cannot move to' in pg_get_functiondef('public.update_delivery(uuid,text,text)'::regprocedure)) = 0 then
    raise exception 'Stopped: the live update_delivery function is not the expected one. Nothing was changed. Send this message to your developer.';
  end if;
  if to_regprocedure('public.driver_complete(uuid,text)') is null or to_regprocedure('public.driver_fail(uuid,text)') is null or to_regprocedure('public.notify_managers(text,text,text,text)') is null then
    raise exception 'Stopped: run migrations up to 0042 first. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables (no direct access for anyone; everything goes through the functions below)
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.order_codes (
  order_id uuid primary key references public.orders(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$'),
  claimed boolean not null default false,          -- true: the customer's own device holds it. false: shown on the tracking page.
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  attempts integer not null default 0,
  lockouts integer not null default 0,
  locked_until timestamptz,
  verified_at timestamptz,
  reissued_at timestamptz
);

-- Permanent record of overrides and code re-issues. Nothing can edit or delete a row.
create table if not exists public.delivery_overrides (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('delivered', 'code_reissued')),
  delivery_id uuid,
  order_number text,
  actor uuid not null,
  actor_name text,
  reason text not null,
  created_at timestamptz not null default now()
);
create or replace function public.audit_rows_are_permanent() returns trigger language plpgsql as $$
begin raise exception 'Audit records cannot be changed or deleted.'; end $$;
drop trigger if exists delivery_overrides_permanent on public.delivery_overrides;
create trigger delivery_overrides_permanent before update or delete on public.delivery_overrides for each row execute function public.audit_rows_are_permanent();
drop trigger if exists delivery_overrides_no_truncate on public.delivery_overrides;
create trigger delivery_overrides_no_truncate before truncate on public.delivery_overrides for each statement execute function public.audit_rows_are_permanent();

alter table public.delivery_progress add column if not exists fail_category text;
alter table public.delivery_progress add column if not exists retry_of uuid references public.deliveries(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'delivery_progress_fail_category_check') then
    alter table public.delivery_progress add constraint delivery_progress_fail_category_check
      check (fail_category is null or fail_category in ('customer_unreachable', 'wrong_address', 'customer_refused', 'driver_problem', 'reassigned', 'other'));
  end if;
end $$;

alter table public.order_codes enable row level security;
alter table public.delivery_overrides enable row level security;
revoke all on public.order_codes, public.delivery_overrides from anon, authenticated, public;
revoke all on function public.audit_rows_are_permanent() from public, anon, authenticated;

-- Managers may override and re-issue codes (the owner always can).
insert into public.role_permissions (role, permission)
select 'manager', 'deliveries.override' where not exists (select 1 from public.role_permissions where role = 'manager' and permission = 'deliveries.override');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Internal helpers: not callable from the app (all execute rights revoked below)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._new_code() returns text language sql volatile as $$
  select lpad((abs(('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0')
$$;

-- The ONLY place that marks a delivery delivered. Reached only through the code check or the manager override.
create or replace function public._deliver(p_delivery uuid, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_no text;
begin
  perform 1 from public.deliveries where id = p_delivery for update;
  v_d := (select d from public.deliveries d where d.id = p_delivery);
  if v_d.id is null then raise exception 'Delivery not found.'; end if;
  if v_d.status not in ('assigned', 'in_transit') then raise exception 'A delivery that is % cannot be completed.', v_d.status; end if;
  perform 1 from public.orders where id = v_d.order_id for update;
  v_no := (select order_number from public.orders where id = v_d.order_id);
  update public.deliveries set status = 'delivered', delivered_at = now(), notes = coalesce(left(nullif(btrim(coalesce(p_notes, '')), ''), 500), notes) where id = p_delivery;
  update public.orders set status = 'completed' where id = v_d.order_id;
  perform public.write_activity('delivery_delivered', 'delivery', 'Delivery for order ' || v_no || ' is now delivered', jsonb_build_object('order_id', v_d.order_id, 'delivery_id', p_delivery));
end $$;

create or replace function public._ensure_order_code(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.order_codes (order_id, code, claimed) values (p_order, public._new_code(), false) on conflict (order_id) do nothing;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. update_delivery: unchanged EXCEPT it can no longer mark "delivered" (that needs the code or a manager override),
--    and a failure recorded by office staff now notifies the owner and managers.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.update_delivery(p_delivery uuid, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_o public.orders%rowtype;
begin
  perform 1 from public.deliveries where id = p_delivery for update;
  v_d := (select d from public.deliveries d where d.id = p_delivery);
  if v_d.id is null then raise exception 'Delivery not found.'; end if;
  if not (public.has_permission('deliveries.assign') or (public.has_permission('deliveries.update') and v_d.assigned_to = auth.uid())) then
    raise exception 'You do not have permission to update this delivery.';
  end if;
  if p_status = 'delivered' then
    raise exception 'A delivery is completed with the customer''s 6-digit code, or by a manager override with a written reason.';
  end if;
  if not ((v_d.status = 'assigned' and p_status in ('in_transit','failed')) or (v_d.status = 'in_transit' and p_status = 'failed')) then
    raise exception 'A delivery that is % cannot move to %.', v_d.status, p_status;
  end if;
  perform 1 from public.orders where id = v_d.order_id for update;
  v_o := (select o from public.orders o where o.id = v_d.order_id);
  update public.deliveries set status = p_status,
    notes = coalesce(left(nullif(btrim(coalesce(p_notes,'')), ''), 500), notes)
  where id = p_delivery;
  update public.orders set status = case p_status when 'in_transit' then 'dispatched' else 'ready' end where id = v_o.id;
  perform public.write_activity('delivery_' || p_status, 'delivery', 'Delivery for order ' || v_o.order_number || ' is now ' || replace(p_status, '_', ' '), jsonb_build_object('order_id', v_o.id, 'delivery_id', p_delivery));
  -- A failure entered by the driver is announced by driver_fail; one entered by office staff is announced here.
  if p_status = 'failed' and v_d.assigned_to is distinct from auth.uid() then
    perform public.notify_managers('delivery_failed', 'Delivery could not be completed', 'Order ' || v_o.order_number || coalesce('. ' || left(nullif(btrim(coalesce(p_notes, '')), ''), 160), ''), '/admin/deliveries');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The customer's code
-- ---------------------------------------------------------------------------------------------------------------------
-- Right after checkout the customer's browser asks for the code once and keeps it. Allowed only while the order has no delivery yet
-- (so a driver, who only learns of the order once it is assigned, can never claim it). Asking again before then returns the same code.
create or replace function public.claim_order_code(p_number text, p_phone text) returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text; v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
begin
  v_id := (select o.id from public.orders o where o.order_number = upper(btrim(coalesce(p_number, ''))) and o.channel = 'checkout'
           and char_length(v_phone) >= 6 and right(o.phone, 9) = right(v_phone, 9) and o.created_at > now() - interval '3 days');
  if v_id is null then raise exception 'We could not find an order with those details.'; end if;
  if exists (select 1 from public.deliveries where order_id = v_id) then raise exception 'This order is already being delivered. Ask TradeLink if you need your code again.'; end if;
  insert into public.order_codes (order_id, code, claimed) values (v_id, public._new_code(), true) on conflict (order_id) do nothing;
  v_code := (select c.code from public.order_codes c where c.order_id = v_id and c.claimed);
  if v_code is null then raise exception 'The code for this order is not available here. Ask TradeLink.'; end if;
  return v_code;
end $$;

-- Order tracking page: shows the code only for orders whose code was never claimed by a device (older orders), while the order is on the way.
create or replace function public.track_order_code(p_number text, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid; v_c public.order_codes%rowtype; v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
begin
  v_id := (select o.id from public.orders o where o.order_number = upper(btrim(coalesce(p_number, ''))) and o.channel = 'checkout' and char_length(v_phone) >= 6 and right(o.phone, 9) = right(v_phone, 9));
  if v_id is null then raise exception 'We could not find an order with those details.'; end if;
  if not exists (select 1 from public.deliveries d where d.order_id = v_id and d.status = 'in_transit') then return jsonb_build_object('state', 'none'); end if;
  v_c := (select c from public.order_codes c where c.order_id = v_id);
  if v_c.order_id is null then return jsonb_build_object('state', 'none'); end if;
  if v_c.expires_at < now() then return jsonb_build_object('state', 'expired'); end if;
  if v_c.locked_until is not null and v_c.locked_until > now() then return jsonb_build_object('state', 'locked'); end if;
  if v_c.claimed then return jsonb_build_object('state', 'device'); end if;
  return jsonb_build_object('state', 'show', 'code', v_c.code);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The driver's steps
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.driver_start(p_delivery uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.delivery_progress where delivery_id = p_delivery and picked_up_at is not null)
     or not exists (select 1 from public.deliveries where id = p_delivery and assigned_to = auth.uid() and status = 'assigned') then
    raise exception 'Mark the order as picked up first.';
  end if;
  perform public.update_delivery(p_delivery, 'in_transit', null);
  perform public._ensure_order_code((select order_id from public.deliveries where id = p_delivery));
end $$;

-- OLD two-argument version: switched off, so an out-of-date app cannot skip the code.
create or replace function public.driver_complete(p_delivery uuid, p_photo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Update needed: finishing a delivery now needs the customer''s 6-digit code. Reload the app and try again.';
end $$;

-- Complete a delivery with the customer's code + the delivery photo. A wrong code is COUNTED and returned as a result
-- (not raised), so the counter is saved. 5 wrong tries lock it for 15 minutes; after 3 locks only a manager re-issue unlocks it.
create or replace function public.driver_complete(p_delivery uuid, p_photo text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_c public.order_codes%rowtype; v_no text; v_att integer; v_locks integer; v_until timestamptz; v_code text := btrim(coalesce(p_code, ''));
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  v_d := (select d from public.deliveries d where d.id = p_delivery and d.assigned_to = auth.uid() and d.status = 'in_transit');
  if v_d.id is null then raise exception 'This delivery is not on the way.'; end if;
  if p_photo is null or p_photo !~ '^data:image/(jpeg|png|webp);base64,' or char_length(p_photo) < 1000 or char_length(p_photo) > 900000 then
    raise exception 'Take a clear photo of the delivered order first.';
  end if;
  if v_code !~ '^[0-9]{6}$' then return jsonb_build_object('ok', false, 'error', 'format', 'message', 'Enter the 6-digit code from the customer.'); end if;
  perform public._ensure_order_code(v_d.order_id);
  perform 1 from public.order_codes where order_id = v_d.order_id for update;
  v_c := (select c from public.order_codes c where c.order_id = v_d.order_id);
  v_no := (select order_number from public.orders where id = v_d.order_id);
  if v_c.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'expired', 'message', 'This code has expired. Ask the office to issue a new one.'); end if;
  if v_c.locked_until is not null and v_c.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'message', case when v_c.locked_until = 'infinity' then 'Too many wrong codes. Ask the office to issue a new code.'
      else 'Too many wrong codes. Try again in ' || greatest(1, ceil(extract(epoch from (v_c.locked_until - now())) / 60)::int) || ' minutes.' end);
  end if;
  if v_c.code <> v_code then
    v_att := v_c.attempts + 1;
    if v_att >= 5 then
      v_locks := v_c.lockouts + 1;
      v_until := case when v_locks >= 3 then 'infinity'::timestamptz else now() + interval '15 minutes' end;
      update public.order_codes set attempts = 0, lockouts = v_locks, locked_until = v_until where order_id = v_d.order_id;
      perform public.notify_managers('otp_locked', 'Delivery code locked', 'Order ' || coalesce(v_no, '') || ': 5 wrong codes entered' || case when v_locks >= 3 then '. Needs a new code from the office.' else '. Locked for 15 minutes.' end, '/admin/deliveries');
      return jsonb_build_object('ok', false, 'error', 'locked', 'message', case when v_locks >= 3 then 'Too many wrong codes. Ask the office to issue a new code.' else 'Too many wrong codes. Try again in 15 minutes.' end);
    end if;
    update public.order_codes set attempts = v_att where order_id = v_d.order_id;
    return jsonb_build_object('ok', false, 'error', 'wrong', 'triesLeft', 5 - v_att, 'message', 'That code is not correct. ' || (5 - v_att) || ' tries left.');
  end if;
  update public.order_codes set attempts = 0, verified_at = now() where order_id = v_d.order_id;
  update public.delivery_progress set proof_photo = p_photo, updated_at = now() where delivery_id = p_delivery;
  if not found then insert into public.delivery_progress (delivery_id, proof_photo) values (p_delivery, p_photo); end if;
  perform public._deliver(p_delivery, null);
  return jsonb_build_object('ok', true);
end $$;

-- Failing a delivery now records a category. The old two-argument call still works (category "other").
create or replace function public.driver_fail(p_delivery uuid, p_reason text, p_category text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.deliveries where id = p_delivery and assigned_to = auth.uid() and status in ('assigned', 'in_transit')) then raise exception 'This delivery is not yours to cancel.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Tell us why it could not be delivered.'; end if;
  if coalesce(p_category, 'other') not in ('customer_unreachable', 'wrong_address', 'customer_refused', 'driver_problem', 'other') then raise exception 'Choose a reason type.'; end if;
  perform public.update_delivery(p_delivery, 'failed', left(btrim(p_reason), 300));
  insert into public.delivery_progress (delivery_id, fail_category) values (p_delivery, coalesce(p_category, 'other'))
  on conflict (delivery_id) do update set fail_category = excluded.fail_category, updated_at = now();
  perform public.notify_managers('delivery_failed', 'Delivery could not be completed', left(btrim(p_reason), 200), '/admin/deliveries');
end $$;
create or replace function public.driver_fail(p_delivery uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin perform public.driver_fail(p_delivery, p_reason, 'other'); end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Office: override, re-issue, fail with a category, retry / reassign
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.ops_override_delivered(p_delivery uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_no text; v_name text; v_why text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not public.has_permission('deliveries.override') then raise exception 'You are not allowed to override a delivery.' using errcode = '42501'; end if;
  if char_length(v_why) < 10 or char_length(v_why) > 500 then raise exception 'Write the reason (at least 10 characters).'; end if;
  v_d := (select d from public.deliveries d where d.id = p_delivery);
  if v_d.id is null then raise exception 'Delivery not found.'; end if;
  if v_d.status not in ('assigned', 'in_transit') then raise exception 'A delivery that is % cannot be overridden.', v_d.status; end if;
  v_no := (select order_number from public.orders where id = v_d.order_id);
  v_name := (select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = auth.uid());
  insert into public.delivery_overrides (kind, delivery_id, order_number, actor, actor_name, reason) values ('delivered', p_delivery, v_no, auth.uid(), v_name, v_why);
  perform public._deliver(p_delivery, 'Manager override: ' || v_why);
  perform public.notify_managers('delivery_override', 'Delivery completed by override', 'Order ' || coalesce(v_no, '') || ' by ' || coalesce(v_name, 'a manager') || ': ' || left(v_why, 140), '/admin/deliveries');
end $$;

-- A manager issues a NEW code (lost code, or locked after too many wrong tries) and reads it to the customer. Shown once; recorded.
create or replace function public.ops_reissue_otp(p_delivery uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_no text; v_name text; v_code text := public._new_code();
begin
  if auth.uid() is null or not public.has_permission('deliveries.override') then raise exception 'You are not allowed to issue a new code.' using errcode = '42501'; end if;
  v_d := (select d from public.deliveries d where d.id = p_delivery);
  if v_d.id is null then raise exception 'Delivery not found.'; end if;
  if v_d.status not in ('assigned', 'in_transit') then raise exception 'A delivery that is % does not need a code.', v_d.status; end if;
  v_no := (select order_number from public.orders where id = v_d.order_id);
  v_name := (select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = auth.uid());
  insert into public.order_codes (order_id, code, claimed, reissued_at) values (v_d.order_id, v_code, true, now())
  on conflict (order_id) do update set code = excluded.code, claimed = true, attempts = 0, lockouts = 0, locked_until = null, verified_at = null,
    expires_at = now() + interval '14 days', reissued_at = now();
  insert into public.delivery_overrides (kind, delivery_id, order_number, actor, actor_name, reason) values ('code_reissued', p_delivery, v_no, auth.uid(), v_name, 'New delivery code issued by the office');
  perform public.write_activity('delivery_code_reissued', 'delivery', 'New delivery code issued for order ' || coalesce(v_no, ''), jsonb_build_object('delivery_id', p_delivery));
  return v_code;
end $$;

create or replace function public.ops_fail_delivery(p_delivery uuid, p_category text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('deliveries.assign') then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_category not in ('customer_unreachable', 'wrong_address', 'customer_refused', 'driver_problem', 'other') then raise exception 'Choose a reason type.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Tell us why it could not be delivered.'; end if;
  perform public.update_delivery(p_delivery, 'failed', left(btrim(p_reason), 300));
  insert into public.delivery_progress (delivery_id, fail_category) values (p_delivery, p_category)
  on conflict (delivery_id) do update set fail_category = excluded.fail_category, updated_at = now();
end $$;

-- Retry a failed delivery, or move an assigned (not yet picked up) delivery to another driver. The Phase 1 city rule applies.
create or replace function public.ops_reassign_delivery(p_delivery uuid, p_assignee uuid, p_scheduled timestamptz default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_new uuid; v_no text;
begin
  if auth.uid() is null or not public.has_permission('deliveries.assign') then raise exception 'Not allowed.' using errcode = '42501'; end if;
  perform 1 from public.deliveries where id = p_delivery for update;
  v_d := (select d from public.deliveries d where d.id = p_delivery);
  if v_d.id is null then raise exception 'Delivery not found.'; end if;
  if v_d.status not in ('assigned', 'failed') then raise exception 'Only an assigned or failed delivery can be reassigned (this one is %).', v_d.status; end if;
  v_no := (select order_number from public.orders where id = v_d.order_id);
  if v_d.status = 'assigned' then
    if exists (select 1 from public.delivery_progress where delivery_id = p_delivery and picked_up_at is not null) then raise exception 'The driver already picked this order up. Mark it as failed first.'; end if;
    if v_d.assigned_to is not distinct from p_assignee then raise exception 'Choose a different driver.'; end if;
    update public.deliveries set status = 'failed', notes = 'Reassigned by the office' where id = p_delivery;
    update public.orders set status = 'ready' where id = v_d.order_id;
    insert into public.delivery_progress (delivery_id, fail_category) values (p_delivery, 'reassigned')
    on conflict (delivery_id) do update set fail_category = 'reassigned', updated_at = now();
    if v_d.assigned_to is not null then
      perform public.notify(v_d.assigned_to, 'delivery_removed', 'Delivery reassigned', 'Order ' || coalesce(v_no, '') || ' was given to another driver.', '/admin/deliveries');
    end if;
  end if;
  v_new := public.assign_delivery(v_d.order_id, p_assignee, p_scheduled, p_notes);   -- permission, status and city rules all apply; any refusal undoes everything above
  insert into public.delivery_progress (delivery_id, retry_of) values (v_new, p_delivery)
  on conflict (delivery_id) do update set retry_of = excluded.retry_of, updated_at = now();
  perform public.write_activity('delivery_reassigned', 'delivery', 'Order ' || coalesce(v_no, '') || ' sent to a new driver', jsonb_build_object('from_delivery', p_delivery, 'delivery_id', v_new));
  return v_new;
end $$;

-- Delivery list extras (replaces the Phase 1 version; same fields plus failure details and two new flags)
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
        'id', x.id, 'cityId', x.city_id, 'city', x.city, 'zone', x.zone, 'attention', to_jsonb(x.attention),
        'failCategory', x.fail_category, 'attempt', x.attempt, 'retryOf', x.retry_of, 'codeLocked', x.code_locked))
      from (
        select d.id, o.city_id, c.name as city, z.name as zone, pr.fail_category, pr.retry_of,
          (select count(*) from public.deliveries d4 where d4.order_id = d.order_id and d4.created_at <= d.created_at) as attempt,
          (d.status = 'in_transit' and exists (select 1 from public.order_codes oc where oc.order_id = d.order_id and oc.locked_until is not null and oc.locked_until > now())) as code_locked,
          array_remove(array[
            case when d.status = 'assigned' and pr.accepted_at is null and d.created_at < now() - interval '30 minutes' then 'not_accepted' end,
            case when d.status in ('assigned', 'in_transit') and d.scheduled_at is not null and d.scheduled_at < now() then 'late' end,
            case when d.status = 'failed' and not exists (select 1 from public.deliveries d2 where d2.order_id = d.order_id and d2.status <> 'failed') then 'failed_open' end,
            case when d.status = 'failed' and not exists (select 1 from public.deliveries d2 where d2.order_id = d.order_id and d2.status <> 'failed')
                  and (select count(*) from public.deliveries d3 where d3.order_id = d.order_id and d3.status = 'failed') >= 3 then 'many_failures' end,
            case when d.status = 'in_transit' and exists (select 1 from public.order_codes oc where oc.order_id = d.order_id and oc.locked_until is not null and oc.locked_until > now()) then 'code_locked' end,
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
-- 7. Permissions
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['_new_code()', '_deliver(uuid, text)', '_ensure_order_code(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'driver_start(uuid)', 'driver_complete(uuid, text)', 'driver_complete(uuid, text, text)', 'driver_fail(uuid, text)', 'driver_fail(uuid, text, text)',
    'ops_override_delivered(uuid, text)', 'ops_reissue_otp(uuid)', 'ops_fail_delivery(uuid, text, text)', 'ops_reassign_delivery(uuid, uuid, timestamptz, text)', 'ops_delivery_list()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['claim_order_code(text, text)', 'track_order_code(text, text)'] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to anon, authenticated';
  end loop;
end $$;
