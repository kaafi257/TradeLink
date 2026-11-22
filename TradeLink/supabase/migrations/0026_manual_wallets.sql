-- TradeLink: Telebirr and eBirr as MANUAL wallet payments (customer pays your number, sends the reference + receipt screenshot).
-- Run ONCE in Supabase -> SQL Editor, AFTER 0025. Safe to run more than once. Additive.
-- A screenshot or reference is NEVER proof by itself: staff mark it paid only after seeing the money in the Telebirr / eBirr app.
-- This is NOT an API integration with Ethio telecom or eBirr. Providers stay labelled as manual.

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.payments'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%bank_transfer%' loop
    execute format('alter table public.payments drop constraint %I', c);
  end loop;
end $$;
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('bank_transfer','cod','telebirr','ebirr'));

alter table public.checkout_settings
  add column if not exists telebirr_enabled boolean not null default false,
  add column if not exists telebirr_name text check (char_length(telebirr_name) <= 120),
  add column if not exists telebirr_number text check (telebirr_number is null or telebirr_number ~ '^[0-9+ -]{6,20}$'),
  add column if not exists ebirr_enabled boolean not null default false,
  add column if not exists ebirr_name text check (char_length(ebirr_name) <= 120),
  add column if not exists ebirr_number text check (ebirr_number is null or ebirr_number ~ '^[0-9+ -]{6,20}$');


create or replace function public.checkout_options() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cod', cod_enabled, 'bank', bank_enabled and account_number is not null, 'telebirr', telebirr_enabled and telebirr_number is not null, 'ebirr', ebirr_enabled and ebirr_number is not null,
                            'delivery_fee', delivery_fee, 'free_delivery_over', free_delivery_over)
  from public.checkout_settings where id
$$;

create or replace function public.place_order(
  p_items jsonb, p_name text, p_phone text, p_email text, p_location text, p_notes text, p_method text, p_key text, p_website text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_set public.checkout_settings%rowtype; v_o public.orders%rowtype; v_item jsonb; v_p public.products%rowtype; v_qty numeric; v_price numeric;
  v_sub numeric := 0; v_fee numeric := 0; v_n int := 0; v_seen uuid[] := '{}'; v_pid uuid; v_pay uuid; v_ref text; v_recent int;
begin
  if btrim(coalesce(p_website, '')) <> '' then raise exception 'Something went wrong. Please try again.'; end if;          -- honeypot
  p_name := btrim(coalesce(p_name, '')); p_phone := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
  p_email := nullif(btrim(coalesce(p_email, '')), ''); p_location := btrim(coalesce(p_location, '')); p_notes := nullif(btrim(coalesce(p_notes, '')), '');
  p_key := btrim(coalesce(p_key, ''));
  if char_length(p_key) not between 16 and 80 then raise exception 'Please reload the page and try again.'; end if;
  if char_length(p_name) not between 2 and 120 then raise exception 'Please enter your name.'; end if;
  if char_length(p_phone) not between 6 and 20 then raise exception 'Please enter a valid phone number.'; end if;
  if char_length(p_location) not between 2 and 160 then raise exception 'Please enter the delivery address.'; end if;
  if p_email is not null and (char_length(p_email) > 160 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'Please enter a valid email address.'; end if;
  if p_notes is not null and char_length(p_notes) > 500 then raise exception 'Delivery instructions are too long (500 characters max).'; end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Your cart is empty.'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Please order at most 30 different products at a time.'; end if;

  -- Same key again: hand back the order that was already placed (never a second one).
  select * into v_o from public.orders where idempotency_key = p_key;
  if found then
    select reference into v_ref from public.payments where order_id = v_o.id order by created_at desc limit 1;
    return jsonb_build_object('order_number', v_o.order_number, 'payment_reference', v_ref, 'total', v_o.total_amount, 'repeat', true);
  end if;

  select * into v_set from public.checkout_settings where id;
  if p_method = 'cod' and not v_set.cod_enabled then raise exception 'Cash on Delivery is not available right now.'; end if;
  if p_method = 'bank_transfer' and not (v_set.bank_enabled and v_set.account_number is not null) then raise exception 'Bank transfer is not available right now.'; end if;
  if p_method = 'telebirr' and not (v_set.telebirr_enabled and v_set.telebirr_number is not null) then raise exception 'Telebirr is not available right now.'; end if;
  if p_method = 'ebirr' and not (v_set.ebirr_enabled and v_set.ebirr_number is not null) then raise exception 'eBirr is not available right now.'; end if;
  if p_method not in ('cod', 'bank_transfer', 'telebirr', 'ebirr') then raise exception 'Choose how you want to pay.'; end if;

  select count(*) into v_recent from public.orders where phone = p_phone and channel = 'checkout' and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'Too many orders from this number. Please try again later.'; end if;

  insert into public.orders (customer_name, phone, email, delivery_location, delivery_notes, status, total_amount, amount_paid, channel, customer_id, idempotency_key)
  values (p_name, p_phone, p_email, p_location, p_notes, case when p_method = 'cod' then 'confirmed' else 'pending' end, 0, 0, 'checkout', auth.uid(), p_key)
  returning * into v_o;

  for v_item in select * from jsonb_array_elements(p_items) loop
    begin v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'quantity')::numeric;
    exception when others then raise exception 'One of the products in your cart is not valid.'; end;
    if v_pid is null or v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception 'Check the quantities in your cart.'; end if;
    if v_pid = any(v_seen) then raise exception 'A product appears twice in your cart.'; end if;
    v_seen := v_seen || v_pid;
    select p.* into v_p from public.products p where p.id = v_pid and p.active and p.audience in ('b2c', 'both')
      and exists (select 1 from public.public_products pp where pp.id = p.id);
    if not found then raise exception 'A product in your cart is no longer available.'; end if;
    if v_p.retail_price is null or v_p.retail_price <= 0 then raise exception '% is sold by quote. Please send a price request for it.', v_p.name; end if;
    if v_p.stock_quantity < v_qty then raise exception 'Only % % of % in stock.', greatest(v_p.stock_quantity, 0), v_p.unit, v_p.name; end if;
    v_price := case when v_p.sale_price is not null and v_p.sale_price > 0 and v_p.sale_price < v_p.retail_price then v_p.sale_price else v_p.retail_price end;
    insert into public.order_items (order_id, product_id, product_name, quantity, unit, unit_price) values (v_o.id, v_p.id, v_p.name, v_qty, v_p.unit, v_price);
    v_sub := v_sub + round(v_qty * v_price, 2); v_n := v_n + 1;
  end loop;

  v_fee := case when v_set.free_delivery_over is not null and v_sub >= v_set.free_delivery_over then 0 else v_set.delivery_fee end;
  update public.orders set total_amount = v_sub + v_fee, delivery_fee = v_fee where id = v_o.id;

  insert into public.payments (order_id, method, amount, status) values (v_o.id, p_method, v_sub + v_fee, 'pending') returning id, reference into v_pay, v_ref;
  perform public.pay_event(v_pay, 'order_placed', null, 'pending', case when p_method = 'cod' then 'Cash on Delivery chosen. Payment is collected on delivery.' else 'Transfer chosen (' || p_method || '). Waiting for the transfer details.' end, 'customer');
  return jsonb_build_object('order_number', v_o.order_number, 'payment_reference', v_ref, 'total', v_sub + v_fee, 'method', p_method, 'repeat', false);
end $$;

create or replace function public.order_view(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_set public.checkout_settings%rowtype; v_pay public.payments%rowtype; v_bank jsonb := null;
begin
  select * into v_o from public.orders where id = p_order;
  select * into v_pay from public.payments where order_id = p_order order by created_at desc limit 1;
  select * into v_set from public.checkout_settings where id;
  -- The bank details appear only for an order that is waiting for a bank transfer.
  if v_pay.method <> 'cod' and v_pay.status in ('pending', 'submitted', 'failed') then
    if v_pay.method = 'bank_transfer' and v_set.account_number is not null then
      v_bank := jsonb_build_object('bank_name', v_set.bank_name, 'account_name', v_set.account_name, 'account_number', v_set.account_number, 'note', v_set.bank_note);
    elsif v_pay.method = 'telebirr' and v_set.telebirr_number is not null then
      v_bank := jsonb_build_object('bank_name', 'Telebirr', 'account_name', v_set.telebirr_name, 'account_number', v_set.telebirr_number, 'note', null);
    elsif v_pay.method = 'ebirr' and v_set.ebirr_number is not null then
      v_bank := jsonb_build_object('bank_name', 'eBirr', 'account_name', v_set.ebirr_name, 'account_number', v_set.ebirr_number, 'note', null);
    end if;
  end if;
  return jsonb_build_object(
    'order_number', v_o.order_number, 'status', v_o.status, 'created_at', v_o.created_at, 'customer_name', v_o.customer_name,
    'delivery_location', v_o.delivery_location, 'delivery_fee', v_o.delivery_fee, 'total', v_o.total_amount, 'paid', v_o.amount_paid,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', product_name, 'quantity', quantity, 'unit', unit, 'unit_price', unit_price, 'line_total', line_total) order by product_name)
                       from public.order_items where order_id = p_order), '[]'::jsonb),
    'delivery_status', (select status from public.deliveries where order_id = p_order order by created_at desc limit 1),
    'payment', case when v_pay.id is null then null else jsonb_build_object(
      'method', v_pay.method, 'status', v_pay.status, 'amount', v_pay.amount, 'currency', v_pay.currency, 'reference', v_pay.reference,
      'customer_txn_ref', v_pay.customer_txn_ref, 'has_proof', v_pay.proof_path is not null, 'review_note', case when v_pay.status = 'failed' then v_pay.review_note end,
      'paid_at', coalesce(v_pay.verified_at, v_pay.collected_at), 'bank', v_bank) end,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('method', x.method, 'status', x.status, 'amount', x.amount, 'reference', x.reference, 'created_at', x.created_at,
                                                          'paid_at', coalesce(x.verified_at, x.collected_at)) order by x.created_at desc)
                          from public.payments x where x.order_id = p_order), '[]'::jsonb));
end $$;

create or replace function public.submit_payment_proof(p_number text, p_phone text, p_txn_ref text, p_proof text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_pay public.payments%rowtype; v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'); v_ref text := nullif(btrim(coalesce(p_txn_ref, '')), ''); v_proof text := nullif(btrim(coalesce(p_proof, '')), '');
begin
  select * into v_o from public.orders where order_number = upper(btrim(coalesce(p_number, ''))) and channel = 'checkout';
  if not found or not (v_o.customer_id is not distinct from auth.uid() and auth.uid() is not null or (char_length(v_phone) >= 6 and right(v_o.phone, 9) = right(v_phone, 9))) then
    raise exception 'We could not find an order with those details.';
  end if;
  if v_ref is null and v_proof is null then raise exception 'Enter the transaction reference from your bank, or attach the receipt.'; end if;
  if v_ref is not null and v_ref !~ '^[0-9A-Za-z/_.-]{4,40}$' then raise exception 'The transaction reference looks wrong. Use the letters and numbers from your bank receipt.'; end if;
  if v_proof is not null and v_proof !~ '^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' then raise exception 'The receipt file is not valid.'; end if;
  select * into v_pay from public.payments where order_id = v_o.id order by created_at desc limit 1 for update;
  if not found or v_pay.method not in ('bank_transfer', 'telebirr', 'ebirr') then raise exception 'This order is not paid by transfer.'; end if;
  if v_o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if v_pay.status not in ('pending', 'submitted', 'failed') then raise exception 'This payment is already %.', replace(v_pay.status, '_', ' '); end if;
  if v_ref is not null and exists (select 1 from public.payments where lower(customer_txn_ref) = lower(v_ref) and id <> v_pay.id and status in ('submitted', 'paid', 'processing')) then
    raise exception 'That transaction reference was already used for another payment.';
  end if;
  update public.payments set status = 'submitted', customer_txn_ref = coalesce(v_ref, customer_txn_ref), proof_path = coalesce(v_proof, proof_path), submitted_at = now(), review_note = null, updated_at = now() where id = v_pay.id;
  perform public.pay_event(v_pay.id, 'transfer_submitted', v_pay.status, 'submitted', 'Customer reported a transfer' || case when v_ref is not null then ' (ref ' || v_ref || ')' else '' end || case when v_proof is not null then ' with a receipt file' else '' end || '. Not paid until staff verify it.', 'customer');
  return public.order_view(v_o.id);
end $$;

create or replace function public.verify_bank_payment(p_payment uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pay public.payments%rowtype; v_o public.orders%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not coalesce(public.has_permission('payments.verify'), false) then raise exception 'You do not have permission to verify bank transfers.'; end if;
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then raise exception 'Payment not found.'; end if;
  if v_pay.method not in ('bank_transfer', 'telebirr', 'ebirr') then raise exception 'Only transfers are verified here.'; end if;
  if v_pay.status <> 'submitted' then raise exception 'Only a submitted transfer can be verified (status is %).', replace(v_pay.status, '_', ' '); end if;
  select * into v_o from public.orders where id = v_pay.order_id for update;
  if v_o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'The note is too long (300 characters max).'; end if;
  if p_approve then
    update public.payments set status = 'paid', verified_by = auth.uid(), verified_at = now(), review_note = v_note, updated_at = now() where id = p_payment;
    update public.orders set amount_paid = least(total_amount, amount_paid + v_pay.amount), status = case when status = 'pending' then 'confirmed' else status end where id = v_o.id;
    perform public.pay_event(p_payment, 'transfer_verified', 'submitted', 'paid', coalesce(v_note, 'Checked against the bank statement.'));
    perform public.write_activity('payment_verified', 'payments', 'Verified bank transfer for order ' || v_o.order_number, jsonb_build_object('payment_id', p_payment, 'order_id', v_o.id));
  else
    if v_note is null then raise exception 'Write a short reason so the customer knows what to fix.'; end if;
    update public.payments set status = 'failed', verified_by = auth.uid(), verified_at = now(), review_note = v_note, updated_at = now() where id = p_payment;
    perform public.pay_event(p_payment, 'transfer_rejected', 'submitted', 'failed', v_note);
    perform public.write_activity('payment_rejected', 'payments', 'Rejected bank transfer for order ' || v_o.order_number, jsonb_build_object('payment_id', p_payment, 'order_id', v_o.id));
  end if;
  return public.order_view(v_o.id);
end $$;

create or replace function public.expire_payments() returns int
language plpgsql security definer set search_path = public as $$
declare v_hours int; r record; v_n int := 0;
begin
  select bank_hold_hours into v_hours from public.checkout_settings where id;
  for r in select id from public.payments where method in ('bank_transfer', 'telebirr', 'ebirr') and status = 'pending' and created_at < now() - make_interval(hours => v_hours) for update skip locked loop
    update public.payments set status = 'expired', updated_at = now() where id = r.id;
    update public.orders set status = 'cancelled' where id = (select order_id from public.payments where id = r.id) and status = 'pending' and amount_paid = 0;
    insert into public.payment_events (payment_id, order_id, actor_kind, event, from_status, to_status, note)
    select r.id, order_id, 'system', 'payment_expired', 'pending', 'expired', 'No transfer was reported within ' || v_hours || ' hours.' from public.payments where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.save_checkout_settings(p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb := coalesce(p_settings, '{}'::jsonb); v_bank boolean; v_acc text;
begin
  if auth.uid() is null or not coalesce(public.has_permission('payments.manage'), false) then raise exception 'You do not have permission to change payment settings.'; end if;
  v_bank := coalesce((s->>'bank_enabled')::boolean, false); v_acc := nullif(btrim(coalesce(s->>'account_number', '')), '');
  if v_bank and (v_acc is null or nullif(btrim(coalesce(s->>'account_name', '')), '') is null or nullif(btrim(coalesce(s->>'bank_name', '')), '') is null) then
    raise exception 'Enter the bank name, account name and account number before turning on bank transfer.';
  end if;
  if coalesce((s->>'telebirr_enabled')::boolean, false) and (nullif(btrim(coalesce(s->>'telebirr_number', '')), '') is null or nullif(btrim(coalesce(s->>'telebirr_name', '')), '') is null) then
    raise exception 'Enter the Telebirr account name and number before turning on Telebirr.';
  end if;
  if coalesce((s->>'ebirr_enabled')::boolean, false) and (nullif(btrim(coalesce(s->>'ebirr_number', '')), '') is null or nullif(btrim(coalesce(s->>'ebirr_name', '')), '') is null) then
    raise exception 'Enter the eBirr account name and number before turning on eBirr.';
  end if;
  update public.checkout_settings set
    cod_enabled = coalesce((s->>'cod_enabled')::boolean, false), bank_enabled = v_bank,
    bank_name = nullif(btrim(coalesce(s->>'bank_name', '')), ''), account_name = nullif(btrim(coalesce(s->>'account_name', '')), ''), account_number = v_acc,
    bank_note = nullif(btrim(coalesce(s->>'bank_note', '')), ''),
    delivery_fee = greatest(coalesce(nullif(s->>'delivery_fee', '')::numeric, 0), 0), free_delivery_over = nullif(s->>'free_delivery_over', '')::numeric,
    telebirr_enabled = coalesce((s->>'telebirr_enabled')::boolean, false), telebirr_name = nullif(btrim(coalesce(s->>'telebirr_name', '')), ''), telebirr_number = nullif(btrim(coalesce(s->>'telebirr_number', '')), ''),
    ebirr_enabled = coalesce((s->>'ebirr_enabled')::boolean, false), ebirr_name = nullif(btrim(coalesce(s->>'ebirr_name', '')), ''), ebirr_number = nullif(btrim(coalesce(s->>'ebirr_number', '')), ''),
    bank_hold_hours = coalesce(nullif(s->>'bank_hold_hours', '')::int, 72), updated_by = auth.uid(), updated_at = now()
  where id;
  perform public.write_activity('payment_settings', 'payments', 'Updated checkout and payment settings', jsonb_build_object('cod', coalesce((s->>'cod_enabled')::boolean, false), 'bank', v_bank));
end $$;

create or replace function public.payment_providers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.checkout_settings%rowtype;
begin
  if auth.uid() is null or not (coalesce(public.has_permission('payments.view'), false) or public.is_tl_staff()) then raise exception 'You do not have permission to view payments.'; end if;
  select * into s from public.checkout_settings where id;
  return jsonb_build_array(
    jsonb_build_object('key', 'bank_transfer', 'name', 'CBE bank transfer', 'state', case when s.bank_enabled and s.account_number is not null then 'live' else 'off' end, 'detail', 'Manual verification by staff'),
    jsonb_build_object('key', 'cod', 'name', 'Cash on Delivery', 'state', case when s.cod_enabled then 'live' else 'off' end, 'detail', 'Paid when cash is confirmed collected'),
    jsonb_build_object('key', 'telebirr', 'name', 'Telebirr (manual)', 'state', case when s.telebirr_enabled and s.telebirr_number is not null then 'live' else 'off' end, 'detail', 'Customer sends to your number; staff verify in the Telebirr app'),
    jsonb_build_object('key', 'cbe_birr', 'name', 'CBE Birr', 'state', 'not_configured', 'detail', 'Needs provider credentials and a tested integration'),
    jsonb_build_object('key', 'ebirr', 'name', 'eBirr (manual)', 'state', case when s.ebirr_enabled and s.ebirr_number is not null then 'live' else 'off' end, 'detail', 'Customer sends to your number; staff verify in the eBirr app'));
end $$;
