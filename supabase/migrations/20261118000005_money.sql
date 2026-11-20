-- Simulated money: payments, refunds, ledger, subscriptions (plan §2.5, §2.10, §6.3).
-- provider is constrained to 'mock': no real money is collected, held or paid out.

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan text not null default 'premium_monthly' check (plan in ('premium_monthly')),
  status public.subscription_status not null default 'inactive',
  price bigint not null check (price > 0),
  period_start timestamptz,
  period_end timestamptz,
  provider text not null default 'mock' check (provider = 'mock'),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end > period_start)
);
create unique index subscriptions_one_active on public.subscriptions (user_id) where status = 'active';
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function app_private.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  purpose public.payment_purpose not null,
  booking_id uuid references public.bookings (id) on delete restrict,
  extension_id uuid references public.extension_requests (id) on delete restrict,
  subscription_id uuid references public.subscriptions (id) on delete restrict,
  payer_id uuid not null references public.profiles (id) on delete restrict,
  amount bigint not null check (amount > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  provider text not null default 'mock' check (provider = 'mock'),
  status public.payment_status not null default 'pending',
  -- Idempotency: retries and double taps resolve to one payment (§2.5).
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 128),
  provider_ref text,
  failure_reason text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (purpose in ('booking', 'late_fee', 'damage_compensation') and booking_id is not null) or
    (purpose = 'extension' and extension_id is not null and booking_id is not null) or
    (purpose = 'subscription' and subscription_id is not null)
  )
);
create index payments_booking on public.payments (booking_id);
create index payments_payer on public.payments (payer_id, created_at desc);
create index payments_subscription on public.payments (subscription_id);

-- A refund is its own record linked to the source payment; payments are never overwritten (§2.5).
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  booking_id uuid references public.bookings (id) on delete restrict,
  amount bigint not null check (amount > 0),
  reason text not null check (char_length(reason) between 3 and 300),
  status public.refund_status not null default 'pending',
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 128),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index refunds_payment on public.refunds (payment_id);
create index refunds_booking on public.refunds (booking_id);

-- Refunds may never exceed the amount actually paid.
create function app_private.check_refund_total() returns trigger
language plpgsql set search_path = '' as $$
declare
  paid bigint;
  refunded bigint;
begin
  select amount into paid from public.payments where id = new.payment_id and status = 'succeeded';
  if paid is null then
    raise exception 'refund requires a succeeded payment' using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0) into refunded from public.refunds
    where payment_id = new.payment_id and status <> 'failed' and id <> new.id;
  if refunded + new.amount > paid then
    raise exception 'refunds (%) would exceed payment (%)', refunded + new.amount, paid using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger refunds_total_check before insert or update of amount, status on public.refunds
  for each row execute function app_private.check_refund_total();

-- Append-only ledger (§2.5). Exactly one of debit/credit is positive per entry.
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  booking_id uuid references public.bookings (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,
  refund_id uuid references public.refunds (id) on delete restrict,
  subscription_id uuid references public.subscriptions (id) on delete restrict,
  party_id uuid references public.profiles (id) on delete restrict,
  category public.ledger_category not null,
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  description text not null default '',
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now(),
  check ((debit > 0) <> (credit > 0))
);
create index ledger_booking on public.ledger_entries (booking_id);
create index ledger_party on public.ledger_entries (party_id, created_at desc);
create index ledger_category on public.ledger_entries (category, created_at);
create trigger ledger_append_only before update or delete on public.ledger_entries
  for each row execute function app_private.forbid_mutation();
