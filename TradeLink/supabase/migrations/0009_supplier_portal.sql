-- TradeLink Supplier Portal, step 2 of 2 (stage 1: supplier accounts and approval).
-- Run AFTER 0008_supplier_role.sql. Safe to run more than once.
--
-- Reuses the existing tables: profiles (login + role), suppliers (the business record from 0007),
-- activity_logs (audit trail). Adds supplier registration data, an approval workflow, in-app
-- notifications and private storage for logos and business documents.

-- ---------------------------------------------------------------------------
-- 1. The supplier business record grows into a full account
-- ---------------------------------------------------------------------------
alter table public.suppliers
  add column if not exists profile_id uuid unique references public.profiles(id) on delete set null,
  add column if not exists status text not null default 'approved' check (status in ('pending','approved','rejected','suspended')),
  add column if not exists owner_name text check (char_length(owner_name) <= 120),
  add column if not exists phone text check (char_length(phone) <= 40),
  add column if not exists email text check (char_length(email) <= 160),
  add column if not exists address text check (char_length(address) <= 200),
  add column if not exists business_type text check (business_type in ('manufacturer','wholesaler','distributor','importer','retailer','farmer','service','other')),
  add column if not exists logo_path text,
  add column if not exists documents jsonb not null default '[]'::jsonb,
  add column if not exists status_note text check (char_length(status_note) <= 500),
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists fee_rate numeric(5,2) not null default 0 check (fee_rate between 0 and 100),
  add column if not exists source_hash text,
  add column if not exists updated_at timestamptz not null default now();
-- Suppliers that already exist (added by staff in the directory) stay approved: the column default is 'approved'.
-- New self-registrations are inserted as 'pending' by the register-supplier function.

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();

-- Who may change what. The service role / SQL editor (no signed-in user) is unrestricted.
create or replace function public.suppliers_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if public.has_any_role(array['owner','manager']::public.app_role[]) then
    if new.status is distinct from old.status then new.reviewed_by := auth.uid(); new.reviewed_at := now(); end if;
    return new;
  end if;

  if public.current_user_role() = 'supplier' then
    if new.profile_id is distinct from old.profile_id or new.status is distinct from old.status
       or new.industry_id is distinct from old.industry_id or new.active is distinct from old.active
       or new.fee_rate is distinct from old.fee_rate or new.status_note is distinct from old.status_note
       or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at
       or new.source_hash is distinct from old.source_hash then
      raise exception 'Only TradeLink can change your approval, industry or fees.';
    end if;
    if old.status <> 'pending' and new.name is distinct from old.name then
      raise exception 'To change the business name, please contact TradeLink.';
    end if;
    return new;
  end if;

  -- Other staff who manage the catalogue can edit the directory entry, but not approvals or fees.
  if new.profile_id is distinct from old.profile_id or new.status is distinct from old.status
     or new.fee_rate is distinct from old.fee_rate or new.status_note is distinct from old.status_note
     or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Only the owner or a manager can change supplier approval or fees.';
  end if;
  return new;
end;
$$;
drop trigger if exists suppliers_guard on public.suppliers;
create trigger suppliers_guard before update on public.suppliers for each row execute function public.suppliers_guard();

-- Suppliers read and edit only their own business row (the trigger above limits which columns).
drop policy if exists "Supplier reads own business" on public.suppliers;
create policy "Supplier reads own business" on public.suppliers for select to authenticated
using (profile_id = auth.uid() and public.current_user_role() = 'supplier');
drop policy if exists "Supplier edits own business" on public.suppliers;
create policy "Supplier edits own business" on public.suppliers for update to authenticated
using (profile_id = auth.uid() and public.current_user_role() = 'supplier')
with check (profile_id = auth.uid() and public.current_user_role() = 'supplier');

-- Only approved, publicly listed suppliers reach the website, with harmless fields only.
drop view if exists public.public_supplier_categories;
drop view if exists public.public_suppliers;
create view public.public_suppliers as
select s.id, s.name, s.industry_id, s.location, s.about, s.logo_path
from public.suppliers s join public.industries i on i.id = s.industry_id
where s.active and s.status = 'approved' and i.active;
grant select on public.public_suppliers to anon, authenticated;
create view public.public_supplier_categories as
select sc.supplier_id, sc.category_id
from public.supplier_categories sc
join public.public_suppliers s on s.id = sc.supplier_id
join public.public_categories c on c.id = sc.category_id;
grant select on public.public_supplier_categories to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. In-app notifications (any signed-in user reads only their own)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null check (char_length(title) <= 160),
  body text check (char_length(body) <= 600),
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;

drop policy if exists "Read own notifications" on public.notifications;
create policy "Read own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "Mark own notifications read" on public.notifications;
create policy "Mark own notifications read" on public.notifications for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, update on public.notifications to authenticated;

-- Users may only set read_at; nothing else about a notification can be edited from the browser.
create or replace function public.notifications_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if new.user_id is distinct from old.user_id or new.kind is distinct from old.kind or new.title is distinct from old.title
     or new.body is distinct from old.body or new.link is distinct from old.link or new.created_at is distinct from old.created_at then
    raise exception 'Notifications cannot be edited.';
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_guard on public.notifications;
create trigger notifications_guard before update on public.notifications for each row execute function public.notifications_guard();

-- The only way a notification is created: from inside other database functions. Not callable from the browser.
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text default null, p_link text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications(user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);
end;
$$;
revoke execute on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Approval workflow (owner or manager only), always recorded in the Activity Log
-- ---------------------------------------------------------------------------
create or replace function public.review_supplier(p_id uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.suppliers; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not public.has_any_role(array['owner','manager']::public.app_role[]) then
    raise exception 'Only the owner or a manager can review suppliers.';
  end if;
  select * into s from public.suppliers where id = p_id for update;
  if not found then raise exception 'Supplier not found.'; end if;

  if p_action = 'approve' then
    if s.status not in ('pending','rejected') then raise exception 'Only a pending or rejected application can be approved.'; end if;
    update public.suppliers set status = 'approved', active = true, status_note = null where id = p_id;
    perform public.notify(s.profile_id, 'supplier_approved', 'Your supplier account is approved', 'You can now sign in to the supplier portal and manage your business.', '/supplier');
  elsif p_action = 'reject' then
    if s.status <> 'pending' then raise exception 'Only a pending application can be rejected.'; end if;
    if v_note is null or char_length(v_note) < 5 then raise exception 'Please give the reason, so the supplier can correct it.'; end if;
    update public.suppliers set status = 'rejected', active = false, status_note = v_note where id = p_id;
    perform public.notify(s.profile_id, 'supplier_rejected', 'Your supplier application needs changes', v_note, '/supplier');
  elsif p_action = 'suspend' then
    if s.status <> 'approved' then raise exception 'Only an approved supplier can be suspended.'; end if;
    if v_note is null or char_length(v_note) < 5 then raise exception 'Please give the reason for the suspension.'; end if;
    update public.suppliers set status = 'suspended', active = false, status_note = v_note where id = p_id;
    perform public.notify(s.profile_id, 'supplier_suspended', 'Your supplier account is suspended', v_note, '/supplier');
  elsif p_action = 'reactivate' then
    if s.status <> 'suspended' then raise exception 'Only a suspended supplier can be reactivated.'; end if;
    update public.suppliers set status = 'approved', active = true, status_note = null where id = p_id;
    perform public.notify(s.profile_id, 'supplier_reactivated', 'Your supplier account is active again', null, '/supplier');
  else
    raise exception 'Unknown action.';
  end if;
  perform public.write_activity('supplier_' || p_action, 'suppliers', initcap(p_action) || ' supplier ' || s.name, jsonb_build_object('supplier_id', p_id, 'note', v_note));
end;
$$;
revoke execute on function public.review_supplier(uuid, text, text) from public, anon;
grant execute on function public.review_supplier(uuid, text, text) to authenticated;

-- A rejected supplier corrects the application and sends it back for review.
create or replace function public.resubmit_supplier()
returns void language plpgsql security definer set search_path = public as $$
declare s public.suppliers;
begin
  if auth.uid() is null or public.current_user_role() <> 'supplier' then raise exception 'Not a supplier account.'; end if;
  select * into s from public.suppliers where profile_id = auth.uid() for update;
  if not found then raise exception 'No supplier application found.'; end if;
  if s.status <> 'rejected' then raise exception 'Only a rejected application can be resubmitted.'; end if;
  update public.suppliers set status = 'pending', status_note = null where id = s.id;
  perform public.write_activity('supplier_resubmitted', 'suppliers', 'Supplier resubmitted application: ' || s.name, jsonb_build_object('supplier_id', s.id));
end;
$$;
revoke execute on function public.resubmit_supplier() from public, anon;
grant execute on function public.resubmit_supplier() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Storage: public logos, private business documents. Files live in a folder named after the supplier id.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('supplier-logos', 'supplier-logos', true, 2097152, array['image/jpeg','image/png','image/webp']),
  ('supplier-documents', 'supplier-documents', false, 5242880, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.owns_supplier_folder(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.suppliers s
                 where s.id::text = (storage.foldername(p_name))[1] and s.profile_id = auth.uid())
         and public.current_user_role() = 'supplier'
$$;
revoke execute on function public.owns_supplier_folder(text) from public, anon;
grant execute on function public.owns_supplier_folder(text) to authenticated;

drop policy if exists "Supplier manages own logo" on storage.objects;
create policy "Supplier manages own logo" on storage.objects for all to authenticated
using (bucket_id = 'supplier-logos' and (public.owns_supplier_folder(name) or public.has_any_role(array['owner','manager']::public.app_role[])))
with check (bucket_id = 'supplier-logos' and (public.owns_supplier_folder(name) or public.has_any_role(array['owner','manager']::public.app_role[])));

drop policy if exists "Supplier reads own documents" on storage.objects;
create policy "Supplier reads own documents" on storage.objects for select to authenticated
using (bucket_id = 'supplier-documents' and (public.owns_supplier_folder(name) or public.has_any_role(array['owner','manager']::public.app_role[])));
drop policy if exists "Supplier uploads own documents" on storage.objects;
create policy "Supplier uploads own documents" on storage.objects for insert to authenticated
with check (bucket_id = 'supplier-documents' and public.owns_supplier_folder(name));
drop policy if exists "Supplier removes own documents" on storage.objects;
create policy "Supplier removes own documents" on storage.objects for delete to authenticated
using (bucket_id = 'supplier-documents' and (public.owns_supplier_folder(name) or public.has_any_role(array['owner','manager']::public.app_role[])));
