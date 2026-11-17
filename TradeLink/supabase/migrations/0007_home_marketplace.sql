-- TradeLink multi-industry homepage: starter industries + a real suppliers directory.
-- Additive and safe to run more than once. Run 0005 and 0006 first.

-- ---------------------------------------------------------------------------
-- 1. Starter industries (only the ones you do not have yet). They appear on the homepage grid
--    and get products as soon as you add categories and products in Admin.
--    "Food & Beverages" is skipped when you already have "Food & Groceries".
-- ---------------------------------------------------------------------------
insert into public.industries (name, description, icon, sort_order)
select v.name, v.descr, v.icon, v.ord
from (values
  ('Food & Beverages',                   'Staples, drinks and groceries',            'wheat',      10),
  ('Electronics',                        'Phones, computers and accessories',        'smartphone', 30),
  ('Agriculture',                        'Seeds, fertilizers and farm produce',      'sprout',     40),
  ('Furniture & Home',                   'Tables, chairs, sofas and home goods',     'armchair',   50),
  ('Construction & Building Materials',  'Cement, tools and building materials',     'hardhat',    60),
  ('Health & Medical Supplies',          'Medical and pharmacy supplies',            'pill',       70),
  ('Beauty & Personal Care',             'Cosmetics and personal care',              'sparkles',   80),
  ('Automotive',                         'Vehicles, spare parts and accessories',    'car',        90),
  ('Office Supplies',                    'Stationery and office equipment',          'book',      100),
  ('Packaging',                          'Boxes, bags and packaging materials',      'package',   110),
  ('Other Industries',                   'Everything else',                          'factory',   120)
) as v(name, descr, icon, ord)
where not exists (select 1 from public.industries i where i.name = v.name)
  and not (v.name = 'Food & Beverages' and exists (select 1 from public.industries i where i.name = 'Food & Groceries'));

-- ---------------------------------------------------------------------------
-- 2. Suppliers directory. Only suppliers marked "Show on the public website" are visible to visitors,
--    and only these harmless fields: name, industry, location, a short description and categories.
--    Private contact details are never stored here.
-- ---------------------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  industry_id uuid not null references public.industries(id) on delete restrict,
  location text,
  about text check (about is null or char_length(about) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name)
);
create index if not exists suppliers_industry_idx on public.suppliers(industry_id);

create table if not exists public.supplier_categories (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (supplier_id, category_id)
);

alter table public.suppliers enable row level security;
alter table public.supplier_categories enable row level security;

drop policy if exists "Staff read suppliers" on public.suppliers;
create policy "Staff read suppliers" on public.suppliers for select to authenticated
using (public.has_any_role(array['owner','manager','sales','inventory','delivery']::public.app_role[]));
drop policy if exists "Manage suppliers" on public.suppliers;
create policy "Manage suppliers" on public.suppliers for all to authenticated
using (public.has_permission('catalogue.manage')) with check (public.has_permission('catalogue.manage'));

drop policy if exists "Staff read supplier categories" on public.supplier_categories;
create policy "Staff read supplier categories" on public.supplier_categories for select to authenticated
using (public.has_any_role(array['owner','manager','sales','inventory','delivery']::public.app_role[]));
drop policy if exists "Manage supplier categories" on public.supplier_categories;
create policy "Manage supplier categories" on public.supplier_categories for all to authenticated
using (public.has_permission('catalogue.manage')) with check (public.has_permission('catalogue.manage'));

grant select, insert, update, delete on public.suppliers, public.supplier_categories to authenticated;

-- Public views (what the website reads).
drop view if exists public.public_suppliers;
create view public.public_suppliers as
select s.id, s.name, s.industry_id, s.location, s.about
from public.suppliers s join public.industries i on i.id = s.industry_id
where s.active and i.active;
grant select on public.public_suppliers to anon, authenticated;

drop view if exists public.public_supplier_categories;
create view public.public_supplier_categories as
select sc.supplier_id, sc.category_id
from public.supplier_categories sc
join public.public_suppliers s on s.id = sc.supplier_id
join public.public_categories c on c.id = sc.category_id;
grant select on public.public_supplier_categories to anon, authenticated;

-- Record who added or removed a supplier in the Activity Log.
create or replace function public.log_supplier_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.write_activity('supplier_' || lower(tg_op), 'catalogue',
    (case tg_op when 'INSERT' then 'Added supplier ' when 'DELETE' then 'Removed supplier ' end) || (case when tg_op = 'DELETE' then old.name else new.name end), '{}'::jsonb);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists log_supplier_insert on public.suppliers;
create trigger log_supplier_insert after insert on public.suppliers for each row execute function public.log_supplier_change();
drop trigger if exists log_supplier_delete on public.suppliers;
create trigger log_supplier_delete after delete on public.suppliers for each row execute function public.log_supplier_change();
