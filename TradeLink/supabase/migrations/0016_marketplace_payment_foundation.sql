-- TradeLink marketplace payments foundation
-- Additive only. This migration records payment-provider configuration and payment ledger
-- metadata. It does NOT initiate transfers, verify receipts, or execute supplier payouts.
-- Those operations remain disabled until each provider's official merchant integration,
-- credentials, callback verification and reconciliation tests are completed.

create table if not exists public.marketplace_payment_providers (
  id uuid primary key default gen_random_uuid(),
  provider_code text not null unique check (provider_code in ('telebirr','bank_transfer','cbe','ebirr')),
  display_name text not null,
  enabled boolean not null default false,
  integration_status text not null default 'not_configured'
    check (integration_status in ('not_configured','sandbox','testing','active','suspended')),
  merchant_reference text,
  public_configuration jsonb not null default '{}'::jsonb,
  credentials_configured boolean not null default false,
  last_tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (integration_status <> 'active' or (enabled and credentials_configured))
);

insert into public.marketplace_payment_providers (provider_code, display_name)
values
  ('telebirr', 'Telebirr'),
  ('bank_transfer', 'Bank transfer'),
  ('cbe', 'Commercial Bank of Ethiopia'),
  ('ebirr', 'eBirr')
on conflict (provider_code) do nothing;

create table if not exists public.marketplace_payment_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  provider_code text not null check (provider_code in ('telebirr','bank_transfer','cbe','ebirr')),
  transaction_reference text,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'ETB' check (currency = 'ETB'),
  status text not null default 'pending'
    check (status in ('pending','submitted','verified','failed','refunded','cancelled')),
  verification_source text,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_payment_records_order_idx
  on public.marketplace_payment_records(order_id);
create index if not exists marketplace_payment_records_supplier_idx
  on public.marketplace_payment_records(supplier_id);
create index if not exists marketplace_payment_records_status_idx
  on public.marketplace_payment_records(status, created_at desc);

alter table public.marketplace_payment_providers enable row level security;
alter table public.marketplace_payment_records enable row level security;

drop policy if exists "tl staff manage payment providers" on public.marketplace_payment_providers;
create policy "tl staff manage payment providers"
on public.marketplace_payment_providers for all to authenticated
using (public.is_tl_staff())
with check (public.is_tl_staff());

drop policy if exists "tl staff manage marketplace payment records" on public.marketplace_payment_records;
create policy "tl staff manage marketplace payment records"
on public.marketplace_payment_records for all to authenticated
using (public.is_tl_staff())
with check (public.is_tl_staff());

grant select, insert, update, delete on public.marketplace_payment_providers to authenticated;
grant select, insert, update, delete on public.marketplace_payment_records to authenticated;

comment on table public.marketplace_payment_providers is
  'Admin-managed Ethiopian payment rails. Active status must not be set until the real provider integration has been tested.';
comment on table public.marketplace_payment_records is
  'ETB payment ledger metadata. A row is not proof of payment; only trusted server-side verification may set status to verified.';
