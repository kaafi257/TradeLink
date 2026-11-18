-- TradeLink reporting center, stage 1: overview, customers, orders, inquiries, inventory and financial reports.
-- Every function is SECURITY INVOKER, so Row Level Security still decides which rows the caller can read, and each
-- one also requires the 'reports.view' permission. Customer phone numbers and emails are masked unless the caller has
-- 'reports.sensitive' (the owner always has it). Additive and safe to run more than once. Run 0009 first.

-- ---------------------------------------------------------------------------
-- 1. Permissions. The owner has every permission; managers get reports.view by default.
--    'reports.sensitive' (full customer contact details in reports) is owner-only unless granted in Staff Management.
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values ('manager', 'reports.view') on conflict do nothing;

create or replace function public.reports_guard() returns void language plpgsql stable set search_path = public as $$
begin
  if not public.has_permission('reports.view') then
    raise exception 'You do not have permission to view reports.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.report_mask(p text) returns text language plpgsql stable set search_path = public as $$
begin
  if p is null or p = '' then return p; end if;
  if public.has_permission('reports.sensitive') then return p; end if;
  if length(p) <= 4 then return repeat('*', length(p)); end if;
  return left(p, 3) || repeat('*', greatest(length(p) - 5, 1)) || right(p, 2);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Shared views (security_invoker: they run with the caller's own row access).
--    A "customer" is one person identified by the last 9 digits of their phone number, because TradeLink has no
--    customer accounts: people send quote requests and place orders with a name and phone.
-- ---------------------------------------------------------------------------
drop view if exists public.report_customer_events;
create view public.report_customer_events with (security_invoker = true) as
  select right(regexp_replace(q.phone, '\D', '', 'g'), 9) as k, q.customer_name as name, q.phone, q.email,
         q.customer_type as type, q.created_at as at, 'quote'::text as src, q.id, 0::numeric as amount
  from public.quotations q
  union all
  select right(regexp_replace(o.phone, '\D', '', 'g'), 9), o.customer_name, o.phone, null::text,
         coalesce(q.customer_type, 'business'), o.created_at, 'order', o.id,
         case when o.status <> 'cancelled' then o.total_amount else 0 end
  from public.orders o left join public.quotations q on q.id = o.quotation_id;

drop view if exists public.report_orders_v;
create view public.report_orders_v with (security_invoker = true) as
  select o.id, o.order_number, o.customer_name, o.phone, o.delivery_location, o.status,
         case o.status when 'pending' then 'pending' when 'confirmed' then 'pending'
                       when 'processing' then 'processing' when 'ready' then 'processing' when 'dispatched' then 'processing'
                       when 'completed' then 'completed' else 'cancelled' end as stage,
         case when q.customer_type = 'individual' then 'retail' else 'wholesale' end as order_type,
         o.total_amount, o.amount_paid, o.created_at,
         (select d.status from public.deliveries d where d.order_id = o.id order by d.created_at desc limit 1) as delivery_status
  from public.orders o left join public.quotations q on q.id = o.quotation_id;

grant select on public.report_customer_events, public.report_orders_v to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Overview
-- ---------------------------------------------------------------------------
create or replace function public.report_overview(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare v_pf timestamptz := p_from - (p_to - p_from); r jsonb;
begin
  perform public.reports_guard();
  select jsonb_build_object(
    'customers_total',  (select count(distinct k) from public.report_customer_events where k <> ''),
    'customers_active', (select count(distinct k) from public.report_customer_events where k <> '' and at >= p_from and at < p_to),
    'customers_new',    (select count(*) from (select k, min(at) f from public.report_customer_events where k <> '' group by k) x where f >= p_from and f < p_to),
    'customers_new_prev', (select count(*) from (select k, min(at) f from public.report_customer_events where k <> '' group by k) x where f >= v_pf and f < p_from),
    'suppliers_total',    (select count(*) from public.suppliers),
    'suppliers_verified', (select count(*) from public.suppliers where status = 'approved'),
    'suppliers_pending',  (select count(*) from public.suppliers where status = 'pending'),
    'suppliers_new',      (select count(*) from public.suppliers where created_at >= p_from and created_at < p_to),
    'products_total',   (select count(*) from public.products),
    'products_active',  (select count(*) from public.products where active),
    'products_out',     (select count(*) from public.products where active and stock_quantity <= 0),
    'orders_total',     (select count(*) from public.orders where created_at >= p_from and created_at < p_to),
    'orders_prev',      (select count(*) from public.orders where created_at >= v_pf and created_at < p_from),
    'orders_all',       (select count(*) from public.orders),
    'quotes_total',     (select count(*) from public.quotations where created_at >= p_from and created_at < p_to),
    'quotes_prev',      (select count(*) from public.quotations where created_at >= v_pf and created_at < p_from),
    'revenue',          (select coalesce(sum(total_amount), 0) from public.sales where sold_at >= p_from and sold_at < p_to),
    'revenue_prev',     (select coalesce(sum(total_amount), 0) from public.sales where sold_at >= v_pf and sold_at < p_from),
    'staff_total',      (select count(*) from public.profiles where active),
    'staff_active',     (select count(distinct actor_id) from public.activity_logs where actor_id is not null and created_at >= p_from and created_at < p_to),
    'activity',         (select count(*) from public.activity_logs where created_at >= p_from and created_at < p_to),
    'activity_prev',    (select count(*) from public.activity_logs where created_at >= v_pf and created_at < p_from)
  ) into r;
  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Time series for charts. Buckets are cut in the caller's time zone, with empty periods filled with zero.
-- ---------------------------------------------------------------------------
create or replace function public.report_series(p_metric text, p_from timestamptz, p_to timestamptz, p_bucket text default 'day', p_tz text default 'UTC')
returns table (bucket date, value numeric)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  if p_bucket not in ('day', 'week', 'month') then raise exception 'Unknown bucket.'; end if;
  if p_to - p_from > interval '800 days' then raise exception 'Choose a shorter period.'; end if;
  return query
  with b as (
    select (g at time zone p_tz)::date as d
    from generate_series(date_trunc(p_bucket, p_from at time zone p_tz), date_trunc(p_bucket, (p_to - interval '1 second') at time zone p_tz), ('1 ' || p_bucket)::interval) g
  ), ev as (
    select date_trunc(p_bucket, o.created_at at time zone p_tz)::date as d, 1::numeric as v from public.orders o
      where p_metric = 'orders' and o.created_at >= p_from and o.created_at < p_to
    union all select date_trunc(p_bucket, q.created_at at time zone p_tz)::date, 1 from public.quotations q
      where p_metric = 'quotes' and q.created_at >= p_from and q.created_at < p_to
    union all select date_trunc(p_bucket, s.sold_at at time zone p_tz)::date, s.total_amount from public.sales s
      where p_metric = 'revenue' and s.sold_at >= p_from and s.sold_at < p_to
    union all select date_trunc(p_bucket, s.sold_at at time zone p_tz)::date, s.amount_paid from public.sales s
      where p_metric = 'collected' and s.sold_at >= p_from and s.sold_at < p_to
    union all select date_trunc(p_bucket, f.first_at at time zone p_tz)::date, 1
      from (select k, min(at) as first_at from public.report_customer_events where k <> '' group by k) f
      where p_metric = 'new_customers' and f.first_at >= p_from and f.first_at < p_to
    union all select date_trunc(p_bucket, m.created_at at time zone p_tz)::date, 1 from public.inventory_movements m
      where p_metric = 'stock_movements' and m.created_at >= p_from and m.created_at < p_to
    union all select date_trunc(p_bucket, a.created_at at time zone p_tz)::date, 1 from public.activity_logs a
      where p_metric = 'activity' and a.created_at >= p_from and a.created_at < p_to
  )
  select b.d, coalesce(sum(ev.v), 0) from b left join ev on ev.d = b.d group by b.d order by b.d;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Customers
-- ---------------------------------------------------------------------------
create or replace function public.report_customer_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.reports_guard();
  with act as (
    select k, bool_or(type = 'individual') as retail, count(*) filter (where src = 'order') as orders
    from public.report_customer_events where k <> '' and at >= p_from and at < p_to group by k
  ), firsts as (select k, min(at) f from public.report_customer_events where k <> '' group by k)
  select jsonb_build_object(
    'total',    (select count(*) from firsts),
    'active',   (select count(*) from act),
    'new',      (select count(*) from firsts where f >= p_from and f < p_to),
    'retail',   (select count(*) from act where retail),
    'business', (select count(*) from act where not retail),
    'ordering', (select count(*) from act where orders > 0),
    'repeat',   (select count(*) from (select k from public.report_customer_events where k <> '' and at >= p_from and at < p_to group by k having count(*) > 1) x)
  ) into r;
  return r;
end;
$$;

create or replace function public.report_customers(p_from timestamptz, p_to timestamptz, p_type text default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (customer_key text, name text, phone text, email text, type text, quotes bigint, orders bigint, spent numeric, first_seen timestamptz, last_seen timestamptz, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  with firsts as (select e.k, min(e.at) f from public.report_customer_events e where e.k <> '' group by e.k),
  agg as (
    select e.k,
           (array_agg(e.name order by e.at desc))[1] as nm,
           (array_agg(e.phone order by e.at desc))[1] as ph,
           (array_agg(e.email order by e.at desc) filter (where e.email is not null))[1] as em,
           case when bool_or(e.type = 'individual') then 'individual' else 'business' end as ty,
           count(*) filter (where e.src = 'quote') as qn,
           count(*) filter (where e.src = 'order') as onum,
           sum(e.amount) as sp, max(e.at) as ls
    from public.report_customer_events e
    where e.k <> '' and e.at >= p_from and e.at < p_to
    group by e.k
  )
  select a.k, a.nm, public.report_mask(a.ph),
         case when public.has_permission('reports.sensitive') then a.em else null end,
         a.ty, a.qn, a.onum, coalesce(a.sp, 0), f.f, a.ls, count(*) over ()
  from agg a join firsts f on f.k = a.k
  where (p_type is null or p_type = '' or a.ty = p_type)
    and (p_search is null or p_search = '' or a.nm ilike '%' || p_search || '%' or a.ph ilike '%' || p_search || '%')
  order by coalesce(a.sp, 0) desc, a.ls desc
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Orders
-- ---------------------------------------------------------------------------
create or replace function public.report_order_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.reports_guard();
  select jsonb_build_object(
    'total',       count(*),
    'value',       coalesce(sum(total_amount) filter (where stage <> 'cancelled'), 0),
    'paid',        coalesce(sum(amount_paid) filter (where stage <> 'cancelled'), 0),
    'retail',      count(*) filter (where order_type = 'retail'),
    'wholesale',   count(*) filter (where order_type = 'wholesale'),
    'pending',     count(*) filter (where stage = 'pending'),
    'processing',  count(*) filter (where stage = 'processing'),
    'completed',   count(*) filter (where stage = 'completed'),
    'cancelled',   count(*) filter (where stage = 'cancelled'),
    'by_status',   coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.report_orders_v where created_at >= p_from and created_at < p_to group by status) s), '{}'::jsonb),
    'delivery',    coalesce((select jsonb_object_agg(coalesce(delivery_status, 'none'), n) from (select delivery_status, count(*) n from public.report_orders_v where created_at >= p_from and created_at < p_to and stage <> 'cancelled' group by delivery_status) s), '{}'::jsonb)
  ) into r
  from public.report_orders_v where created_at >= p_from and created_at < p_to;
  return r;
end;
$$;

create or replace function public.report_orders(p_from timestamptz, p_to timestamptz, p_stage text default null, p_type text default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, order_number text, customer_name text, phone text, location text, status text, order_type text, total numeric, paid numeric, delivery_status text, created_at timestamptz, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  select v.id, v.order_number, v.customer_name, public.report_mask(v.phone), v.delivery_location, v.status, v.order_type,
         v.total_amount, v.amount_paid, v.delivery_status, v.created_at, count(*) over ()
  from public.report_orders_v v
  where v.created_at >= p_from and v.created_at < p_to
    and (p_stage is null or p_stage = '' or v.stage = p_stage or v.status = p_stage)
    and (p_type is null or p_type = '' or v.order_type = p_type)
    and (p_search is null or p_search = '' or v.order_number ilike '%' || p_search || '%' or v.customer_name ilike '%' || p_search || '%')
  order by v.created_at desc
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Inquiries and RFQs (customer quotation requests)
-- ---------------------------------------------------------------------------
create or replace function public.report_inquiry_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.reports_guard();
  select jsonb_build_object(
    'total',      count(*),
    'wholesale',  count(*) filter (where customer_type = 'business'),
    'retail',     count(*) filter (where customer_type = 'individual'),
    'pending',    count(*) filter (where status in ('new', 'reviewing')),
    'answered',   count(*) filter (where status in ('quoted', 'accepted')),
    'converted',  count(*) filter (where status = 'converted'),
    'rejected',   count(*) filter (where status = 'rejected'),
    'by_status',  coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.quotations where created_at >= p_from and created_at < p_to group by status) s), '{}'::jsonb),
    'avg_response_hours', (select round(avg(extract(epoch from (updated_at - created_at)) / 3600)::numeric, 1)
                           from public.quotations where created_at >= p_from and created_at < p_to and status not in ('new', 'reviewing')),
    'value',      coalesce(sum(estimated_total), 0)
  ) into r
  from public.quotations where created_at >= p_from and created_at < p_to;
  return r;
end;
$$;

create or replace function public.report_inquiries(p_from timestamptz, p_to timestamptz, p_status text default null, p_type text default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, quote_number text, customer_name text, phone text, location text, status text, customer_type text, estimated_total numeric, items bigint, created_at timestamptz, updated_at timestamptz, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  select q.id, q.quote_number, q.customer_name, public.report_mask(q.phone), q.delivery_location, q.status, q.customer_type, q.estimated_total,
         (select count(*) from public.quotation_items i where i.quotation_id = q.id), q.created_at, q.updated_at, count(*) over ()
  from public.quotations q
  where q.created_at >= p_from and q.created_at < p_to
    and (p_status is null or p_status = '' or q.status = p_status
         or (p_status = 'pending' and q.status in ('new', 'reviewing')) or (p_status = 'answered' and q.status in ('quoted', 'accepted')))
    and (p_type is null or p_type = '' or q.customer_type = p_type)
    and (p_search is null or p_search = '' or q.quote_number ilike '%' || p_search || '%' or q.customer_name ilike '%' || p_search || '%')
  order by q.created_at desc
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Inventory
-- ---------------------------------------------------------------------------
create or replace function public.report_inventory_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.reports_guard();
  select jsonb_build_object(
    'products',    count(*),
    'ok',          count(*) filter (where stock_quantity > 0 and not (reorder_level > 0 and stock_quantity <= reorder_level)),
    'low',         count(*) filter (where stock_quantity > 0 and reorder_level > 0 and stock_quantity <= reorder_level),
    'out',         count(*) filter (where stock_quantity <= 0),
    'stock_value', coalesce(sum(greatest(stock_quantity, 0) * wholesale_price), 0),
    'movements',   (select count(*) from public.inventory_movements m where m.created_at >= p_from and m.created_at < p_to),
    'units_in',    (select coalesce(sum(quantity), 0) from public.inventory_movements m where m.created_at >= p_from and m.created_at < p_to and movement_type in ('purchase', 'adjustment_in', 'return')),
    'units_out',   (select coalesce(sum(quantity), 0) from public.inventory_movements m where m.created_at >= p_from and m.created_at < p_to and movement_type in ('sale', 'adjustment_out', 'damage')),
    'by_type',     coalesce((select jsonb_object_agg(movement_type, n) from (select movement_type, count(*) n from public.inventory_movements m where m.created_at >= p_from and m.created_at < p_to group by movement_type) s), '{}'::jsonb)
  ) into r
  from public.products where active;
  return r;
end;
$$;

create or replace function public.report_stock(p_status text default null, p_category text default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, name text, sku text, category text, unit text, stock numeric, reorder_level numeric, status text, value numeric, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  with s as (
    select p.id, p.name, p.sku, p.category, p.unit, p.stock_quantity as stock, p.reorder_level as rl,
           case when p.stock_quantity <= 0 then 'out' when p.reorder_level > 0 and p.stock_quantity <= p.reorder_level then 'low' else 'ok' end as st,
           greatest(p.stock_quantity, 0) * p.wholesale_price as val
    from public.products p where p.active
  )
  select s.id, s.name, s.sku, s.category, s.unit, s.stock, s.rl, s.st, s.val, count(*) over ()
  from s
  where (p_status is null or p_status = '' or s.st = p_status)
    and (p_category is null or p_category = '' or s.category = p_category)
    and (p_search is null or p_search = '' or s.name ilike '%' || p_search || '%' or s.sku ilike '%' || p_search || '%')
  order by case s.st when 'out' then 0 when 'low' then 1 else 2 end, s.name
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.report_movements(p_from timestamptz, p_to timestamptz, p_type text default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, created_at timestamptz, product text, movement_type text, quantity numeric, reference text, notes text, by_name text, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  select m.id, m.created_at, p.name, m.movement_type, m.quantity, m.reference, m.notes, pr.full_name, count(*) over ()
  from public.inventory_movements m
  join public.products p on p.id = m.product_id
  left join public.profiles pr on pr.id = m.created_by
  where m.created_at >= p_from and m.created_at < p_to
    and (p_type is null or p_type = '' or m.movement_type = p_type)
    and (p_search is null or p_search = '' or p.name ilike '%' || p_search || '%')
  order by m.created_at desc
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Financial. Commissions, supplier earnings and refunds are not recorded yet (they start with supplier orders),
--    so they are reported as null instead of an invented number.
-- ---------------------------------------------------------------------------
create or replace function public.report_financial_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare v_pf timestamptz := p_from - (p_to - p_from); r jsonb;
begin
  perform public.reports_guard();
  select jsonb_build_object(
    'sales',        count(*),
    'revenue',      coalesce(sum(total_amount), 0),
    'collected',    coalesce(sum(amount_paid), 0),
    'outstanding',  coalesce(sum(total_amount - amount_paid), 0),
    'average',      coalesce(round(avg(total_amount), 2), 0),
    'revenue_prev', (select coalesce(sum(total_amount), 0) from public.sales where sold_at >= v_pf and sold_at < p_from),
    'by_method',    coalesce((select jsonb_agg(jsonb_build_object('method', coalesce(method, 'other'), 'count', n, 'amount', amt) order by amt desc)
                              from (select payment_method as method, count(*) n, sum(total_amount) amt from public.sales where sold_at >= p_from and sold_at < p_to group by payment_method) s), '[]'::jsonb),
    'commissions',  null,
    'supplier_earnings', null,
    'refunds',      null
  ) into r
  from public.sales where sold_at >= p_from and sold_at < p_to;
  return r;
end;
$$;

create or replace function public.report_financial_periods(p_from timestamptz, p_to timestamptz, p_bucket text default 'day', p_tz text default 'UTC')
returns table (bucket date, sales bigint, revenue numeric, collected numeric, outstanding numeric)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  if p_bucket not in ('day', 'week', 'month') then raise exception 'Unknown bucket.'; end if;
  if p_to - p_from > interval '800 days' then raise exception 'Choose a shorter period.'; end if;
  return query
  with b as (
    select (g at time zone p_tz)::date as d
    from generate_series(date_trunc(p_bucket, p_from at time zone p_tz), date_trunc(p_bucket, (p_to - interval '1 second') at time zone p_tz), ('1 ' || p_bucket)::interval) g
  ), s as (
    select date_trunc(p_bucket, x.sold_at at time zone p_tz)::date as d, count(*) n, sum(x.total_amount) rev, sum(x.amount_paid) col
    from public.sales x where x.sold_at >= p_from and x.sold_at < p_to group by 1
  )
  select b.d, coalesce(s.n, 0), coalesce(s.rev, 0), coalesce(s.col, 0), coalesce(s.rev - s.col, 0)
  from b left join s on s.d = b.d order by b.d desc;
end;
$$;

create or replace function public.report_sales(p_from timestamptz, p_to timestamptz, p_method text default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, receipt_number text, customer_name text, payment_method text, total numeric, paid numeric, sold_at timestamptz, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  select s.id, s.receipt_number, s.customer_name, s.payment_method, s.total_amount, s.amount_paid, s.sold_at, count(*) over ()
  from public.sales s
  where s.sold_at >= p_from and s.sold_at < p_to
    and (p_method is null or p_method = '' or s.payment_method = p_method)
    and (p_search is null or p_search = '' or s.receipt_number ilike '%' || p_search || '%' or s.customer_name ilike '%' || p_search || '%')
  order by s.sold_at desc
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end;
$$;

-- Report functions are for signed-in staff only; the permission check inside decides who gets data.
revoke all on function
  public.reports_guard(), public.report_mask(text), public.report_overview(timestamptz, timestamptz),
  public.report_series(text, timestamptz, timestamptz, text, text),
  public.report_customer_summary(timestamptz, timestamptz), public.report_customers(timestamptz, timestamptz, text, text, int, int),
  public.report_order_summary(timestamptz, timestamptz), public.report_orders(timestamptz, timestamptz, text, text, text, int, int),
  public.report_inquiry_summary(timestamptz, timestamptz), public.report_inquiries(timestamptz, timestamptz, text, text, text, int, int),
  public.report_inventory_summary(timestamptz, timestamptz), public.report_stock(text, text, text, int, int),
  public.report_movements(timestamptz, timestamptz, text, text, int, int),
  public.report_financial_summary(timestamptz, timestamptz), public.report_financial_periods(timestamptz, timestamptz, text, text),
  public.report_sales(timestamptz, timestamptz, text, text, int, int)
from public, anon;
grant execute on function
  public.reports_guard(), public.report_mask(text), public.report_overview(timestamptz, timestamptz),
  public.report_series(text, timestamptz, timestamptz, text, text),
  public.report_customer_summary(timestamptz, timestamptz), public.report_customers(timestamptz, timestamptz, text, text, int, int),
  public.report_order_summary(timestamptz, timestamptz), public.report_orders(timestamptz, timestamptz, text, text, text, int, int),
  public.report_inquiry_summary(timestamptz, timestamptz), public.report_inquiries(timestamptz, timestamptz, text, text, text, int, int),
  public.report_inventory_summary(timestamptz, timestamptz), public.report_stock(text, text, text, int, int),
  public.report_movements(timestamptz, timestamptz, text, text, int, int),
  public.report_financial_summary(timestamptz, timestamptz), public.report_financial_periods(timestamptz, timestamptz, text, text),
  public.report_sales(timestamptz, timestamptz, text, text, int, int)
to authenticated;

-- Helpful indexes for large datasets.
create index if not exists orders_status_created_idx on public.orders(status, created_at desc);
create index if not exists quotations_status_created_idx on public.quotations(status, created_at desc);
create index if not exists inventory_movements_created_idx on public.inventory_movements(created_at desc);
create index if not exists deliveries_order_idx on public.deliveries(order_id, created_at desc);
create index if not exists quotations_phone9_idx on public.quotations((right(regexp_replace(phone, '\D', '', 'g'), 9)));
create index if not exists orders_phone9_idx on public.orders((right(regexp_replace(phone, '\D', '', 'g'), 9)));
