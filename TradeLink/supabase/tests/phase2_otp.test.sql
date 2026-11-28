-- Phase 2 SQL tests: customer code (OTP), locked completion, lockouts, manager override + audit, failure categories, retry/reassign, notifications.
-- Run against a COPY of the schema (local Postgres or a staging Supabase project), never production.
-- Everything happens inside one transaction that is rolled back, so no data remains.
-- Usage: psql -v ON_ERROR_STOP=1 -f supabase/tests/phase1_cities.test.sql   (prints PASS/FAIL per test; exits non-zero on failure)
\set QUIET on
\pset tuples_only on
begin;
\o /dev/null
create schema t;
create table t.results (n serial, name text, ok boolean, detail text);

-- act as a user: role authenticated + their id. t.as_anon() acts as a guest. t.root() goes back to the owner of the DB.
create function t.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, true); perform set_config('role', 'authenticated', true); end $$;
create function t.as_anon() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', true); perform set_config('role', 'anon', true); end $$;
create function t.root() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); perform set_config('request.jwt.claim.sub', '', true); end $$;
grant usage on schema t to public;
grant all on all tables in schema t to public;
grant execute on all functions in schema t to public;
grant usage on all sequences in schema t to public;

-- expect_ok / expect_err run one statement and record whether it behaved as expected
create function t.ok(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; insert into t.results (name, ok) values (p_name, true);
  exception when others then insert into t.results (name, ok, detail) values (p_name, false, 'unexpected error: ' || sqlerrm); end;
end $$;
create function t.err(p_name text, p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql; insert into t.results (name, ok, detail) values (p_name, false, 'expected an error but it succeeded');
  exception when others then
    insert into t.results (name, ok, detail) values (p_name, sqlerrm ilike '%' || p_like || '%', case when sqlerrm ilike '%' || p_like || '%' then null else 'wrong error: ' || sqlerrm end);
  end;
end $$;
create function t.check(p_name text, p_cond boolean) returns void language plpgsql as $$ begin insert into t.results (name, ok) values (p_name, coalesce(p_cond, false)); end $$;

-- ---------- fixtures (as superuser) ----------
select set_config('t.mgr', gen_random_uuid()::text, true), set_config('t.drvA', gen_random_uuid()::text, true), set_config('t.drvB', gen_random_uuid()::text, true),
       set_config('t.staff', gen_random_uuid()::text, true), set_config('t.owner', gen_random_uuid()::text, true);
insert into auth.users (id, email) select current_setting('t.' || k)::uuid, k || '@test.local' from unnest(array['owner','mgr','drvA','drvB','staff']) k;
insert into public.profiles (id, email, full_name, role, active)
select current_setting('t.' || k)::uuid, k || '@test.local', initcap(k), r::public.app_role, true
from (values ('owner','owner'), ('mgr','manager'), ('drvA','delivery'), ('drvB','delivery'), ('staff','staff')) v(k, r)
on conflict (id) do update set role = excluded.role, active = true, full_name = excluded.full_name;
insert into public.orders (order_number, customer_name, phone, delivery_location, status, channel)
select 'T-' || n, 'Customer ' || n, '09110000' || n, 'Street ' || n, 'ready', 'checkout' from generate_series(1, 12) n;
update public.orders set channel = 'quote' where order_number = 'T-12';

-- inside one transaction now() never changes; give each test delivery its own timestamp like real life
create function t.stamp() returns trigger language plpgsql as $$ begin new.created_at := clock_timestamp(); return new; end $$;
create trigger t_stamp before insert on public.deliveries for each row execute function t.stamp();
create function t.oid(n int) returns uuid language sql security definer as $$ select id from public.orders where order_number = 'T-' || n $$;
create function t.u(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function t.did(n int) returns uuid language sql security definer as $$ select id from public.deliveries where order_id = t.oid(n) order by created_at desc limit 1 $$;
create function t.code(n int) returns text language sql security definer as $$ select code from public.order_codes where order_id = t.oid(n) $$;
create function t.att(n int) returns int language sql security definer as $$ select attempts from public.order_codes where order_id = t.oid(n) $$;
create function t.photo() returns text language sql as $$ select 'data:image/jpeg;base64,' || repeat('A', 1500) $$;
create function t.nots(kind text, who uuid default null) returns bigint language sql security definer as $$ select count(*) from public.notifications where notifications.kind = $1 and ($2 is null or user_id = $2) $$;
-- drive an order through the driver's steps as the real users: upto = 'assigned' | 'accepted' | 'picked' | 'start'
create function t.go(n int, drv text, upto text) returns void language plpgsql as $$
begin
  perform t.as_user(t.u('mgr')); perform public.assign_delivery(t.oid(n), t.u(drv), null, null);
  if upto = 'assigned' then perform t.root(); return; end if;
  perform t.as_user(t.u(drv)); perform public.driver_respond(t.did(n), true, null);
  if upto = 'accepted' then perform t.root(); return; end if;
  perform public.driver_mark_picked_up(t.did(n));
  if upto = 'picked' then perform t.root(); return; end if;
  perform public.driver_start(t.did(n));
  perform t.root();
end $$;

-- ================= A. the customer claims the code at checkout =================
select t.as_anon();
select set_config('t.c1', public.claim_order_code('T-1', '091100001'), true);
select t.check('claim: the customer receives a 6-digit code', current_setting('t.c1') ~ '^[0-9]{6}$');
select t.root();
select t.check('claim: the code is 6 digits and marked as held by the customer device', (select code ~ '^[0-9]{6}$' and claimed from public.order_codes where order_id = t.oid(1)));
select t.as_anon();
select t.check('claim: asking again before delivery returns the same code (lost response is safe)', public.claim_order_code('T-1', '091100001') = (select t.code(1)));
select t.err('claim: wrong phone refused', $$select public.claim_order_code('T-1', '0000000000')$$, 'could not find');
select t.err('claim: unknown order refused', $$select public.claim_order_code('NOPE', '091100001')$$, 'could not find');
select t.err('claim: only checkout orders', $$select public.claim_order_code('T-12', '0911000012')$$, 'could not find');
select t.err('claim: guests cannot read order_codes directly', $$select * from public.order_codes$$, 'permission denied');
select t.root();
select t.go(1, 'drvA', 'start');
select t.as_anon();
select t.err('claim: refused once a delivery exists (a driver can never claim it)', $$select public.claim_order_code('T-1', '091100001')$$, 'already being delivered');
select t.check('track_order_code: claimed code is never shown on the tracking page', (select public.track_order_code('T-1', '091100001')->>'state') = 'device' and (public.track_order_code('T-1', '091100001') ? 'code') = false);

-- ================= B. bypass attempts =================
select t.as_user(t.u('drvA'));
select t.err('bypass: the assigned driver cannot call update_delivery(delivered)', format('select public.update_delivery(%L, %L, null)', t.did(1), 'delivered'), 'customer''s 6-digit code');
select t.as_user(t.u('mgr'));
select t.err('bypass: a manager cannot call update_delivery(delivered) either', format('select public.update_delivery(%L, %L, null)', t.did(1), 'delivered'), 'customer''s 6-digit code');
select t.as_user(t.u('owner'));
select t.err('bypass: not even the owner', format('select public.update_delivery(%L, %L, null)', t.did(1), 'delivered'), 'customer''s 6-digit code');
select t.as_user(t.u('drvA'));
select t.err('bypass: the old 2-argument driver_complete is switched off', format('select public.driver_complete(%L, %L)', t.did(1), t.photo()), 'Update needed');
select t.err('bypass: internal _deliver is not callable by users', format('select public._deliver(%L, null)', t.did(1)), 'permission denied');
select t.err('bypass: internal _new_code is not callable by users', $$select public._new_code()$$, 'permission denied');
select t.err('bypass: internal _ensure_order_code is not callable by users', format('select public._ensure_order_code(%L)', t.oid(1)), 'permission denied');
select t.err('bypass: a driver cannot read order_codes', $$select * from public.order_codes$$, 'permission denied');
select t.err('bypass: a driver cannot read delivery_overrides', $$select * from public.delivery_overrides$$, 'permission denied');
select t.err('bypass: a driver cannot write deliveries directly', $$update public.deliveries set status = 'delivered'$$, 'permission denied');
select t.check('secrecy: driver_my_jobs never contains the code', position((select t.code(1)) in public.driver_my_jobs()::text) = 0);
select t.as_anon();
select t.check('secrecy: track_driver never contains the code', position((select t.code(1)) in coalesce(public.track_driver('T-1', '091100001')::text, '')) = 0);
select t.as_user(t.u('mgr'));
select t.check('secrecy: the delivery list never contains the code', position((select t.code(1)) in public.ops_delivery_list()::text) = 0);
select t.as_user(t.u('drvB'));
select t.err('another driver cannot complete this delivery', format('select public.driver_complete(%L, %L, %L)', t.did(1), t.photo(), (select t.code(1))), 'not on the way');

-- ================= C. the code check =================
select t.as_user(t.u('drvA'));
select t.err('code: a photo is required (and is checked before the code)', format('select public.driver_complete(%L, null, %L)', t.did(1), '123456'), 'photo');
select t.check('code: wrong format returns a result and does not use a try', (select public.driver_complete(t.did(1), t.photo(), '12')->>'error') = 'format' and t.att(1) = 0);
select t.root();
select set_config('t.right1', t.code(1), true), set_config('t.wrong1', case when t.code(1) = '000000' then '000001' else '000000' end, true);
select t.as_user(t.u('drvA'));
select t.check('code: a wrong code is refused with tries left', (select public.driver_complete(t.did(1), t.photo(), current_setting('t.wrong1')) ->> 'triesLeft') = '4');
select t.root();
select t.check('code: the attempt counter was SAVED (not rolled back)', (select attempts from public.order_codes where order_id = t.oid(1)) = 1);
select t.check('code: the delivery is still on the way', (select status from public.deliveries where id = t.did(1)) = 'in_transit');
select t.as_user(t.u('drvA'));
select public.driver_complete(t.did(1), t.photo(), current_setting('t.wrong1')); select public.driver_complete(t.did(1), t.photo(), current_setting('t.wrong1')); select public.driver_complete(t.did(1), t.photo(), current_setting('t.wrong1'));
select t.check('code: the 5th wrong code locks the delivery', (select public.driver_complete(t.did(1), t.photo(), current_setting('t.wrong1'))->>'error') = 'locked');
select t.root();
select t.check('lock: owners and managers were notified', t.nots('otp_locked', t.u('mgr')) = 1 and t.nots('otp_locked', t.u('owner')) = 1);
select t.as_user(t.u('drvA'));
select t.check('lock: even the RIGHT code is refused while locked', (select public.driver_complete(t.did(1), t.photo(), current_setting('t.right1'))->>'error') = 'locked');
select t.as_user(t.u('mgr'));
select t.check('lock: the delivery list flags it', (select (r->'attention') ? 'code_locked' and (r->>'codeLocked') = 'true' from jsonb_array_elements(public.ops_delivery_list()->'rows') r where r->>'id' = t.did(1)::text));
select t.as_anon();
select t.check('lock: the customer page says locked', (select public.track_order_code('T-1', '091100001')->>'state') = 'locked');
select t.root();
update public.order_codes set locked_until = now() - interval '1 minute' where order_id = (select t.oid(1));
select t.as_user(t.u('drvA'));
select t.check('lock: after the wait, tries are available again', (select public.driver_complete(t.did(1), t.photo(), current_setting('t.wrong1'))->>'triesLeft') = '4');
select t.root();
update public.order_codes set expires_at = now() - interval '1 minute' where order_id = (select t.oid(1));
select t.as_user(t.u('drvA'));
select t.check('code: an expired code is refused', (select public.driver_complete(t.did(1), t.photo(), current_setting('t.right1'))->>'error') = 'expired');
select t.root();
update public.order_codes set expires_at = now() + interval '1 day' where order_id = (select t.oid(1));
select t.as_user(t.u('drvA'));
select t.check('code: the RIGHT code completes the delivery', (select (public.driver_complete(t.did(1), t.photo(), current_setting('t.right1')))->>'ok') = 'true');
select t.root();
select t.check('done: delivery is delivered with a time', (select status = 'delivered' and delivered_at is not null from public.deliveries where id = t.did(1)));
select t.check('done: order is completed', (select status = 'completed' from public.orders where id = t.oid(1)));
select t.check('done: the photo is kept as extra proof', (select proof_photo is not null from public.delivery_progress where delivery_id = t.did(1)));
select t.check('done: the code is marked used', (select verified_at is not null and attempts = 0 from public.order_codes where order_id = t.oid(1)));
select t.check('done: managers got the Delivered notification', t.nots('delivery_done', t.u('mgr')) = 1);
select t.as_user(t.u('drvA'));
select t.err('done: it cannot be completed twice', format('select public.driver_complete(%L, %L, %L)', t.did(1), t.photo(), current_setting('t.right1')), 'not on the way');

-- ================= D. three lockouts need the office; re-issue =================
select t.go(2, 'drvA', 'start');
update public.order_codes set claimed = true where order_id = (select t.oid(2));
select t.as_user(t.u('drvA'));
select public.driver_complete(t.did(2), t.photo(), '999999') from generate_series(1, 5);
select t.root();
update public.order_codes set locked_until = now() - interval '1 second' where order_id = (select t.oid(2));
select t.as_user(t.u('drvA'));
select public.driver_complete(t.did(2), t.photo(), '999999') from generate_series(1, 5);
select t.root();
update public.order_codes set locked_until = now() - interval '1 second' where order_id = (select t.oid(2));
select t.as_user(t.u('drvA'));
select public.driver_complete(t.did(2), t.photo(), '999999') from generate_series(1, 5);
select t.root();
select t.check('lockout: after 3 locks it stays locked until the office acts', (select locked_until = 'infinity' and lockouts = 3 from public.order_codes where order_id = t.oid(2)));
select t.as_user(t.u('drvA'));
select t.err('reissue: a driver cannot issue a new code', format('select public.ops_reissue_otp(%L)', t.did(2)), 'not allowed');
select t.as_user(t.u('staff'));
select t.err('reissue: plain staff cannot', format('select public.ops_reissue_otp(%L)', t.did(2)), 'not allowed');
select t.as_user(t.u('mgr'));
select set_config('t.new2', public.ops_reissue_otp(t.did(2)), true);
select t.check('reissue: the manager receives a new 6-digit code', current_setting('t.new2') ~ '^[0-9]{6}$');
select t.root();
select t.check('reissue: lock cleared, counters reset', (select locked_until is null and attempts = 0 and lockouts = 0 from public.order_codes where order_id = t.oid(2)));
select t.check('reissue: recorded permanently', (select count(*) from public.delivery_overrides where kind = 'code_reissued' and order_number = 'T-2') = 1);
select t.as_user(t.u('drvA'));
select t.check('reissue: the old code no longer works', (select public.driver_complete(t.did(2), t.photo(), '999999')->>'error') = 'wrong');
select t.check('reissue: the new code completes the delivery', (select public.driver_complete(t.did(2), t.photo(), (select code from (select current_setting('t.new2') code) q))->>'ok') = 'true');

-- ================= E. manager override + permanent audit =================
select t.go(3, 'drvA', 'start');
select t.as_user(t.u('drvA'));
select t.err('override: a driver cannot', format('select public.ops_override_delivered(%L, %L)', t.did(3), 'Customer confirmed by phone'), 'not allowed');
select t.as_user(t.u('staff'));
select t.err('override: plain staff cannot', format('select public.ops_override_delivered(%L, %L)', t.did(3), 'Customer confirmed by phone'), 'not allowed');
select t.as_user(t.u('mgr'));
select t.err('override: a reason is required', format('select public.ops_override_delivered(%L, %L)', t.did(3), 'ok'), 'reason');
select t.err('override: an empty reason is refused', format('select public.ops_override_delivered(%L, null)', t.did(3)), 'reason');
select t.ok('override: a manager with a written reason succeeds', format('select public.ops_override_delivered(%L, %L)', t.did(3), 'Customer confirmed receipt by phone; phone has no data'));
select t.root();
select t.check('override: the delivery is delivered and the order completed', (select d.status = 'delivered' and o.status = 'completed' from public.deliveries d join public.orders o on o.id = d.order_id where d.id = t.did(3)));
select t.check('override: a permanent audit row names the manager and the reason', (select actor = t.u('mgr') and reason like '%phone has no data%' and kind = 'delivered' and order_number = 'T-3' from public.delivery_overrides where order_number = 'T-3' and kind = 'delivered'));
select t.check('override: owner and manager were notified', t.nots('delivery_override', t.u('owner')) = 1 and t.nots('delivery_override', t.u('mgr')) = 1);
select t.err('audit: a row cannot be edited (even by the database owner)', $$update public.delivery_overrides set reason = 'changed'$$, 'cannot be changed');
select t.err('audit: a row cannot be deleted', $$delete from public.delivery_overrides$$, 'cannot be changed');
select t.err('audit: the table cannot be emptied', $$truncate public.delivery_overrides$$, 'cannot be changed');
select t.as_user(t.u('mgr'));
select t.err('override: a delivered delivery cannot be overridden again', format('select public.ops_override_delivered(%L, %L)', t.did(3), 'Trying to do it twice'), 'cannot be overridden');
select t.go(4, 'drvA', 'accepted');
select t.as_user(t.u('owner'));
select t.ok('override: the owner can override too (even before pickup)', format('select public.ops_override_delivered(%L, %L)', t.did(4), 'Customer collected the goods at the office'));

-- ================= F. failures: categories, notifications, retry and reassign =================
select t.go(5, 'drvA', 'start');
select t.as_user(t.u('drvA'));
select t.err('fail: an unknown category is refused', format('select public.driver_fail(%L, %L, %L)', t.did(5), 'nobody home', 'bogus'), 'reason type');
select t.err('fail: a reason is required', format('select public.driver_fail(%L, %L, %L)', t.did(5), '', 'other'), 'Tell us why');
select t.ok('fail: the driver records a category', format('select public.driver_fail(%L, %L, %L)', t.did(5), 'Customer not answering the phone', 'customer_unreachable'));
select t.root();
select t.check('fail: category saved, delivery failed, order back to ready', (select pr.fail_category = 'customer_unreachable' and d.status = 'failed' and o.status = 'ready' from public.deliveries d join public.delivery_progress pr on pr.delivery_id = d.id join public.orders o on o.id = d.order_id where d.id = t.did(5)));
select t.check('fail: managers were told exactly once (no duplicate)', (select count(*) from public.notifications where kind = 'delivery_failed' and user_id = t.u('mgr') and body like '%not answering%') = 1);

select t.go(6, 'drvA', 'assigned');
select t.as_user(t.u('drvA'));
select t.ok('fail: the old 2-argument driver_fail still works', format('select public.driver_fail(%L, %L)', t.did(6), 'Vehicle broke down'));
select t.root();
select t.check('fail: old call recorded category other', (select fail_category from public.delivery_progress where delivery_id = t.did(6)) = 'other');

select t.go(7, 'drvA', 'start');
select t.as_user(t.u('drvA'));
select t.err('fail (office): a driver cannot use the office function', format('select public.ops_fail_delivery(%L, %L, %L)', t.did(7), 'customer_refused', 'Refused'), 'Not allowed');
select t.as_user(t.u('mgr'));
select t.err('fail (office): unknown category refused', format('select public.ops_fail_delivery(%L, %L, %L)', t.did(7), 'zzz', 'Refused'), 'reason type');
select t.ok('fail (office): staff record a failure with a category', format('select public.ops_fail_delivery(%L, %L, %L)', t.did(7), 'customer_refused', 'Customer refused the goods at the door'));
select t.root();
select t.check('fail (office): staff failures now notify managers exactly once', (select count(*) from public.notifications where kind = 'delivery_failed' and user_id = t.u('mgr') and body like '%refused the goods%') = 1);
select t.check('fail (office): category saved', (select fail_category from public.delivery_progress where delivery_id = t.did(7)) = 'customer_refused');

-- retry a failed delivery
select t.as_user(t.u('drvA'));
select t.err('retry: a driver cannot reassign', format('select public.ops_reassign_delivery(%L, %L, null, null)', t.did(7), t.u('drvB')), 'Not allowed');
select t.as_user(t.u('mgr'));
select set_config('t.retry7', public.ops_reassign_delivery(t.did(7), t.u('drvB'), null, 'Try again tomorrow')::text, true);
select t.root();
select t.check('retry: a new delivery is created for driver B, linked to the failed one', (select d.assigned_to = t.u('drvB') and d.status = 'assigned' and pr.retry_of is not null from public.deliveries d join public.delivery_progress pr on pr.delivery_id = d.id where d.id = t.u('retry7')));
select t.check('retry: the failed attempt is kept', (select status from public.deliveries where order_id = t.oid(7) and id <> t.u('retry7')) = 'failed');
select t.as_user(t.u('mgr'));
select t.check('retry: the list shows attempt 2', (select (r->>'attempt') = '2' from jsonb_array_elements(public.ops_delivery_list()->'rows') r where r->>'id' = t.u('retry7')::text));
select t.err('retry: an order that already has an active delivery cannot be retried again', format('select public.ops_reassign_delivery(%L, %L, null, null)', (select id from public.deliveries where order_id = t.oid(7) and status = 'failed'), t.u('drvA')), 'already has a delivery');

-- reassign an assigned (not picked up) delivery
select t.go(8, 'drvA', 'accepted');
select t.as_user(t.u('mgr'));
select t.err('reassign: to the same driver is pointless', format('select public.ops_reassign_delivery(%L, %L, null, null)', t.did(8), t.u('drvA')), 'different driver');
select set_config('t.re8', public.ops_reassign_delivery(t.did(8), t.u('drvB'), null, null)::text, true);
select t.root();
select t.check('reassign: old delivery failed as "reassigned", order handed to driver B', (select count(*) from public.deliveries d join public.delivery_progress pr on pr.delivery_id = d.id where d.order_id = t.oid(8) and d.status = 'failed' and pr.fail_category = 'reassigned') = 1
  and (select assigned_to from public.deliveries where id = t.u('re8')) = t.u('drvB'));
select t.check('reassign: the old driver is told', t.nots('delivery_removed', t.u('drvA')) = 1);
select t.go(9, 'drvA', 'picked');
select t.as_user(t.u('mgr'));
select t.err('reassign: refused after pickup', format('select public.ops_reassign_delivery(%L, %L, null, null)', t.did(9), t.u('drvB')), 'already picked');

-- the city rule still applies to a retry, and a refused retry changes nothing
select t.root();
insert into public.cities (id, name) values ('10000000-0000-0000-0000-000000000009', 'Testville');
insert into public.driver_cities (profile_id, city_id) values (t.u('drvA'), '10000000-0000-0000-0000-000000000009');
update public.orders set city_id = '10000000-0000-0000-0000-000000000009' where order_number = 'T-10';
select t.go(10, 'drvA', 'assigned');
select t.as_user(t.u('mgr'));
select t.err('city rule: a reassign to a driver outside the city is refused', format('select public.ops_reassign_delivery(%L, %L, null, null)', t.did(10), t.u('drvB')), 'does not serve');
select t.root();
select t.check('city rule: a refused reassign left the original delivery untouched', (select status = 'assigned' and assigned_to = t.u('drvA') from public.deliveries where id = t.did(10)) and (select status from public.orders where order_number = 'T-10') = 'ready');

-- three failed attempts get flagged
select t.root();
update public.orders set city_id = null where order_number = 'T-10';
delete from public.cities where id = '10000000-0000-0000-0000-000000000009';
select t.go(11, 'drvA', 'assigned');
select t.as_user(t.u('mgr'));
select public.ops_fail_delivery(t.did(11), 'other', 'First problem');
select public.ops_reassign_delivery(t.did(11), t.u('drvB'), null, null);
select t.root();
select t.as_user(t.u('mgr'));
select public.ops_fail_delivery(t.did(11), 'other', 'Second problem');
select public.ops_reassign_delivery(t.did(11), t.u('drvA'), null, null);
select public.ops_fail_delivery(t.did(11), 'other', 'Third problem');
select t.check('flags: 3 failed attempts are flagged for the office', (select (r->'attention') ? 'many_failures' and (r->'attention') ? 'failed_open' from jsonb_array_elements(public.ops_delivery_list()->'rows') r where r->>'id' = t.did(11)::text));

-- ================= G. legacy / in-flight orders (no code claimed on a device) =================
select t.root();
update public.orders set channel = 'checkout' where order_number = 'T-12';
select t.go(12, 'drvA', 'start');
select t.as_anon();
select t.check('legacy: an unclaimed code is shown on the tracking page while on the way', (select public.track_order_code('T-12', '0911000012')->>'state') = 'show' and (select public.track_order_code('T-12', '0911000012')->>'code') = (select t.code(12)));
select t.check('legacy: nothing is shown for an order that is not on the way', (select public.track_order_code('T-5', '091100005')->>'state') = 'none');
select t.root();
delete from public.order_codes where order_id = (select t.oid(12));
select t.as_user(t.u('drvA'));
select t.check('in-flight: a delivery with no code yet still gets one (wrong guess counted)', (select public.driver_complete(t.did(12), t.photo(), '123456')->>'error') in ('wrong'));
select t.root();
select t.check('in-flight: the code was created unclaimed', (select not claimed from public.order_codes where order_id = t.oid(12)));

-- ---------- report ----------
select t.root();
\o
select format('%s  %s%s', case when ok then 'PASS' else 'FAIL' end, name, coalesce('   <- ' || detail, '')) as result from t.results order by n;
select format('%s passed, %s failed', count(*) filter (where ok), count(*) filter (where not ok)) as summary from t.results;
do $$ begin if exists (select 1 from t.results where not ok) then raise exception 'Phase 2 SQL tests FAILED'; end if; end $$;
rollback;
