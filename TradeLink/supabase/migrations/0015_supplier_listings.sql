-- TradeLink: approved supplier products appear in the public marketplace.
-- Run after 0013 (and 0014). Additive and safe to run more than once.
--
-- How it works
--  * A supplier adds a product (status "pending"). Nothing is public yet.
--  * When TradeLink approves it, a normal row in the existing `products` table is created for it (the "listing"),
--    linked to the supplier product and the supplier. All existing pages (store, search, categories, quotes, orders,
--    sales, reports) therefore work for it with no special cases.
--  * TradeLink (the store) sets its own retail price on the listing. Until it does, the item is wholesale-only.
--  * Stock is the supplier's real stock: the listing's stock is recalculated inside the same transaction whenever the
--    supplier's warehouse stock changes, so the website is always current.
--  * A recorded sale takes the units out of the supplier's warehouses under row locks. If there is not enough, the sale
--    fails and nothing changes, so the same unit can never be sold twice.
--  * Editing what the product is, rejecting it, or suspending the supplier hides the listing until it is approved again.

-- ---------------------------------------------------------------------------
-- 1. Links
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists supplier_product_id uuid references public.supplier_products(id) on delete set null;
create unique index if not exists products_supplier_product_idx on public.products(supplier_product_id) where supplier_product_id is not null;
create index if not exists products_supplier_idx on public.products(supplier_id) where supplier_id is not null;

-- A supplier cannot list the same product name twice (only added when existing data allows it).
do $$ begin
  create unique index if not exists supplier_products_name_idx on public.supplier_products(supplier_id, lower(btrim(name)));
exception when unique_violation then
  raise notice 'Duplicate supplier product names already exist; unique name index skipped. Remove the duplicates and run this file again.';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Listing guard: stock and links of a supplier product are managed by the system, not edited by hand
-- ---------------------------------------------------------------------------
create or replace function public.products_listing_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.listing_sync', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.supplier_product_id is distinct from old.supplier_product_id or new.supplier_id is distinct from old.supplier_id then
      raise exception 'The supplier link of a product cannot be changed.';
    end if;
    if old.supplier_product_id is not null and new.stock_quantity is distinct from old.stock_quantity then
      raise exception 'Stock for supplier products comes from the supplier''s warehouses and cannot be edited here.';
    end if;
  elsif new.supplier_product_id is not null or new.supplier_id is not null then
    raise exception 'Supplier products are listed by approving them.';
  end if;
  return new;
end $$;
drop trigger if exists products_listing_guard on public.products;
create trigger products_listing_guard before insert or update on public.products for each row execute function public.products_listing_guard();
revoke execute on function public.products_listing_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Create / refresh the listing for one supplier product
-- ---------------------------------------------------------------------------
create or replace function public.sync_supplier_listing(p_id uuid, p_activate boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare sp public.supplier_products; s public.suppliers; v_live boolean; v_cat text; v_img text; v_stock numeric; l uuid;
begin
  select * into sp from public.supplier_products where id = p_id;
  if not found then return; end if;
  select * into s from public.suppliers where id = sp.supplier_id;
  v_live := sp.status = 'approved' and sp.active and s.status = 'approved' and s.active;
  select id into l from public.products where supplier_product_id = p_id;
  if l is null and not v_live then return; end if;

  perform set_config('app.listing_sync', 'on', true);
  perform set_config('app.stock_rpc', 'on', true);
  select name into v_cat from public.categories where id = sp.category_id;
  v_cat := coalesce(v_cat, 'Uncategorized');
  v_img := case when cardinality(sp.image_paths) > 0 then 'storage:supplier-products/' || sp.image_paths[1] end;
  select coalesce(sum(available), 0) into v_stock from public.supplier_stock where product_id = p_id;

  if l is null then
    insert into public.products (name, category, category_id, description, image_url, unit, wholesale_price, min_order_quantity,
                                 stock_quantity, reorder_level, active, audience, retail_price, brand, supplier_id, supplier_product_id)
    values (sp.name, v_cat, sp.category_id, sp.description, v_img, sp.unit, sp.price, sp.min_order_qty,
            0, sp.reorder_level, true, 'b2b', 0, sp.brand, sp.supplier_id, sp.id)
    returning id into l;
    update public.products set stock_quantity = v_stock where id = l and stock_quantity is distinct from v_stock;
  else
    update public.products set name = sp.name, category = v_cat, category_id = sp.category_id, description = sp.description, image_url = v_img,
           unit = sp.unit, wholesale_price = sp.price, min_order_quantity = sp.min_order_qty, reorder_level = sp.reorder_level, brand = sp.brand,
           stock_quantity = v_stock,
           active = case when not v_live then false when p_activate then true else active end
     where id = l;
  end if;

  -- extra photos (the first one is the main image)
  delete from public.product_images where product_id = l and url like 'storage:%';
  insert into public.product_images (product_id, url, sort_order)
  select l, 'storage:supplier-products/' || path, 100 + ord::int
  from unnest(sp.image_paths) with ordinality as t(path, ord) where ord > 1;
end $$;
revoke execute on function public.sync_supplier_listing(uuid, boolean) from public, anon, authenticated;

create or replace function public.supplier_products_listing_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_supplier_listing(new.id, tg_op = 'UPDATE' and old.status is distinct from 'approved' and new.status = 'approved');
  return new;
end $$;
drop trigger if exists supplier_products_listing_sync on public.supplier_products;
create trigger supplier_products_listing_sync after insert or update on public.supplier_products for each row execute function public.supplier_products_listing_sync();
revoke execute on function public.supplier_products_listing_sync() from public, anon, authenticated;

-- A suspended, rejected or deactivated supplier takes its listings off the website; approving it again does not auto-republish.
create or replace function public.suppliers_listing_sync() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status is distinct from old.status or new.active is distinct from old.active then
    for r in select id from public.supplier_products where supplier_id = new.id loop perform public.sync_supplier_listing(r.id, false); end loop;
  end if;
  return new;
end $$;
drop trigger if exists suppliers_listing_sync on public.suppliers;
create trigger suppliers_listing_sync after update on public.suppliers for each row execute function public.suppliers_listing_sync();
revoke execute on function public.suppliers_listing_sync() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Live stock: the listing always shows the supplier's real available stock
-- ---------------------------------------------------------------------------
create or replace function public.supplier_stock_mirror() returns trigger language plpgsql security definer set search_path = public as $$
declare v_p uuid := coalesce(new.product_id, old.product_id);
begin
  perform set_config('app.listing_sync', 'on', true);
  perform set_config('app.stock_rpc', 'on', true);
  update public.products set stock_quantity = (select coalesce(sum(available), 0) from public.supplier_stock where product_id = v_p)
   where supplier_product_id = v_p;
  return null;
end $$;
drop trigger if exists supplier_stock_mirror on public.supplier_stock;
create trigger supplier_stock_mirror after insert or update or delete on public.supplier_stock for each row execute function public.supplier_stock_mirror();
revoke execute on function public.supplier_stock_mirror() from public, anon, authenticated;

-- Takes units out of the supplier's warehouses (largest stock first) under row locks; fails whole if short.
create or replace function public.listing_take_stock(p_sp uuid, p_qty numeric, p_ref text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_left numeric := p_qty; v_take numeric; v_sup uuid;
begin
  select supplier_id into v_sup from public.supplier_products where id = p_sp;
  for r in select warehouse_id, available from public.supplier_stock where product_id = p_sp and available > 0 order by available desc for update loop
    exit when v_left <= 0;
    v_take := least(r.available, v_left);
    perform public.stock_apply(v_sup, p_sp, r.warehouse_id, 'remove', v_take, p_ref, 'Marketplace sale');
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then raise exception 'Not enough stock of % for this order.', p_name; end if;
end $$;
revoke execute on function public.listing_take_stock(uuid, numeric, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Selling: identical to before for TradeLink's own products; supplier products draw down the supplier's stock
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
  update public.orders set amount_paid = p_amount_paid, status = 'ready' where id = p_order;
  return v_sale;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The store sets its own retail price (wholesale price stays the supplier's price and is never public)
-- ---------------------------------------------------------------------------
create or replace function public.set_listing_price(p_supplier_product uuid, p_retail numeric, p_sale numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
  if auth.uid() is null or not (public.is_tl_staff() or public.has_permission('products.edit')) then raise exception 'You do not have permission to set prices.'; end if;
  if p_retail is null or p_retail < 0 then raise exception 'Enter a retail price of 0 or more (0 keeps it wholesale only).'; end if;
  if p_sale is not null and (p_sale <= 0 or p_sale >= p_retail) then raise exception 'A sale price must be above 0 and below the retail price.'; end if;
  select id, name into v_id, v_name from public.products where supplier_product_id = p_supplier_product for update;
  if v_id is null then raise exception 'Approve the supplier product first; it is not on the marketplace yet.'; end if;
  update public.products set retail_price = p_retail, sale_price = case when p_retail > 0 then p_sale end,
         audience = case when p_retail > 0 then 'both' else 'b2b' end where id = v_id;
  perform public.write_activity('listing_price_set', 'product', 'Set retail price for ' || v_name, jsonb_build_object('product_id', v_id, 'retail_price', p_retail));
end $$;
revoke execute on function public.set_listing_price(uuid, numeric, numeric) from public, anon;
grant execute on function public.set_listing_price(uuid, numeric, numeric) to authenticated;

-- What the admin screens need to show a listing next to its supplier product.
create or replace view public.supplier_listing_status with (security_invoker = true) as
select p.supplier_product_id, p.id as product_id, p.active as listed, p.retail_price, p.sale_price, p.audience, p.stock_quantity
from public.products p where p.supplier_product_id is not null;
grant select on public.supplier_listing_status to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Public views: same harmless columns as before, plus which (publicly listed) supplier a product comes from
-- ---------------------------------------------------------------------------
drop view if exists public.public_best_sellers;
drop view if exists public.public_product_images;
drop view if exists public.public_product_options;
drop view if exists public.public_products;
create view public.public_products as
select p.id, p.name, p.category, p.description, p.image_url, p.unit, p.package_size, p.min_order_quantity,
       p.category_id, p.audience,
       case when p.audience in ('b2c','both') and p.retail_price > 0 then p.retail_price end as retail_price,
       p.brand,
       case when p.audience in ('b2c','both') and p.retail_price > 0 then p.sale_price end as sale_price,
       p.created_at,
       case when p.stock_quantity <= 0 then 'out'
            when p.reorder_level > 0 and p.stock_quantity <= p.reorder_level then 'low'
            else 'in' end as stock_status,
       case when p.stock_quantity > 0 and p.reorder_level > 0 and p.stock_quantity <= p.reorder_level then p.stock_quantity end as stock_left,
       (select ps.id from public.public_suppliers ps where ps.id = p.supplier_id) as supplier_id
from public.products p
left join public.categories c on c.id = p.category_id
left join public.industries i on i.id = c.industry_id
where p.active = true and (c.id is null or (c.active and i.active));
grant select on public.public_products to anon, authenticated;

create view public.public_product_images as
select i.id, i.product_id, i.url, i.sort_order from public.product_images i join public.public_products p on p.id = i.product_id;
grant select on public.public_product_images to anon, authenticated;
create view public.public_product_options as
select o.id, o.product_id, o.kind, o.label, o.color_hex, o.sort_order from public.product_options o join public.public_products p on p.id = o.product_id;
grant select on public.public_product_options to anon, authenticated;
create view public.public_best_sellers as
select x.product_id, x.rank from (
  select oi.product_id, row_number() over (order by sum(oi.quantity) desc, max(s.sold_at) desc) as rank
  from public.order_items oi
  join public.sales s on s.order_id = oi.order_id
  join public.public_products p on p.id = oi.product_id
  group by oi.product_id
) x where x.rank <= 12;
grant select on public.public_best_sellers to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Publish anything that was already approved before this file existed
-- ---------------------------------------------------------------------------
select public.sync_supplier_listing(id, true) from public.supplier_products where status = 'approved';
