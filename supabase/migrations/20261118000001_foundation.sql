-- TigRent foundation: extensions, enums, shared triggers, platform settings, audit log.
-- Plan refs: §2 (configurable rules), §6.3, §6.4, §10.1.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Internal helpers live outside the API-exposed `public` schema.
create schema if not exists app_private;
grant usage on schema app_private to authenticated, service_role;

-- ── Enumerations ───────────────────────────────────────────────────────────
create type public.app_role as enum ('borrower', 'lender', 'admin', 'moderator');
create type public.marketplace_role as enum ('borrower', 'lender');
create type public.account_status as enum ('active', 'paused_pending_review', 'restricted', 'suspended');
create type public.verification_status as enum ('not_submitted', 'pending_review', 'verified', 'rejected', 'needs_resubmission', 'expired');
create type public.terms_doc_type as enum ('tos', 'privacy', 'rental_terms');
create type public.listing_status as enum ('draft', 'active', 'paused', 'unavailable', 'removed');
create type public.item_condition as enum ('new', 'like_new', 'good', 'fair', 'worn');
create type public.moderation_status as enum ('ok', 'reported', 'hidden');
create type public.report_status as enum ('open', 'reviewing', 'actioned', 'dismissed');
create type public.booking_status as enum (
  'pending_lender_approval', 'rejected', 'cancelled', 'awaiting_payment', 'payment_expired',
  'confirmed', 'active', 'overdue', 'return_requested', 'disputed', 'completed'
);
create type public.extension_status as enum ('pending', 'rejected', 'approved_awaiting_payment', 'paid', 'payment_failed', 'expired', 'cancelled');
create type public.return_outcome as enum ('clean', 'late', 'damaged', 'incomplete', 'not_returned');
create type public.payment_purpose as enum ('booking', 'extension', 'subscription', 'late_fee', 'damage_compensation');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'expired');
create type public.refund_status as enum ('pending', 'succeeded', 'failed');
create type public.ledger_category as enum (
  'borrower_payment', 'deposit_held', 'deposit_released', 'deposit_withheld', 'rent_payable',
  'platform_commission', 'extension_payment', 'late_fee', 'damage_compensation', 'refund',
  'cancellation_adjustment', 'subscription_payment'
);
create type public.dispute_category as enum ('damage', 'missing_item', 'incomplete_return', 'late_return', 'not_as_described', 'payment', 'other');
create type public.dispute_severity as enum ('minor', 'major', 'severe');
create type public.dispute_status as enum (
  'open', 'awaiting_borrower_response', 'awaiting_lender_response', 'under_review',
  'resolved_refund', 'resolved_compensation', 'closed', 'appealed'
);
create type public.review_direction as enum ('borrower_to_lender', 'lender_to_borrower');
create type public.review_moderation as enum ('visible', 'under_review', 'hidden');
create type public.appeal_status as enum ('open', 'under_review', 'needs_info', 'upheld', 'lifted');
create type public.subscription_status as enum ('inactive', 'active', 'cancelled', 'expired', 'payment_failed');
create type public.conversation_kind as enum ('booking', 'support');

-- ── Shared triggers ────────────────────────────────────────────────────────
create function app_private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Append-only tables: history must never be rewritten (§2.5, §10.1).
create function app_private.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only; % is not allowed', tg_table_name, tg_op using errcode = '42501';
end
$$;

-- ── Platform settings (versioned, admin-managed; §2, Phase 12) ──────────────
create table public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  value jsonb not null,
  version integer not null check (version > 0),
  is_current boolean not null default true,
  -- true = demonstration value, not an approved business/legal term (§0.1.9)
  is_sample boolean not null default true,
  description text not null default '',
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (key, version)
);
create unique index platform_settings_one_current on public.platform_settings (key) where is_current;

create function app_private.setting(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.platform_settings where key = p_key and is_current
$$;

-- ── Cancellation policy versions (§2.6) ────────────────────────────────────
create table public.cancellation_policy_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  label text not null,
  rules jsonb not null,
  is_sample boolean not null default true,
  is_active boolean not null default false,
  effective_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index cancellation_policy_one_active on public.cancellation_policy_versions (is_active) where is_active;

-- ── Audit log (append-only, staff-readable; §6.3) ───────────────────────────
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity on public.audit_logs (entity_type, entity_id);
create index audit_logs_created on public.audit_logs (created_at desc);
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function app_private.forbid_mutation();

create function app_private.audit(p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
$$;
