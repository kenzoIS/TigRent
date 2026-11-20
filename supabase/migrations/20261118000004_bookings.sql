-- Bookings and the rental lifecycle records (plan §2.3, §2.4, §2.7, §2.8, §6.3).

-- Business timezone helper: a date + local time in Asia/Manila → timestamptz (§2.3, §10.1).
create function app_private.manila_timestamp(p_date date, p_time time) returns timestamptz
language sql immutable set search_path = '' as $$
  select (p_date + p_time) at time zone 'Asia/Manila'
$$;

-- Inclusive rental-day rule (§2.3): max(1, return - pickup + 1). Single server-side definition.
create function app_private.rental_days(p_pickup date, p_return date) returns integer
language sql immutable set search_path = '' as $$
  select greatest(1, (p_return - p_pickup) + 1)
$$;

-- Commission in centavos, half-up rounding on basis points (10% = 1000 bps).
create function app_private.commission_amount(p_rent bigint, p_bps integer) returns bigint
language sql immutable set search_path = '' as $$
  select ((p_rent * p_bps) + 5000) / 10000
$$;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete restrict,
  borrower_id uuid not null references public.profiles (id) on delete restrict,
  lender_id uuid not null references public.profiles (id) on delete restrict,
  pickup_date date not null,
  return_date date not null,
  rental_days integer not null check (rental_days >= 1),
  due_at timestamptz not null,
  pickup_arrangement text check (pickup_arrangement is null or char_length(pickup_arrangement) <= 300),
  status public.booking_status not null default 'pending_lender_approval',
  hold_expires_at timestamptz,
  decision_reason text,
  decided_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancel_reason text,
  cancelled_at timestamptz,
  -- Immutable agreement snapshot (§2.4, §10.1): title, rates, pickup, policy references.
  snapshot jsonb not null,
  daily_rate bigint not null check (daily_rate > 0),
  late_fee_per_day bigint not null check (late_fee_per_day >= 0),
  commission_bps integer not null check (commission_bps between 0 and 10000),
  subtotal bigint not null check (subtotal > 0),
  deposit bigint not null check (deposit >= 0),
  total bigint not null,
  commission bigint not null check (commission >= 0),
  lender_net bigint not null,
  policy_version_id uuid not null references public.cancellation_policy_versions (id),
  terms_version_id uuid not null references public.terms_versions (id),
  handover_lender_at timestamptz,
  handover_borrower_at timestamptz,
  activated_at timestamptz,
  returned_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Peer-to-peer: a student cannot rent from themselves (§6.4).
  check (borrower_id <> lender_id),
  check (return_date >= pickup_date),
  check (rental_days = greatest(1, (return_date - pickup_date) + 1)),
  check (subtotal = daily_rate * rental_days),
  check (total = subtotal + deposit),
  check (lender_net = subtotal - commission),
  check (status <> 'awaiting_payment' or hold_expires_at is not null),
  -- Concurrency-safe inventory: no two holding bookings may overlap for one listing (§2.4, §6.4).
  constraint bookings_no_overlap exclude using gist (
    listing_id with =,
    daterange(pickup_date, return_date, '[]') with &&
  ) where (status in ('awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed'))
);
create index bookings_listing on public.bookings (listing_id, pickup_date, return_date);
create index bookings_borrower on public.bookings (borrower_id, status);
create index bookings_lender on public.bookings (lender_id, status);
create index bookings_status_due on public.bookings (status, due_at);
create index bookings_hold_expiry on public.bookings (hold_expires_at) where status = 'awaiting_payment';
create trigger bookings_updated_at before update on public.bookings
  for each row execute function app_private.set_updated_at();

-- Append-only transition history (§6.3).
create table public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  from_status public.booking_status,
  to_status public.booking_status not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index booking_events_booking on public.booking_events (booking_id, created_at);
create trigger booking_events_append_only before update or delete on public.booking_events
  for each row execute function app_private.forbid_mutation();

create table public.booking_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  terms_version_id uuid not null references public.terms_versions (id),
  terms_snapshot jsonb not null,
  accepted_at timestamptz not null default now(),
  unique (booking_id, user_id)
);

create table public.handover_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  lender_confirmed_at timestamptz,
  lender_notes text check (lender_notes is null or char_length(lender_notes) <= 1000),
  borrower_confirmed_at timestamptz,
  borrower_notes text check (borrower_notes is null or char_length(borrower_notes) <= 1000),
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger handover_reports_updated_at before update on public.handover_reports
  for each row execute function app_private.set_updated_at();

create table public.return_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  borrower_requested_at timestamptz,
  borrower_notes text check (borrower_notes is null or char_length(borrower_notes) <= 1000),
  borrower_photo_paths text[] not null default '{}',
  lender_inspected_at timestamptz,
  outcome public.return_outcome,
  lender_notes text check (lender_notes is null or char_length(lender_notes) <= 1000),
  lender_photo_paths text[] not null default '{}',
  late_days integer not null default 0 check (late_days >= 0),
  late_fee bigint not null default 0 check (late_fee >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger return_reports_updated_at before update on public.return_reports
  for each row execute function app_private.set_updated_at();

create table public.extension_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  old_return_date date not null,
  new_return_date date not null,
  extra_days integer not null check (extra_days >= 1),
  extra_amount bigint not null check (extra_amount > 0),
  extra_commission bigint not null check (extra_commission >= 0),
  status public.extension_status not null default 'pending',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_reason text,
  hold_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (new_return_date > old_return_date),
  check (extra_days = new_return_date - old_return_date)
);
create index extension_requests_booking on public.extension_requests (booking_id, created_at desc);
create unique index extension_requests_one_open on public.extension_requests (booking_id)
  where status in ('pending', 'approved_awaiting_payment');
create trigger extension_requests_updated_at before update on public.extension_requests
  for each row execute function app_private.set_updated_at();
