-- Identity: profiles, roles, academic years, student verification, terms (plan §2.1, §2.2, §6.3).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  avatar_path text,
  account_status public.account_status not null default 'active',
  status_reason text,
  status_changed_at timestamptz,
  -- UI preference only; authorization always uses user_roles (§2.1)
  active_role_pref public.marketplace_role,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function app_private.set_updated_at();

-- Every auth user gets exactly one profile.
create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120))
  on conflict (id) do nothing;
  return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
create index user_roles_role on public.user_roles (role);

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  label text not null unique check (char_length(label) between 3 and 40),
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  is_archived boolean not null default false,
  is_sample boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date > start_date),
  check (not (is_current and is_archived))
);
-- At most one current academic year (§6.4).
create unique index academic_years_one_current on public.academic_years (is_current) where is_current;
create trigger academic_years_updated_at before update on public.academic_years
  for each row execute function app_private.set_updated_at();

-- One row per submission; history is preserved across resubmissions (Phase 4).
create table public.student_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  academic_year_id uuid not null references public.academic_years (id),
  full_name text not null check (char_length(full_name) between 2 and 120),
  student_email text not null check (student_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  student_id text not null check (char_length(student_id) between 3 and 40),
  requested_roles public.marketplace_role[] not null default '{}',
  document_path text,
  document_mime text,
  document_size_bytes integer check (document_size_bytes is null or document_size_bytes > 0),
  status public.verification_status not null default 'pending_review',
  provider text not null default 'manual_demo',
  provider_ref text,
  provider_status text,
  review_reason text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'pending_review' or document_path is not null)
);
create index student_verifications_user on public.student_verifications (user_id, submitted_at desc);
create index student_verifications_queue on public.student_verifications (status, submitted_at) where status = 'pending_review';
-- Only one submission can await review at a time.
create unique index student_verifications_one_pending on public.student_verifications (user_id) where status = 'pending_review';
create trigger student_verifications_updated_at before update on public.student_verifications
  for each row execute function app_private.set_updated_at();

create table public.terms_versions (
  id uuid primary key default gen_random_uuid(),
  doc_type public.terms_doc_type not null,
  version integer not null check (version > 0),
  title text not null,
  content text not null,
  is_sample boolean not null default true,
  is_active boolean not null default false,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (doc_type, version)
);
create unique index terms_versions_one_active on public.terms_versions (doc_type) where is_active;

create table public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  terms_version_id uuid not null references public.terms_versions (id),
  context text not null default 'onboarding',
  accepted_at timestamptz not null default now(),
  unique (user_id, terms_version_id, context)
);
