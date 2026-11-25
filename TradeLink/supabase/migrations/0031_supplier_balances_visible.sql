-- Supplier balances: every approved supplier is listed (even with nothing owed yet), and any sale that
-- never produced a commission row (sold before commissions existed, or before the item was linked to a
-- supplier listing) is backfilled once. Additive and idempotent.

-- 1. Backfill: only sales with no commission rows at all, only items that belong to a supplier listing.
insert into public.sale_commissions (sale_id, order_id, supplier_id, product_id, supplier_product_id, product_name, quantity,
                                     selling_unit_price, supplier_unit_price, rate, supplier_amount, commission, supplier_earning)
select sa.id, sa.order_id, p.supplier_id, p.id, p.supplier_product_id, oi.product_name, oi.quantity, oi.unit_price, p.wholesale_price, s.fee_rate,
       round(oi.quantity * p.wholesale_price, 2),
       round(oi.quantity * p.wholesale_price * s.fee_rate / 100, 2),
       round(oi.quantity * p.wholesale_price, 2) - round(oi.quantity * p.wholesale_price * s.fee_rate / 100, 2)
from public.sales sa
join public.order_items oi on oi.order_id = sa.order_id
join public.products p on p.id = oi.product_id and p.supplier_product_id is not null and p.supplier_id is not null
join public.suppliers s on s.id = p.supplier_id
where not exists (select 1 from public.sale_commissions c where c.sale_id = sa.id);

-- 2. Balances list: approved suppliers always appear.
create or replace function public.payout_balances() returns table (
  supplier_id uuid, supplier_name text, earned numeric, paid numeric, balance numeric, verified boolean, last_paid timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('payments.view') then raise exception 'You do not have permission to view payments.'; end if;
  return query
  select s.id, s.name, coalesce(e.v, 0), coalesce(p.v, 0), coalesce(e.v, 0) - coalesce(p.v, 0),
         (c.verified_at is not null), p.last
  from public.suppliers s
  left join (select sc.supplier_id sid, sum(sc.supplier_earning) v from public.sale_commissions sc group by sc.supplier_id) e on e.sid = s.id
  left join (select sp.supplier_id sid, sum(sp.amount) v, max(sp.paid_at) last from public.supplier_payouts sp group by sp.supplier_id) p on p.sid = s.id
  left join public.supplier_checks c on c.supplier_id = s.id
  where s.status = 'approved' or e.v is not null or p.v is not null
  order by (coalesce(e.v, 0) - coalesce(p.v, 0)) desc, s.name;
end $$;
revoke execute on function public.payout_balances() from public, anon;
grant execute on function public.payout_balances() to authenticated;
