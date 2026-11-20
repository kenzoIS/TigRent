-- ════════════════════════════════════════════════════════════════════════════
-- TigRent DEMO SEED (plan §9). Fictitious people and data only.
--  • Emails use the reserved .test domain and can never belong to a real student.
--  • No real student IDs or documents. Verification file paths point to sample files.
--  • Policy/setting values are SAMPLE values (is_sample = true), not approved business or legal terms.
--  • Idempotent: fixed IDs + ON CONFLICT DO NOTHING; history rows are written only on first insert.
--  • Booking dates are relative to "today" in Asia/Manila, so a reset refreshes the demo timeline.
-- Demo password for every seeded account: TigRentDemo#2026
-- ════════════════════════════════════════════════════════════════════════════

-- ── Platform settings (sample values; admin-configurable in Phase 12) ───────
insert into public.platform_settings (key, value, version, is_current, is_sample, description) values
  ('commission_bps',                '1000',  1, true, false, 'Platform commission in basis points on rental charges (BMC: 10%). Excludes the refundable deposit.'),
  ('commission_on_late_fees',       'false', 1, true, true,  'Whether late fees are commission-eligible (sample default: no).'),
  ('commission_on_damage',          'false', 1, true, true,  'Whether damage compensation is commission-eligible (sample default: no).'),
  ('payment_hold_minutes',          '15',    1, true, true,  'Minutes an accepted request is held while the borrower completes the demo payment.'),
  ('return_due_time_local',         '"23:59"', 1, true, true, 'Local time (Asia/Manila) on the return date when an item becomes due.'),
  ('late_day_rounding',             '"per_started_24h"', 1, true, true, 'Each started 24 h after the due time counts as one late day.'),
  ('email_domain_allowlist',        '["ust.edu.ph", "tigrent.test"]', 1, true, true, 'Accepted student email domains. tigrent.test is a demo-only domain. Confirm the real domain list with the product owner.'),
  ('student_id_pattern',            '"^[A-Za-z0-9-]{4,20}$"', 1, true, true, 'Permissive sample pattern. The real UST student ID format is unconfirmed.'),
  ('allow_non_current_academic_year', 'false', 1, true, true, 'Allow verification for a non-current academic year (documented demo exception only).'),
  ('verification_expiry',           '{"expire_on_academic_year_change": true}', 1, true, true, 'When a verification expires.'),
  ('verification_document',         '{"max_bytes": 10485760, "mime_types": ["application/pdf", "image/jpeg", "image/png", "image/heic"]}', 1, true, true, 'Registration-form upload limits.'),
  ('account_health_rule',           '{"min_reviews": 3, "avg_below": 2.5, "action": "paused_pending_review"}', 1, true, true, 'Low-rating restriction rule (plan §2.9 example). One low rating never triggers it.'),
  ('trusted_lender_rule',           '{"min_completed_lendings": 5, "min_avg_rating": 4.5, "no_unresolved_severe_disputes": true}', 1, true, true, 'Verified Trusted Lender badge criteria. Not an official UST endorsement.'),
  ('premium_price_centavos',        '9900',  1, true, false, 'TigRent Premium monthly price (BMC: ₱99/month). Demo checkout only.'),
  ('payment_provider_mode',         '"mock_user_choice"', 1, true, true, 'Demo payment adapter: borrower picks the simulated outcome. No real money moves.'),
  ('verification_provider_mode',    '"manual_demo"', 1, true, true, 'Student verification by manual demo review. No external provider is connected.'),
  -- Also created by migrations 014/016; listed here so a demo reset (which truncates settings) keeps them.
  ('max_rental_days',               '30',    1, true, true,  'Longest single rental a borrower can request (sample).'),
  ('max_advance_days',              '90',    1, true, true,  'How far ahead a pickup date can be booked (sample).'),
  ('handover_opens_days_before',    '1',     1, true, true,  'How many days before the pickup date the handover can be confirmed (sample).'),
  ('reminder_due_soon_hours',       '24',    1, true, true,  'Remind both parties this many hours before an item is due (sample).'),
  ('reminder_followup_hours',       '6',     1, true, true,  'Nudge the lender about an undecided extension or an uninspected return after this many hours (sample).'),
  ('dispute_appeal_days',           '7',     1, true, true,  'Days after a dispute decision during which either party may appeal (sample).'),
  ('review_window_days',            '30',    1, true, true,  'Days after completion during which each party can leave a review (sample).')
on conflict (key, version) do nothing;

insert into public.cancellation_policy_versions (id, version, label, is_sample, is_active, rules) values
  ('cccccccc-0000-4000-8000-000000000001', 1, 'Sample cancellation policy v1 (awaiting product-owner approval)', true, true, '{
    "pending_cancel_by_borrower":   {"rent_refund_pct": 100, "deposit_refund_pct": 100, "note": "Usually nothing has been charged yet."},
    "borrower_cancel_before_pickup": {"windows": [
        {"min_hours_before_pickup": 24, "rent_refund_pct": 100},
        {"min_hours_before_pickup": 0,  "rent_refund_pct": 50}
      ], "deposit_refund_pct": 100},
    "lender_cancel_before_pickup":  {"rent_refund_pct": 100, "deposit_refund_pct": 100},
    "payment_failure_or_timeout":   {"rent_refund_pct": 100, "deposit_refund_pct": 100},
    "listing_withdrawn":            {"rent_refund_pct": 100, "deposit_refund_pct": 100},
    "after_pickup":                 {"allowed": false, "route": "return_or_dispute"},
    "dispute_driven":               {"route": "moderator_decision"}
  }'::jsonb)
on conflict (id) do nothing;

insert into public.terms_versions (id, doc_type, version, title, is_sample, is_active, content) values
  ('dddddddd-0000-4000-8000-000000000001', 'tos', 1, 'TigRent Terms of Service (prototype)', true, true,
   'PROTOTYPE TEXT, NOT LEGALLY REVIEWED. TigRent is a student project prototype connecting verified students who rent academic equipment to each other. TigRent is not an official University of Santo Tomas service. Payments, refunds and payouts in this prototype are simulated and no real money moves.'),
  ('dddddddd-0000-4000-8000-000000000002', 'privacy', 1, 'TigRent Privacy Notice (prototype)', true, true,
   'PROTOTYPE TEXT, NOT LEGALLY REVIEWED. TigRent stores your name, student email, student ID and registration form only to review your student status. Documents are kept in private storage, visible only to you and authorized reviewers, and are never shown on your public profile.'),
  ('dddddddd-0000-4000-8000-000000000003', 'rental_terms', 1, 'Standard TigRent Rental Terms (archived)', true, false,
   'Archived prototype rental terms. New rental requests use the active Rental Terms & Conditions version.'),
  ('dddddddd-0000-4000-8000-000000000004', 'rental_terms', 2, 'TigRent Rental Terms & Conditions', true, true,
   E'TIGRENT RENTAL TERMS & CONDITIONS — VERSION 2\n\n1. Scope and eligibility. TigRent connects verified students for academic-equipment rentals. TigRent is not an official University of Santo Tomas service. Each borrower and lender must use their own verified account and comply with campus rules.\n\n2. Listing and request. A listing states the item, condition, daily rate, refundable deposit, late fee, dates and pickup arrangement. A request is not confirmed until the lender accepts it and the required demo checkout is completed. The final server-confirmed price and these terms are recorded with the booking.\n\n3. Charges and deposit. The rental charge is the displayed daily rate for every calendar day from pickup through return, inclusive. The refundable deposit and any stated late fee are shown before a request is sent. Payments, refunds and payouts in this student-project demo are simulated: no real money or payment credentials are processed.\n\n4. Pickup and return. Both parties must meet at the listing’s stated public campus pickup point or another safe public location arranged in TigRent messages. The borrower should inspect the item at pickup and return it with its listed accessories by the stated due time on the return date.\n\n5. Care of equipment. The borrower must use the item with reasonable care, follow any listing instructions and must not lend, sell, alter or misuse it. The borrower should promptly tell the lender through TigRent messages if the item is damaged, lost, stolen or no longer usable.\n\n6. Cancellations, late returns and disputes. The active cancellation policy shown with the booking controls cancellation outcomes. A late return may incur the listing’s stated per-day fee. Claims about damage, missing parts, late return or non-return are handled through TigRent’s in-app dispute process using the available evidence and review workflow.\n\n7. Communication and safety. Keep arrangements in TigRent messages. Do not post phone numbers, home addresses, payment credentials or other sensitive information in listings, request notes or chat. Meet in visible public campus areas and follow UST safety rules.\n\n8. Platform action. TigRent may pause a listing, restrict an account or review activity where there is a safety concern, a terms breach, dishonest listing information or misuse of the platform.\n\n9. Demo status. These are the current operational terms for this TigRent prototype. They are not a substitute for legal advice and must receive institutional and legal review before real-world deployment.')
on conflict (id) do nothing;

insert into public.academic_years (id, label, start_date, end_date, is_current, is_archived, is_sample) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'AY 2025–2026', '2025-08-01', '2026-07-31', false, true, true),
  ('eeeeeeee-0000-4000-8000-000000000002', 'AY 2026–2027', '2026-08-01', '2027-07-31', true, false, true)
on conflict (id) do nothing;

insert into public.listing_categories (slug, label, icon, sort_order) values
  ('calculators', 'Calculators', 'calculator', 1),
  ('photo-video', 'Photo & video', 'camera', 2),
  ('laptop-accessories', 'Laptop accessories', 'laptop', 3),
  ('presentation', 'Presentation', 'presentation', 4),
  ('drafting', 'Drafting & art', 'ruler', 5),
  ('lab-gear', 'Lab gear', 'flask-conical', 6),
  ('power-cables', 'Power & cables', 'plug', 7),
  ('other', 'Other', 'package', 99)
on conflict (slug) do nothing;

insert into public.campus_pickup_points (id, label, description, sort_order, is_sample) values
  ('ffffffff-0000-4000-8000-000000000001', 'Main Gate (Gate 1)', 'Meet at the Main Gate public waiting area.', 1, false),
  ('ffffffff-0000-4000-8000-000000000002', 'P.Noval Gate (Gate 7)', 'Meet at the P.Noval Gate public waiting area.', 2, false),
  ('ffffffff-0000-4000-8000-000000000003', 'Lacson Gate (Gate 14)', 'Meet at the Lacson Gate public waiting area.', 3, false),
  ('ffffffff-0000-4000-8000-000000000004', 'Dapitan Gate (Gate 11)', 'Meet at the Dapitan Gate public waiting area.', 4, false),
  ('ffffffff-0000-4000-8000-000000000005', 'Main Building', 'Meet at the Main Building public lobby.', 5, false),
  ('ffffffff-0000-4000-8000-000000000006', 'UST Hospital', 'Meet at the UST Hospital public lobby.', 6, false)
on conflict (id) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order, is_active = true, is_sample = false;

-- ── Demo accounts (auth + profile via trigger) ──────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('TigRentDemo#2026', extensions.gen_salt('bf')), now(),
       '{"provider": "email", "providers": ["email"]}'::jsonb,
       jsonb_build_object('full_name', u.full_name, 'demo', true), now(), now(), '', '', '', ''
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'admin.demo@tigrent.test',      'Tess Admin (Demo moderator)'),
  ('aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'bea.borrower@tigrent.test',    'Bea Santos'),
  ('aaaaaaaa-0000-4000-8000-000000000003'::uuid, 'leo.lender@tigrent.test',      'Leo Reyes'),
  ('aaaaaaaa-0000-4000-8000-000000000004'::uuid, 'dana.dual@tigrent.test',       'Dana Cruz'),
  ('aaaaaaaa-0000-4000-8000-000000000005'::uuid, 'paolo.pending@tigrent.test',   'Paolo Lim'),
  ('aaaaaaaa-0000-4000-8000-000000000006'::uuid, 'rina.rejected@tigrent.test',   'Rina Tan'),
  ('aaaaaaaa-0000-4000-8000-000000000007'::uuid, 'rico.restricted@tigrent.test', 'Rico Garcia'),
  ('aaaaaaaa-0000-4000-8000-000000000008'::uuid, 'mika.lender@tigrent.test',     'Mika Uy')
) as u(id, email, full_name)
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
from auth.users u
where u.email like '%@tigrent.test'
on conflict (provider_id, provider) do nothing;

-- Profiles are created by the auth trigger; make sure names are set even on re-runs.
update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name'
  from auth.users u where u.id = p.id and u.email like '%@tigrent.test' and p.full_name = '';

update public.profiles set
  account_status = 'paused_pending_review',
  status_reason = 'Sample account-health rule met: 3 reviews averaging below 2.5. New rentals and listings are paused pending moderator review.',
  status_changed_at = now() - interval '1 day'
where id = 'aaaaaaaa-0000-4000-8000-000000000007' and account_status = 'active';

update public.profiles set active_role_pref = 'borrower' where id = 'aaaaaaaa-0000-4000-8000-000000000004' and active_role_pref is null;

insert into public.user_roles (user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'admin'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'moderator'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'borrower'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'lender'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'borrower'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'lender'),
  ('aaaaaaaa-0000-4000-8000-000000000007', 'borrower'),
  ('aaaaaaaa-0000-4000-8000-000000000007', 'lender'),
  ('aaaaaaaa-0000-4000-8000-000000000008', 'lender')
on conflict do nothing;

-- ── Student verifications (fictitious IDs; sample document paths) ──────────
insert into public.student_verifications (id, user_id, academic_year_id, full_name, student_email, student_id, requested_roles,
  document_path, document_mime, document_size_bytes, status, provider, review_reason, reviewed_by, reviewed_at, submitted_at, expires_at)
select v.id, v.user_id, 'eeeeeeee-0000-4000-8000-000000000002', p.full_name, u.email, v.student_id, v.roles,
       v.user_id::text || '/registration-form-SAMPLE.pdf', 'application/pdf', 48213, v.status, 'manual_demo', v.reason,
       case when v.status in ('verified', 'rejected') then 'aaaaaaaa-0000-4000-8000-000000000001'::uuid end,
       case when v.status in ('verified', 'rejected') then now() - interval '30 days' end,
       now() - v.age,
       case when v.status = 'verified' then app_private.manila_timestamp('2027-07-31', '23:59') end
from (values
  ('99999999-0000-4000-8000-000000000002'::uuid, 'aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'DEMO-0002', array['borrower']::public.marketplace_role[], 'verified'::public.verification_status, null::text, interval '40 days'),
  ('99999999-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000003', 'DEMO-0003', array['lender']::public.marketplace_role[], 'verified', null, interval '40 days'),
  ('99999999-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000004', 'DEMO-0004', array['borrower', 'lender']::public.marketplace_role[], 'verified', null, interval '40 days'),
  ('99999999-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000005', 'DEMO-0005', array['borrower']::public.marketplace_role[], 'pending_review', null, interval '2 hours'),
  ('99999999-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000006', 'DEMO-0006', array['lender']::public.marketplace_role[], 'rejected',
     'The uploaded registration form is for a previous academic year. Please upload your current-term registration form.', interval '3 days'),
  ('99999999-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000007', 'DEMO-0007', array['borrower', 'lender']::public.marketplace_role[], 'verified', null, interval '70 days'),
  ('99999999-0000-4000-8000-000000000008', 'aaaaaaaa-0000-4000-8000-000000000008', 'DEMO-0008', array['lender']::public.marketplace_role[], 'verified', null, interval '90 days')
) as v(id, user_id, student_id, roles, status, reason, age)
join public.profiles p on p.id = v.user_id
join auth.users u on u.id = v.user_id
on conflict (id) do nothing;

insert into public.terms_acceptances (user_id, terms_version_id, context)
select p.id, t.id, 'onboarding'
from public.profiles p cross join public.terms_versions t
where p.id in ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004',
               'aaaaaaaa-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000007',
               'aaaaaaaa-0000-4000-8000-000000000008')
  and t.doc_type in ('tos', 'privacy') and t.is_active
on conflict do nothing;

-- ── Listings (amounts in centavos) ──────────────────────────────────────────
insert into public.listings (id, lender_id, title, description, category, condition, equipment_notes, daily_rate, deposit, late_fee_per_day,
                             pickup_point_id, pickup_notes, status, is_featured, published_at)
values
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'Casio fx-991EX scientific calculator',
   'Exam-approved scientific calculator with spreadsheet and matrix modes. Fresh battery.', 'calculators', 'like_new', 'Includes hard cover.',
   4000, 30000, 2000, 'ffffffff-0000-4000-8000-000000000002', 'Weekdays after 3 PM.', 'active', true, now() - interval '60 days'),
  ('11111111-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003', 'Canon EOS 200D DSLR with 18–55mm lens',
   'Entry-level DSLR for org events and photojournalism classes. Two batteries and a 32 GB card included.', 'photo-video', 'good', 'Small scuff on the grip; fully working.',
   45000, 300000, 20000, 'ffffffff-0000-4000-8000-000000000003', 'Bring a padded bag.', 'active', true, now() - interval '50 days'),
  ('11111111-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000003', 'Portable projector with HDMI cable',
   '1080p-capable portable projector for thesis defenses and org presentations.', 'presentation', 'good', null,
   35000, 200000, 15000, 'ffffffff-0000-4000-8000-000000000004', null, 'active', false, now() - interval '45 days'),
  ('11111111-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000003', 'Aluminum laptop stand',
   'Foldable, adjustable laptop stand for long study sessions.', 'laptop-accessories', 'like_new', null,
   3000, 20000, 1500, 'ffffffff-0000-4000-8000-000000000002', null, 'active', false, now() - interval '40 days'),
  ('11111111-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000003', 'Drafting set: T-square, triangles, compass',
   'Complete drafting kit for architecture and engineering plates.', 'drafting', 'good', null,
   6000, 40000, 3000, 'ffffffff-0000-4000-8000-000000000004', null, 'active', false, now() - interval '70 days'),
  ('11111111-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000003', 'Lab gown (medium)',
   'Clean lab gown, medium size.', 'lab-gear', 'good', null,
   2500, 10000, 1000, null, null, 'draft', false, null),
  ('22222222-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000008', 'Travel tripod (155 cm)',
   'Lightweight aluminum tripod with phone mount adapter.', 'photo-video', 'good', null,
   12000, 80000, 6000, 'ffffffff-0000-4000-8000-000000000001', null, 'active', true, now() - interval '80 days'),
  ('22222222-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000008', '18-inch ring light with phone holder',
   'Dimmable ring light for recorded presentations and vlogs.', 'photo-video', 'like_new', null,
   10000, 50000, 5000, 'ffffffff-0000-4000-8000-000000000003', null, 'active', false, now() - interval '80 days'),
  ('22222222-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000008', 'TI-84 Plus graphing calculator',
   'Graphing calculator for statistics and calculus courses.', 'calculators', 'good', null,
   8000, 100000, 4000, 'ffffffff-0000-4000-8000-000000000002', null, 'active', true, now() - interval '85 days'),
  ('22222222-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000008', 'USB-C hub (HDMI, USB-A, SD)',
   'Seven-in-one USB-C hub.', 'laptop-accessories', 'new', null,
   3500, 30000, 2000, 'ffffffff-0000-4000-8000-000000000002', null, 'paused', false, now() - interval '20 days'),
  ('33333333-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000004', 'Architect scale ruler set',
   'Triangular scale rulers, metric and imperial.', 'drafting', 'good', null,
   2500, 15000, 1000, 'ffffffff-0000-4000-8000-000000000004', null, 'active', false, now() - interval '60 days'),
  ('33333333-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004', 'Wireless presenter clicker',
   'USB presenter with laser pointer.', 'presentation', 'like_new', null,
   2500, 20000, 1000, 'ffffffff-0000-4000-8000-000000000003', null, 'active', false, now() - interval '30 days'),
  ('44444444-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000007', 'Extension cord (5 m, 4 outlets)',
   'Heavy-duty extension cord for booths and events.', 'power-cables', 'fair', null,
   2000, 10000, 1000, 'ffffffff-0000-4000-8000-000000000001', null, 'active', false, now() - interval '55 days')
on conflict (id) do nothing;

-- One clearly-labelled SAMPLE cover photo per seeded listing (assets/listings/<id>.png, uploaded by
-- scripts/db-seed-files.mjs as each lender). The draft keeps no photo, to demonstrate the publish check.
insert into public.listing_images (listing_id, path, sort_order)
select l.id, l.id::text || '/sample-cover.png', 0
from public.listings l
where l.id::text ~ '^(1111|2222|3333|4444)' and l.status <> 'draft'
  and not exists (select 1 from public.listing_images i where i.listing_id = l.id and i.path = l.id::text || '/sample-cover.png');

insert into public.listing_availability (id, listing_id, start_date, end_date, reason)
values ('55555555-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002',
        ((now() at time zone 'Asia/Manila')::date + 20), ((now() at time zone 'Asia/Manila')::date + 22), 'Using it for my own org event')
on conflict (id) do nothing;

insert into public.listing_reports (id, listing_id, reporter_id, reason, details, status)
values ('66666666-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000004',
        'Photos do not match the item', 'Sample report for the moderation queue demo.', 'open')
on conflict do nothing;

-- ── Bookings: one helper keeps price math, snapshots, events, payments and ledger consistent ──
create or replace function pg_temp.seed_booking(p_id uuid, p_listing uuid, p_borrower uuid, p_pickup_offset int, p_return_offset int, p_status public.booking_status)
returns void language plpgsql as $f$
declare
  l public.listings;
  d0 date := (now() at time zone 'Asia/Manila')::date;
  v_pickup date := d0 + p_pickup_offset;
  v_return date := d0 + p_return_offset;
  v_days int := app_private.rental_days(v_pickup, v_return);
  v_bps int := (app_private.setting('commission_bps'))::int;
  v_due_time time := (app_private.setting('return_due_time_local') #>> '{}')::time;
  v_sub bigint; v_comm bigint; v_total bigint;
  v_policy uuid; v_terms uuid; v_pickup_label text;
  v_path public.booking_status[];
  v_rows int; v_pay uuid; v_refund uuid; i int;
  v_handover timestamptz := app_private.manila_timestamp(v_pickup, '10:00');
  -- Never record a return in the future (e.g. an item due back today, seeded in the morning).
  v_returned timestamptz := least(app_private.manila_timestamp(v_return, '16:00'), now() - interval '30 minutes');
begin
  select * into strict l from public.listings where id = p_listing;
  v_sub := l.daily_rate * v_days;
  v_comm := app_private.commission_amount(v_sub, v_bps);
  v_total := v_sub + l.deposit;
  select id into strict v_policy from public.cancellation_policy_versions where is_active;
  select id into strict v_terms from public.terms_versions where doc_type = 'rental_terms' and is_active;
  select label into v_pickup_label from public.campus_pickup_points where id = l.pickup_point_id;

  insert into public.bookings (id, listing_id, borrower_id, lender_id, pickup_date, return_date, rental_days, due_at, status,
    hold_expires_at, decided_at, decision_reason, cancelled_by, cancel_reason, cancelled_at, snapshot,
    daily_rate, late_fee_per_day, commission_bps, subtotal, deposit, total, commission, lender_net,
    policy_version_id, terms_version_id, handover_lender_at, handover_borrower_at, activated_at, returned_at, completed_at, created_at)
  values (p_id, l.id, p_borrower, l.lender_id, v_pickup, v_return, v_days, app_private.manila_timestamp(v_return, v_due_time), p_status,
    case when p_status in ('awaiting_payment', 'payment_expired') then
      case when p_status = 'awaiting_payment' then now() + make_interval(mins => (app_private.setting('payment_hold_minutes'))::int)
           else now() - interval '1 day' end end,
    case when p_status <> 'pending_lender_approval' and p_status <> 'cancelled' then now() - interval '2 days' end,
    case when p_status = 'rejected' then 'Sorry, I need the drafting set for my own plates that week.' end,
    case when p_status = 'cancelled' then p_borrower end,
    case when p_status = 'cancelled' then 'Found another option for my class.' end,
    case when p_status = 'cancelled' then now() - interval '1 day' end,
    jsonb_build_object('listing_title', l.title, 'category', l.category, 'condition', l.condition, 'daily_rate', l.daily_rate,
                       'deposit', l.deposit, 'late_fee_per_day', l.late_fee_per_day, 'pickup_point', v_pickup_label,
                       'pickup_notes', l.pickup_notes, 'commission_bps', v_bps, 'return_due_time_local', v_due_time::text,
                       'policy_version', 1, 'rental_terms_version', 1, 'seeded', true),
    l.daily_rate, l.late_fee_per_day, v_bps, v_sub, l.deposit, v_total, v_comm, v_sub - v_comm,
    v_policy, v_terms,
    case when p_status in ('active', 'overdue', 'return_requested', 'disputed', 'completed') then v_handover end,
    case when p_status in ('active', 'overdue', 'return_requested', 'disputed', 'completed') then v_handover + interval '5 minutes' end,
    case when p_status in ('active', 'overdue', 'return_requested', 'disputed', 'completed') then v_handover + interval '5 minutes' end,
    case when p_status in ('return_requested', 'disputed', 'completed') then v_returned end,
    case when p_status = 'completed' then v_returned + interval '2 hours' end,
    least(now(), app_private.manila_timestamp(v_pickup, '08:00') - interval '3 days'))
  on conflict (id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if; -- already seeded: never duplicate history

  insert into public.booking_terms_acceptances (booking_id, user_id, terms_version_id, terms_snapshot)
  values (p_id, p_borrower, v_terms, jsonb_build_object('rental_terms_version', 1, 'policy_version', 1));

  v_path := case p_status
    when 'pending_lender_approval' then array['pending_lender_approval']
    when 'rejected' then array['pending_lender_approval', 'rejected']
    when 'cancelled' then array['pending_lender_approval', 'cancelled']
    when 'awaiting_payment' then array['pending_lender_approval', 'awaiting_payment']
    when 'payment_expired' then array['pending_lender_approval', 'awaiting_payment', 'payment_expired']
    when 'confirmed' then array['pending_lender_approval', 'awaiting_payment', 'confirmed']
    when 'active' then array['pending_lender_approval', 'awaiting_payment', 'confirmed', 'active']
    when 'overdue' then array['pending_lender_approval', 'awaiting_payment', 'confirmed', 'active', 'overdue']
    when 'return_requested' then array['pending_lender_approval', 'awaiting_payment', 'confirmed', 'active', 'return_requested']
    when 'disputed' then array['pending_lender_approval', 'awaiting_payment', 'confirmed', 'active', 'return_requested', 'disputed']
    when 'completed' then array['pending_lender_approval', 'awaiting_payment', 'confirmed', 'active', 'return_requested', 'completed']
  end::public.booking_status[];
  for i in 1 .. array_length(v_path, 1) loop
    insert into public.booking_events (booking_id, actor_id, from_status, to_status, reason, metadata)
    values (p_id,
            case when v_path[i] in ('awaiting_payment', 'rejected', 'completed') then l.lender_id
                 when v_path[i] in ('overdue', 'payment_expired') then null
                 else p_borrower end,
            case when i > 1 then v_path[i - 1] end, v_path[i], 'Seeded demo history', '{"seed": true}');
  end loop;

  if p_status in ('confirmed', 'active', 'overdue', 'return_requested', 'disputed', 'completed') then
    insert into public.payments (purpose, booking_id, payer_id, amount, status, idempotency_key, provider_ref, processed_at)
    values ('booking', p_id, p_borrower, v_total, 'succeeded', 'seed:pay:' || p_id, 'MOCK-SEED-' || left(p_id::text, 8), now() - interval '2 days')
    returning id into v_pay;
    -- Balanced simulated ledger: cash in = deposit held + lender payable + commission.
    insert into public.ledger_entries (booking_id, payment_id, party_id, category, debit, credit, description, idempotency_key) values
      (p_id, v_pay, p_borrower, 'borrower_payment', v_total, 0, 'Simulated borrower payment', 'seed:ledger:' || p_id || ':payment'),
      (p_id, v_pay, l.lender_id, 'rent_payable', 0, v_sub - v_comm, 'Simulated lender payable (not paid out)', 'seed:ledger:' || p_id || ':payable'),
      (p_id, v_pay, null, 'platform_commission', 0, v_comm, 'Platform commission (10%)', 'seed:ledger:' || p_id || ':commission');
    if l.deposit > 0 then
      insert into public.ledger_entries (booking_id, payment_id, party_id, category, debit, credit, description, idempotency_key)
      values (p_id, v_pay, p_borrower, 'deposit_held', 0, l.deposit, 'Refundable deposit held (not revenue)', 'seed:ledger:' || p_id || ':deposit');
    end if;
  elsif p_status = 'payment_expired' then
    insert into public.payments (purpose, booking_id, payer_id, amount, status, idempotency_key, failure_reason, processed_at)
    values ('booking', p_id, p_borrower, v_total, 'expired', 'seed:pay:' || p_id, 'Demo payment hold expired before checkout', now() - interval '1 day');
  end if;

  if p_status in ('active', 'overdue', 'return_requested', 'disputed', 'completed') then
    insert into public.handover_reports (booking_id, lender_confirmed_at, lender_notes, borrower_confirmed_at, borrower_notes)
    values (p_id, v_handover, 'Handed over in working condition.', v_handover + interval '5 minutes', 'Received; condition matches the listing.');
  end if;

  if p_status in ('return_requested', 'disputed', 'completed') then
    insert into public.return_reports (booking_id, borrower_requested_at, borrower_notes, lender_inspected_at, outcome, lender_notes)
    values (p_id, v_returned, 'Returned at the agreed pickup point.',
            case when p_status in ('disputed', 'completed') then v_returned + interval '1 hour' end,
            case p_status when 'completed' then 'clean'::public.return_outcome when 'disputed' then 'damaged'::public.return_outcome end,
            case p_status when 'completed' then 'Returned in the agreed condition.' when 'disputed' then 'The compass hinge is bent and one triangle is cracked.' end);
  end if;

  if p_status = 'completed' and l.deposit > 0 then
    insert into public.refunds (payment_id, booking_id, amount, reason, status, idempotency_key, processed_at)
    values (v_pay, p_id, l.deposit, 'Deposit released after clean return (simulated refund)', 'succeeded', 'seed:refund:' || p_id, v_returned + interval '2 hours')
    returning id into v_refund;
    insert into public.ledger_entries (booking_id, refund_id, party_id, category, debit, credit, description, idempotency_key) values
      (p_id, v_refund, p_borrower, 'deposit_released', l.deposit, 0, 'Deposit released to borrower', 'seed:ledger:' || p_id || ':deposit_release'),
      (p_id, v_refund, p_borrower, 'refund', 0, l.deposit, 'Simulated refund of deposit', 'seed:ledger:' || p_id || ':refund');
  end if;
end
$f$;

-- Bea = …02, Leo = …03, Dana = …04, Rico = …07, Mika = …08
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002',   3,   5, 'confirmed');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004',  -2,   1, 'active');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002',   7,   9, 'pending_lender_approval');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000004', '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000004',   8,  10, 'pending_lender_approval');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000005', '11111111-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000007',  -1,   2, 'active');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000006', '11111111-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000002',  -6,  -3, 'disputed');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000007', '22222222-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004',   4,   6, 'awaiting_payment');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000008', '22222222-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000004',  -5,  -2, 'overdue');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000009', '22222222-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002',  -3,   0, 'return_requested');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000010', '11111111-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000002',  10,  11, 'payment_expired');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000011', '11111111-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002',  14,  15, 'cancelled');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000012', '11111111-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000004',   5,   6, 'rejected');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000013', '22222222-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000002', -40, -38, 'completed');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000014', '22222222-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000004', -35, -34, 'completed');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000015', '22222222-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', -30, -28, 'completed');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000016', '22222222-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004', -25, -23, 'completed');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000017', '22222222-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', -20, -19, 'completed');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000018', '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000007', -50, -49, 'completed');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000019', '22222222-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000007', -45, -44, 'completed');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000020', '33333333-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000007', -42, -41, 'completed');
select pg_temp.seed_booking('bbbbbbbb-0000-4000-8000-000000000021', '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', -60, -58, 'completed');

-- ── Reviews (completed bookings only) ──────────────────────────────────────
-- Mika: 5 completed lendings averaging 4.8 → meets the sample Trusted Lender rule.
-- Rico: 3 reviews averaging 1.67 → meets the sample low-rating restriction rule.
insert into public.reviews (booking_id, reviewer_id, target_id, direction, rating, comment, created_at)
select r.booking_id, b.borrower_id, b.lender_id, 'borrower_to_lender', r.rating, r.comment, b.completed_at + interval '1 day'
from (values
  ('bbbbbbbb-0000-4000-8000-000000000013'::uuid, 5, 'Calculator was spotless and Mika was on time.'),
  ('bbbbbbbb-0000-4000-8000-000000000014', 5, 'Sturdy tripod, easy pickup.'),
  ('bbbbbbbb-0000-4000-8000-000000000015', 4, 'Worked well; pickup was a bit late.'),
  ('bbbbbbbb-0000-4000-8000-000000000016', 5, 'Great for my stats finals.'),
  ('bbbbbbbb-0000-4000-8000-000000000017', 5, 'Would rent again.'),
  ('bbbbbbbb-0000-4000-8000-000000000021', 4, 'Good calculator, clear instructions.')
) as r(booking_id, rating, comment)
join public.bookings b on b.id = r.booking_id
on conflict (booking_id, reviewer_id, target_id) do nothing;

insert into public.reviews (booking_id, reviewer_id, target_id, direction, rating, comment, created_at)
select r.booking_id, b.lender_id, b.borrower_id, 'lender_to_borrower', r.rating, r.comment, b.completed_at + interval '1 day'
from (values
  ('bbbbbbbb-0000-4000-8000-000000000013'::uuid, 5, 'Returned on time and in perfect condition.'),
  ('bbbbbbbb-0000-4000-8000-000000000014', 5, 'Careful with the equipment.'),
  ('bbbbbbbb-0000-4000-8000-000000000021', 5, 'Smooth rental.'),
  ('bbbbbbbb-0000-4000-8000-000000000018', 2, 'Returned late without messaging.'),
  ('bbbbbbbb-0000-4000-8000-000000000019', 1, 'Ring light came back with a loose clamp and no reply to messages.'),
  ('bbbbbbbb-0000-4000-8000-000000000020', 2, 'Hard to coordinate the return.')
) as r(booking_id, rating, comment)
join public.bookings b on b.id = r.booking_id
on conflict (booking_id, reviewer_id, target_id) do nothing;

-- ── Dispute on the damaged return ───────────────────────────────────────────
insert into public.disputes (id, booking_id, opener_id, category, severity, description, requested_amount, status)
values ('77777777-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000003',
        'damage', 'major', 'The compass hinge is bent and one 45° triangle is cracked. Requesting part of the deposit for replacement.',
        25000, 'awaiting_borrower_response')
on conflict (id) do nothing;
insert into public.dispute_messages (id, dispute_id, sender_id, body) values
  ('78787878-0000-4000-8000-000000000001', '77777777-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003',
   'Sample case: photos of the bent hinge would be attached here as private evidence.')
on conflict (id) do nothing;

-- ── Messages on live rentals ───────────────────────────────────────────────
-- Every booking gets its conversation automatically (migration 016 trigger); messages look it up by booking.
insert into public.messages (id, conversation_id, sender_id, body, created_at)
select v.id::uuid, c.id, v.sender::uuid, v.body, now() - v.ago::interval
from (values
  ('89898989-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'Hi Leo! Can we meet at the student center at 10 AM for the camera?', '20 hours'),
  ('89898989-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'Sure, see you there. I''ll bring the spare battery.', '19 hours'),
  ('89898989-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004', 'Projector works great for our defense rehearsal, thanks!', '1 day')
) as v(id, booking, sender, body, ago)
join public.conversations c on c.booking_id = v.booking::uuid
on conflict (id) do nothing;

-- ── Notifications ──────────────────────────────────────────────────────────
insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key) values
  ('aaaaaaaa-0000-4000-8000-000000000003', 'booking.requested', 'New booking request', 'Bea Santos wants to rent your Casio fx-991EX.', 'booking', 'bbbbbbbb-0000-4000-8000-000000000003', 'seed:notif:b03:requested'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'booking.requested', 'New booking request', 'Dana Cruz wants to rent your Casio fx-991EX for overlapping dates.', 'booking', 'bbbbbbbb-0000-4000-8000-000000000004', 'seed:notif:b04:requested'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'booking.confirmed', 'Booking confirmed', 'Your Canon EOS 200D rental is confirmed (demo payment).', 'booking', 'bbbbbbbb-0000-4000-8000-000000000001', 'seed:notif:b01:confirmed'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'booking.overdue', 'Return overdue', 'The travel tripod was due 2 days ago. Please arrange the return with Mika.', 'booking', 'bbbbbbbb-0000-4000-8000-000000000008', 'seed:notif:b08:overdue:borrower'),
  ('aaaaaaaa-0000-4000-8000-000000000008', 'booking.overdue', 'Item overdue', 'Dana Cruz has not returned your travel tripod.', 'booking', 'bbbbbbbb-0000-4000-8000-000000000008', 'seed:notif:b08:overdue:lender'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'verification.submitted', 'Verification submitted', 'Your documents are waiting for manual review.', 'verification', '99999999-0000-4000-8000-000000000005', 'seed:notif:v05:submitted'),
  ('aaaaaaaa-0000-4000-8000-000000000006', 'verification.rejected', 'Verification needs attention', 'Your registration form was not accepted. See the reason and resubmit.', 'verification', '99999999-0000-4000-8000-000000000006', 'seed:notif:v06:rejected'),
  ('aaaaaaaa-0000-4000-8000-000000000007', 'account.paused', 'Account paused for review', 'New rentals and listings are paused. Your active rental and support remain available.', 'profile', 'aaaaaaaa-0000-4000-8000-000000000007', 'seed:notif:u07:paused'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'dispute.opened', 'Dispute opened', 'Leo Reyes reported damage on the drafting set. Please respond.', 'dispute', '77777777-0000-4000-8000-000000000001', 'seed:notif:d01:opened')
on conflict (dedupe_key) do nothing;

-- ── Premium (simulated): Mika has an active demo subscription ──────────────
insert into public.subscriptions (id, user_id, status, price, period_start, period_end)
values ('12121212-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000008', 'active', 9900, now() - interval '10 days', now() + interval '20 days')
on conflict (id) do nothing;
insert into public.payments (id, purpose, subscription_id, payer_id, amount, status, idempotency_key, provider_ref, processed_at)
values ('13131313-0000-4000-8000-000000000001', 'subscription', '12121212-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000008',
        9900, 'succeeded', 'seed:pay:sub:mika', 'MOCK-SEED-SUB', now() - interval '10 days')
on conflict (id) do nothing;
insert into public.ledger_entries (payment_id, subscription_id, party_id, category, debit, credit, description, idempotency_key) values
  ('13131313-0000-4000-8000-000000000001', '12121212-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000008', 'subscription_payment', 9900, 0, 'Simulated Premium payment (₱99/month)', 'seed:ledger:sub:mika:payment'),
  ('13131313-0000-4000-8000-000000000001', '12121212-0000-4000-8000-000000000001', null, 'subscription_payment', 0, 9900, 'Premium revenue (simulated)', 'seed:ledger:sub:mika:revenue')
on conflict (idempotency_key) do nothing;

-- ── Audit trail for seeded admin decisions ─────────────────────────────────
insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'verification.' || v.status, 'student_verification', v.id::text, '{"seed": true}'
from public.student_verifications v
where v.status in ('verified', 'rejected')
  and not exists (select 1 from public.audit_logs a where a.entity_id = v.id::text and a.action = 'verification.' || v.status);

-- ── Account status history for seeded restrictions (Phase 11) ──────────────
insert into public.account_status_events (user_id, from_status, to_status, reason, actor_id, metadata)
select p.id, 'active', p.account_status, coalesce(p.status_reason, 'Paused by the sample low-rating rule.'), null, '{"automatic": true, "seed": true}'
  from public.profiles p
 where p.account_status <> 'active'
   and not exists (select 1 from public.account_status_events e where e.user_id = p.id);
