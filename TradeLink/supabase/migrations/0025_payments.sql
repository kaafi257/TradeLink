-- TradeLink: customer checkout and payments (bank transfer and Cash on Delivery).
-- Run ONCE in Supabase -> SQL Editor, AFTER 0024. Safe to run more than once. Additive: no table, policy or function that exists is dropped.
--
-- What this adds
--   * checkout_settings   bank account shown to customers, Cash on Delivery on/off, delivery fee. Only staff with payments.manage can change it.
--   * payments            one row per payment attempt for an order. Its status is separate from the order status and the delivery status.
--   * payment_events      append-only audit trail of every payment action (customer, staff or system).
--   * refunds             refunds that staff have RECORDED. TradeLink does not move money: the refund is paid back by hand.
--   * place_order()       the checkout. Prices, stock and totals are worked out in the database from the live catalogue, never trusted from the browser.
--   * submit_payment_proof(), verify_bank_payment(), confirm_cod_collection(), refund_payment(), cancel_payment()
--   * track_order(), my_orders()          customers see only their own orders and payments (guest: order number + phone; account: signed in)
--   * payment_list(), payment_stats(), payment_audit(), payment_reconciliation(), payment_providers()   admin
--   * a private "payment-proofs" storage bucket (proof is for staff to look at: it is never proof of payment by itself)
-- Mobile-money providers (Telebirr, CBE Birr, eBirr) are NOT connected here. payment_providers() reports them as "not configured".

-- ---------------------------------------------------------------------------
-- 0. Permissions (the owner always has every permission)
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('manager','payments.verify'), ('manager','payments.refund'), ('manager','payments.collect'),
  ('delivery','payments.collect')
on conflict do nothing;

-- A customer account is a Supabase Auth user flagged account_type=customer. It gets NO staff profile (so it can never open the admin).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data->>'account_type', '') = 'customer' then return new; end if;
  insert into public.profiles(id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), coalesce(new.email, ''), 'staff')
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
create table if not exists public.checkout_settings (
  id boolean primary key default true check (id),
  cod_enabled boolean not null default false,
  bank_enabled boolean not null default false,
  bank_name text check (char_length(bank_name) <= 80),
  account_name text check (char_length(account_name) <= 120),
  account_number text check (account_number is null or account_number ~ '^[0-9A-Za-z -]{4,40}$'),
  bank_note text check (char_length(bank_note) <= 300),
  delivery_fee numeric(14,2) not null default 0 check (delivery_fee >= 0),
  free_delivery_over numeric(14,2) check (free_delivery_over is null or free_delivery_over > 0),
  bank_hold_hours int not null default 72 check (bank_hold_hours between 1 and 720),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.checkout_settings (id) values (true) on conflict do nothing;
alter table public.checkout_settings enable row level security;
drop policy if exists "Finance read checkout settings" on public.checkout_settings;
create policy "Finance read checkout settings" on public.checkout_settings for select to authenticated
using (public.has_permission('payments.view') or public.is_tl_staff());
revoke insert, update, delete on public.checkout_settings from authenticated, anon;
grant select on public.checkout_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Orders: who placed it (account or guest), contact, delivery notes and fee
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists customer_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists email text;
alter table public.orders add column if not exists delivery_notes text;
alter table public.orders add column if not exists delivery_fee numeric(14,2) not null default 0;
alter table public.orders add column if not exists channel text not null default 'quote' check (channel in ('quote','checkout'));
alter table public.orders add column if not exists idempotency_key text;
create unique index if not exists orders_idempotency_key on public.orders (idempotency_key) where idempotency_key is not null;
create index if not exists orders_customer_idx on public.orders (customer_id, created_at desc) where customer_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Payments, events, refunds
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  method text not null check (method in ('bank_transfer','cod')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'ETB' check (currency = 'ETB'),
  status text not null default 'pending' check (status in ('pending','submitted','processing','paid','failed','expired','cancelled','refunded','partially_refunded')),
  reference text not null unique default ('PAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  customer_txn_ref text check (char_length(customer_txn_ref) <= 40),
  proof_path text,
  submitted_at timestamptz,
  review_note text check (char_length(review_note) <= 300),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  collected_by uuid references public.profiles(id),
  collected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One open payment per order at a time: this is what stops a double submit from charging twice.
create unique index if not exists payments_one_open_per_order on public.payments (order_id) where status in ('pending','submitted','processing');
create index if not exists payments_order_idx on public.payments (order_id);
create index if not exists payments_status_idx on public.payments (status, created_at desc);
create unique index if not exists payments_txn_ref_unique on public.payments (lower(customer_txn_ref)) where customer_txn_ref is not null and status in ('submitted','paid','processing');

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  order_id uuid not null references public.orders(id),
  actor_id uuid,
  actor_name text,
  actor_kind text not null check (actor_kind in ('customer','staff','system')),
  event text not null,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists payment_events_payment_idx on public.payment_events (payment_id, created_at);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (char_length(reason) between 3 and 300),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Nobody can write these tables directly: every change goes through the guarded functions below.
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.refunds enable row level security;
drop policy if exists "Finance read payments" on public.payments;
create policy "Finance read payments" on public.payments for select to authenticated using (public.has_permission('payments.view') or public.is_tl_staff());
drop policy if exists "Finance read payment events" on public.payment_events;
create policy "Finance read payment events" on public.payment_events for select to authenticated using (public.has_permission('payments.view') or public.is_tl_staff());
drop policy if exists "Finance read refunds" on public.refunds;
create policy "Finance read refunds" on public.refunds for select to authenticated using (public.has_permission('payments.view') or public.is_tl_staff());
revoke all on public.payments, public.payment_events, public.refunds from anon, authenticated;
grant select on public.payments, public.payment_events, public.refunds to authenticated;

-- Internal: write one audit row. actor is whoever is calling (customer, staff or system).
create or replace function public.pay_event(p_payment uuid, p_event text, p_from text, p_to text, p_note text, p_kind text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_order uuid; v_name text; v_kind text;
begin
  select order_id into v_order from public.payments where id = p_payment;
  if auth.uid() is not null then select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid(); end if;
  v_kind := coalesce(p_kind, case when v_name is not null then 'staff' when auth.uid() is not null then 'customer' else 'customer' end);
  insert into public.payment_events (payment_id, order_id, actor_id, actor_name, actor_kind, event, from_status, to_status, note)
  values (p_payment, v_order, auth.uid(), v_name, v_kind, p_event, p_from, p_to, p_note);
end $$;
revoke execute on function public.pay_event(uuid, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. What the checkout may offer (no bank account number here: that is shown only after an order exists)
-- ---------------------------------------------------------------------------
create or replace function public.checkout_options() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cod', cod_enabled, 'bank', bank_enabled and account_number is not null,
                            'delivery_fee', delivery_fee, 'free_delivery_over', free_delivery_over)
  from public.checkout_settings where id
$$;
revoke execute on function public.checkout_options() from public;
grant execute on function public.checkout_options() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. place_order: the checkout. p_items = [{"product_id": "...", "quantity": 2}]
--    Everything that matters is recalculated here. p_key makes a double click or a retry return the SAME order.
-- ---------------------------------------------------------------------------
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
  if p_method not in ('cod', 'bank_transfer') then raise exception 'Choose how you want to pay.'; end if;

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
  perform public.pay_event(v_pay, 'order_placed', null, 'pending', case when p_method = 'cod' then 'Cash on Delivery chosen. Payment is collected on delivery.' else 'Bank transfer chosen. Waiting for the transfer details.' end, 'customer');
  return jsonb_build_object('order_number', v_o.order_number, 'payment_reference', v_ref, 'total', v_sub + v_fee, 'method', p_method, 'repeat', false);
end $$;
revoke execute on function public.place_order(jsonb, text, text, text, text, text, text, text, text) from public;
grant execute on function public.place_order(jsonb, text, text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Customer side: look up an order. Guest: order number + the phone on the order. Account: signed in.
-- ---------------------------------------------------------------------------
create or replace function public.order_view(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_set public.checkout_settings%rowtype; v_pay public.payments%rowtype; v_bank jsonb := null;
begin
  select * into v_o from public.orders where id = p_order;
  select * into v_pay from public.payments where order_id = p_order order by created_at desc limit 1;
  select * into v_set from public.checkout_settings where id;
  -- The bank details appear only for an order that is waiting for a bank transfer.
  if v_pay.method = 'bank_transfer' and v_pay.status in ('pending', 'submitted', 'failed') and v_set.account_number is not null then
    v_bank := jsonb_build_object('bank_name', v_set.bank_name, 'account_name', v_set.account_name, 'account_number', v_set.account_number, 'note', v_set.bank_note);
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
revoke execute on function public.order_view(uuid) from public, anon, authenticated;

create or replace function public.track_order(p_number text, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
begin
  select * into v_o from public.orders where order_number = upper(btrim(coalesce(p_number, ''))) and channel = 'checkout';
  -- One message for "no such order" and "wrong phone", so order numbers cannot be probed.
  if not found or char_length(v_phone) < 6 or right(v_o.phone, 9) <> right(v_phone, 9) then raise exception 'We could not find an order with those details.'; end if;
  return public.order_view(v_o.id);
end $$;
revoke execute on function public.track_order(text, text) from public;
grant execute on function public.track_order(text, text) to anon, authenticated;

create or replace function public.my_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  return coalesce((select jsonb_agg(public.order_view(o.id) order by o.created_at desc) from (select id, created_at from public.orders where customer_id = auth.uid() order by created_at desc limit 100) o), '[]'::jsonb);
end $$;
revoke execute on function public.my_orders() from public, anon;
grant execute on function public.my_orders() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The customer reports a bank transfer. This does NOT make it paid: staff must verify it against the bank.
-- ---------------------------------------------------------------------------
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
  if not found or v_pay.method <> 'bank_transfer' then raise exception 'This order is not paid by bank transfer.'; end if;
  if v_o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if v_pay.status not in ('pending', 'submitted', 'failed') then raise exception 'This payment is already %.', replace(v_pay.status, '_', ' '); end if;
  if v_ref is not null and exists (select 1 from public.payments where lower(customer_txn_ref) = lower(v_ref) and id <> v_pay.id and status in ('submitted', 'paid', 'processing')) then
    raise exception 'That transaction reference was already used for another payment.';
  end if;
  update public.payments set status = 'submitted', customer_txn_ref = coalesce(v_ref, customer_txn_ref), proof_path = coalesce(v_proof, proof_path), submitted_at = now(), review_note = null, updated_at = now() where id = v_pay.id;
  perform public.pay_event(v_pay.id, 'transfer_submitted', v_pay.status, 'submitted', 'Customer reported a transfer' || case when v_ref is not null then ' (ref ' || v_ref || ')' else '' end || case when v_proof is not null then ' with a receipt file' else '' end || '. Not paid until staff verify it.', 'customer');
  return public.order_view(v_o.id);
end $$;
revoke execute on function public.submit_payment_proof(text, text, text, text) from public;
grant execute on function public.submit_payment_proof(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Staff: verify a bank transfer. Only people with payments.verify. The amount paid is the amount of the order, set by the database.
-- ---------------------------------------------------------------------------
create or replace function public.verify_bank_payment(p_payment uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pay public.payments%rowtype; v_o public.orders%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not coalesce(public.has_permission('payments.verify'), false) then raise exception 'You do not have permission to verify bank transfers.'; end if;
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then raise exception 'Payment not found.'; end if;
  if v_pay.method <> 'bank_transfer' then raise exception 'Only bank transfers are verified here.'; end if;
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

-- Cash on Delivery: paid only when an authorised person confirms the cash was collected, for the exact amount.
create or replace function public.confirm_cod_collection(p_payment uuid, p_amount numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pay public.payments%rowtype; v_o public.orders%rowtype; v_ok boolean;
begin
  if auth.uid() is null or not coalesce(public.has_permission('payments.collect'), false) then raise exception 'You do not have permission to confirm cash collection.'; end if;
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then raise exception 'Payment not found.'; end if;
  if v_pay.method <> 'cod' then raise exception 'This is not a Cash on Delivery payment.'; end if;
  if v_pay.status not in ('pending', 'processing') then raise exception 'This payment is already %.', replace(v_pay.status, '_', ' '); end if;
  select * into v_o from public.orders where id = v_pay.order_id for update;
  if v_o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  -- Delivery staff may only confirm cash for deliveries assigned to them; office roles with payments.manage may confirm any.
  v_ok := coalesce(public.has_permission('payments.manage'), false) or public.is_tl_staff()
          or exists (select 1 from public.deliveries d where d.order_id = v_o.id and d.assigned_to = auth.uid());
  if not v_ok then raise exception 'Only the person delivering this order can confirm its cash.'; end if;
  if p_amount is null or p_amount <> v_pay.amount then raise exception 'The cash collected must equal the amount due (% ETB).', v_pay.amount; end if;
  update public.payments set status = 'paid', collected_by = auth.uid(), collected_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = p_payment;
  update public.orders set amount_paid = least(total_amount, amount_paid + v_pay.amount) where id = v_o.id;
  perform public.pay_event(p_payment, 'cash_collected', v_pay.status, 'paid', coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Cash collected on delivery.'));
  perform public.write_activity('cod_collected', 'payments', 'Cash collected for order ' || v_o.order_number, jsonb_build_object('payment_id', p_payment, 'order_id', v_o.id));
  return public.order_view(v_o.id);
end $$;

-- Cancel or fail an unpaid payment (staff).
create or replace function public.cancel_payment(p_payment uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_pay public.payments%rowtype;
begin
  if auth.uid() is null or not coalesce(public.has_permission('payments.manage'), false) then raise exception 'You do not have permission to cancel payments.'; end if;
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then raise exception 'Payment not found.'; end if;
  if v_pay.status not in ('pending', 'submitted', 'processing', 'failed') then raise exception 'A % payment cannot be cancelled.', replace(v_pay.status, '_', ' '); end if;
  update public.payments set status = 'cancelled', review_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = p_payment;
  perform public.pay_event(p_payment, 'payment_cancelled', v_pay.status, 'cancelled', p_note);
end $$;

-- Refunds are RECORDED here after staff have sent the money back by hand. TradeLink does not pay anyone.
create or replace function public.refund_payment(p_payment uuid, p_amount numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pay public.payments%rowtype; v_done numeric; v_status text; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not coalesce(public.has_permission('payments.refund'), false) then raise exception 'You do not have permission to record refunds.'; end if;
  select * into v_pay from public.payments where id = p_payment for update;
  if not found then raise exception 'Payment not found.'; end if;
  if v_pay.status not in ('paid', 'partially_refunded') then raise exception 'Only a paid payment can be refunded (status is %).', replace(v_pay.status, '_', ' '); end if;
  if char_length(v_reason) not between 3 and 300 then raise exception 'Write a short reason for the refund.'; end if;
  select coalesce(sum(amount), 0) into v_done from public.refunds where payment_id = p_payment;
  if p_amount is null or p_amount <= 0 or p_amount > v_pay.amount - v_done then raise exception 'The refund must be above zero and at most % ETB.', v_pay.amount - v_done; end if;
  insert into public.refunds (payment_id, amount, reason, created_by) values (p_payment, p_amount, v_reason, auth.uid());
  v_status := case when v_done + p_amount >= v_pay.amount then 'refunded' else 'partially_refunded' end;
  update public.payments set status = v_status, updated_at = now() where id = p_payment;
  update public.orders set amount_paid = greatest(0, amount_paid - p_amount) where id = v_pay.order_id;
  perform public.pay_event(p_payment, 'refund_recorded', v_pay.status, v_status, p_amount || ' ETB: ' || v_reason);
  perform public.write_activity('refund_recorded', 'payments', 'Recorded a refund of ' || p_amount || ' ETB', jsonb_build_object('payment_id', p_payment, 'amount', p_amount));
  return jsonb_build_object('status', v_status, 'refunded', v_done + p_amount);
end $$;

-- An unpaid bank transfer that was never reported expires after the hold time. Run by any admin page load, or by pg_cron if you have it.
create or replace function public.expire_payments() returns int
language plpgsql security definer set search_path = public as $$
declare v_hours int; r record; v_n int := 0;
begin
  select bank_hold_hours into v_hours from public.checkout_settings where id;
  for r in select id from public.payments where method = 'bank_transfer' and status = 'pending' and created_at < now() - make_interval(hours => v_hours) for update skip locked loop
    update public.payments set status = 'expired', updated_at = now() where id = r.id;
    update public.orders set status = 'cancelled' where id = (select order_id from public.payments where id = r.id) and status = 'pending' and amount_paid = 0;
    insert into public.payment_events (payment_id, order_id, actor_kind, event, from_status, to_status, note)
    select r.id, order_id, 'system', 'payment_expired', 'pending', 'expired', 'No transfer was reported within ' || v_hours || ' hours.' from public.payments where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.expire_payments() from public, anon;
grant execute on function public.expire_payments() to authenticated;

-- A cancelled order cancels its unpaid payment.
create or replace function public.orders_cancel_payments() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    for r in select id, status from public.payments where order_id = new.id and status in ('pending', 'submitted', 'processing') loop
      update public.payments set status = 'cancelled', updated_at = now() where id = r.id;
      insert into public.payment_events (payment_id, order_id, actor_id, actor_kind, event, from_status, to_status, note)
      values (r.id, new.id, auth.uid(), case when auth.uid() is null then 'system' else 'staff' end, 'order_cancelled', r.status, 'cancelled', 'The order was cancelled.');
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists orders_cancel_payments on public.orders;
create trigger orders_cancel_payments after update of status on public.orders for each row execute function public.orders_cancel_payments();

-- ---------------------------------------------------------------------------
-- 9. Admin: settings, lists, statistics, audit, reconciliation and provider status
-- ---------------------------------------------------------------------------
create or replace function public.save_checkout_settings(p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb := coalesce(p_settings, '{}'::jsonb); v_bank boolean; v_acc text;
begin
  if auth.uid() is null or not coalesce(public.has_permission('payments.manage'), false) then raise exception 'You do not have permission to change payment settings.'; end if;
  v_bank := coalesce((s->>'bank_enabled')::boolean, false); v_acc := nullif(btrim(coalesce(s->>'account_number', '')), '');
  if v_bank and (v_acc is null or nullif(btrim(coalesce(s->>'account_name', '')), '') is null or nullif(btrim(coalesce(s->>'bank_name', '')), '') is null) then
    raise exception 'Enter the bank name, account name and account number before turning on bank transfer.';
  end if;
  update public.checkout_settings set
    cod_enabled = coalesce((s->>'cod_enabled')::boolean, false), bank_enabled = v_bank,
    bank_name = nullif(btrim(coalesce(s->>'bank_name', '')), ''), account_name = nullif(btrim(coalesce(s->>'account_name', '')), ''), account_number = v_acc,
    bank_note = nullif(btrim(coalesce(s->>'bank_note', '')), ''),
    delivery_fee = greatest(coalesce(nullif(s->>'delivery_fee', '')::numeric, 0), 0), free_delivery_over = nullif(s->>'free_delivery_over', '')::numeric,
    bank_hold_hours = coalesce(nullif(s->>'bank_hold_hours', '')::int, 72), updated_by = auth.uid(), updated_at = now()
  where id;
  perform public.write_activity('payment_settings', 'payments', 'Updated checkout and payment settings', jsonb_build_object('cod', coalesce((s->>'cod_enabled')::boolean, false), 'bank', v_bank));
end $$;

create or replace function public.payment_list(p_search text default null, p_method text default null, p_status text default null, p_from timestamptz default null, p_to timestamptz default null, p_limit int default 200)
returns table (id uuid, order_number text, customer_name text, phone text, method text, amount numeric, status text, reference text, customer_txn_ref text, proof_path text,
               submitted_at timestamptz, created_at timestamptz, verified_at timestamptz, collected_at timestamptz, review_note text, refunded numeric)
language plpgsql security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if auth.uid() is null or not (coalesce(public.has_permission('payments.view'), false) or public.is_tl_staff()) then raise exception 'You do not have permission to view payments.'; end if;
  perform public.expire_payments();
  return query
  select p.id, o.order_number, o.customer_name, o.phone, p.method, p.amount, p.status, p.reference, p.customer_txn_ref, p.proof_path, p.submitted_at, p.created_at, p.verified_at, p.collected_at, p.review_note,
         coalesce((select sum(r.amount) from public.refunds r where r.payment_id = p.id), 0)
  from public.payments p join public.orders o on o.id = p.order_id
  where (q is null or o.order_number ilike '%' || q || '%' or p.reference ilike '%' || q || '%' or coalesce(p.customer_txn_ref, '') ilike '%' || q || '%' or o.customer_name ilike '%' || q || '%' or o.phone like '%' || q || '%')
    and (p_method is null or p.method = p_method) and (p_status is null or p.status = p_status)
    and (p_from is null or p.created_at >= p_from) and (p_to is null or p.created_at < p_to)
  order by (p.status = 'submitted') desc, p.created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;

create or replace function public.payment_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (coalesce(public.has_permission('payments.view'), false) or public.is_tl_staff()) then raise exception 'You do not have permission to view payments.'; end if;
  return jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(s, jsonb_build_object('count', n, 'amount', a)) from (select status s, count(*) n, sum(amount) a from public.payments group by status) x), '{}'::jsonb),
    'by_method', coalesce((select jsonb_object_agg(m, jsonb_build_object('count', n, 'amount', a)) from (select method m, count(*) n, sum(amount) a from public.payments where status = 'paid' group by method) x), '{}'::jsonb),
    'awaiting_verification', (select count(*) from public.payments where status = 'submitted'),
    'cod_to_collect', coalesce((select sum(amount) from public.payments where method = 'cod' and status = 'pending'), 0),
    'refunded', coalesce((select sum(amount) from public.refunds), 0));
end $$;

create or replace function public.payment_audit(p_payment uuid) returns table (created_at timestamptz, actor_kind text, actor_name text, event text, from_status text, to_status text, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (coalesce(public.has_permission('payments.view'), false) or public.is_tl_staff()) then raise exception 'You do not have permission to view payments.'; end if;
  return query select e.created_at, e.actor_kind, e.actor_name, e.event, e.from_status, e.to_status, e.note from public.payment_events e where e.payment_id = p_payment order by e.created_at;
end $$;

-- Checkout orders whose paid amount does not match their payments (paid minus refunds). Should be empty.
create or replace function public.payment_reconciliation() returns table (order_number text, customer_name text, order_total numeric, amount_paid numeric, payments_paid numeric, difference numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (coalesce(public.has_permission('payments.view'), false) or public.is_tl_staff()) then raise exception 'You do not have permission to view payments.'; end if;
  return query
  select o.order_number, o.customer_name, o.total_amount, o.amount_paid, x.net, o.amount_paid - x.net
  from public.orders o
  cross join lateral (select coalesce(sum(case when p.status in ('paid', 'partially_refunded', 'refunded') then p.amount end), 0)
                           - coalesce((select sum(r.amount) from public.refunds r join public.payments p2 on p2.id = r.payment_id where p2.order_id = o.id), 0) as net
                      from public.payments p where p.order_id = o.id) x
  where o.channel = 'checkout' and o.status <> 'cancelled' and o.amount_paid is distinct from least(o.total_amount, x.net)
  order by o.created_at desc;
end $$;

-- Which ways of paying are really switched on. Mobile-money providers are never "live" here: no credentials and no tested integration exist.
create or replace function public.payment_providers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.checkout_settings%rowtype;
begin
  if auth.uid() is null or not (coalesce(public.has_permission('payments.view'), false) or public.is_tl_staff()) then raise exception 'You do not have permission to view payments.'; end if;
  select * into s from public.checkout_settings where id;
  return jsonb_build_array(
    jsonb_build_object('key', 'bank_transfer', 'name', 'CBE bank transfer', 'state', case when s.bank_enabled and s.account_number is not null then 'live' else 'off' end, 'detail', 'Manual verification by staff'),
    jsonb_build_object('key', 'cod', 'name', 'Cash on Delivery', 'state', case when s.cod_enabled then 'live' else 'off' end, 'detail', 'Paid when cash is confirmed collected'),
    jsonb_build_object('key', 'telebirr', 'name', 'Telebirr', 'state', 'not_configured', 'detail', 'Needs merchant credentials and a tested integration'),
    jsonb_build_object('key', 'cbe_birr', 'name', 'CBE Birr', 'state', 'not_configured', 'detail', 'Needs provider credentials and a tested integration'),
    jsonb_build_object('key', 'ebirr', 'name', 'eBirr', 'state', 'not_configured', 'detail', 'Needs provider credentials and a tested integration'));
end $$;

revoke execute on function public.verify_bank_payment(uuid, boolean, text), public.confirm_cod_collection(uuid, numeric, text), public.cancel_payment(uuid, text), public.refund_payment(uuid, numeric, text),
  public.save_checkout_settings(jsonb), public.payment_list(text, text, text, timestamptz, timestamptz, int), public.payment_stats(), public.payment_audit(uuid),
  public.payment_reconciliation(), public.payment_providers() from public, anon;
grant execute on function public.verify_bank_payment(uuid, boolean, text), public.confirm_cod_collection(uuid, numeric, text), public.cancel_payment(uuid, text), public.refund_payment(uuid, numeric, text),
  public.save_checkout_settings(jsonb), public.payment_list(text, text, text, timestamptz, timestamptz, int), public.payment_stats(), public.payment_audit(uuid),
  public.payment_reconciliation(), public.payment_providers() to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Receipts / proof of transfer: a private bucket. Anyone placing an order may upload a file; only staff who view payments can open one.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Customers upload payment proof" on storage.objects;
create policy "Customers upload payment proof" on storage.objects for insert to anon, authenticated
with check (bucket_id = 'payment-proofs' and name ~ '^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$');
drop policy if exists "Finance reads payment proof" on storage.objects;
create policy "Finance reads payment proof" on storage.objects for select to authenticated
using (bucket_id = 'payment-proofs' and (coalesce(public.has_permission('payments.view'), false) or public.is_tl_staff()));
