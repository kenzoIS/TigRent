-- Authorization: helper predicates, least-privilege grants, row-level security (plan §6.5, §10.2).
-- Clients may READ through RLS; protected state changes go through SECURITY DEFINER RPCs (later phases).

-- ── Helper predicates (SECURITY DEFINER so policies don't recurse through RLS) ──
create function app_private.has_role(p_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = p_role)
$$;

create function app_private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin', 'moderator'))
$$;

-- Latest submission wins; a verified record past its expiry reads as expired (lazy expiry, §2.2).
create function app_private.verification_status(p_user uuid) returns public.verification_status
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case
              when v.status = 'verified' and v.expires_at is not null and v.expires_at <= now() then 'expired'::public.verification_status
              else v.status
            end
       from public.student_verifications v
      where v.user_id = p_user
      order by v.submitted_at desc
      limit 1),
    'not_submitted'::public.verification_status)
$$;

create function app_private.is_verified_student() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.verification_status(auth.uid()) = 'verified'
$$;

create function app_private.is_booking_party(p_booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b where b.id = p_booking and auth.uid() in (b.borrower_id, b.lender_id))
$$;

create function app_private.can_view_listing(p_listing uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.listings l
     where l.id = p_listing
       and (
         l.lender_id = auth.uid()
         or app_private.is_staff()
         or (l.status = 'active' and l.moderation_status <> 'hidden' and app_private.is_verified_student())
         or exists (select 1 from public.bookings b where b.listing_id = l.id and auth.uid() in (b.borrower_id, b.lender_id))
       )
  )
$$;

create function app_private.is_conversation_participant(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_participants where conversation_id = p_conversation and user_id = auth.uid())
$$;

create function app_private.is_dispute_party(p_dispute uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.disputes d join public.bookings b on b.id = d.booking_id
     where d.id = p_dispute and auth.uid() in (b.borrower_id, b.lender_id)
  )
$$;

-- ── Least-privilege grants ────────────────────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app_private revoke execute on functions from public;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema app_private to authenticated, service_role;
-- Defense in depth: writers and trigger bodies are never callable by API users
-- (app_private is not API-exposed; triggers do not need EXECUTE at fire time).
revoke execute on function
  app_private.audit(text, text, text, jsonb),
  app_private.handle_new_user(),
  app_private.set_updated_at(),
  app_private.forbid_mutation(),
  app_private.check_refund_total()
from authenticated;

grant select on
  public.profiles, public.user_roles, public.academic_years, public.student_verifications,
  public.terms_versions, public.terms_acceptances, public.listing_categories, public.campus_pickup_points,
  public.listings, public.listing_images, public.listing_availability, public.listing_reports,
  public.bookings, public.booking_events, public.booking_terms_acceptances, public.handover_reports,
  public.return_reports, public.extension_requests, public.payments, public.refunds, public.ledger_entries,
  public.subscriptions, public.disputes, public.dispute_messages, public.dispute_evidence, public.reviews,
  public.account_appeals, public.conversations, public.conversation_participants, public.messages,
  public.notifications, public.platform_settings, public.cancellation_policy_versions, public.audit_logs
to authenticated;

-- Column-scoped self-service updates; every protected column stays RPC-only (§6.5).
grant update (full_name, avatar_path, active_role_pref) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;

-- Terms/Privacy text is readable before sign-up.
grant select on public.terms_versions to anon;

-- ── Row-level security ─────────────────────────────────────────────────────
alter table public.platform_settings enable row level security;
alter table public.cancellation_policy_versions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.academic_years enable row level security;
alter table public.student_verifications enable row level security;
alter table public.terms_versions enable row level security;
alter table public.terms_acceptances enable row level security;
alter table public.listing_categories enable row level security;
alter table public.campus_pickup_points enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
alter table public.listing_availability enable row level security;
alter table public.listing_reports enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;
alter table public.booking_terms_acceptances enable row level security;
alter table public.handover_reports enable row level security;
alter table public.return_reports enable row level security;
alter table public.extension_requests enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.disputes enable row level security;
alter table public.dispute_messages enable row level security;
alter table public.dispute_evidence enable row level security;
alter table public.reviews enable row level security;
alter table public.account_appeals enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

-- Settings & policies: current values readable by members; full history by staff.
create policy settings_read on public.platform_settings for select to authenticated
  using (is_current or app_private.is_staff());
create policy cancellation_policy_read on public.cancellation_policy_versions for select to authenticated
  using (true);
create policy audit_staff_read on public.audit_logs for select to authenticated
  using (app_private.is_staff());

-- Identity
create policy profiles_self_or_staff_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app_private.is_staff());
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy user_roles_self_or_staff_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or app_private.is_staff());
create policy academic_years_read on public.academic_years for select to authenticated
  using (true);
create policy verifications_self_or_staff_read on public.student_verifications for select to authenticated
  using (user_id = (select auth.uid()) or app_private.is_staff());
-- Separate anon policy: anon has no access to app_private helpers.
create policy terms_versions_public_read on public.terms_versions for select to anon
  using (is_active);
create policy terms_versions_member_read on public.terms_versions for select to authenticated
  using (is_active or app_private.is_staff());
create policy terms_acceptances_self_or_staff_read on public.terms_acceptances for select to authenticated
  using (user_id = (select auth.uid()) or app_private.is_staff());

-- Listings
create policy listing_categories_read on public.listing_categories for select to authenticated
  using (is_active or app_private.is_staff());
create policy pickup_points_read on public.campus_pickup_points for select to authenticated
  using (is_active or app_private.is_staff());
create policy listings_read on public.listings for select to authenticated
  using (app_private.can_view_listing(id));
create policy listing_images_read on public.listing_images for select to authenticated
  using (app_private.can_view_listing(listing_id));
create policy listing_availability_read on public.listing_availability for select to authenticated
  using (app_private.can_view_listing(listing_id));
create policy listing_reports_read on public.listing_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or app_private.is_staff());

-- Bookings & lifecycle: only the two parties and staff.
create policy bookings_party_read on public.bookings for select to authenticated
  using ((select auth.uid()) in (borrower_id, lender_id) or app_private.is_staff());
create policy booking_events_party_read on public.booking_events for select to authenticated
  using (app_private.is_booking_party(booking_id) or app_private.is_staff());
create policy booking_terms_party_read on public.booking_terms_acceptances for select to authenticated
  using (app_private.is_booking_party(booking_id) or app_private.is_staff());
create policy handover_party_read on public.handover_reports for select to authenticated
  using (app_private.is_booking_party(booking_id) or app_private.is_staff());
create policy return_party_read on public.return_reports for select to authenticated
  using (app_private.is_booking_party(booking_id) or app_private.is_staff());
create policy extensions_party_read on public.extension_requests for select to authenticated
  using (app_private.is_booking_party(booking_id) or app_private.is_staff());

-- Money (simulated)
create policy subscriptions_self_or_staff_read on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or app_private.is_staff());
create policy payments_party_read on public.payments for select to authenticated
  using (payer_id = (select auth.uid())
         or (booking_id is not null and app_private.is_booking_party(booking_id))
         or app_private.is_staff());
create policy refunds_party_read on public.refunds for select to authenticated
  using ((booking_id is not null and app_private.is_booking_party(booking_id))
         or exists (select 1 from public.payments p where p.id = payment_id and p.payer_id = (select auth.uid()))
         or app_private.is_staff());
create policy ledger_party_read on public.ledger_entries for select to authenticated
  using (party_id = (select auth.uid()) or app_private.is_staff());

-- Trust
create policy disputes_party_read on public.disputes for select to authenticated
  using (app_private.is_booking_party(booking_id) or app_private.is_staff());
create policy dispute_messages_party_read on public.dispute_messages for select to authenticated
  using (app_private.is_dispute_party(dispute_id) or app_private.is_staff());
create policy dispute_evidence_party_read on public.dispute_evidence for select to authenticated
  using (app_private.is_dispute_party(dispute_id) or app_private.is_staff());
create policy reviews_read on public.reviews for select to authenticated
  using (moderation_status = 'visible'
         or (select auth.uid()) in (reviewer_id, target_id)
         or app_private.is_staff());
create policy appeals_self_or_staff_read on public.account_appeals for select to authenticated
  using (user_id = (select auth.uid()) or app_private.is_staff());

-- Messaging & notifications
create policy conversations_participant_read on public.conversations for select to authenticated
  using (app_private.is_conversation_participant(id) or app_private.is_staff());
create policy participants_read on public.conversation_participants for select to authenticated
  using (app_private.is_conversation_participant(conversation_id) or app_private.is_staff());
create policy participants_self_update on public.conversation_participants for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy messages_participant_read on public.messages for select to authenticated
  using (app_private.is_conversation_participant(conversation_id) or app_private.is_staff());
create policy notifications_self_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_self_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── Public profile projection (no student ID, email, or account status; §6.3 data minimization) ──
create view public.public_profiles with (security_barrier = true) as
select
  p.id,
  p.full_name,
  p.avatar_path,
  p.created_at,
  app_private.verification_status(p.id) = 'verified' as is_student_verified,
  coalesce(r.review_count, 0)::integer as review_count,
  r.rating_avg,
  coalesce(c.completed_lendings, 0)::integer as completed_lendings,
  coalesce(c.completed_borrowings, 0)::integer as completed_borrowings
from public.profiles p
left join lateral (
  select count(*) as review_count, round(avg(rating)::numeric, 2) as rating_avg
    from public.reviews rv
   where rv.target_id = p.id and rv.moderation_status = 'visible'
) r on true
left join lateral (
  select count(*) filter (where b.lender_id = p.id) as completed_lendings,
         count(*) filter (where b.borrower_id = p.id) as completed_borrowings
    from public.bookings b
   where b.status = 'completed' and p.id in (b.lender_id, b.borrower_id)
) c on true;

revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to authenticated;
