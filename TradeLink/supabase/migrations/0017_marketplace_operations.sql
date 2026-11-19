-- TradeLink marketplace operations: category commissions, returns/disputes,
-- supplier payout ledger, promotions and customer reviews.
-- Additive migration; does not alter existing order, product, supplier or auth rows.

create table if not exists public.marketplace_category_commissions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  commission_type text not null default 'percentage' check (commission_type in ('percentage','fixed')),
  commission_value numeric(12,2) not null check (commission_value >= 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(category_id)
);

create table if not exists public.marketplace_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null default auth.uid(),
  reason text not null,
  details text,
  status text not null default 'requested'
    check (status in ('requested','under_review','approved','rejected','received','refunded','closed')),
  resolution_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  return_id uuid references public.marketplace_returns(id) on delete set null,
  opened_by uuid references auth.users(id) on delete set null default auth.uid(),
  subject text not null,
  description text not null,
  status text not null default 'open'
    check (status in ('open','investigating','awaiting_customer','awaiting_supplier','resolved','closed')),
  resolution text,
  assigned_to uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_payouts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'ETB' check (currency = 'ETB'),
  provider_code text not null check (provider_code in ('telebirr','bank_transfer','cbe','ebirr')),
  destination_reference text,
  status text not null default 'queued'
    check (status in ('queued','approved','processing','paid','failed','cancelled')),
  provider_transaction_reference text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  failure_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  discount_type text not null check (discount_type in ('percentage','fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  active boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.marketplace_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  reviewer_id uuid references auth.users(id) on delete set null default auth.uid(),
  rating integer not null check (rating between 1 and 5),
  title text,
  body text,
  status text not null default 'pending' check (status in ('pending','published','hidden','rejected')),
  moderated_by uuid references auth.users(id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_returns_order_idx on public.marketplace_returns(order_id);
create index if not exists marketplace_returns_status_idx on public.marketplace_returns(status, created_at desc);
create index if not exists marketplace_disputes_status_idx on public.marketplace_disputes(status, created_at desc);
create index if not exists marketplace_payouts_supplier_idx on public.marketplace_payouts(supplier_id, created_at desc);
create index if not exists marketplace_payouts_status_idx on public.marketplace_payouts(status, created_at desc);
create index if not exists marketplace_promotions_active_idx on public.marketplace_promotions(active, starts_at, ends_at);
create index if not exists marketplace_reviews_product_idx on public.marketplace_reviews(product_id, status, created_at desc);

alter table public.marketplace_category_commissions enable row level security;
alter table public.marketplace_returns enable row level security;
alter table public.marketplace_disputes enable row level security;
alter table public.marketplace_payouts enable row level security;
alter table public.marketplace_promotions enable row level security;
alter table public.marketplace_reviews enable row level security;

-- Admin/staff-only operational access for this first admin implementation.
-- Customer/supplier self-service policies should be added with the corresponding portal flows.
do $$
declare t text;
begin
  foreach t in array array[
    'marketplace_category_commissions','marketplace_returns','marketplace_disputes',
    'marketplace_payouts','marketplace_promotions','marketplace_reviews'
  ] loop
    execute format('drop policy if exists "tl staff manage %1$s" on public.%1$I', t);
    execute format('create policy "tl staff manage %1$s" on public.%1$I for all to authenticated using (public.is_tl_staff()) with check (public.is_tl_staff())', t);
    execute format('grant select, insert, update, delete on public.%1$I to authenticated', t);
  end loop;
end $$;

comment on table public.marketplace_payouts is
  'Internal ETB payout queue only. Status paid must be set only after an actual provider transfer is independently verified.';
comment on table public.marketplace_payment_records is
  'Payment metadata ledger; pending/submitted is not proof of payment.';
