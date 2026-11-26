-- 0013 created the supplier-operations tables with row-level rules but no table privileges,
-- so every read/write failed with "permission denied". RLS policies still decide which rows each person sees.
grant select, insert, update on public.supplier_products to authenticated;
grant select, insert, update on public.supplier_warehouses to authenticated;
grant select on public.supplier_stock, public.supplier_stock_movements,
                public.purchase_orders, public.purchase_order_contacts, public.purchase_order_items to authenticated;
