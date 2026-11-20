-- Disputes, reviews, appeals, messaging, notifications (plan §2.7, §2.9, Phase 9–11).

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  opener_id uuid not null references public.profiles (id) on delete restrict,
  category public.dispute_category not null,
  severity public.dispute_severity not null default 'major',
  description text not null check (char_length(description) between 10 and 2000),
  requested_amount bigint not null default 0 check (requested_amount >= 0),
  status public.dispute_status not null default 'open',
  decision text,
  resolution_amount bigint check (resolution_amount is null or resolution_amount >= 0),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index disputes_booking on public.disputes (booking_id);
create index disputes_queue on public.disputes (status, created_at);
create trigger disputes_updated_at before update on public.disputes
  for each row execute function app_private.set_updated_at();

create table public.dispute_messages (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index dispute_messages_dispute on public.dispute_messages (dispute_id, created_at);

create table public.dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  path text not null,
  mime text,
  size_bytes integer check (size_bytes is null or size_bytes > 0),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index dispute_evidence_dispute on public.dispute_evidence (dispute_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  reviewer_id uuid not null references public.profiles (id) on delete restrict,
  target_id uuid not null references public.profiles (id) on delete restrict,
  direction public.review_direction not null,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  is_reported boolean not null default false,
  moderation_status public.review_moderation not null default 'visible',
  created_at timestamptz not null default now(),
  -- One review per reviewer/booking/target; no self-reviews (§2.9, §6.4).
  unique (booking_id, reviewer_id, target_id),
  check (reviewer_id <> target_id)
);
create index reviews_target on public.reviews (target_id, created_at desc);

create table public.account_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 2000),
  status public.appeal_status not null default 'open',
  moderator_id uuid references public.profiles (id) on delete set null,
  moderator_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index account_appeals_queue on public.account_appeals (status, created_at);
create unique index account_appeals_one_open on public.account_appeals (user_id) where status in ('open', 'under_review', 'needs_info');

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null,
  booking_id uuid references public.bookings (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed', 'blocked')),
  created_at timestamptz not null default now(),
  check ((kind = 'booking') = (booking_id is not null))
);
create unique index conversations_one_per_booking on public.conversations (booking_id) where booking_id is not null;

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_participants_user on public.conversation_participants (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  attachment_path text,
  created_at timestamptz not null default now()
);
create index messages_conversation on public.messages (conversation_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type ~ '^[a-z][a-z0-9_.]*$'),
  title text not null check (char_length(title) between 1 and 140),
  body text not null default '' check (char_length(body) <= 600),
  entity_type text,
  entity_id uuid,
  channel text not null default 'in_app' check (channel in ('in_app', 'push_simulated', 'email_simulated')),
  delivery_status text not null default 'delivered' check (delivery_status in ('pending', 'delivered', 'failed')),
  -- Reminders and retries never duplicate (Phase 9 gate).
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_inbox on public.notifications (user_id, read_at, created_at desc);
