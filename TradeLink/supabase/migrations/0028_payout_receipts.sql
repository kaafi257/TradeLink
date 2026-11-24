-- Supplier payout receipts: the supplier is told in-app when TradeLink records a payout. Additive; table and rules are unchanged.
create or replace function public.record_payout(p_supplier uuid, p_amount numeric, p_method text, p_reference text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_name text; v_profile uuid; v_earned numeric; v_paid numeric; v_id uuid;
begin
  if auth.uid() is null or not public.has_permission('payments.manage') then raise exception 'You do not have permission to record payouts.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero.'; end if;
  if p_method is null or p_method not in ('bank_transfer','mobile_money','cash') then raise exception 'Choose how the supplier was paid.'; end if;
  select name, profile_id into v_name, v_profile from public.suppliers where id = p_supplier for update;
  if v_name is null then raise exception 'Supplier not found.'; end if;
  if not exists (select 1 from public.supplier_checks where supplier_id = p_supplier and verified_at is not null) then
    raise exception 'Verify this supplier first (Supplier Verification) before paying them.';
  end if;
  select coalesce(sum(supplier_earning), 0) into v_earned from public.sale_commissions where supplier_id = p_supplier;
  select coalesce(sum(amount), 0) into v_paid from public.supplier_payouts where supplier_id = p_supplier;
  if round(p_amount, 2) > v_earned - v_paid then raise exception 'That is more than the balance owed (%).', to_char(v_earned - v_paid, 'FM999,999,990.00'); end if;
  insert into public.supplier_payouts (supplier_id, amount, method, reference, note, created_by)
  values (p_supplier, round(p_amount, 2), p_method, nullif(btrim(p_reference),''), nullif(btrim(p_note),''), auth.uid()) returning id into v_id;
  perform public.write_activity('supplier_payout', 'payments', 'Paid ' || to_char(round(p_amount, 2), 'FM999,999,990.00') || ' to supplier ' || v_name, jsonb_build_object('supplier_id', p_supplier, 'payout_id', v_id));
  perform public.notify(v_profile, 'payout', 'Payment sent: ' || to_char(round(p_amount, 2), 'FM999,999,990.00') || ' ETB',
    'Receipt PAY-' || upper(left(v_id::text, 8)) || '. Open Payments to view or print it.', '/supplier/payments');
  return v_id;
end $$;
revoke execute on function public.record_payout(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.record_payout(uuid, numeric, text, text, text) to authenticated;
