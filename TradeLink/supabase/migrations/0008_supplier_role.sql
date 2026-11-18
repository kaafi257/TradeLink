-- TradeLink Supplier Portal, step 1 of 2. Run this file ON ITS OWN first, then run 0009_supplier_portal.sql.
-- (PostgreSQL does not let a new enum value be used in the same transaction that creates it.)
alter type public.app_role add value if not exists 'supplier';
