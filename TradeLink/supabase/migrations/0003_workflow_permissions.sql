-- TradeLink: quote -> order -> sale -> stock -> delivery workflow + per-action permissions.
-- Run ONCE in the Supabase SQL Editor AFTER 0001 and 0002. Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Per-action permissions. The owner always has every permission; the owner edits the
-- other roles in Settings -> Permissions. Re-running never overwrites owner changes.
-- ---------------------------------------------------------------------------
create table if not exists public.role_permissions (
  role public.app_role not null,
  permission text not null,
  primary key (role, permission)
);
alter table public.role_permissions enable row level security;

insert into public.role_permissions (role, permission) values
  ('manager','quotes.price'),('sales','quotes.price'),
  ('manager','quotes.convert'),('sales','quotes.convert'),
  ('manager','orders.cancel'),
  ('manager','sales.record'),('sales','sales.record'),
  ('manager','deliveries.assign'),
  ('manager','deliveries.update'),('delivery','deliveries.update'),
  ('manager','stock.adjust'),('inventory','stock.adjust'),
  ('manager','products.edit'),('inventory','products.edit')
on conflict do nothing;

create or replace function public.has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.current_user_role() = 'owner'
    or exists (select 1 from public.role_permissions rp
               where rp.role = public.current_user_role() and rp.permission = p_permission),
    false)
$$;

drop policy if exists "Read own role permissions" on public.role_permissions;
create policy "Read own role permissions" on public.role_permissions for select to authenticated
using (role = public.current_user_role() or public.has_any_role(array['owner','manager']::public.app_role[]));
drop policy if exists "Owner manages permissions" on public.role_permissions;
create policy "Owner manages permissions" on public.role_permissions for all to authenticated
using (public.current_user_role() = 'owner') with check (public.current_user_role() = 'owner' and role <> 'owner');
revoke update, truncate on public.role_permissions from authenticated;

create or replace function public.log_permission_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.role_permissions;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  perform public.write_activity('permission_changed', 'staff',
    case when tg_op = 'DELETE' then 'Removed ' else 'Granted ' end || r.permission || case when tg_op = 'DELETE' then ' from ' else ' to ' end || r.role,
    jsonb_build_object('role', r.role, 'permission', r.permission));
  return r;
end;
$$;
drop trigger if exists log_permission_change on public.role_permissions;
create trigger log_permission_change after insert or delete on public.role_permissions
for each row execute function public.log_permission_change();

-- Product editing now follows the permission (still limited to staff who can read products).
drop policy if exists "Managers manage products" on public.products;
create policy "Managers manage products" on public.products for all to authenticated
using (public.has_permission('products.edit')) with check (public.has_permission('products.edit'));

-- adjust_stock now follows the 'stock.adjust' permission.
create or replace function public.adjust_stock(p_product uuid, p_type text, p_quantity numeric, p_notes text default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_delta numeric; v_new numeric;
begin
  if not public.has_permission('stock.adjust') then
    raise exception 'You do not have permission to adjust stock.';
  end if;
  if p_type not in ('purchase','adjustment_in','return','adjustment_out','damage') then
    raise exception 'Invalid movement type.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero.'; end if;

  v_delta := case when p_type in ('purchase','adjustment_in','return') then p_quantity else -p_quantity end;
  perform set_config('app.stock_rpc', 'on', true);
  update public.products set stock_quantity = stock_quantity + v_delta where id = p_product
  returning stock_quantity into v_new;
  if not found then raise exception 'Product not found.'; end if;

  insert into public.inventory_movements (product_id, movement_type, quantity, notes, created_by)
  values (p_product, p_type, p_quantity, left(nullif(btrim(coalesce(p_notes, '')), ''), 500), auth.uid());
  return v_new;
exception when check_violation then
  raise exception 'Not enough stock for this adjustment.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Money/stock/status data can now change ONLY through the functions below.
-- ---------------------------------------------------------------------------
create unique index if not exists sales_order_unique on public.sales(order_id) where order_id is not null;
create unique index if not exists orders_quotation_unique on public.orders(quotation_id) where quotation_id is not null;

revoke insert, update, delete, truncate on public.orders from authenticated;
revoke insert, update, delete, truncate on public.order_items from authenticated;
revoke insert, update, delete, truncate on public.deliveries from authenticated;
revoke insert, update, delete, truncate on public.quotation_items from authenticated;
revoke insert, update, delete, truncate on public.sales from authenticated;
drop policy if exists "Staff record sales" on public.sales;

-- Deliveries: office roles see all, delivery staff only the ones assigned to them.
drop policy if exists "Staff manage deliveries" on public.deliveries;
drop policy if exists "View deliveries" on public.deliveries;
create policy "View deliveries" on public.deliveries for select to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[])
       or (public.current_user_role() = 'delivery' and assigned_to = auth.uid()));

-- Quotation guard: 'quoted' and 'converted' and the total are set only by price_quote()/convert_quote_to_order().
create or replace function public.quotations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.workflow_rpc', true), '') = 'on' then return new; end if;
  if new.estimated_total is distinct from old.estimated_total then
    raise exception 'The quote total is set by pricing the quotation.';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'converted' then raise exception 'A converted quotation cannot be changed.'; end if;
    if new.status in ('quoted','converted') then raise exception 'Use "Price quote" or "Create order" for that status.'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists quotations_guard on public.quotations;
create trigger quotations_guard before update on public.quotations
for each row execute function public.quotations_guard();

-- ---------------------------------------------------------------------------
-- price_quote: p_prices = [{"item_id": "...", "unit_price": 1234.5}, ...] covering every line
-- ---------------------------------------------------------------------------
create or replace function public.price_quote(p_quote uuid, p_prices jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_q public.quotations%rowtype; v_item record; v_price numeric; v_total numeric; v_n int := 0;
begin
  if not public.has_permission('quotes.price') then raise exception 'You do not have permission to price quotations.'; end if;
  select * into v_q from public.quotations where id = p_quote for update;
  if not found then raise exception 'Quotation not found.'; end if;
  if v_q.status not in ('new','reviewing','quoted') then raise exception 'A quotation that is % cannot be re-priced.', v_q.status; end if;
  if jsonb_typeof(coalesce(p_prices, 'null'::jsonb)) <> 'array' then raise exception 'Prices are missing.'; end if;

  perform set_config('app.workflow_rpc', 'on', true);
  for v_item in select id from public.quotation_items where quotation_id = p_quote loop
    v_n := v_n + 1;
    select (e->>'unit_price')::numeric into v_price from jsonb_array_elements(p_prices) e where (e->>'item_id')::uuid = v_item.id;
    if v_price is null or v_price <= 0 or v_price > 100000000 then raise exception 'Enter a valid price for every line.'; end if;
    update public.quotation_items set unit_price = round(v_price, 2) where id = v_item.id;
  end loop;
  if v_n = 0 then raise exception 'This quotation has no items.'; end if;

  select sum(line_total) into v_total from public.quotation_items where quotation_id = p_quote;
  update public.quotations set estimated_total = v_total, status = 'quoted' where id = p_quote;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- convert_quote_to_order: priced quotation -> confirmed order (once per quotation)
-- ---------------------------------------------------------------------------
create or replace function public.convert_quote_to_order(p_quote uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_q public.quotations%rowtype; v_order uuid; v_number text; v_total numeric;
begin
  if not public.has_permission('quotes.convert') then raise exception 'You do not have permission to create orders.'; end if;
  select * into v_q from public.quotations where id = p_quote for update;
  if not found then raise exception 'Quotation not found.'; end if;
  if v_q.status not in ('quoted','accepted') then raise exception 'Price the quotation first (status is %).', v_q.status; end if;
  if exists (select 1 from public.orders where quotation_id = p_quote) then raise exception 'This quotation already has an order.'; end if;
  if exists (select 1 from public.quotation_items where quotation_id = p_quote and (unit_price <= 0 or product_id is null)) then
    raise exception 'Every line needs a price and an existing product.';
  end if;

  select sum(line_total) into v_total from public.quotation_items where quotation_id = p_quote;
  insert into public.orders (quotation_id, customer_name, phone, delivery_location, status, total_amount)
  values (v_q.id, v_q.customer_name, v_q.phone, v_q.delivery_location, 'confirmed', v_total)
  returning id, order_number into v_order, v_number;
  insert into public.order_items (order_id, product_id, product_name, quantity, unit, unit_price)
  select v_order, product_id, product_name, quantity, unit, unit_price from public.quotation_items where quotation_id = p_quote;

  perform set_config('app.workflow_rpc', 'on', true);
  update public.quotations set status = 'converted' where id = p_quote;
  perform public.write_activity('order_created', 'order', 'Order ' || v_number || ' created from quotation ' || v_q.quote_number, jsonb_build_object('order_id', v_order));
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_sale: records payment, DEDUCTS STOCK (with a 'sale' movement per line), readies the order
-- ---------------------------------------------------------------------------
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
  for v_item in select oi.*, p.name as pname from public.order_items oi left join public.products p on p.id = oi.product_id where oi.order_id = p_order loop
    if v_item.product_id is null then raise exception 'A product on this order no longer exists.'; end if;
    begin
      update public.products set stock_quantity = stock_quantity - v_item.quantity where id = v_item.product_id returning stock_quantity into v_new;
    exception when check_violation then
      raise exception 'Not enough stock of % for this order.', v_item.pname;
    end;
    insert into public.inventory_movements (product_id, movement_type, quantity, reference, notes, created_by)
    values (v_item.product_id, 'sale', v_item.quantity, v_o.order_number, 'Sale for ' || v_o.customer_name, auth.uid());
  end loop;

  insert into public.sales (order_id, customer_name, total_amount, amount_paid, payment_method)
  values (p_order, v_o.customer_name, v_o.total_amount, p_amount_paid, p_method) returning id into v_sale;
  update public.orders set amount_paid = p_amount_paid, status = 'ready' where id = p_order;
  return v_sale;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_order: only before a sale is recorded (afterwards use a stock "return" adjustment)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype;
begin
  if not public.has_permission('orders.cancel') then raise exception 'You do not have permission to cancel orders.'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_o.status not in ('pending','confirmed') or exists (select 1 from public.sales where order_id = p_order) then
    raise exception 'Only an order with no recorded sale can be cancelled.';
  end if;
  update public.orders set status = 'cancelled' where id = p_order;
  perform public.write_activity('order_cancelled', 'order', 'Order ' || v_o.order_number || ' cancelled', jsonb_build_object('order_id', p_order));
end;
$$;

-- ---------------------------------------------------------------------------
-- Deliveries
-- ---------------------------------------------------------------------------
create or replace function public.assign_delivery(p_order uuid, p_assignee uuid, p_scheduled timestamptz, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_id uuid; v_name text;
begin
  if not public.has_permission('deliveries.assign') then raise exception 'You do not have permission to assign deliveries.'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_o.status <> 'ready' then raise exception 'Only a sold order that is ready can be assigned (status is %).', v_o.status; end if;
  if exists (select 1 from public.deliveries where order_id = p_order and status <> 'failed') then raise exception 'This order already has a delivery.'; end if;
  select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = p_assignee and active = true and role in ('delivery','manager','owner');
  if v_name is null then raise exception 'Choose an active delivery staff member.'; end if;
  insert into public.deliveries (order_id, assigned_to, status, scheduled_at, notes)
  values (p_order, p_assignee, 'assigned', p_scheduled, left(nullif(btrim(coalesce(p_notes,'')), ''), 500)) returning id into v_id;
  perform public.write_activity('delivery_assigned', 'delivery', 'Order ' || v_o.order_number || ' assigned to ' || v_name, jsonb_build_object('order_id', p_order, 'delivery_id', v_id));
  return v_id;
end;
$$;

-- assigned -> in_transit -> delivered; assigned/in_transit -> failed (the order can then be re-assigned)
create or replace function public.update_delivery(p_delivery uuid, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_o public.orders%rowtype;
begin
  select * into v_d from public.deliveries where id = p_delivery for update;
  if not found then raise exception 'Delivery not found.'; end if;
  if not (public.has_permission('deliveries.assign') or (public.has_permission('deliveries.update') and v_d.assigned_to = auth.uid())) then
    raise exception 'You do not have permission to update this delivery.';
  end if;
  if not ((v_d.status = 'assigned' and p_status in ('in_transit','failed')) or (v_d.status = 'in_transit' and p_status in ('delivered','failed'))) then
    raise exception 'A delivery that is % cannot move to %.', v_d.status, p_status;
  end if;
  select * into v_o from public.orders where id = v_d.order_id for update;
  update public.deliveries set status = p_status,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    notes = coalesce(left(nullif(btrim(coalesce(p_notes,'')), ''), 500), notes)
  where id = p_delivery;
  update public.orders set status = case p_status when 'in_transit' then 'dispatched' when 'delivered' then 'completed' else 'ready' end where id = v_o.id;
  perform public.write_activity('delivery_' || p_status, 'delivery', 'Delivery for order ' || v_o.order_number || ' is now ' || replace(p_status, '_', ' '), jsonb_build_object('order_id', v_o.id, 'delivery_id', p_delivery));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.has_permission(text) from public, anon;
revoke execute on function public.price_quote(uuid,jsonb) from public, anon;
revoke execute on function public.convert_quote_to_order(uuid) from public, anon;
revoke execute on function public.record_sale(uuid,numeric,text) from public, anon;
revoke execute on function public.cancel_order(uuid) from public, anon;
revoke execute on function public.assign_delivery(uuid,uuid,timestamptz,text) from public, anon;
revoke execute on function public.update_delivery(uuid,text,text) from public, anon;
revoke execute on function public.adjust_stock(uuid,text,numeric,text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.price_quote(uuid,jsonb) to authenticated;
grant execute on function public.convert_quote_to_order(uuid) to authenticated;
grant execute on function public.record_sale(uuid,numeric,text) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.assign_delivery(uuid,uuid,timestamptz,text) to authenticated;
grant execute on function public.update_delivery(uuid,text,text) to authenticated;
grant execute on function public.adjust_stock(uuid,text,numeric,text) to authenticated;

-- ---------------------------------------------------------------------------
-- OPTIONAL (only after deploying the submit-quote Edge Function with Turnstile, README section 6d):
-- force every public quote through the CAPTCHA check by removing direct public access.
--   revoke execute on function public.submit_quote(text,text,text,text,uuid,numeric,text,text) from anon, authenticated;
-- ---------------------------------------------------------------------------
