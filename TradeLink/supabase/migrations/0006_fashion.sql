-- TradeLink fashion storefront. Run ONCE in the Supabase SQL Editor after 0001-0005. Idempotent (safe to re-run).
-- Adds to the EXISTING products table (no second product table): brand, sale price, a photo gallery and size/colour options.
-- Stock stays one number per product (adjust_stock / record_sale are untouched).

-- ---------------------------------------------------------------------------
-- Which industries use the fashion storefront (/clothing). Set it in Admin -> Industries & Categories.
-- ---------------------------------------------------------------------------
alter table public.industries add column if not exists storefront text not null default 'standard' check (storefront in ('standard','fashion'));

-- ---------------------------------------------------------------------------
-- Product details used by clothing
-- ---------------------------------------------------------------------------
alter table public.products add column if not exists brand text check (char_length(brand) <= 60);
alter table public.products add column if not exists sale_price numeric(14,2) check (sale_price is null or sale_price >= 0);
alter table public.products drop constraint if exists products_sale_below_retail;
alter table public.products add constraint products_sale_below_retail check (sale_price is null or sale_price < retail_price);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null check (char_length(url) <= 600),
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create index if not exists product_images_product_idx on public.product_images(product_id, sort_order);

create table if not exists public.product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('size','color')),
  label text not null check (char_length(btrim(label)) between 1 and 30),
  color_hex text check (color_hex is null or color_hex ~* '^#[0-9a-f]{6}$'),
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create unique index if not exists product_options_unique on public.product_options(product_id, kind, lower(btrim(label)));
create index if not exists product_options_product_idx on public.product_options(product_id, kind, sort_order);

-- ---------------------------------------------------------------------------
-- Row-level security: staff with "Add and edit products" manage them; the public only uses the views below.
-- ---------------------------------------------------------------------------
alter table public.product_images enable row level security;
alter table public.product_options enable row level security;
drop policy if exists "Staff read product images" on public.product_images;
create policy "Staff read product images" on public.product_images for select to authenticated
using (public.has_any_role(array['owner','manager','sales','inventory','delivery']::public.app_role[]));
drop policy if exists "Manage product images" on public.product_images;
create policy "Manage product images" on public.product_images for all to authenticated
using (public.has_permission('products.edit')) with check (public.has_permission('products.edit'));
drop policy if exists "Staff read product options" on public.product_options;
create policy "Staff read product options" on public.product_options for select to authenticated
using (public.has_any_role(array['owner','manager','sales','inventory','delivery']::public.app_role[]));
drop policy if exists "Manage product options" on public.product_options;
create policy "Manage product options" on public.product_options for all to authenticated
using (public.has_permission('products.edit')) with check (public.has_permission('products.edit'));
grant select, insert, update, delete on public.product_images, public.product_options to authenticated;

-- ---------------------------------------------------------------------------
-- Public views (harmless columns only). Stock is shown as in / low / out; the exact number only when it is running low.
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
       case when p.stock_quantity > 0 and p.reorder_level > 0 and p.stock_quantity <= p.reorder_level then p.stock_quantity end as stock_left
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

-- Best sellers: ranked from real recorded sales (a product's rank only; no quantities, prices or customers are exposed).
create view public.public_best_sellers as
select x.product_id, x.rank from (
  select oi.product_id, row_number() over (order by sum(oi.quantity) desc, max(s.sold_at) desc) as rank
  from public.order_items oi
  join public.sales s on s.order_id = oi.order_id
  join public.public_products p on p.id = oi.product_id
  group by oi.product_id
) x where x.rank <= 12;
grant select on public.public_best_sellers to anon, authenticated;

drop view if exists public.public_industries;
create view public.public_industries as
select id, name, description, icon, sort_order, storefront from public.industries where active = true;
grant select on public.public_industries to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Starter structure (no products): a Clothing industry that uses the fashion storefront, and its categories.
-- Rename, hide or add categories any time in Admin -> Industries & Categories.
-- ---------------------------------------------------------------------------
insert into public.industries (name, description, icon, sort_order, storefront)
values ('Clothing & Fashion', 'Clothing, shoes and accessories', 'shirt', 20, 'fashion')
on conflict (name) do nothing;
insert into public.categories (industry_id, name, sort_order)
select i.id, c.name, c.ord from public.industries i,
  (values ('Men''s Clothing',10),('Women''s Clothing',20),('Shirts',30),('Jackets',40),('Trousers',50),('Shoes',60),('Accessories',70)) as c(name, ord)
where i.name = 'Clothing & Fashion'
on conflict (industry_id, name) do nothing;
