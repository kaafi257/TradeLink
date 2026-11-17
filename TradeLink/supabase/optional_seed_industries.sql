-- OPTIONAL. Not a migration; run only if you want these industries to exist (they can also be added any time in Admin -> Industries & Categories).
-- Adds the marketplace's starting industries with NO products. The homepage lists an industry as "Coming soon" until a product is added to one of its categories.
-- Safe to re-run (existing names are left alone). Clothing & Fashion already exists from migration 0006.
insert into public.industries (name, description, icon, sort_order) values
  ('Food & Beverages', null, 'utensils', 10),
  ('Electronics', null, 'smartphone', 30),
  ('Agriculture', null, 'sprout', 40),
  ('Furniture & Home', null, 'armchair', 50),
  ('Construction & Building Materials', null, 'hardhat', 60),
  ('Health & Medical Supplies', null, 'pill', 70),
  ('Beauty & Personal Care', null, 'sparkles', 80),
  ('Automotive', null, 'car', 90),
  ('Office Supplies', null, 'book', 100),
  ('Packaging', null, 'package', 110),
  ('Other Industries', null, 'factory', 120)
on conflict (name) do nothing;
