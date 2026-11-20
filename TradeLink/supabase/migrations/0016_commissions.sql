-- TradeLink commissions: a percentage of the supplier's price on every marketplace sale of a supplier product.
-- Run after 0015 (and 0011 for the reports). Additive and safe to run more than once. No payouts yet: this calculates and reports only.
--
--  * Each supplier has a commission rate (suppliers.fee_rate, default 0). TradeLink staff set it in Admin -> Suppliers.
--  * When a sale is recorded, one row per supplier product is stored: supplier price x quantity, the rate used, the commission and what
--    the supplier earns. The rate is copied at that moment, so changing it later never rewrites past sales.
--  * Suppliers see only their own rows; TradeLink staff see all. Nobody can edit rows from the browser.

create table if not exists public.sale_commissions (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  product_id uuid references public.products(id) on delete set null,
  supplier_product_id uuid references public.supplier_products(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  selling_unit_price numeric(14,2) not null,
  supplier_unit_price numeric(14,2) not null,
  rate numeric(5,2) not null check (rate between 0 and 100),
  supplier_amount numeric(14,2) not null,
  commission numeric(14,2) not null check (commission >= 0),
  supplier_earning numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique (sale_id, supplier_product_id)
);
create index if not exists sale_commissions_supplier_idx on public.sale_commissions(supplier_id, created_at desc);
create index if not exists sale_commissions_created_idx on public.sale_commissions(created_at desc);
alter table public.sale_commissions enable row level security;
drop policy if exists "Own or staff read commissions" on public.sale_commissions;
create policy "Own or staff read commissions" on public.sale_commissions for select to authenticated
using (supplier_id = public.my_supplier_id() or public.is_tl_staff());
revoke insert, update, delete on public.sale_commissions from authenticated;
grant select on public.sale_commissions to authenticated;

create or replace function public.set_supplier_fee_rate(p_supplier uuid, p_rate numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null or not public.is_tl_staff() then raise exception 'Only the owner or a manager can set commission rates.'; end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 then raise exception 'The commission rate must be between 0 and 100.'; end if;
  update public.suppliers set fee_rate = round(p_rate, 2) where id = p_supplier returning name into v_name;
  if v_name is null then raise exception 'Supplier not found.'; end if;
  perform public.write_activity('supplier_fee_rate', 'suppliers', 'Set commission for ' || v_name || ' to ' || round(p_rate, 2) || '%', jsonb_build_object('supplier_id', p_supplier, 'rate', p_rate));
end $$;
revoke execute on function public.set_supplier_fee_rate(uuid, numeric) from public, anon;
grant execute on function public.set_supplier_fee_rate(uuid, numeric) to authenticated;

-- Selling now also records the commission (everything else in record_sale is unchanged).
create or replace function public.record_sale(p_order uuid, p_amount_paid numeric, p_method text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_item record; v_sale uuid; v_new numeric;
begin
  if not public.has_permission('sales.record') then raise exception 'You do not have permission to record sales.'; end if;
  if p_method is null or p_method not in ('cash','bank_transfer','mobile_money','credit') then raise exception 'Choose a payment method.'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_o.status not in ('confirmed','processing') then raise exception 'Only a confirmed order can be sold (status is %).', v_o.status; end if;
  if exists (select 1 from public.sales where order_id = p_order) then raise exception 'A sale is already recorded for this order.'; end if;
  if p_amount_paid is null or p_amount_paid < 0 or p_amount_paid > v_o.total_amount then raise exception 'Amount paid must be between 0 and the order total.'; end if;
  if p_method <> 'credit' and p_amount_paid = 0 then raise exception 'Enter the amount paid (use Credit for an unpaid sale).'; end if;

  perform set_config('app.stock_rpc', 'on', true);
  for v_item in select oi.*, p.name as pname, p.supplier_product_id as spid from public.order_items oi left join public.products p on p.id = oi.product_id where oi.order_id = p_order loop
    if v_item.product_id is null then raise exception 'A product on this order no longer exists.'; end if;
    if v_item.spid is not null then
      perform public.listing_take_stock(v_item.spid, v_item.quantity, v_o.order_number, v_item.pname);
    else
      begin
        update public.products set stock_quantity = stock_quantity - v_item.quantity where id = v_item.product_id returning stock_quantity into v_new;
      exception when check_violation then
        raise exception 'Not enough stock of % for this order.', v_item.pname;
      end;
    end if;
    insert into public.inventory_movements (product_id, movement_type, quantity, reference, notes, created_by)
    values (v_item.product_id, 'sale', v_item.quantity, v_o.order_number, 'Sale for ' || v_o.customer_name, auth.uid());
  end loop;

  insert into public.sales (order_id, customer_name, total_amount, amount_paid, payment_method)
  values (p_order, v_o.customer_name, v_o.total_amount, p_amount_paid, p_method) returning id into v_sale;
  -- Commission on supplier products: the supplier's rate at this moment, applied to the supplier's price, stored so later rate changes never alter it.
  insert into public.sale_commissions (sale_id, order_id, supplier_id, product_id, supplier_product_id, product_name, quantity,
                                       selling_unit_price, supplier_unit_price, rate, supplier_amount, commission, supplier_earning)
  select v_sale, p_order, p.supplier_id, p.id, p.supplier_product_id, oi.product_name, oi.quantity, oi.unit_price, p.wholesale_price, s.fee_rate,
         round(oi.quantity * p.wholesale_price, 2),
         round(oi.quantity * p.wholesale_price * s.fee_rate / 100, 2),
         round(oi.quantity * p.wholesale_price, 2) - round(oi.quantity * p.wholesale_price * s.fee_rate / 100, 2)
  from public.order_items oi
  join public.products p on p.id = oi.product_id and p.supplier_product_id is not null
  join public.suppliers s on s.id = p.supplier_id
  where oi.order_id = p_order;
  update public.orders set amount_paid = p_amount_paid, status = 'ready' where id = p_order;
  return v_sale;
end;
$$;

-- Financial summary: commissions and supplier earnings are now real figures (refunds stay empty until sales can be reversed).
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
    'commissions',  (select coalesce(sum(commission), 0) from public.sale_commissions where created_at >= p_from and created_at < p_to),
    'supplier_earnings', (select coalesce(sum(supplier_earning), 0) from public.sale_commissions where created_at >= p_from and created_at < p_to),
    'refunds',      null
  ) into r
  from public.sales where sold_at >= p_from and sold_at < p_to;
  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports (permission-guarded like the other reports; RLS still applies)
-- ---------------------------------------------------------------------------
create or replace function public.report_commissions(p_from timestamptz, p_to timestamptz, p_supplier uuid default null, p_search text default null, p_limit int default 15, p_offset int default 0)
returns table (id uuid, created_at timestamptz, supplier_id uuid, supplier_name text, order_number text, product_name text, quantity numeric,
               selling_unit_price numeric, supplier_unit_price numeric, rate numeric, supplier_amount numeric, commission numeric, supplier_earning numeric, total_count bigint)
language plpgsql stable set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.reports_guard();
  return query
  select c.id, c.created_at, c.supplier_id, s.name, o.order_number, c.product_name, c.quantity, c.selling_unit_price, c.supplier_unit_price, c.rate,
         c.supplier_amount, c.commission, c.supplier_earning, count(*) over ()
  from public.sale_commissions c
  join public.suppliers s on s.id = c.supplier_id
  left join public.orders o on o.id = c.order_id
  where c.created_at >= p_from and c.created_at < p_to
    and (p_supplier is null or c.supplier_id = p_supplier)
    and (v_q is null or c.product_name ilike '%' || v_q || '%' or s.name ilike '%' || v_q || '%' or o.order_number ilike '%' || v_q || '%')
  order by c.created_at desc
  limit least(greatest(p_limit, 1), 10000) offset greatest(p_offset, 0);
end $$;
revoke execute on function public.report_commissions(timestamptz, timestamptz, uuid, text, int, int) from public, anon;
grant execute on function public.report_commissions(timestamptz, timestamptz, uuid, text, int, int) to authenticated;

create or replace function public.report_commission_suppliers(p_from timestamptz, p_to timestamptz)
returns table (supplier_id uuid, supplier_name text, rate numeric, units numeric, supplier_amount numeric, commission numeric, supplier_earning numeric)
language plpgsql stable set search_path = public as $$
begin
  perform public.reports_guard();
  return query
  select s.id, s.name, s.fee_rate, coalesce(sum(c.quantity), 0), coalesce(sum(c.supplier_amount), 0), coalesce(sum(c.commission), 0), coalesce(sum(c.supplier_earning), 0)
  from public.suppliers s
  left join public.sale_commissions c on c.supplier_id = s.id and c.created_at >= p_from and c.created_at < p_to
  where s.status = 'approved'
  group by s.id, s.name, s.fee_rate
  order by coalesce(sum(c.commission), 0) desc, s.name;
end $$;
revoke execute on function public.report_commission_suppliers(timestamptz, timestamptz) from public, anon;
grant execute on function public.report_commission_suppliers(timestamptz, timestamptz) to authenticated;
