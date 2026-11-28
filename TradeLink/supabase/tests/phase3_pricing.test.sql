-- Phase 3 SQL tests: delivery fee rules and quote, place_order (new + old call), driver pay rules, earnings, payouts, cash handover, security.
-- Run against a COPY of the schema (local Postgres or a staging Supabase project), never production. One rolled-back transaction.
-- Usage: psql -v ON_ERROR_STOP=1 -f supabase/tests/phase3_pricing.test.sql
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
       set_config('t.staff', gen_random_uuid()::text, true), set_config('t.owner', gen_random_uuid()::text, true),
       set_config('t.cA', gen_random_uuid()::text, true), set_config('t.cB', gen_random_uuid()::text, true), set_config('t.zK', gen_random_uuid()::text, true), set_config('t.zS', gen_random_uuid()::text, true),
       set_config('t.ind', gen_random_uuid()::text, true), set_config('t.sup', gen_random_uuid()::text, true), set_config('t.sup2', gen_random_uuid()::text, true),
       set_config('t.p1', gen_random_uuid()::text, true), set_config('t.p2', gen_random_uuid()::text, true);
insert into auth.users (id, email) select current_setting('t.' || k)::uuid, k || '@test.local' from unnest(array['owner','mgr','drvA','drvB','staff']) k;
insert into public.profiles (id, email, full_name, role, active)
select current_setting('t.' || k)::uuid, k || '@test.local', initcap(k), r::public.app_role, true
from (values ('owner','owner'), ('mgr','manager'), ('drvA','delivery'), ('drvB','delivery'), ('staff','staff')) v(k, r)
on conflict (id) do update set role = excluded.role, active = true, full_name = excluded.full_name;
insert into public.cities (id, name) values (current_setting('t.cA')::uuid, 'Dire Dawa'), (current_setting('t.cB')::uuid, 'Addis Ababa');
insert into public.city_zones (id, city_id, name) values (current_setting('t.zK')::uuid, current_setting('t.cA')::uuid, 'Kezira'), (current_setting('t.zS')::uuid, current_setting('t.cA')::uuid, 'Sabian');
insert into public.driver_cities (profile_id, city_id) values (current_setting('t.drvA')::uuid, current_setting('t.cA')::uuid), (current_setting('t.drvB')::uuid, current_setting('t.cA')::uuid), (current_setting('t.drvA')::uuid, current_setting('t.cB')::uuid);
insert into public.industries (id, name) values (current_setting('t.ind')::uuid, 'Test industry');
insert into public.suppliers (id, name, industry_id) values (current_setting('t.sup')::uuid, 'Shop with pin', current_setting('t.ind')::uuid), (current_setting('t.sup2')::uuid, 'Shop without pin', current_setting('t.ind')::uuid);
insert into public.supplier_locations (supplier_id, lat, lng) values (current_setting('t.sup')::uuid, 9.5900, 41.8600);
insert into public.products (id, name, category, unit, wholesale_price, retail_price, stock_quantity, audience, active, supplier_id) values
  (current_setting('t.p1')::uuid, 'Flour', 'Test', 'bag', 100, 200, 1000, 'b2c', true, current_setting('t.sup')::uuid),
  (current_setting('t.p2')::uuid, 'Oil', 'Test', 'litre', 50, 100, 1000, 'b2c', true, current_setting('t.sup2')::uuid);
update public.checkout_settings set cod_enabled = true, delivery_fee = 50, free_delivery_over = 1000 where id;
create function t.u(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function t.items(sup2 boolean default false, qty int default 1) returns jsonb language sql as $$
  select case when sup2 then jsonb_build_array(jsonb_build_object('product_id', t.u('p2'), 'quantity', qty), jsonb_build_object('product_id', t.u('p1'), 'quantity', qty))
              else jsonb_build_array(jsonb_build_object('product_id', t.u('p1'), 'quantity', qty)) end $$;
create function t.stamp() returns trigger language plpgsql as $$ begin new.created_at := clock_timestamp(); return new; end $$;
create trigger t_stamp before insert on public.deliveries for each row execute function t.stamp();
create function t.fee(r jsonb) returns numeric language sql as $$ select (r->>'fee')::numeric $$;
create function t.key() returns text language sql as $$ select 'key-' || replace(gen_random_uuid()::text, '-', '') $$;
create function t.ordfee(n text) returns numeric language sql security definer as $$ select delivery_fee from public.orders where order_number = n $$;
create function t.nots(kind text, who uuid default null) returns bigint language sql security definer as $$ select count(*) from public.notifications where notifications.kind = $1 and ($2 is null or user_id = $2) $$;
create function t.photo() returns text language sql as $$ select 'data:image/jpeg;base64,' || repeat('A', 1500) $$;
-- customer position about 11.12 km north of the shop (0.1 degree of latitude)
create function t.lat() returns double precision language sql as $$ select 9.6900::double precision $$;
create function t.lng() returns double precision language sql as $$ select 41.8600::double precision $$;

-- ================= A. nothing changes until the owner enters a rate (backward compatible) =================
select t.as_anon();
select t.check('flat: with no rule the quote is today''s flat fee', t.fee(public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zK'), t.lat(), t.lng())) = 50);
select t.check('flat: the quote says the source is flat', public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zK'), t.lat(), t.lng())->>'source' = 'flat');
select t.check('flat: a guest can ask for a quote (the call works without signing in)', public.quote_delivery_fee(t.items(), t.u('cA'), null, null, null) ? 'fee');
select set_config('t.o1', (public.place_order(t.items(), 'Meron', '0911000001', null, 'Kezira', null, 'cod', t.key(), ''))->>'order_number', true);
select t.root();
select t.check('old call: the nine-argument place_order still works and charges the flat fee', t.ordfee(current_setting('t.o1')) = 50);
select t.check('old call: no city or position is stored', (select city_id is null and delivery_fee_source = 'flat' from public.orders where order_number = current_setting('t.o1')));
select t.check('old call: no position row is created', not exists (select 1 from public.order_locations ol join public.orders o on o.id = ol.order_id where o.order_number = current_setting('t.o1')));
select t.check('rate tables start empty (no invented rates)', not exists (select 1 from public.delivery_fee_rules) and not exists (select 1 from public.driver_pay_rules));

-- ================= B. only the owner changes prices =================
select t.as_user(t.u('mgr'));
select t.err('rules: a manager cannot save a fee rule', format('select public.ops_save_fee_rule(%L, null, 30, 5, null, null, 1, true)', t.u('cA')), 'owner');
select t.err('rules: a manager cannot save a pay rule', format('select public.ops_save_pay_rule(%L, null, 20, 2, 1, true)', t.u('cA')), 'owner');
select t.err('rules: a manager cannot delete a rule', format('select public.ops_delete_rule(%L, %L)', 'fee', gen_random_uuid()), 'owner');
select t.check('rules: a manager can read the pricing screen (read only)', (public.ops_pricing()->>'canEdit')::boolean = false);
select t.as_user(t.u('drvA'));
select t.err('rules: a driver cannot read the pricing screen', 'select public.ops_pricing()', 'Not allowed');
select t.err('rules: a driver cannot save a rule', format('select public.ops_save_fee_rule(%L, null, 1, 1, null, null, 1, true)', t.u('cA')), 'owner');
select t.as_anon();
select t.err('rules: a guest cannot save a rule', format('select public.ops_save_fee_rule(%L, null, 1, 1, null, null, 1, true)', t.u('cA')), 'permission denied');
select t.root();
-- give the test owner the owner role
update public.profiles set role = 'owner' where id = (select t.u('owner'));
select t.as_user(t.u('owner'));
select t.err('rules: negative base refused', format('select public.ops_save_fee_rule(%L, null, -1, 5, null, null, 1, true)', t.u('cA')), 'base fee');
select t.err('rules: max below min refused', format('select public.ops_save_fee_rule(%L, null, 10, 5, 100, 50, 1, true)', t.u('cA')), 'highest');
select t.err('rules: road factor outside 1-3 refused', format('select public.ops_save_fee_rule(%L, null, 10, 5, null, null, 5, true)', t.u('cA')), 'road factor');
select t.err('rules: an area from another city refused', format('select public.ops_save_fee_rule(%L, %L, 10, 5, null, null, 1, true)', t.u('cB'), t.u('zK')), 'does not belong');
select t.ok('rules: the owner saves a city fee rule (base 30, 5 per km)', format('select public.ops_save_fee_rule(%L, null, 30, 5, null, null, 1, true)', t.u('cA')));
select t.ok('rules: saving the same scope again updates it', format('select public.ops_save_fee_rule(%L, null, 30, 5, null, null, 1, true)', t.u('cA')));
select t.check('rules: still exactly one rule for that city', (select jsonb_array_length(public.ops_pricing()->'fee')) = 1);
select t.check('rules: the owner sees canEdit', (public.ops_pricing()->>'canEdit')::boolean);
select t.root();

-- ================= C. the quote =================
select t.as_anon();
select t.check('quote: base + per km x distance (11.12 km x 5 + 30)', abs(t.fee(public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zK'), t.lat(), t.lng())) - (30 + 5 * 11.12)) < 0.3);
select t.check('quote: the distance is returned', abs((public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zK'), t.lat(), t.lng())->>'distanceKm')::numeric - 11.12) < 0.1);
select t.check('quote: source is distance', public.quote_delivery_fee(t.items(), t.u('cA'), null, t.lat(), t.lng())->>'source' = 'distance');
select t.check('quote: no customer position -> today''s flat fee and a hint to share the location', t.fee(public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zK'), null, null)) = 50 and (public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zK'), null, null)->>'needsLocation')::boolean);
select t.check('quote: a shop with no saved position -> flat fee (cannot measure)', t.fee(public.quote_delivery_fee(jsonb_build_array(jsonb_build_object('product_id', t.u('p2'), 'quantity', 1)), t.u('cA'), t.u('zK'), t.lat(), t.lng())) = 50);
select t.check('quote: a city with no rule keeps the flat fee', t.fee(public.quote_delivery_fee(t.items(), t.u('cB'), null, t.lat(), t.lng())) = 50);
select t.check('quote: free delivery over the threshold still wins', t.fee(public.quote_delivery_fee(t.items(false, 6), t.u('cA'), t.u('zK'), t.lat(), t.lng())) = 0);
select t.check('quote: free delivery is labelled free', public.quote_delivery_fee(t.items(false, 6), t.u('cA'), t.u('zK'), t.lat(), t.lng())->>'source' = 'free');
select t.check('quote: the subtotal comes from the live catalogue', (public.quote_delivery_fee(t.items(false, 3), t.u('cA'), t.u('zK'), t.lat(), t.lng())->>'subtotal')::numeric = 600);
select t.check('quote: the first shop with a position is used (cart with a pinless shop first)', abs(t.fee(public.quote_delivery_fee(t.items(true), t.u('cA'), t.u('zK'), t.lat(), t.lng())) - (30 + 5 * 11.12)) < 0.3);
select t.err('quote: an impossible position is refused', format('select public.quote_delivery_fee(%L::jsonb, %L, null, 95, 41)', t.items(), t.u('cA')), 'Invalid position');
select t.err('quote: an unknown city is refused', format('select public.quote_delivery_fee(%L::jsonb, %L, null, 9.6, 41.8)', t.items(), gen_random_uuid()), 'city');
select t.root();

select t.as_user(t.u('owner'));
select t.ok('rules: area rule (Kezira) with minimum 100 and maximum 120', format('select public.ops_save_fee_rule(%L, %L, 10, 20, 100, 120, 1, true)', t.u('cA'), t.u('zK')));
select t.as_anon();
select t.check('quote: the area rule wins over the city rule', t.fee(public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zK'), t.lat(), t.lng())) = 120);
select t.check('quote: maximum caps the fee', t.fee(public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zK'), t.lat(), t.lng())) <= 120);
select t.check('quote: minimum lifts a small fee', t.fee(public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zK'), 9.5901, 41.8600)) = 100);
select t.check('quote: another area of the same city falls back to the city rule', abs(t.fee(public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zS'), t.lat(), t.lng())) - (30 + 5 * 11.12)) < 0.3);
select t.root();
select t.as_user(t.u('owner'));
select t.ok('rules: switch the area rule off', format('select public.ops_save_fee_rule(%L, %L, 10, 20, 100, 120, 1, false)', t.u('cA'), t.u('zK')));
select t.as_anon();
select t.check('quote: an inactive rule is ignored', abs(t.fee(public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zK'), t.lat(), t.lng())) - (30 + 5 * 11.12)) < 0.3);
select t.root();
select t.as_user(t.u('owner'));
select t.ok('rules: road factor 1.5 makes roads longer than straight lines', format('select public.ops_save_fee_rule(%L, null, 30, 5, null, null, 1.5, true)', t.u('cA')));
select t.as_anon();
select t.check('quote: road factor applies to the distance', abs(t.fee(public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zS'), t.lat(), t.lng())) - (30 + 5 * 11.12 * 1.5)) < 0.6);
select t.root();
select t.as_user(t.u('owner'));
select t.ok('rules: restore road factor 1', format('select public.ops_save_fee_rule(%L, null, 30, 5, null, null, 1, true)', t.u('cA')));
select t.root();

-- ================= D. place_order stores the fee the server worked out =================
select t.as_anon();
select set_config('t.q1', (public.quote_delivery_fee(t.items(), t.u('cA'), t.u('zS'), t.lat(), t.lng())->>'fee'), true);
select set_config('t.k2', t.key(), true);
select set_config('t.o2', (public.place_order(t.items(), 'Selam', '0911000002', null, 'Sabian', null, 'cod', current_setting('t.k2'), '', t.u('cA'), t.u('zS'), t.lat(), t.lng(), 15::real))->>'order_number', true);
select t.root();
select t.check('order: the stored fee equals the quote the customer saw', t.ordfee(current_setting('t.o2')) = current_setting('t.q1')::numeric);
select t.check('order: total = items + fee', (select total_amount = 200 + delivery_fee from public.orders where order_number = current_setting('t.o2')));
select t.check('order: the payment amount equals the total', (select p.amount = o.total_amount from public.payments p join public.orders o on o.id = p.order_id where o.order_number = current_setting('t.o2')));
select t.check('order: source and distance are saved', (select delivery_fee_source = 'distance' and abs(delivery_distance_km - 11.12) < 0.1 from public.orders where order_number = current_setting('t.o2')));
select t.check('order: the city and area are saved with the order', (select city_id = t.u('cA') and zone_id = t.u('zS') from public.orders where order_number = current_setting('t.o2')));
select t.check('order: the customer position is saved', (select abs(ol.lat - t.lat()) < 0.0001 from public.order_locations ol join public.orders o on o.id = ol.order_id where o.order_number = current_setting('t.o2')));
select t.as_anon();
select t.check('order: sending the same key again returns the same order and fee', (public.place_order(t.items(), 'Selam', '0911000002', null, 'Sabian', null, 'cod', current_setting('t.k2'), '', t.u('cA'), t.u('zS'), t.lat(), t.lng(), 15::real))->>'order_number' = current_setting('t.o2'));
select t.err('order: city that does not exist refused', format('select public.place_order(%L::jsonb, %L, %L, null, %L, null, %L, %L, %L, %L::uuid, null::uuid, null::double precision, null::double precision, null::real)', t.items(), 'A B', '0911000003', 'Here', 'cod', t.key(), '', gen_random_uuid()), 'city');
select t.err('order: area from a different city refused', format('select public.place_order(%L::jsonb, %L, %L, null, %L, null, %L, %L, %L, %L::uuid, %L::uuid, null::double precision, null::double precision, null::real)', t.items(), 'A B', '0911000003', 'Here', 'cod', t.key(), '', t.u('cB'), t.u('zK')), 'does not belong');
select t.err('order: a city with areas needs one chosen', format('select public.place_order(%L::jsonb, %L, %L, null, %L, null, %L, %L, %L, %L::uuid, null::uuid, null::double precision, null::double precision, null::real)', t.items(), 'A B', '0911000003', 'Here', 'cod', t.key(), '', t.u('cA')), 'area');
select t.err('order: latitude without longitude refused', format('select public.place_order(%L::jsonb, %L, %L, null, %L, null, %L, %L, %L, null::uuid, null::uuid, 9.6::double precision, null::double precision, null::real)', t.items(), 'A B', '0911000003', 'Here', 'cod', t.key(), ''), 'position');
select t.err('order: a very weak GPS signal refused', format('select public.place_order(%L::jsonb, %L, %L, null, %L, null, %L, %L, %L, null::uuid, null::uuid, 9.6::double precision, 41.8::double precision, 9000::real)', t.items(), 'A B', '0911000003', 'Here', 'cod', t.key(), ''), 'weak');
select t.root();
select t.check('order: a refused order leaves no half-made order behind', not exists (select 1 from public.orders where customer_name = 'A B'));
select t.as_anon();
select set_config('t.o3', (public.place_order(t.items(), 'Rahel', '0911000004', null, 'Somewhere', null, 'cod', t.key(), '', t.u('cB'), null, t.lat(), t.lng(), null))->>'order_number', true);
select t.root();
select t.check('order: a city with no rate keeps the flat fee even with a position', t.ordfee(current_setting('t.o3')) = 50);
select t.check('order: the flat source is recorded', (select delivery_fee_source = 'flat' from public.orders where order_number = current_setting('t.o3')));
select t.as_anon();
select set_config('t.o4', (public.place_order(t.items(false, 6), 'Free', '0911000005', null, 'Somewhere', null, 'cod', t.key(), '', t.u('cA'), t.u('zS'), t.lat(), t.lng(), 10::real))->>'order_number', true);
select t.root();
select t.check('order: free delivery over the threshold is applied by the server', t.ordfee(current_setting('t.o4')) = 0 and (select delivery_fee_source = 'free' from public.orders where order_number = current_setting('t.o4')));

-- ================= E. driver pay rules =================
create function t.go(n text, drv text) returns void language plpgsql as $$
declare v_o uuid := (select id from public.orders where order_number = n);
begin
  update public.orders set status = 'ready', city_id = coalesce(city_id, t.u('cA')), zone_id = case when city_id is null then t.u('zK') else zone_id end where id = v_o;
  perform t.as_user(t.u('mgr')); perform public.assign_delivery(v_o, t.u(drv), null, null);
  perform t.as_user(t.u(drv)); perform public.driver_respond((select id from public.deliveries where order_id = v_o order by created_at desc limit 1), true, null);
  perform public.driver_mark_picked_up((select id from public.deliveries where order_id = v_o order by created_at desc limit 1));
  perform public.driver_start((select id from public.deliveries where order_id = v_o order by created_at desc limit 1));
  perform t.root();
end $$;
create function t.finish(n text, drv text) returns void language plpgsql as $$
declare v_d uuid := (select d.id from public.deliveries d join public.orders o on o.id = d.order_id where o.order_number = n order by d.created_at desc limit 1);
begin
  perform t.as_user(t.u(drv));
  perform public.driver_complete(v_d, t.photo(), (select code from public.order_codes oc join public.deliveries d on d.order_id = oc.order_id where d.id = v_d));
  perform t.root();
end $$;
create function t.pay(n text) returns numeric language sql security definer as $$
  select pr.driver_fee from public.delivery_progress pr join public.deliveries d on d.id = pr.delivery_id join public.orders o on o.id = d.order_id where o.order_number = n order by d.created_at desc limit 1 $$;
create function t.payid(n text) returns uuid language sql security definer as $$ select p.id from public.payments p join public.orders o on o.id = p.order_id where o.order_number = n $$;
create function t.codeof(n text) returns text language sql security definer as $$ select code from public.order_codes oc join public.orders o on o.id = oc.order_id where o.order_number = n $$;
-- the order code helper needs the real code: read it as the system and pass it explicitly
create or replace function t.finish(n text, drv text) returns void language plpgsql as $$
declare v_d uuid := (select d.id from public.deliveries d join public.orders o on o.id = d.order_id where o.order_number = n order by d.created_at desc limit 1); v_c text := t.codeof(n);
begin
  perform t.as_user(t.u(drv));
  perform public.driver_complete(v_d, t.photo(), v_c);
  perform t.root();
end $$;

select t.go(current_setting('t.o1'), 'drvA');
select t.finish(current_setting('t.o1'), 'drvA');
select t.check('pay: with no pay rule a delivered job stays unpriced (never invented)', t.pay(current_setting('t.o1')) is null);
select t.as_user(t.u('owner'));
select t.ok('pay: the owner sets a Dire Dawa pay rule (20 base, 2 per km)', format('select public.ops_save_pay_rule(%L, null, 20, 2, 1, true)', t.u('cA')));
select t.root();
select t.go(current_setting('t.o2'), 'drvA');
select t.finish(current_setting('t.o2'), 'drvA');
select t.check('pay: a delivered job gets the rule pay (20 + 2 x 11.12)', abs(t.pay(current_setting('t.o2')) - (20 + 2 * 11.12)) < 0.2);
select t.go(current_setting('t.o3'), 'drvA');
select t.root();
select t.as_user(t.u('mgr'));
select t.ok('pay: a hand-set pay on a job', format('select public.ops_set_driver_fee(%L, 77)', (select d.id from public.deliveries d join public.orders o on o.id = d.order_id where o.order_number = current_setting('t.o3') order by d.created_at desc limit 1)));
select t.root();
select t.finish(current_setting('t.o3'), 'drvA');
select t.check('pay: a hand-set pay wins over the rule', t.pay(current_setting('t.o3')) = 77);
select t.as_user(t.u('owner'));
select t.ok('pay: switch to a per-km-only rule', format('select public.ops_save_pay_rule(%L, null, 0, 3, 1, true)', t.u('cA')));
select t.root();
-- an order with a city but no customer position: per-km pay cannot be measured
insert into public.orders (order_number, customer_name, phone, delivery_location, status, channel, city_id, zone_id) values ('T-NOPIN', 'No Pin', '0911000099', 'x', 'ready', 'checkout', (select t.u('cA')), (select t.u('zK')));
select t.go('T-NOPIN', 'drvA');
select t.finish('T-NOPIN', 'drvA');
select t.check('pay: a per-km rule without positions leaves the job unpriced', t.pay('T-NOPIN') is null);

-- ================= F. driver earnings =================
select t.as_user(t.u('drvA'));
select t.check('earn: the driver sees what was earned in total', (public.driver_earnings()->>'earned')::numeric = (20 + 2 * 11.12)::numeric(12,2) + 77 or abs((public.driver_earnings()->>'earned')::numeric - ((20 + 2 * 11.12) + 77)) < 0.3);
select t.check('earn: nothing is paid yet, so all of it is owed', (public.driver_earnings()->>'paid')::numeric = 0 and abs((public.driver_earnings()->>'owed')::numeric - (public.driver_earnings()->>'earned')::numeric) < 0.001);
select t.check('earn: the old fields are still there', (public.driver_earnings()) ?& array['today', 'week', 'month', 'unpriced', 'days']);
select t.check('earn: weekly and monthly summaries are lists', jsonb_typeof(public.driver_earnings()->'weeks') = 'array' and jsonb_typeof(public.driver_earnings()->'months') = 'array');
select t.check('earn: this month holds the 3 priced jobs + 2 unpriced counted separately', (public.driver_earnings()->'month'->>'count')::int = 4 and (public.driver_earnings()->>'unpriced')::int = 2);
select t.as_user(t.u('drvB'));
select t.check('earn: another driver sees none of it', (public.driver_earnings()->>'earned')::numeric = 0);
select t.root();

-- ================= G. payouts =================
select set_config('t.owed', ((select public.ops_driver_earnings(current_date - 30, current_date)) -> 'rows' -> 0 ->> 'owed'), true) where false;
select t.as_user(t.u('mgr'));
select t.err('payout: a manager cannot record a payout', format('select public.ops_record_payout(%L, 10, %L, %L, current_date, null, null, null)', t.u('drvA'), 'cash', null), 'owner');
select t.check('payout: a manager can read the earnings overview but not pay', (public.ops_driver_earnings(current_date - 30, current_date)->>'canPay')::boolean = false);
select t.as_user(t.u('drvA'));
select t.err('payout: a driver cannot read the overview', 'select public.ops_driver_earnings(current_date - 30, current_date)', 'Not allowed');
select t.err('payout: a driver cannot record a payout to themselves', format('select public.ops_record_payout(%L, 10, %L, %L, current_date, null, null, null)', t.u('drvA'), 'cash', null), 'owner');
select t.as_user(t.u('owner'));
select t.check('payout: the overview lists drivers with owed amounts', (select (r->>'owed')::numeric > 0 from jsonb_array_elements(public.ops_driver_earnings(current_date - 30, current_date)->'rows') r where r->>'driver' = t.u('drvA')::text));
select t.err('payout: more than owed is refused', format('select public.ops_record_payout(%L, 100000, %L, %L, current_date, null, null, null)', t.u('drvA'), 'cash', null), 'more than');
select t.err('payout: zero refused', format('select public.ops_record_payout(%L, 0, %L, %L, current_date, null, null, null)', t.u('drvA'), 'cash', null), 'amount');
select t.err('payout: a transfer needs its reference', format('select public.ops_record_payout(%L, 10, %L, %L, current_date, null, null, null)', t.u('drvA'), 'bank_transfer', null), 'reference');
select t.err('payout: a future date refused', format('select public.ops_record_payout(%L, 10, %L, %L, current_date + 5, null, null, null)', t.u('drvA'), 'cash', null), 'future');
select t.err('payout: a payout to a driver with nothing earned is refused', format('select public.ops_record_payout(%L, 10, %L, %L, current_date, null, null, null)', t.u('drvB'), 'cash', null), 'more than');
select t.err('payout: an invalid method refused', format('select public.ops_record_payout(%L, 10, %L, %L, current_date, null, null, null)', t.u('drvA'), 'bitcoin', 'x'), 'how it was paid');
select set_config('t.pay1', public.ops_record_payout(t.u('drvA'), 50, 'bank_transfer', 'TXN-1001', current_date, current_date - 7, current_date, 'Weekly')::text, true);
select t.check('payout: recorded', current_setting('t.pay1')::uuid is not null);
select t.check('payout: owed went down by the amount paid', abs((select (r->>'owed')::numeric from jsonb_array_elements(public.ops_driver_earnings(current_date - 30, current_date)->'rows') r where r->>'driver' = t.u('drvA')::text) - ((20 + 2 * 11.12) + 77 - 50)) < 0.3);
select t.err('payout: you cannot pay more than what is left owed', format('select public.ops_record_payout(%L, 1000, %L, %L, current_date, null, null, null)', t.u('drvA'), 'cash', null), 'more than');
select t.root();
select t.check('payout: the driver was notified', t.nots('driver_payout', t.u('drvA')) = 1);
select t.check('payout: it is in the activity log', exists (select 1 from public.activity_logs where action = 'driver_payout'));
select t.err('payout: the record cannot be edited (even by the database owner)', format('update public.driver_payouts set amount = 1 where id = %L', current_setting('t.pay1')), 'cannot be changed');
select t.err('payout: the record cannot be deleted', format('delete from public.driver_payouts where id = %L', current_setting('t.pay1')), 'cannot be changed');
select t.err('payout: the table cannot be truncated', 'truncate public.driver_payouts cascade', 'cannot be changed');
select t.as_user(t.u('drvA'));
select t.check('payout: the driver sees their own payout', (select count(*) from jsonb_array_elements(public.driver_payouts())) = 1);
select t.check('payout: the driver''s paid and owed are updated', abs((public.driver_earnings()->>'paid')::numeric - 50) < 0.001);
select t.as_user(t.u('drvB'));
select t.check('payout: another driver sees none of it', (select count(*) from jsonb_array_elements(public.driver_payouts())) = 0);
select t.as_user(t.u('mgr'));
select t.err('payout: a manager cannot cancel a payout record', format('select public.ops_void_payout(%L, %L)', current_setting('t.pay1'), 'entered twice'), 'owner');
select t.check('payout: a manager can list the history', (select count(*) from jsonb_array_elements(public.ops_driver_payouts(t.u('drvA')))) = 1);
select t.as_user(t.u('owner'));
select t.err('payout: cancelling needs a reason', format('select public.ops_void_payout(%L, %L)', current_setting('t.pay1'), 'x'), 'why');
select t.ok('payout: the owner cancels a wrong record with a reason', format('select public.ops_void_payout(%L, %L)', current_setting('t.pay1'), 'Entered twice by mistake'));
select t.err('payout: cancelling twice refused', format('select public.ops_void_payout(%L, %L)', current_setting('t.pay1'), 'again please'), 'already');
select t.check('payout: after cancelling, the amount is owed again', abs((select (r->>'owed')::numeric from jsonb_array_elements(public.ops_driver_earnings(current_date - 30, current_date)->'rows') r where r->>'driver' = t.u('drvA')::text) - ((20 + 2 * 11.12) + 77)) < 0.3);
select t.check('payout: the cancelled record stays visible in the history', (select (x->>'voided')::boolean from jsonb_array_elements(public.ops_driver_payouts(t.u('drvA'))) x limit 1));
select t.root();
select t.err('payout: a cancel record cannot be changed either', format('update public.driver_payout_voids set reason = %L where payout_id = %L', 'changed', current_setting('t.pay1')), 'cannot be changed');

-- ================= H. cash handover =================
insert into public.orders (order_number, customer_name, phone, delivery_location, status, channel, city_id) values
  ('T-C1', 'Cash One', '0911000071', 'x', 'ready', 'checkout', (select t.u('cA'))), ('T-C2', 'Cash Two', '0911000072', 'x', 'ready', 'checkout', (select t.u('cA')));
insert into public.payments (order_id, method, amount, status) select id, 'cod', 400, 'pending' from public.orders where order_number = 'T-C1';
insert into public.payments (order_id, method, amount, status) select id, 'cod', 250, 'pending' from public.orders where order_number = 'T-C2';
select t.go('T-C1', 'drvB'); select t.go('T-C2', 'drvB');
select t.as_user(t.u('drvB'));
select t.ok('cash: the driver confirms cash for the first order', format('select public.confirm_cod_collection(%L, 400)', t.payid('T-C1')));
select t.ok('cash: and for the second', format('select public.confirm_cod_collection(%L, 250)', t.payid('T-C2')));
select t.check('cash: the driver is holding 650 ETB', (public.driver_cash()->>'holding')::numeric = 650);
select t.check('cash: the two orders are listed', jsonb_array_length(public.driver_cash()->'orders') = 2);
select t.as_user(t.u('drvA'));
select t.check('cash: another driver holds nothing', (public.driver_cash()->>'holding')::numeric = 0);
select t.err('cash: nothing to hand over -> refused', 'select public.driver_submit_handover(10, null)', 'no collected cash');
select t.as_user(t.u('drvB'));
select t.err('cash: a negative amount refused', 'select public.driver_submit_handover(-5, null)', 'Enter');
select set_config('t.h1', public.driver_submit_handover(600, 'Short by 50')::text, true);
select t.root();
select t.check('cash: the handover is recorded with expected 650 and declared 600', (select expected = 650 and declared = 600 and status = 'submitted' from public.cash_handovers where id = current_setting('t.h1')::uuid) is not distinct from true) ;
select t.as_user(t.u('drvB'));
select t.check('cash: after handing over the driver holds nothing', (public.driver_cash()->>'holding')::numeric = 0);
select t.err('cash: the same cash cannot be handed over twice', 'select public.driver_submit_handover(650, null)', 'no collected cash');
select t.check('cash: the driver sees the handover as waiting', (public.driver_cash()->'recent'->0->>'status') = 'submitted');
select t.root();
select t.check('cash: the managers were told', t.nots('cash_handover') >= 1);
select t.as_user(t.u('staff'));
select t.err('cash: staff without the permission cannot read the overview', 'select public.ops_cash_overview()', 'Not allowed');
select t.err('cash: staff cannot confirm', format('select public.ops_confirm_handover(%L, 600, %L)', current_setting('t.h1'), 'ok'), 'not allowed');
select t.as_user(t.u('drvB'));
select t.err('cash: a driver cannot confirm their own handover', format('select public.ops_confirm_handover(%L, 650, %L)', current_setting('t.h1'), 'ok'), 'not allowed');
select t.err('cash: a driver cannot read the office overview', 'select public.ops_cash_overview()', 'Not allowed');
select t.as_user(t.u('mgr'));
select t.check('cash: the manager sees the waiting handover with the difference', (select (h->>'declared')::numeric = 600 and (h->>'expected')::numeric = 650 and h->>'orders' = 'T-C1, T-C2' from jsonb_array_elements(public.ops_cash_overview()->'handovers') h limit 1));
select t.err('cash: a difference needs an explanation', format('select public.ops_confirm_handover(%L, 600, null)', current_setting('t.h1')), 'differs');
select t.err('cash: a negative received amount refused', format('select public.ops_confirm_handover(%L, -1, %L)', current_setting('t.h1'), 'x'), 'Enter');
select t.ok('cash: the manager confirms 600 with a note', format('select public.ops_confirm_handover(%L, 600, %L)', current_setting('t.h1'), 'Driver paid 50 for fuel, will settle'));
select t.err('cash: confirming twice refused', format('select public.ops_confirm_handover(%L, 600, %L)', current_setting('t.h1'), 'again please'), 'already');
select t.root();
select t.check('cash: the difference (-50) is stored', (select difference = -50 and received = 600 and status = 'confirmed' from public.cash_handovers where id = current_setting('t.h1')::uuid));
select t.check('cash: the driver was told', t.nots('cash_handover', t.u('drvB')) >= 1);
select t.check('cash: a difference alerts the managers', t.nots('cash_difference') >= 1);
select t.err('cash: handover records cannot be deleted', format('delete from public.cash_handovers where id = %L', current_setting('t.h1')), 'cannot be changed');
select t.check('cash: the collected payments are linked to the handover', (select count(*) = 2 from public.payments where handover_id = current_setting('t.h1')::uuid));
select t.as_user(t.u('mgr'));
select t.check('cash: the overview no longer shows that cash as held', not exists (select 1 from jsonb_array_elements(public.ops_cash_overview()->'holding') x where x->>'driver' = t.u('drvB')::text));
select t.root();

-- ================= I. security =================
select t.as_user(t.u('drvA'));
select t.err('security: fee rules are not readable directly', 'select * from public.delivery_fee_rules', 'permission denied');
select t.err('security: pay rules are not readable directly', 'select * from public.driver_pay_rules', 'permission denied');
select t.err('security: payouts are not readable directly', 'select * from public.driver_payouts', 'permission denied');
select t.err('security: handovers are not readable directly', 'select * from public.cash_handovers', 'permission denied');
select t.err('security: payouts cannot be inserted directly', format('insert into public.driver_payouts (driver, amount, method, paid_on, recorded_by) values (%L, 5, %L, current_date, %L)', t.u('drvA'), 'cash', t.u('drvA')), 'permission denied');
select t.err('security: the fee calculator is internal', format('select public._delivery_fee(%L::jsonb, null, null, null, null, 0)', t.items()), 'permission denied');
select t.err('security: the pay calculator is internal', format('select public._driver_pay_for(%L)', gen_random_uuid()), 'permission denied');
select t.as_anon();
select t.err('security: a guest cannot open the earnings', 'select public.driver_earnings()', 'permission denied');
select t.err('security: a guest cannot open the cash screen', 'select public.driver_cash()', 'permission denied');
select t.err('security: a guest cannot record a payout', format('select public.ops_record_payout(%L, 5, %L, null, current_date, null, null, null)', t.u('drvA'), 'cash'), 'permission denied');
select t.err('security: a guest cannot confirm cash', format('select public.ops_confirm_handover(%L, 5, null)', gen_random_uuid()), 'permission denied');
select t.root();
select t.check('security: row level security is on for every new table', (select bool_and(relrowsecurity) from pg_class where relname in ('delivery_fee_rules', 'driver_pay_rules', 'driver_payouts', 'driver_payout_voids', 'cash_handovers') and relnamespace = 'public'::regnamespace));
select t.check('security: every new function runs as its owner with a fixed search path', (select bool_and(prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('quote_delivery_fee', 'ops_pricing', 'ops_save_fee_rule', 'ops_save_pay_rule', 'ops_delete_rule', 'driver_earnings', 'driver_payouts', 'ops_driver_earnings', 'ops_driver_payouts', 'ops_record_payout', 'ops_void_payout', 'driver_cash', 'driver_submit_handover', 'ops_cash_overview', 'ops_confirm_handover', '_delivery_fee', '_driver_pay_for', '_deliver')));
select t.as_user(t.u('owner'));
select t.ok('rules: the owner can delete a rule', format('select public.ops_delete_rule(%L, %L)', 'fee', (select (r->>'id')::uuid from jsonb_array_elements(public.ops_pricing()->'fee') r limit 1)));
select t.err('rules: an unknown rule type refused', format('select public.ops_delete_rule(%L, %L)', 'other', gen_random_uuid()), 'Unknown');
select t.root();

-- ---------- report ----------
select t.root();
\o
select format('%s  %s%s', case when ok then 'PASS' else 'FAIL' end, name, coalesce('   <- ' || detail, '')) as result from t.results order by n;
select format('%s passed, %s failed', count(*) filter (where ok), count(*) filter (where not ok)) as summary from t.results;
do $$ begin if exists (select 1 from t.results where not ok) then raise exception 'Phase 3 SQL tests FAILED'; end if; end $$;
rollback;
