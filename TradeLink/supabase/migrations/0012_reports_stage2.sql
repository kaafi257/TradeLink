-- TradeLink reporting center, stage 2: suppliers, products, user activity and audit, marketplace analytics.
-- Same rules as 0011: every report function is SECURITY INVOKER, calls reports_guard() ('reports.view'), and masks
-- contact details unless the caller has 'reports.sensitive'. Run 0011 first. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Anonymous website events (visits, product views, category views, searches). No name, no IP, nothing personal.
--    Nobody can write directly: the public site calls track_event(), which is rate limited per browser.
-- ---------------------------------------------------------------------------
create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  session_id text not null check (char_length(session_id) between 8 and 64),
  kind text not null check (kind in ('visit','product_view','category_view','industry_view','search')),
  ref_id uuid,
  term text check (char_length(term) <= 80),
  results int check (results is null or results >= 0),
  mode text check (mode in ('business','individual')),
  created_at timestamptz not null default now()
);
create index if not exists site_events_kind_idx on public.site_events(kind, created_at desc);
create index if not exists site_events_ref_idx on public.site_events(ref_id, kind) where ref_id is not null;
create index if not exists site_events_session_idx on public.site_events(session_id, created_at desc);
alter table public.site_events enable row level security;
revoke all on public.site_events from anon, authenticated;
grant select on public.site_events to authenticated;
drop policy if exists "Report viewers read site events" on public.site_events;
create policy "Report viewers read site events" on public.site_events for select to authenticated
using (public.has_permission('reports.view'));

create or replace function public.track_event(p_session text, p_kind text, p_ref uuid default null, p_term text default null, p_results int default null, p_mode text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_session is null or char_length(p_session) not between 8 and 64 then return; end if;
  if p_kind is null or p_kind not in ('visit','product_view','category_view','industry_view','search') then return; end if;
  if (select count(*) from public.site_events where session_id = p_session and created_at > now() - interval '1 hour') >= 200 then return; end if;
  insert into public.site_events(session_id, kind, ref_id, term, results, mode)
  values (p_session, p_kind, p_ref, left(nullif(btrim(p_term), ''), 80), greatest(p_results, 0),
          case when p_mode in ('business','individual') then p_mode end);
end $$;
revoke execute on function public.track_event(text,text,uuid,text,int,text) from public;
grant execute on function public.track_event(text,text,uuid,text,int,text) to anon, authenticated;

-- Staff sign-ins go into the existing audit trail.
create or replace function public.log_login() returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then return; end if;
  if exists (select 1 from public.activity_logs where actor_id = auth.uid() and action = 'login' and created_at > now() - interval '1 minute') then return; end if;
  select role::text into v_role from public.profiles where id = auth.uid();
  perform public.write_activity('login', 'auth', 'Signed in', jsonb_build_object('role', v_role));
end $$;
revoke execute on function public.log_login() from public;
grant execute on function public.log_login() to authenticated;

create index if not exists activity_logs_created_idx on public.activity_logs(created_at desc);
create index if not exists products_created_idx on public.products(created_at desc);
create index if not exists suppliers_created_idx on public.suppliers(created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Suppliers
-- ---------------------------------------------------------------------------
create or replace function public.report_supplier_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.reports_guard();
  select jsonb_build_object(
    'total',     (select count(*) from public.suppliers),
    'active',    (select count(*) from public.suppliers where active and status = 'approved'),
    'pending',   (select count(*) from public.suppliers where status = 'pending'),
    'rejected',  (select count(*) from public.suppliers where status = 'rejected'),
    'suspended', (select count(*) from public.suppliers where status = 'suspended'),
    'new',       (select count(*) from public.suppliers where created_at >= p_from and created_at < p_to),
    'by_industry', coalesce((select jsonb_agg(jsonb_build_object('label', n, 'value', c) order by c desc, n)
                     from (select i.name n, count(*) c from public.suppliers s join public.industries i on i.id = s.industry_id group by i.name) x), '[]'),
    'by_status',   coalesce((select jsonb_agg(jsonb_build_object('label', st, 'value', c) order by c desc, st)
                     from (select status st, count(*) c from public.suppliers group by status) x), '[]'),
    'by_type',     coalesce((select jsonb_agg(jsonb_build_object('label', t, 'value', c) order by c desc, t)
                     from (select coalesce(business_type, 'not set') t, count(*) c from public.suppliers group by 1) x), '[]')
  ) into r;
  return r;
end;
$$;

create or replace function public.report_suppliers(p_from timestamptz, p_to timestamptz, p_status text default null, p_industry text default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, name text, industry text, location text, status text, business_type text, owner_name text, phone text, email text, categories bigint, joined timestamptz, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  select s.id, s.name, i.name, s.location, s.status, s.business_type, s.owner_name,
         public.report_mask(s.phone),
         case when public.has_permission('reports.sensitive') then s.email else null end,
         (select count(*) from public.supplier_categories sc where sc.supplier_id = s.id),
         s.created_at, count(*) over ()
  from public.suppliers s join public.industries i on i.id = s.industry_id
  where s.created_at >= p_from and s.created_at < p_to
    and (p_status is null or p_status = '' or s.status = p_status)
    and (p_industry is null or p_industry = '' or i.name = p_industry)
    and (p_search is null or p_search = '' or s.name ilike '%' || p_search || '%' or s.location ilike '%' || p_search || '%' or s.owner_name ilike '%' || p_search || '%')
  order by s.created_at desc
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Products (catalogue health, website views and what customers actually ordered)
-- ---------------------------------------------------------------------------
create or replace function public.report_product_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.reports_guard();
  select jsonb_build_object(
    'total',    (select count(*) from public.products),
    'active',   (select count(*) from public.products where active),
    'inactive', (select count(*) from public.products where not active),
    'out',      (select count(*) from public.products where active and stock_quantity <= 0),
    'low',      (select count(*) from public.products where active and stock_quantity > 0 and stock_quantity <= reorder_level),
    'new',      (select count(*) from public.products where created_at >= p_from and created_at < p_to),
    'views',    (select count(*) from public.site_events e where e.kind = 'product_view' and e.created_at >= p_from and e.created_at < p_to),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('label', c, 'value', n) order by n desc, c)
                     from (select category c, count(*) n from public.products where active group by category) x), '[]'),
    'top_viewed', coalesce((select jsonb_agg(jsonb_build_object('label', n, 'value', v) order by v desc, n)
                     from (select p.name n, count(*) v from public.site_events e join public.products p on p.id = e.ref_id
                           where e.kind = 'product_view' and e.created_at >= p_from and e.created_at < p_to group by p.id, p.name order by 2 desc, 1 limit 10) x), '[]'),
    'top_ordered', coalesce((select jsonb_agg(jsonb_build_object('label', n, 'value', v) order by v desc, n)
                     from (select oi.product_name n, sum(oi.quantity) v from public.order_items oi join public.orders o on o.id = oi.order_id
                           where o.status <> 'cancelled' and o.created_at >= p_from and o.created_at < p_to group by oi.product_name order by 2 desc, 1 limit 10) x), '[]')
  ) into r;
  return r;
end;
$$;

create or replace function public.report_products(p_from timestamptz, p_to timestamptz, p_status text default null, p_category text default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, name text, category text, sku text, price numeric, stock numeric, unit text, state text, views bigint, ordered numeric, added timestamptz, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  with pv as (select e.ref_id, count(*) n from public.site_events e where e.kind = 'product_view' and e.created_at >= p_from and e.created_at < p_to and e.ref_id is not null group by e.ref_id),
  po as (select oi.product_id, sum(oi.quantity) q from public.order_items oi join public.orders o on o.id = oi.order_id
         where o.status <> 'cancelled' and o.created_at >= p_from and o.created_at < p_to and oi.product_id is not null group by oi.product_id),
  x as (
    select p.*, case when not p.active then 'inactive' when p.stock_quantity <= 0 then 'out' when p.stock_quantity <= p.reorder_level then 'low' else 'in_stock' end as st
    from public.products p
  )
  select x.id, x.name, x.category, x.sku, x.wholesale_price, x.stock_quantity, x.unit, x.st,
         coalesce(pv.n, 0), coalesce(po.q, 0), x.created_at, count(*) over ()
  from x left join pv on pv.ref_id = x.id left join po on po.product_id = x.id
  where (p_status is null or p_status = '' or x.st = p_status or (p_status = 'active' and x.st <> 'inactive'))
    and (p_category is null or p_category = '' or x.category = p_category)
    and (p_search is null or p_search = '' or x.name ilike '%' || p_search || '%' or x.sku ilike '%' || p_search || '%')
  order by coalesce(po.q, 0) desc, coalesce(pv.n, 0) desc, x.name
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. User activity and audit trail (staff actions from activity_logs)
-- ---------------------------------------------------------------------------
create or replace function public.report_audit_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.reports_guard();
  select jsonb_build_object(
    'events',  (select count(*) from public.activity_logs where created_at >= p_from and created_at < p_to),
    'logins',  (select count(*) from public.activity_logs where action = 'login' and created_at >= p_from and created_at < p_to),
    'actors',  (select count(distinct actor_id) from public.activity_logs where actor_id is not null and created_at >= p_from and created_at < p_to),
    'changes', (select count(*) from public.activity_logs where action <> 'login' and created_at >= p_from and created_at < p_to),
    'by_action', coalesce((select jsonb_agg(jsonb_build_object('label', a, 'value', c) order by c desc, a)
                   from (select action a, count(*) c from public.activity_logs where created_at >= p_from and created_at < p_to group by action order by 2 desc limit 10) x), '[]'),
    'by_entity', coalesce((select jsonb_agg(jsonb_build_object('label', a, 'value', c) order by c desc, a)
                   from (select entity_type a, count(*) c from public.activity_logs where created_at >= p_from and created_at < p_to group by entity_type order by 2 desc limit 10) x), '[]'),
    'by_user',   coalesce((select jsonb_agg(jsonb_build_object('label', a, 'value', c) order by c desc, a)
                   from (select coalesce(actor_name, 'System') a, count(*) c from public.activity_logs where created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 10) x), '[]')
  ) into r;
  return r;
end;
$$;

create or replace function public.report_audit(p_from timestamptz, p_to timestamptz, p_action text default null, p_entity text default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, at timestamptz, actor text, action text, entity text, description text, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  select l.id, l.created_at, coalesce(l.actor_name, 'System'), l.action, l.entity_type, l.description, count(*) over ()
  from public.activity_logs l
  where l.created_at >= p_from and l.created_at < p_to
    and (p_action is null or p_action = '' or l.action = p_action)
    and (p_entity is null or p_entity = '' or l.entity_type = p_entity)
    and (p_search is null or p_search = '' or l.description ilike '%' || p_search || '%' or l.actor_name ilike '%' || p_search || '%')
  order by l.created_at desc
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Marketplace analytics (anonymous website behaviour)
-- ---------------------------------------------------------------------------
create or replace function public.report_market_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb; v_visits bigint; v_q bigint;
begin
  perform public.reports_guard();
  select count(distinct session_id) into v_visits from public.site_events where kind = 'visit' and created_at >= p_from and created_at < p_to;
  select count(*) into v_q from public.quotations where created_at >= p_from and created_at < p_to;
  select jsonb_build_object(
    'visitors',  v_visits,
    'inquiries', v_q,
    'conversion', case when v_visits > 0 then round(100.0 * v_q / v_visits, 1) end,
    'product_views',  (select count(*) from public.site_events where kind = 'product_view' and created_at >= p_from and created_at < p_to),
    'searches',       (select count(*) from public.site_events where kind = 'search' and created_at >= p_from and created_at < p_to),
    'no_result',      (select count(*) from public.site_events where kind = 'search' and results = 0 and created_at >= p_from and created_at < p_to),
    'retail_sessions',    (select count(distinct session_id) from public.site_events where mode = 'individual' and created_at >= p_from and created_at < p_to),
    'wholesale_sessions', (select count(distinct session_id) from public.site_events where mode = 'business' and created_at >= p_from and created_at < p_to),
    'top_categories', coalesce((select jsonb_agg(jsonb_build_object('label', n, 'value', v) order by v desc, n)
        from (select c.name n, count(*) v from public.site_events e join public.categories c on c.id = e.ref_id where e.kind = 'category_view' and e.created_at >= p_from and e.created_at < p_to group by c.id, c.name order by 2 desc, 1 limit 10) x), '[]'),
    'top_industries', coalesce((select jsonb_agg(jsonb_build_object('label', n, 'value', v) order by v desc, n)
        from (select i.name n, count(*) v from public.site_events e join public.industries i on i.id = e.ref_id where e.kind = 'industry_view' and e.created_at >= p_from and e.created_at < p_to group by i.id, i.name order by 2 desc, 1 limit 10) x), '[]'),
    'top_terms', coalesce((select jsonb_agg(jsonb_build_object('label', n, 'value', v) order by v desc, n)
        from (select lower(term) n, count(*) v from public.site_events where kind = 'search' and term is not null and created_at >= p_from and created_at < p_to group by 1 order by 2 desc, 1 limit 10) x), '[]')
  ) into r;
  return r;
end;
$$;

create or replace function public.report_site_series(p_metric text, p_from timestamptz, p_to timestamptz, p_bucket text default 'day', p_tz text default 'UTC')
returns table (bucket date, value numeric)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  if p_bucket not in ('day', 'week', 'month') then raise exception 'Unknown bucket.'; end if;
  if p_metric not in ('visits', 'product_views', 'searches') then raise exception 'Unknown metric.'; end if;
  if p_to - p_from > interval '800 days' then raise exception 'Choose a shorter period.'; end if;
  return query
  with b as (
    select (g at time zone p_tz)::date as d
    from generate_series(date_trunc(p_bucket, p_from at time zone p_tz), date_trunc(p_bucket, (p_to - interval '1 second') at time zone p_tz), ('1 ' || p_bucket)::interval) g
  ), ev as (
    select date_trunc(p_bucket, v.at at time zone p_tz)::date as d, 1::numeric as n
    from (select min(created_at) as at from public.site_events where kind = 'visit' and created_at >= p_from and created_at < p_to group by session_id,
            (created_at at time zone p_tz)::date) v
    where p_metric = 'visits'
    union all select date_trunc(p_bucket, e.created_at at time zone p_tz)::date, 1 from public.site_events e
      where p_metric = 'product_views' and e.kind = 'product_view' and e.created_at >= p_from and e.created_at < p_to
    union all select date_trunc(p_bucket, e.created_at at time zone p_tz)::date, 1 from public.site_events e
      where p_metric = 'searches' and e.kind = 'search' and e.created_at >= p_from and e.created_at < p_to
  )
  select b.d, coalesce(sum(ev.n), 0) from b left join ev on ev.d = b.d group by b.d order by b.d;
end;
$$;

create or replace function public.report_searches(p_from timestamptz, p_to timestamptz, p_status text default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (term text, searches bigint, visitors bigint, avg_results numeric, no_result bigint, last_at timestamptz, total_count bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  with g as (
    select lower(e.term) t, count(*) n, count(distinct e.session_id) v, round(avg(e.results), 1) ar,
           count(*) filter (where e.results = 0) nr, max(e.created_at) la
    from public.site_events e
    where e.kind = 'search' and e.term is not null and e.created_at >= p_from and e.created_at < p_to
    group by lower(e.term)
  )
  select g.t, g.n, g.v, g.ar, g.nr, g.la, count(*) over ()
  from g
  where (p_status is null or p_status = '' or (p_status = 'no_result' and g.nr > 0))
    and (p_search is null or p_search = '' or g.t ilike '%' || p_search || '%')
  order by g.n desc, g.la desc
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end;
$$;

revoke all on function
  public.report_supplier_summary(timestamptz, timestamptz), public.report_suppliers(timestamptz, timestamptz, text, text, text, int, int),
  public.report_product_summary(timestamptz, timestamptz), public.report_products(timestamptz, timestamptz, text, text, text, int, int),
  public.report_audit_summary(timestamptz, timestamptz), public.report_audit(timestamptz, timestamptz, text, text, text, int, int),
  public.report_market_summary(timestamptz, timestamptz), public.report_site_series(text, timestamptz, timestamptz, text, text),
  public.report_searches(timestamptz, timestamptz, text, text, int, int)
from public, anon;
grant execute on function
  public.report_supplier_summary(timestamptz, timestamptz), public.report_suppliers(timestamptz, timestamptz, text, text, text, int, int),
  public.report_product_summary(timestamptz, timestamptz), public.report_products(timestamptz, timestamptz, text, text, text, int, int),
  public.report_audit_summary(timestamptz, timestamptz), public.report_audit(timestamptz, timestamptz, text, text, text, int, int),
  public.report_market_summary(timestamptz, timestamptz), public.report_site_series(text, timestamptz, timestamptz, text, text),
  public.report_searches(timestamptz, timestamptz, text, text, int, int)
to authenticated;
