-- Lets signed-in suppliers see the commission rate that applies to a category (read-only; only the category id and the percentage are exposed).
-- Run AFTER 0017_admin_suite.sql. Safe to run more than once.
create or replace view public.category_commission_public as
select category_id, rate from public.category_commission_rates;
revoke all on public.category_commission_public from public, anon;
grant select on public.category_commission_public to authenticated;
