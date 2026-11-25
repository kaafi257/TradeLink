-- A paid order must never stay "pending": it is ready to be sold (Record sale), which is also what
-- creates the supplier's earnings. Bank/wallet verification already did this; cash-on-delivery
-- collection did not, and older paid orders were left pending. Additive and idempotent.

create or replace function public.payments_paid_confirm_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    update public.orders set status = 'confirmed' where id = new.order_id and status = 'pending';
  end if;
  return new;
end $$;
revoke execute on function public.payments_paid_confirm_order() from public, anon, authenticated;

drop trigger if exists payments_paid_confirm_order on public.payments;
create trigger payments_paid_confirm_order after insert or update of status on public.payments
  for each row execute function public.payments_paid_confirm_order();

-- Backfill orders that already have a paid payment but are still pending.
update public.orders o set status = 'confirmed'
where o.status = 'pending' and exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'paid');
