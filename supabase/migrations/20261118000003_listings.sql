-- Listings, images, availability, reports, categories, pickup points (plan §2.3, Phase 6/7).

create table public.listing_categories (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]*$'),
  label text not null,
  icon text not null default 'package',
  sort_order integer not null default 0,
  is_active boolean not null default true
);

-- Approved campus-area pickup options (§2.3). Admin-managed; seeded values are samples.
create table public.campus_pickup_points (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  description text not null default '',
  is_active boolean not null default true,
  is_sample boolean not null default true,
  sort_order integer not null default 0
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references public.profiles (id) on delete restrict,
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '' check (char_length(description) <= 2000),
  category text not null references public.listing_categories (slug),
  condition public.item_condition not null,
  equipment_notes text check (equipment_notes is null or char_length(equipment_notes) <= 500),
  -- Money in integer centavos (§2.3, §10.1)
  daily_rate bigint not null check (daily_rate >= 0),
  deposit bigint not null default 0 check (deposit >= 0),
  late_fee_per_day bigint not null default 0 check (late_fee_per_day >= 0),
  pickup_point_id uuid references public.campus_pickup_points (id),
  pickup_notes text check (pickup_notes is null or char_length(pickup_notes) <= 500),
  status public.listing_status not null default 'draft',
  is_featured boolean not null default false,
  featured_until timestamptz,
  moderation_status public.moderation_status not null default 'ok',
  published_at timestamptz,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An active listing must have a positive daily rate (§6.4).
  check (status <> 'active' or daily_rate > 0)
);
create index listings_status_category on public.listings (status, category);
create index listings_lender on public.listings (lender_id, status);
create index listings_search on public.listings using gin (search);
create index listings_featured on public.listings (is_featured, featured_until) where is_featured;
create trigger listings_updated_at before update on public.listings
  for each row execute function app_private.set_updated_at();

create table public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  path text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  moderation_status public.moderation_status not null default 'ok',
  created_at timestamptz not null default now()
);
create index listing_images_listing on public.listing_images (listing_id, sort_order);

-- Manual lender blocks; bookings are checked separately (§6.3).
create table public.listing_availability (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index listing_availability_listing on public.listing_availability (listing_id, start_date, end_date);

create table public.listing_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 200),
  details text check (details is null or char_length(details) <= 1000),
  status public.report_status not null default 'open',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index listing_reports_queue on public.listing_reports (status, created_at);
create unique index listing_reports_one_open on public.listing_reports (listing_id, reporter_id) where status in ('open', 'reviewing');
