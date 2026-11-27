-- Phase 1 SQL tests: cities, zones, driver cities, city-restricted assignment, filters, permissions.
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
select set_config('t.owner', gen_random_uuid()::text, true), set_config('t.mgr', gen_random_uuid()::text, true), set_config('t.drvA', gen_random_uuid()::text, true),
       set_config('t.drvB', gen_random_uuid()::text, true), set_config('t.drvN', gen_random_uuid()::text, true), set_config('t.drvOff', gen_random_uuid()::text, true),
       set_config('t.staff', gen_random_uuid()::text, true);
insert into auth.users (id, email) select current_setting('t.' || k)::uuid, k || '@test.local' from unnest(array['owner','mgr','drvA','drvB','drvN','drvOff','staff']) k;
insert into public.profiles (id, email, full_name, role, active)
select current_setting('t.' || k)::uuid, k || '@test.local', initcap(k), r::public.app_role, a
from (values ('owner','owner',true), ('mgr','manager',true), ('drvA','delivery',true), ('drvB','delivery',true), ('drvN','delivery',true), ('drvOff','delivery',false), ('staff','staff',true)) v(k, r, a)
on conflict (id) do update set role = excluded.role, active = excluded.active, full_name = excluded.full_name;
-- orders: ready checkout orders
insert into public.orders (order_number, customer_name, phone, delivery_location, status, channel)
select 'T-' || n, 'Customer ' || n, '09110000' || n, 'Street ' || n, 'ready', 'checkout' from generate_series(1, 9) n;

create function t.oid(n int) returns uuid language sql security definer as $$ select id from public.orders where order_number = 'T-' || n $$;
create function t.u(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;

-- ---------- 1. backward compatibility: no cities yet, assignment works exactly as before ----------
select t.as_user(t.u('mgr'));
select t.ok('no cities: manager assigns a driver as before', format('select public.assign_delivery(%L, %L, null, null)', t.oid(1), t.u('drvN')));
select t.check('no cities: delivery row created', exists (select 1 from public.deliveries where order_id = (select t.oid(1)) and assigned_to = t.u('drvN')));
select t.err('no cities: a second delivery for the same order is still refused', format('select public.assign_delivery(%L, %L, null, null)', t.oid(1), t.u('drvN')), 'already has a delivery');
select t.err('no cities: inactive driver still refused', format('select public.assign_delivery(%L, %L, null, null)', t.oid(2), t.u('drvOff')), 'Choose an active');
select t.err('no cities: non-ready order still refused', format('select public.assign_delivery(%L, %L, null, null)', (select id from (select gen_random_uuid() id) q), t.u('drvN')), 'not found');

-- ---------- 2. permissions on the management functions ----------
select t.as_user(t.u('drvA'));
select t.err('driver cannot add a city', $$select public.ops_save_city(null, 'Hack', true)$$, 'Not allowed');
select t.err('driver cannot list cities (ops)', $$select public.ops_cities()$$, 'Not allowed');
select t.err('driver cannot read the delivery list extras', $$select public.ops_delivery_list()$$, 'Not allowed');
select t.err('driver cannot set driver cities', format('select public.ops_set_driver_cities(%L, array[]::uuid[])', t.u('drvA')), 'Not allowed');
select t.as_user(t.u('staff'));
select t.err('plain staff cannot add a city', $$select public.ops_save_city(null, 'Hack', true)$$, 'Not allowed');
select t.err('plain staff cannot list assignment candidates', format('select public.ops_assign_candidates(%L)', t.oid(3)), 'Not allowed');
select t.as_anon();
select t.ok('guest can read the public city list', $$select public.public_cities()$$);
select t.err('guest cannot call ops_cities', $$select public.ops_cities()$$, 'permission denied');
select t.err('guest cannot call ops_delivery_list', $$select public.ops_delivery_list()$$, 'permission denied');
select t.err('guest cannot call ops_assign_candidates', format('select public.ops_assign_candidates(%L)', t.oid(3)), 'permission denied');
select t.err('guest cannot call ops_save_city', $$select public.ops_save_city(null, 'Hack', true)$$, 'permission denied');
select t.err('guest cannot read the cities table directly', $$select * from public.cities$$, 'permission denied');
select t.as_user(t.u('mgr'));
select t.err('manager cannot read the cities table directly either', $$select * from public.cities$$, 'permission denied');
select t.err('manager cannot read driver_cities directly', $$select * from public.driver_cities$$, 'permission denied');
select t.err('manager cannot write deliveries directly (permissions unchanged)', $$update public.deliveries set status = 'delivered'$$, 'permission denied');
select t.err('manager cannot insert into deliveries directly', format('insert into public.deliveries (order_id, status) values (%L, %L)', t.oid(4), 'assigned'), 'permission denied');

-- ---------- 3. city and zone management ----------
select t.as_user(t.u('mgr'));
select set_config('t.cDD', public.ops_save_city(null, 'Dire Dawa', true)::text, true);
select set_config('t.cAA', public.ops_save_city(null, 'Addis Ababa', true)::text, true);
select t.err('duplicate city name (any case) refused', $$select public.ops_save_city(null, ' dire dawa ', true)$$, 'already exists');
select t.err('too-short city name refused', $$select public.ops_save_city(null, 'A', true)$$, 'city name');
select set_config('t.zKez', public.ops_save_zone(null, t.u('cDD'), 'Kezira', true)::text, true);
select t.err('duplicate area in the same city refused', format('select public.ops_save_zone(null, %L, %L, true)', t.u('cDD'), 'kezira'), 'already exists');
select set_config('t.zAA', public.ops_save_zone(null, t.u('cAA'), 'Kezira', true)::text, true);
select t.check('same area name allowed in another city', t.u('zAA') is not null);
select t.err('area needs a real city', format('select public.ops_save_zone(null, %L, %L, true)', gen_random_uuid(), 'Nowhere'), 'City not found');
select t.check('public list shows both active cities, zones nested',
  (select jsonb_array_length(public.public_cities())) = 2 and (select jsonb_array_length(c->'zones') from jsonb_array_elements(public.public_cities()) c where c->>'name' = 'Dire Dawa') = 1);
select t.ok('manager can read ops_cities', $$select public.ops_cities()$$);

-- ---------- 4. driver cities ----------
select t.ok('manager sets driver A to Dire Dawa', format('select public.ops_set_driver_cities(%L, array[%L]::uuid[])', t.u('drvA'), t.u('cDD')));
select t.ok('manager sets driver B to Addis Ababa', format('select public.ops_set_driver_cities(%L, array[%L]::uuid[])', t.u('drvB'), t.u('cAA')));
select t.err('cannot set cities for a non-driver', format('select public.ops_set_driver_cities(%L, array[]::uuid[])', t.u('staff')), 'active delivery driver');
select t.err('cannot set unknown cities', format('select public.ops_set_driver_cities(%L, array[%L]::uuid[])', t.u('drvA'), gen_random_uuid()), 'City not found');
select t.check('driver load lists cities for driver A', exists (select 1 from jsonb_array_elements(public.ops_driver_load()) r where r->>'profileId' = t.u('drvA')::text and (r->'cities') @> to_jsonb(array[t.u('cDD')])));

-- ---------- 5. city-restricted assignment (cities now exist, so the rule is on) ----------
select t.err('order without city cannot be assigned', format('select public.assign_delivery(%L, %L, null, null)', t.oid(2), t.u('drvA')), 'Set the city');
select t.check('candidates say the order needs a city', (select public.ops_assign_candidates(t.oid(2))->>'needsCity') = 'true' and jsonb_array_length(public.ops_assign_candidates(t.oid(2))->'drivers') = 0);
select t.ok('manager sets the order city (with its area)', format('select public.ops_set_order_city(%L, %L, %L)', t.oid(2), t.u('cDD'), t.u('zKez')));
select t.err('a city that has areas needs one chosen (staff)', format('select public.ops_set_order_city(%L, %L, null)', t.oid(3), t.u('cDD')), 'area');
select t.err('area from another city refused (staff)', format('select public.ops_set_order_city(%L, %L, %L)', t.oid(3), t.u('cAA'), t.u('zKez')), 'does not belong');
select t.check('candidates for a Dire Dawa order: driver A and office staff, not B/N', (
  select array_agg(r->>'name' order by r->>'name') from jsonb_array_elements(public.ops_assign_candidates(t.oid(2))->'drivers') r) = array['Drva', 'Mgr', 'Owner']);
select t.err('driver B (Addis only) refused for a Dire Dawa order', format('select public.assign_delivery(%L, %L, null, null)', t.oid(2), t.u('drvB')), 'does not serve');
select t.err('driver with no city refused', format('select public.assign_delivery(%L, %L, null, null)', t.oid(2), t.u('drvN')), 'does not serve');
select t.ok('driver A (Dire Dawa) accepted', format('select public.assign_delivery(%L, %L, null, null)', t.oid(2), t.u('drvA')));
select t.ok('manager can assign an order to themself (office staff exempt)', format('select public.ops_set_order_city(%L, %L, %L)', t.oid(5), t.u('cDD'), t.u('zKez')));
select t.ok('...and the assignment goes through', format('select public.assign_delivery(%L, %L, null, null)', t.oid(5), t.u('mgr')));
select t.check('...and it is written to the activity log as exempt', exists (select 1 from public.activity_logs where action = 'delivery_assigned' and description like '%city rule not applied%'));
select t.err('inactive driver still refused with cities on', format('select public.assign_delivery(%L, %L, null, null)', t.oid(6), t.u('drvOff')), 'Choose an active');
select t.as_user(t.u('staff'));
select t.err('a user without the assign permission is still refused', format('select public.assign_delivery(%L, %L, null, null)', t.oid(6), t.u('drvA')), 'permission');

-- inactive city: cannot be chosen, but old data stays
select t.as_user(t.u('mgr'));
select t.ok('manager can switch a city off', format('select public.ops_save_city(%L, %L, false)', t.u('cAA'), 'Addis Ababa'));
select t.err('inactive city cannot be set on an order', format('select public.ops_set_order_city(%L, %L, %L)', t.oid(3), t.u('cAA'), t.u('zAA')), 'active city');
select t.check('public list hides the inactive city', (select jsonb_array_length(public.public_cities())) = 1);
select t.ok('manager switches it back on', format('select public.ops_save_city(%L, %L, true)', t.u('cAA'), 'Addis Ababa'));

-- ---------- 6. customer saves the city of their own order ----------
select t.as_anon();
select t.err('customer: wrong phone refused', format('select public.set_order_city(%L, %L, %L, %L)', 'T-3', '0000000000', t.u('cDD'), t.u('zKez')), 'could not find');
select t.err('customer: unknown order refused', format('select public.set_order_city(%L, %L, %L, %L)', 'NOPE', '091100003', t.u('cDD'), t.u('zKez')), 'could not find');
select t.err('customer: area required when the city has areas', format('select public.set_order_city(%L, %L, %L, null)', 'T-3', '091100003', t.u('cDD')), 'area');
select t.err('customer: area of another city refused', format('select public.set_order_city(%L, %L, %L, %L)', 'T-3', '091100003', t.u('cAA'), t.u('zKez')), 'does not belong');
select t.ok('customer: city saved with the right order number and phone', format('select public.set_order_city(%L, %L, %L, %L)', 'T-3', '091100003', t.u('cDD'), t.u('zKez')));
select t.ok('customer: saving the same city again is harmless', format('select public.set_order_city(%L, %L, %L, %L)', 'T-3', '091100003', t.u('cDD'), t.u('zKez')));
select t.err('customer: cannot switch to another city afterwards', format('select public.set_order_city(%L, %L, %L, %L)', 'T-3', '091100003', t.u('cAA'), t.u('zAA')), 'already saved');
select t.root();
update public.orders set channel = 'quote' where order_number = 'T-4';
select t.as_anon();
select t.err('customer: only checkout orders can be changed this way', format('select public.set_order_city(%L, %L, %L, %L)', 'T-4', '091100004', t.u('cDD'), t.u('zKez')), 'could not find');

-- ---------- 7. staff correct a city; delivered orders are locked ----------
select t.as_user(t.u('mgr'));
select t.ok('staff correct the city of an order', format('select public.ops_set_order_city(%L, %L, %L)', t.oid(3), t.u('cAA'), t.u('zAA')));
select t.root();
update public.deliveries set status = 'delivered' where order_id = (select t.oid(5));
select t.as_user(t.u('mgr'));
select t.err('delivered order city is locked', format('select public.ops_set_order_city(%L, %L, %L)', t.oid(5), t.u('cDD'), t.u('zKez')), 'already delivered');

-- ---------- 8. "needs attention" for the filters ----------
select t.root();
update public.deliveries set created_at = now() - interval '2 hours' where order_id = (select t.oid(2));
update public.deliveries set scheduled_at = now() - interval '1 hour' where order_id = (select t.oid(2));
select t.as_user(t.u('mgr'));
select t.check('needs attention: not accepted for 30+ minutes', (select (r->'attention') ? 'not_accepted' from jsonb_array_elements(public.ops_delivery_list()->'rows') r where r->>'id' = (select id::text from public.deliveries where order_id = t.oid(2))));
select t.check('needs attention: late against the scheduled time', (select (r->'attention') ? 'late' from jsonb_array_elements(public.ops_delivery_list()->'rows') r where r->>'id' = (select id::text from public.deliveries where order_id = t.oid(2))));
select t.check('needs attention: no map pins yet', (select (r->'attention') ? 'no_pins' from jsonb_array_elements(public.ops_delivery_list()->'rows') r where r->>'id' = (select id::text from public.deliveries where order_id = t.oid(2))));
select t.check('list rows carry the city and area names', (select r->>'city' = 'Dire Dawa' and r->>'zone' = 'Kezira' from jsonb_array_elements(public.ops_delivery_list()->'rows') r where r->>'id' = (select id::text from public.deliveries where order_id = t.oid(2))));
select t.check('delivered deliveries are not flagged', (select jsonb_array_length(r->'attention') = 0 from jsonb_array_elements(public.ops_delivery_list()->'rows') r where r->>'id' = (select id::text from public.deliveries where order_id = t.oid(5))));
select t.root();
update public.deliveries set status = 'failed' where order_id = (select t.oid(2));
select t.as_user(t.u('mgr'));
select t.check('needs attention: failed with no new delivery', (select (r->'attention') ? 'failed_open' from jsonb_array_elements(public.ops_delivery_list()->'rows') r where r->>'id' = (select id::text from public.deliveries where order_id = t.oid(2))));
select t.ok('a failed order can be assigned again (retry path still open)', format('select public.assign_delivery(%L, %L, null, null)', t.oid(2), t.u('drvA')));

-- ---------- report ----------
select t.root();
\o
select format('%s  %s%s', case when ok then 'PASS' else 'FAIL' end, name, coalesce('   <- ' || detail, '')) as result from t.results order by n;
select format('%s passed, %s failed', count(*) filter (where ok), count(*) filter (where not ok)) as summary from t.results;
do $$ begin if exists (select 1 from t.results where not ok) then raise exception 'Phase 1 SQL tests FAILED'; end if; end $$;
rollback;
