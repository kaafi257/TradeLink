-- The register-supplier edge function runs with the service role (server side only).
-- On projects where table privileges were tightened, that role also needs explicit access.
-- Safe to run more than once.
grant usage on schema public to service_role;
grant select on public.industries to service_role;
grant select, insert, update, delete on public.suppliers to service_role;
grant select, insert, update on public.profiles to service_role;
grant select, insert on public.activity_logs to service_role;
