-- TradeLink supplier operations, stages 1-3: approval gate, supplier products, warehouses and stock, purchase orders.
-- Run after 0009 (and 0012). Additive and safe to run more than once.
-- Every table has Row Level Security. A supplier sees only its own rows, and only while its account is approved and active.
-- Stock, orders, approvals and totals change only through the functions below; the browser cannot write them directly.

-- ---------------------------------------------------------------------------
-- 1. Gate helpers
-- ---------------------------------------------------------------------------
create or replace function public.my_supplier_id() returns uuid language sql stable security definer set search_path = public as $$
  select s.id from public.suppliers s
  where s.profile_id = auth.uid() and s.status = 'approved' and s.active and public.current_user_role() = 'supplier'
$$;
create or replace function public.is_tl_staff() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['owner','manager']::public.app_role[])
$$;
revoke execute on function public.my_supplier_id(), public.is_tl_staff() from public, anon;
grant execute on function public.my_supplier_id(), public.is_tl_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Supplier products (separate from the public catalogue: they do not become marketplace listings)
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text check (char_length(description) <= 1000),
  category_id uuid references public.categories(id) on delete set null,
  subcategory text check (char_length(subcategory) <= 60),
  brand text check (char_length(brand) <= 60),
  sku text check (char_length(sku) <= 40),
  unit text not null default 'piece' check (char_length(unit) between 1 and 20),
  price numeric(14,2) not null check (price >= 0),
  min_order_qty numeric(14,3) not null default 1 check (min_order_qty > 0),
  bulk_tiers jsonb not null default '[]'::jsonb check (jsonb_typeof(bulk_tiers) = 'array'),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  image_paths text[] not null default '{}' check (cardinality(image_paths) <= 8),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text check (char_length(review_note) <= 500),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists supplier_products_sku_idx on public.supplier_products(supplier_id, lower(sku)) where sku is not null and sku <> '';
create index if not exists supplier_products_supplier_idx on public.supplier_products(supplier_id, created_at desc);
alter table public.supplier_products enable row level security;

drop trigger if exists supplier_products_updated_at on public.supplier_products;
create trigger supplier_products_updated_at before update on public.supplier_products for each row execute function public.set_updated_at();

create or replace function public.supplier_products_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare t jsonb; v_sup uuid;
begin
  if auth.uid() is null then return new; end if;
  -- bulk tiers: [{"min_qty": n, "price": n}], price at or below the base price
  for t in select * from jsonb_array_elements(new.bulk_tiers) loop
    if jsonb_typeof(t) <> 'object' or coalesce((t->>'min_qty')::numeric, 0) <= 0 or coalesce((t->>'price')::numeric, -1) < 0 then
      raise exception 'Each bulk discount needs a quantity above 0 and a price.';
    end if;
  end loop;
  if public.is_tl_staff() then return new; end if;
  v_sup := public.my_supplier_id();
  if v_sup is null then raise exception 'Your supplier account is not approved.'; end if;
  if tg_op = 'INSERT' then
    new.supplier_id := v_sup; new.status := 'pending'; new.review_note := null; new.created_by := auth.uid();
  else
    if new.supplier_id is distinct from old.supplier_id or new.created_by is distinct from old.created_by
       or new.status is distinct from old.status or new.review_note is distinct from old.review_note then
      raise exception 'Only TradeLink can change a product''s approval.';
    end if;
    -- Changing what the product is sends it back for review; price, stock levels and photos do not.
    if old.status <> 'pending' and (new.name is distinct from old.name or new.description is distinct from old.description
       or new.brand is distinct from old.brand or new.category_id is distinct from old.category_id or new.unit is distinct from old.unit) then
      new.status := 'pending';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists supplier_products_guard on public.supplier_products;
create trigger supplier_products_guard before insert or update on public.supplier_products for each row execute function public.supplier_products_guard();

drop policy if exists "Own or staff read supplier products" on public.supplier_products;
create policy "Own or staff read supplier products" on public.supplier_products for select to authenticated
using (supplier_id = public.my_supplier_id() or public.is_tl_staff());
drop policy if exists "Supplier adds own products" on public.supplier_products;
create policy "Supplier adds own products" on public.supplier_products for insert to authenticated
with check (public.my_supplier_id() is not null);
drop policy if exists "Supplier edits own products" on public.supplier_products;
create policy "Supplier edits own products" on public.supplier_products for update to authenticated
using (supplier_id = public.my_supplier_id()) with check (supplier_id = public.my_supplier_id());
revoke delete on public.supplier_products from authenticated;

create or replace function public.review_supplier_product(p_id uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p public.supplier_products; s public.suppliers; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not public.is_tl_staff() then raise exception 'Only the owner or a manager can review supplier products.'; end if;
  select * into p from public.supplier_products where id = p_id for update;
  if not found then raise exception 'Product not found.'; end if;
  select * into s from public.suppliers where id = p.supplier_id;
  if p_action = 'approve' then
    update public.supplier_products set status = 'approved', review_note = null where id = p_id;
    perform public.notify(s.profile_id, 'product_approved', 'Product approved: ' || p.name, null, '/supplier/products');
  elsif p_action = 'reject' then
    if v_note is null or char_length(v_note) < 5 then raise exception 'Please give the reason, so the supplier can correct it.'; end if;
    update public.supplier_products set status = 'rejected', review_note = v_note where id = p_id;
    perform public.notify(s.profile_id, 'product_rejected', 'Product needs changes: ' || p.name, v_note, '/supplier/products');
  else raise exception 'Unknown action.'; end if;
  perform public.write_activity('supplier_product_' || p_action, 'supplier_products', initcap(p_action) || ' supplier product ' || p.name, jsonb_build_object('product_id', p_id, 'supplier_id', p.supplier_id));
end $$;
revoke execute on function public.review_supplier_product(uuid, text, text) from public, anon;
grant execute on function public.review_supplier_product(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Warehouses and stock
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_warehouses (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  address text check (char_length(address) <= 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (supplier_id, name)
);
alter table public.supplier_warehouses enable row level security;
create or replace function public.supplier_warehouses_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_tl_staff() then return new; end if;
  if public.my_supplier_id() is null then raise exception 'Your supplier account is not approved.'; end if;
  if tg_op = 'INSERT' then new.supplier_id := public.my_supplier_id();
  elsif new.supplier_id is distinct from old.supplier_id then raise exception 'A warehouse cannot be moved to another supplier.'; end if;
  return new;
end $$;
drop trigger if exists supplier_warehouses_guard on public.supplier_warehouses;
create trigger supplier_warehouses_guard before insert or update on public.supplier_warehouses for each row execute function public.supplier_warehouses_guard();
drop policy if exists "Own or staff read warehouses" on public.supplier_warehouses;
create policy "Own or staff read warehouses" on public.supplier_warehouses for select to authenticated
using (supplier_id = public.my_supplier_id() or public.is_tl_staff());
drop policy if exists "Supplier adds warehouses" on public.supplier_warehouses;
create policy "Supplier adds warehouses" on public.supplier_warehouses for insert to authenticated with check (public.my_supplier_id() is not null);
drop policy if exists "Supplier edits warehouses" on public.supplier_warehouses;
create policy "Supplier edits warehouses" on public.supplier_warehouses for update to authenticated
using (supplier_id = public.my_supplier_id()) with check (supplier_id = public.my_supplier_id());
revoke delete on public.supplier_warehouses from authenticated;

create table if not exists public.supplier_stock (
  product_id uuid not null references public.supplier_products(id) on delete cascade,
  warehouse_id uuid not null references public.supplier_warehouses(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  available numeric(14,3) not null default 0 check (available >= 0),
  incoming numeric(14,3) not null default 0 check (incoming >= 0),
  reserved numeric(14,3) not null default 0 check (reserved >= 0),
  damaged numeric(14,3) not null default 0 check (damaged >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, warehouse_id)
);
create index if not exists supplier_stock_supplier_idx on public.supplier_stock(supplier_id);
alter table public.supplier_stock enable row level security;
drop policy if exists "Own or staff read stock" on public.supplier_stock;
create policy "Own or staff read stock" on public.supplier_stock for select to authenticated
using (supplier_id = public.my_supplier_id() or public.is_tl_staff());
revoke insert, update, delete on public.supplier_stock from authenticated;

create table if not exists public.supplier_stock_movements (
  id bigint generated always as identity primary key,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_id uuid not null references public.supplier_products(id) on delete cascade,
  warehouse_id uuid not null references public.supplier_warehouses(id) on delete cascade,
  kind text not null check (kind in ('receive','remove','damage','incoming_add','incoming_receive','reserve','release','dispatch')),
  quantity numeric(14,3) not null check (quantity > 0),
  available_after numeric(14,3) not null,
  reference text,
  note text check (char_length(note) <= 300),
  actor_id uuid references public.profiles(id),
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists supplier_movements_idx on public.supplier_stock_movements(supplier_id, created_at desc);
alter table public.supplier_stock_movements enable row level security;
drop policy if exists "Own or staff read movements" on public.supplier_stock_movements;
create policy "Own or staff read movements" on public.supplier_stock_movements for select to authenticated
using (supplier_id = public.my_supplier_id() or public.is_tl_staff());
revoke insert, update, delete on public.supplier_stock_movements from authenticated;

-- Internal: the single place stock changes. Not callable from the browser.
create or replace function public.stock_apply(p_supplier uuid, p_product uuid, p_warehouse uuid, p_kind text, p_qty numeric, p_ref text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare st public.supplier_stock; v_name text; v_level numeric; v_total numeric; v_prof uuid; v_pname text;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be above 0.'; end if;
  insert into public.supplier_stock(product_id, warehouse_id, supplier_id) values (p_product, p_warehouse, p_supplier) on conflict do nothing;
  select * into st from public.supplier_stock where product_id = p_product and warehouse_id = p_warehouse for update;
  case p_kind
    when 'receive' then st.available := st.available + p_qty;
    when 'remove' then if st.available < p_qty then raise exception 'Only % available in this warehouse.', st.available; end if; st.available := st.available - p_qty;
    when 'damage' then if st.available < p_qty then raise exception 'Only % available in this warehouse.', st.available; end if; st.available := st.available - p_qty; st.damaged := st.damaged + p_qty;
    when 'incoming_add' then st.incoming := st.incoming + p_qty;
    when 'incoming_receive' then if st.incoming < p_qty then raise exception 'Only % incoming.', st.incoming; end if; st.incoming := st.incoming - p_qty; st.available := st.available + p_qty;
    when 'reserve' then if st.available < p_qty then raise exception 'Not enough stock: % available.', st.available; end if; st.available := st.available - p_qty; st.reserved := st.reserved + p_qty;
    when 'release' then if st.reserved < p_qty then raise exception 'Reserved stock is lower than expected.'; end if; st.reserved := st.reserved - p_qty; st.available := st.available + p_qty;
    when 'dispatch' then if st.reserved < p_qty then raise exception 'Reserved stock is lower than expected.'; end if; st.reserved := st.reserved - p_qty;
    else raise exception 'Unknown stock action.';
  end case;
  update public.supplier_stock set available = st.available, incoming = st.incoming, reserved = st.reserved, damaged = st.damaged, updated_at = now()
   where product_id = p_product and warehouse_id = p_warehouse;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  insert into public.supplier_stock_movements(supplier_id, product_id, warehouse_id, kind, quantity, available_after, reference, note, actor_id, actor_name)
  values (p_supplier, p_product, p_warehouse, p_kind, p_qty, st.available, p_ref, p_note, auth.uid(), v_name);
  -- Low stock alert (one unread alert per product)
  select reorder_level, name into v_level, v_pname from public.supplier_products where id = p_product;
  if v_level > 0 and p_kind in ('remove','damage','reserve','dispatch') then
    select coalesce(sum(available), 0) into v_total from public.supplier_stock where product_id = p_product;
    if v_total <= v_level then
      select profile_id into v_prof from public.suppliers where id = p_supplier;
      if v_prof is not null and not exists (select 1 from public.notifications where user_id = v_prof and kind = 'low_stock' and link = '/supplier/inventory?p=' || p_product and read_at is null) then
        perform public.notify(v_prof, 'low_stock', 'Low stock: ' || v_pname, v_total || ' left in stock (alert level ' || v_level || ').', '/supplier/inventory?p=' || p_product);
      end if;
    end if;
  end if;
end $$;
revoke execute on function public.stock_apply(uuid, uuid, uuid, text, numeric, text, text) from public, anon, authenticated;

create or replace function public.supplier_adjust_stock(p_product uuid, p_warehouse uuid, p_kind text, p_qty numeric, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_sup is null then raise exception 'Your supplier account is not approved.'; end if;
  if p_kind not in ('receive','remove','damage','incoming_add','incoming_receive') then raise exception 'Unknown stock action.'; end if;
  if p_kind in ('remove','damage') and (v_note is null or char_length(v_note) < 3) then raise exception 'Please add a short reason.'; end if;
  if not exists (select 1 from public.supplier_products where id = p_product and supplier_id = v_sup) then raise exception 'Product not found.'; end if;
  if not exists (select 1 from public.supplier_warehouses where id = p_warehouse and supplier_id = v_sup and active) then raise exception 'Warehouse not found or inactive.'; end if;
  perform public.stock_apply(v_sup, p_product, p_warehouse, p_kind, p_qty, null, v_note);
  perform public.write_activity('supplier_stock_' || p_kind, 'supplier_stock', 'Stock ' || p_kind || ' ' || p_qty, jsonb_build_object('product_id', p_product, 'warehouse_id', p_warehouse, 'supplier_id', v_sup));
end $$;
revoke execute on function public.supplier_adjust_stock(uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.supplier_adjust_stock(uuid, uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Purchase orders (stores order from a supplier; TradeLink staff enter them until store accounts exist)
-- ---------------------------------------------------------------------------
create sequence if not exists public.purchase_order_seq;
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique default ('PO-' || lpad(nextval('public.purchase_order_seq')::text, 5, '0')),
  supplier_id uuid not null references public.suppliers(id),
  store_name text not null check (char_length(btrim(store_name)) between 2 and 120),
  store_note text check (char_length(store_note) <= 500),
  supplier_note text check (char_length(supplier_note) <= 1000),
  status text not null default 'new' check (status in ('new','accepted','rejected','preparing','ready_for_pickup','dispatched','delivered','cancelled')),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz, dispatched_at timestamptz, delivered_at timestamptz, cancelled_at timestamptz
);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders(supplier_id, created_at desc);
create index if not exists purchase_orders_status_idx on public.purchase_orders(supplier_id, status);
alter table public.purchase_orders enable row level security;
drop policy if exists "Own or staff read purchase orders" on public.purchase_orders;
create policy "Own or staff read purchase orders" on public.purchase_orders for select to authenticated
using (supplier_id = public.my_supplier_id() or public.is_tl_staff());
revoke insert, update, delete on public.purchase_orders from authenticated;

-- The store's phone and address are shown to the supplier only once it has accepted the order.
create table if not exists public.purchase_order_contacts (
  po_id uuid primary key references public.purchase_orders(id) on delete cascade,
  store_phone text check (char_length(store_phone) <= 40),
  store_address text check (char_length(store_address) <= 200)
);
alter table public.purchase_order_contacts enable row level security;
drop policy if exists "Staff or accepted supplier read contacts" on public.purchase_order_contacts;
create policy "Staff or accepted supplier read contacts" on public.purchase_order_contacts for select to authenticated
using (public.is_tl_staff() or exists (select 1 from public.purchase_orders o where o.id = po_id and o.supplier_id = public.my_supplier_id()
       and o.status in ('accepted','preparing','ready_for_pickup','dispatched','delivered')));
revoke insert, update, delete on public.purchase_order_contacts from authenticated;

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  product_id uuid not null references public.supplier_products(id),
  product_name text not null,
  unit text not null,
  qty_ordered numeric(14,3) not null check (qty_ordered > 0),
  qty_confirmed numeric(14,3) check (qty_confirmed is null or qty_confirmed >= 0),
  warehouse_id uuid references public.supplier_warehouses(id),
  unit_price numeric(14,2) not null check (unit_price >= 0)
);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items(po_id);
alter table public.purchase_order_items enable row level security;
drop policy if exists "Own or staff read po items" on public.purchase_order_items;
create policy "Own or staff read po items" on public.purchase_order_items for select to authenticated
using (supplier_id = public.my_supplier_id() or public.is_tl_staff());
revoke insert, update, delete on public.purchase_order_items from authenticated;

create or replace function public.admin_create_purchase_order(p_supplier uuid, p_store_name text, p_phone text, p_address text, p_note text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.suppliers; v_po uuid; it jsonb; p public.supplier_products; v_qty numeric; v_price numeric; v_total numeric := 0; t jsonb;
begin
  if auth.uid() is null or not public.is_tl_staff() then raise exception 'Only the owner or a manager can create purchase orders.'; end if;
  select * into s from public.suppliers where id = p_supplier;
  if not found or s.status <> 'approved' or not s.active then raise exception 'The supplier must be approved and active.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one product.'; end if;
  insert into public.purchase_orders(supplier_id, store_name, store_note, created_by)
  values (p_supplier, btrim(p_store_name), nullif(btrim(coalesce(p_note, '')), ''), auth.uid()) returning id into v_po;
  insert into public.purchase_order_contacts(po_id, store_phone, store_address) values (v_po, nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_address, '')), ''));
  for it in select * from jsonb_array_elements(p_items) loop
    select * into p from public.supplier_products where id = (it->>'product_id')::uuid and supplier_id = p_supplier and status = 'approved' and active;
    if not found then raise exception 'A product is not available from this supplier.'; end if;
    v_qty := (it->>'quantity')::numeric;
    if v_qty is null or v_qty < p.min_order_qty then raise exception '% needs at least % %.', p.name, p.min_order_qty, p.unit; end if;
    v_price := p.price;
    for t in select * from jsonb_array_elements(p.bulk_tiers) loop
      if v_qty >= (t->>'min_qty')::numeric and (t->>'price')::numeric < v_price then v_price := (t->>'price')::numeric; end if;
    end loop;
    insert into public.purchase_order_items(po_id, supplier_id, product_id, product_name, unit, qty_ordered, unit_price)
    values (v_po, p_supplier, p.id, p.name, p.unit, v_qty, v_price);
    v_total := v_total + v_qty * v_price;
  end loop;
  update public.purchase_orders set total_amount = v_total where id = v_po;
  perform public.notify(s.profile_id, 'order_new', 'New purchase order', btrim(p_store_name) || ' ordered ' || jsonb_array_length(p_items) || ' product(s).', '/supplier/orders');
  perform public.write_activity('purchase_order_created', 'purchase_orders', 'Created purchase order for ' || s.name, jsonb_build_object('po_id', v_po, 'supplier_id', p_supplier, 'total', v_total));
  return v_po;
end $$;
revoke execute on function public.admin_create_purchase_order(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.admin_create_purchase_order(uuid, text, text, text, text, jsonb) to authenticated;

-- Supplier actions: accept (confirm quantities + reserve stock), reject, prepare, ready, dispatch, cancel, note.
create or replace function public.supplier_po_action(p_po uuid, p_action text, p_note text default null, p_items jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); o public.purchase_orders; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  it jsonb; i public.purchase_order_items; v_q numeric; v_total numeric; v_any boolean := false; v_label text;
begin
  if v_sup is null then raise exception 'Your supplier account is not approved.'; end if;
  select * into o from public.purchase_orders where id = p_po and supplier_id = v_sup for update;
  if not found then raise exception 'Order not found.'; end if;
  if o.status in ('dispatched','delivered') then raise exception 'Orders cannot be changed after dispatch.'; end if;
  if o.status in ('rejected','cancelled') then raise exception 'This order is closed.'; end if;

  if p_action = 'accept' then
    if o.status <> 'new' then raise exception 'Only a new order can be accepted.'; end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Confirm the quantities first.'; end if;
    for i in select * from public.purchase_order_items where po_id = p_po loop
      select e into it from jsonb_array_elements(p_items) e where (e->>'item_id')::uuid = i.id;
      if it is null then raise exception 'Confirm a quantity for every product.'; end if;
      v_q := (it->>'quantity')::numeric;
      if v_q is null or v_q < 0 or v_q > i.qty_ordered then raise exception 'Confirmed quantity for % must be between 0 and %.', i.product_name, i.qty_ordered; end if;
      if v_q > 0 then
        v_any := true;
        if not exists (select 1 from public.supplier_warehouses where id = (it->>'warehouse_id')::uuid and supplier_id = v_sup and active) then raise exception 'Choose a warehouse for %.', i.product_name; end if;
        perform public.stock_apply(v_sup, i.product_id, (it->>'warehouse_id')::uuid, 'reserve', v_q, o.po_number, null);
        update public.purchase_order_items set qty_confirmed = v_q, warehouse_id = (it->>'warehouse_id')::uuid where id = i.id;
      else
        update public.purchase_order_items set qty_confirmed = 0, warehouse_id = null where id = i.id;
      end if;
    end loop;
    if not v_any then raise exception 'Confirm at least one product, or reject the order.'; end if;
    select coalesce(sum(coalesce(qty_confirmed, qty_ordered) * unit_price), 0) into v_total from public.purchase_order_items where po_id = p_po;
    update public.purchase_orders set status = 'accepted', accepted_at = now(), total_amount = v_total, supplier_note = coalesce(v_note, supplier_note) where id = p_po;
  elsif p_action = 'reject' then
    if o.status <> 'new' then raise exception 'Only a new order can be rejected.'; end if;
    if v_note is null or char_length(v_note) < 3 then raise exception 'Please give a reason.'; end if;
    update public.purchase_orders set status = 'rejected', cancel_reason = v_note, cancelled_at = now() where id = p_po;
  elsif p_action = 'prepare' then
    if o.status <> 'accepted' then raise exception 'Accept the order first.'; end if;
    update public.purchase_orders set status = 'preparing', supplier_note = coalesce(v_note, supplier_note) where id = p_po;
  elsif p_action = 'ready' then
    if o.status <> 'preparing' then raise exception 'Start preparing the order first.'; end if;
    update public.purchase_orders set status = 'ready_for_pickup', supplier_note = coalesce(v_note, supplier_note) where id = p_po;
  elsif p_action = 'dispatch' then
    if o.status <> 'ready_for_pickup' then raise exception 'The order must be ready for pickup first.'; end if;
    for i in select * from public.purchase_order_items where po_id = p_po and coalesce(qty_confirmed, 0) > 0 loop
      perform public.stock_apply(v_sup, i.product_id, i.warehouse_id, 'dispatch', i.qty_confirmed, o.po_number, null);
    end loop;
    update public.purchase_orders set status = 'dispatched', dispatched_at = now(), supplier_note = coalesce(v_note, supplier_note) where id = p_po;
  elsif p_action = 'cancel' then
    if o.status = 'new' then raise exception 'Reject a new order instead of cancelling it.'; end if;
    if v_note is null or char_length(v_note) < 3 then raise exception 'Please give a reason.'; end if;
    for i in select * from public.purchase_order_items where po_id = p_po and coalesce(qty_confirmed, 0) > 0 loop
      perform public.stock_apply(v_sup, i.product_id, i.warehouse_id, 'release', i.qty_confirmed, o.po_number, 'Order cancelled');
    end loop;
    update public.purchase_orders set status = 'cancelled', cancel_reason = v_note, cancelled_at = now() where id = p_po;
  elsif p_action = 'note' then
    if v_note is null then raise exception 'Write a note first.'; end if;
    update public.purchase_orders set supplier_note = v_note where id = p_po;
  else raise exception 'Unknown action.'; end if;
  update public.purchase_orders set updated_at = now() where id = p_po;
  v_label := p_action;
  perform public.write_activity('purchase_order_' || v_label, 'purchase_orders', 'Supplier ' || v_label || ' order ' || o.po_number, jsonb_build_object('po_id', p_po, 'supplier_id', v_sup));
end $$;
revoke execute on function public.supplier_po_action(uuid, text, text, jsonb) from public, anon;
grant execute on function public.supplier_po_action(uuid, text, text, jsonb) to authenticated;

-- TradeLink staff close the loop: delivered, or cancelled (releasing any reserved stock).
create or replace function public.admin_po_action(p_po uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.purchase_orders; s public.suppliers; i public.purchase_order_items; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not public.is_tl_staff() then raise exception 'Only the owner or a manager can do this.'; end if;
  select * into o from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'Order not found.'; end if;
  select * into s from public.suppliers where id = o.supplier_id;
  if p_action = 'deliver' then
    if o.status <> 'dispatched' then raise exception 'Only a dispatched order can be marked delivered.'; end if;
    update public.purchase_orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = p_po;
    perform public.notify(s.profile_id, 'order_delivered', 'Order delivered: ' || o.po_number, null, '/supplier/orders');
  elsif p_action = 'cancel' then
    if o.status in ('delivered','cancelled','rejected') then raise exception 'This order is already closed.'; end if;
    if v_note is null or char_length(v_note) < 3 then raise exception 'Please give a reason.'; end if;
    if o.status in ('accepted','preparing','ready_for_pickup') then
      for i in select * from public.purchase_order_items where po_id = p_po and coalesce(qty_confirmed, 0) > 0 loop
        perform public.stock_apply(o.supplier_id, i.product_id, i.warehouse_id, 'release', i.qty_confirmed, o.po_number, 'Order cancelled');
      end loop;
    end if;
    update public.purchase_orders set status = 'cancelled', cancel_reason = v_note, cancelled_at = now(), updated_at = now() where id = p_po;
    perform public.notify(s.profile_id, 'order_cancelled', 'Order cancelled: ' || o.po_number, v_note, '/supplier/orders');
  else raise exception 'Unknown action.'; end if;
  perform public.write_activity('purchase_order_' || p_action, 'purchase_orders', 'TradeLink ' || p_action || ' order ' || o.po_number, jsonb_build_object('po_id', p_po, 'supplier_id', o.supplier_id));
end $$;
revoke execute on function public.admin_po_action(uuid, text, text) from public, anon;
grant execute on function public.admin_po_action(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Dashboard numbers for the signed-in supplier
-- ---------------------------------------------------------------------------
create or replace function public.supplier_dashboard(p_tz text default 'UTC') returns jsonb
language plpgsql stable set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); r jsonb;
begin
  if v_sup is null then raise exception 'Your supplier account is not approved.'; end if;
  select jsonb_build_object(
    'products_total',    (select count(*) from public.supplier_products where supplier_id = v_sup),
    'products_active',   (select count(*) from public.supplier_products where supplier_id = v_sup and active and status = 'approved'),
    'products_pending',  (select count(*) from public.supplier_products where supplier_id = v_sup and status = 'pending'),
    'orders_new',        (select count(*) from public.purchase_orders where supplier_id = v_sup and status = 'new'),
    'orders_accepted',   (select count(*) from public.purchase_orders where supplier_id = v_sup and status in ('accepted','preparing')),
    'orders_awaiting_delivery', (select count(*) from public.purchase_orders where supplier_id = v_sup and status in ('ready_for_pickup','dispatched')),
    'orders_completed',  (select count(*) from public.purchase_orders where supplier_id = v_sup and status = 'delivered'),
    'sales_total',       (select coalesce(sum(total_amount), 0) from public.purchase_orders where supplier_id = v_sup and status = 'delivered'),
    'sales_open',        (select coalesce(sum(total_amount), 0) from public.purchase_orders where supplier_id = v_sup and status in ('accepted','preparing','ready_for_pickup','dispatched')),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'value', v) order by d) from (
        select g::date d, coalesce((select sum(o.total_amount) from public.purchase_orders o where o.supplier_id = v_sup and o.status = 'delivered'
               and (o.delivered_at at time zone p_tz)::date = g::date), 0) v
        from generate_series((now() at time zone p_tz)::date - 29, (now() at time zone p_tz)::date, interval '1 day') g) x), '[]'),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'available', av, 'level', reorder_level) order by av) from (
        select p.id, p.name, p.reorder_level, coalesce((select sum(available) from public.supplier_stock s where s.product_id = p.id), 0) av
        from public.supplier_products p where p.supplier_id = v_sup and p.active and p.reorder_level > 0) q where av <= reorder_level), '[]'),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'po_number', po_number, 'store_name', store_name, 'status', status, 'total_amount', total_amount, 'created_at', created_at) order by created_at desc) from (
        select * from public.purchase_orders where supplier_id = v_sup order by created_at desc limit 6) q), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function public.supplier_dashboard(text) from public, anon;
grant execute on function public.supplier_dashboard(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Product photos: public bucket, each supplier writes only inside its own folder while approved
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('supplier-products', 'supplier-products', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.owns_approved_supplier_folder(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select public.my_supplier_id()::text = (storage.foldername(p_name))[1]
$$;
revoke execute on function public.owns_approved_supplier_folder(text) from public, anon;
grant execute on function public.owns_approved_supplier_folder(text) to authenticated;
drop policy if exists "Supplier manages product photos" on storage.objects;
create policy "Supplier manages product photos" on storage.objects for all to authenticated
using (bucket_id = 'supplier-products' and (public.owns_approved_supplier_folder(name) or public.is_tl_staff()))
with check (bucket_id = 'supplier-products' and (public.owns_approved_supplier_folder(name) or public.is_tl_staff()));
