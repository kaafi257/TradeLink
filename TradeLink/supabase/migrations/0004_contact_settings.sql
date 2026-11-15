-- TradeLink: business contact channels, editable in Admin -> Communication.
-- Run ONCE in the Supabase SQL Editor (after 0001-0003). Idempotent.
create table if not exists public.contact_settings (
  id boolean primary key default true check (id),            -- exactly one row
  phone text not null default '' check (char_length(phone) <= 40),
  whatsapp text not null default '' check (char_length(whatsapp) <= 40),
  telegram text not null default '' check (char_length(telegram) <= 80),
  email text not null default '' check (char_length(email) <= 160),
  address text not null default '' check (char_length(address) <= 200),
  working_hours text not null default '' check (char_length(working_hours) <= 120),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.contact_settings (id) values (true) on conflict do nothing;
alter table public.contact_settings enable row level security;

drop policy if exists "Staff read contact settings" on public.contact_settings;
create policy "Staff read contact settings" on public.contact_settings for select to authenticated
using (public.has_any_role(array['owner','manager','sales']::public.app_role[]));
drop policy if exists "Managers update contact settings" on public.contact_settings;
create policy "Managers update contact settings" on public.contact_settings for update to authenticated
using (public.has_any_role(array['owner','manager']::public.app_role[]))
with check (public.has_any_role(array['owner','manager']::public.app_role[]));

create or replace function public.contact_settings_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := true;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
drop trigger if exists contact_settings_before_update on public.contact_settings;
create trigger contact_settings_before_update before update on public.contact_settings
for each row execute function public.contact_settings_before_update();

create or replace function public.log_contact_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.write_activity('contact_updated', 'settings', 'Updated business contact details', '{}'::jsonb);
  return new;
end;
$$;
drop trigger if exists log_contact_change on public.contact_settings;
create trigger log_contact_change after update on public.contact_settings
for each row execute function public.log_contact_change();

revoke all on public.contact_settings from anon;
revoke insert, delete, truncate on public.contact_settings from authenticated;
grant select, update on public.contact_settings to authenticated;

-- What the public website may read (the owner's rights apply inside the view, like public_products).
drop view if exists public.public_contact;
create view public.public_contact as
select phone, whatsapp, telegram, email, address, working_hours from public.contact_settings;
grant select on public.public_contact to anon, authenticated;

revoke execute on function public.contact_settings_before_update() from public, anon, authenticated;
revoke execute on function public.log_contact_change() from public, anon, authenticated;
