-- Customer payment receipts no longer depend on storage upload permissions: the (compressed) file is sent through a
-- function and kept in a table nobody can read directly. The receipt is now required; the bank reference is optional.
-- Staff with payments.view open it through payment_receipt(). Additive; older storage-based receipts still open.

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete cascade,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  data text not null check (char_length(data) <= 3000000),
  created_at timestamptz not null default now()
);
alter table public.payment_receipts enable row level security;   -- no policies: only the functions below touch it

create or replace function public.upload_payment_receipt(p_number text, p_phone text, p_content_type text, p_data text) returns text
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_pay public.payments%rowtype; v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'); v_id uuid;
begin
  select * into v_o from public.orders where order_number = upper(btrim(coalesce(p_number, ''))) and channel = 'checkout';
  if not found or not (v_o.customer_id is not distinct from auth.uid() and auth.uid() is not null or (char_length(v_phone) >= 6 and right(v_o.phone, 9) = right(v_phone, 9))) then
    raise exception 'We could not find an order with those details.';
  end if;
  if p_content_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then raise exception 'Attach a photo (JPG, PNG, WebP) or a PDF.'; end if;
  if p_data is null or char_length(p_data) < 100 or char_length(p_data) > 3000000 then raise exception 'The receipt file is empty or too large.'; end if;
  select * into v_pay from public.payments where order_id = v_o.id order by created_at desc limit 1;
  if not found or v_pay.method not in ('bank_transfer', 'telebirr', 'ebirr') then raise exception 'This order is not paid by transfer.'; end if;
  v_id := gen_random_uuid();
  insert into public.payment_receipts (id, payment_id, content_type, data) values (v_id, v_pay.id, p_content_type, p_data);
  return 'db:' || v_id::text;
end $$;
revoke execute on function public.upload_payment_receipt(text, text, text, text) from public;
grant execute on function public.upload_payment_receipt(text, text, text, text) to anon, authenticated;

create or replace function public.payment_receipt(p_payment uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_path text; v_r public.payment_receipts%rowtype;
begin
  if auth.uid() is null or not (coalesce(public.has_permission('payments.view'), false) or public.is_tl_staff()) then raise exception 'You do not have permission to view receipts.'; end if;
  v_path := (select proof_path from public.payments where id = p_payment);
  if v_path is null or v_path not like 'db:%' then return null; end if;
  select * into v_r from public.payment_receipts where id = substr(v_path, 4)::uuid;
  if not found then return null; end if;
  return jsonb_build_object('content_type', v_r.content_type, 'data', v_r.data);
end $$;
revoke execute on function public.payment_receipt(uuid) from public, anon;
grant execute on function public.payment_receipt(uuid) to authenticated;

-- The receipt is now what the customer must send; the transaction reference is optional.
create or replace function public.submit_payment_proof(p_number text, p_phone text, p_txn_ref text, p_proof text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_pay public.payments%rowtype; v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'); v_ref text := nullif(btrim(coalesce(p_txn_ref, '')), ''); v_proof text := nullif(btrim(coalesce(p_proof, '')), '');
begin
  select * into v_o from public.orders where order_number = upper(btrim(coalesce(p_number, ''))) and channel = 'checkout';
  if not found or not (v_o.customer_id is not distinct from auth.uid() and auth.uid() is not null or (char_length(v_phone) >= 6 and right(v_o.phone, 9) = right(v_phone, 9))) then
    raise exception 'We could not find an order with those details.';
  end if;
  if v_proof is null then raise exception 'Attach your payment receipt (photo, screenshot or PDF).'; end if;
  if v_ref is not null and v_ref !~ '^[0-9A-Za-z/_.-]{4,40}$' then raise exception 'The transaction reference looks wrong. Use the letters and numbers from your bank receipt.'; end if;
  if v_proof !~ '^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' and v_proof !~ '^db:[0-9a-f-]{36}$' then raise exception 'The receipt file is not valid.'; end if;
  select * into v_pay from public.payments where order_id = v_o.id order by created_at desc limit 1 for update;
  if not found or v_pay.method not in ('bank_transfer', 'telebirr', 'ebirr') then raise exception 'This order is not paid by transfer.'; end if;
  if v_o.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if v_pay.status not in ('pending', 'submitted', 'failed') then raise exception 'This payment is already %.', replace(v_pay.status, '_', ' '); end if;
  if v_ref is not null and exists (select 1 from public.payments where lower(customer_txn_ref) = lower(v_ref) and id <> v_pay.id and status in ('submitted', 'paid', 'processing')) then
    raise exception 'That transaction reference was already used for another payment.';
  end if;
  update public.payments set status = 'submitted', customer_txn_ref = coalesce(v_ref, customer_txn_ref), proof_path = v_proof, submitted_at = now(), review_note = null, updated_at = now() where id = v_pay.id;
  perform public.pay_event(v_pay.id, 'transfer_submitted', v_pay.status, 'submitted', 'Customer sent a receipt' || case when v_ref is not null then ' (ref ' || v_ref || ')' else '' end || '. Not paid until staff verify it.', 'customer');
  return public.order_view(v_o.id);
end $$;
revoke execute on function public.submit_payment_proof(text, text, text, text) from public;
grant execute on function public.submit_payment_proof(text, text, text, text) to anon, authenticated;
