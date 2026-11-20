# TigRent — Data Model (as deployed, Phase 2)

Source: `supabase/migrations/*.sql` (authoritative). TypeScript types are generated into `src/types/database.ts` (`npm run db:types`; a test fails if stale).

## Conventions
- **Money:** `bigint` integer **centavos**, currency `PHP` (CHECK-enforced). Never floating point.
- **Time:** `timestamptz` (UTC). Rental dates are `date` in **Asia/Manila**. `app_private.manila_timestamp(date, time)` converts local business time to `timestamptz`.
- **Rental days:** `app_private.rental_days(pickup, return) = max(1, return − pickup + 1)` (inclusive). The bookings table enforces it with a CHECK.
- **Commission:** `app_private.commission_amount(rent, bps)` uses half-up rounding to the centavo; sample 1000 bps = 10%. It applies to rent only, never the deposit.
- **Sample values:** settings, policies, terms, academic years and pickup points carry `is_sample` so demo values are never mistaken for approved terms.
- **History:** `booking_events`, `ledger_entries` and `audit_logs` are append-only (UPDATE/DELETE raise `42501`).
- **Schemas:** `public` holds API-exposed tables and views. `app_private` holds internal helpers (not exposed by the API).

## Enumerations
| Enum | Values |
|---|---|
| `app_role` | borrower, lender, admin, moderator |
| `marketplace_role` | borrower, lender |
| `account_status` | active, paused_pending_review, restricted, suspended |
| `verification_status` | not_submitted, pending_review, verified, rejected, needs_resubmission, expired |
| `listing_status` | draft, active, paused, unavailable, removed |
| `item_condition` | new, like_new, good, fair, worn |
| `booking_status` | pending_lender_approval, rejected, cancelled, awaiting_payment, payment_expired, confirmed, active, overdue, return_requested, disputed, completed |
| `extension_status` | pending, rejected, approved_awaiting_payment, paid, payment_failed, expired, cancelled |
| `return_outcome` | clean, late, damaged, incomplete, not_returned |
| `payment_purpose` / `payment_status` / `refund_status` | booking, extension, subscription, late_fee, damage_compensation / pending, succeeded, failed, expired / pending, succeeded, failed |
| `ledger_category` | borrower_payment, deposit_held, deposit_released, deposit_withheld, rent_payable, platform_commission, extension_payment, late_fee, damage_compensation, refund, cancellation_adjustment, subscription_payment |
| `dispute_category` / `dispute_severity` / `dispute_status` | damage, missing_item, incomplete_return, late_return, not_as_described, payment, other / minor, major, severe / open, awaiting_borrower_response, awaiting_lender_response, under_review, resolved_refund, resolved_compensation, closed, appealed |
| `review_direction` / `review_moderation` | borrower_to_lender, lender_to_borrower / visible, under_review, hidden |
| `appeal_status`, `subscription_status`, `conversation_kind`, `moderation_status`, `report_status`, `terms_doc_type` | see migrations |

## Booking state machine (enforced by `app_private.booking_transition_allowed`, migration 015; mirrored and parity-tested in `src/domain/bookings.ts`)
```
pending_lender_approval → rejected | cancelled | awaiting_payment
awaiting_payment        → confirmed | payment_expired | cancelled
confirmed               → active (lender handover AND borrower receipt) | cancelled
active                  → return_requested | overdue | disputed
overdue                 → return_requested | disputed
return_requested        → completed | disputed
disputed                → completed | cancelled   (moderator resolution)
```
**Inventory guarantee:** the exclusion constraint `bookings_no_overlap` (btree_gist) makes it impossible for two bookings of one listing to overlap while either is `awaiting_payment`, `confirmed`, `active`, `overdue`, `return_requested` or `disputed`. This holds even under concurrent requests (plan §2.4, §6.4).

## Tables (key rules only)
| Table | Notes |
|---|---|
| `profiles` | 1:1 with `auth.users` (created by trigger). **No student ID or email.** Users may update only `full_name`, `avatar_path`, `active_role_pref`. |
| `user_roles` | (user, role) PK. Not writable by users. |
| `academic_years` | At most one `is_current` (partial unique index). |
| `student_verifications` | One row per submission (history kept). At most one `pending_review` per user. Holds student ID, email and the document path (owner + staff only). `app_private.verification_status(user)` returns the latest status, treating an expired `verified` as `expired`. |
| `terms_versions` / `terms_acceptances` | One active version per doc type. Anonymous users can read active versions. |
| `listing_categories`, `campus_pickup_points` | Admin-managed lookups (sample values). |
| `listings` | Rate/deposit/late fee ≥ 0, and an `active` listing needs rate > 0. Has a full-text `search` column. |
| `listing_images`, `listing_availability`, `listing_reports` | Images and blocks are visible wherever the listing is visible. One open report per reporter per listing. |
| `bookings` | Immutable `snapshot` + priced columns. CHECKs: borrower ≠ lender, days rule, subtotal = rate × days, total = subtotal + deposit, lender_net = subtotal − commission. |
| `booking_events` | Append-only transition log. |
| `booking_terms_acceptances`, `handover_reports`, `return_reports`, `extension_requests` | One open extension per booking. Extension `extra_days = new − old`. |
| `payments` | `provider = 'mock'` only. Unique `idempotency_key`. Purpose-specific foreign-key CHECK. |
| `refunds` | Linked to a succeeded payment. A trigger blocks refunds exceeding the amount paid. Unique idempotency key. |
| `ledger_entries` | Append-only. Exactly one of debit/credit > 0. Unique idempotency key. |
| `subscriptions` | `provider = 'mock'`, one active per user. |
| `disputes`, `dispute_messages`, `dispute_evidence` | Parties + staff only. |
| `reviews` | Unique (booking, reviewer, target). No self-review. Rating 1–5. |
| `account_appeals` | One open appeal per user. |
| `conversations`, `conversation_participants`, `messages` | Participants + staff. Read state is per participant (`last_read_at`). |
| `notifications` | Owner only. Unique `dedupe_key` (idempotent reminders). |
| `platform_settings` | Versioned (`key`, `version`), one current per key, `is_sample`. |
| `cancellation_policy_versions` | One active. Bookings reference the version in force when created. |
| `audit_logs` | Append-only. Staff read. |
| `account_status_events` | Append-only history of automatic low-rating pauses and moderator account decisions, including the reason and actor where applicable. |

**Trust records:** `reviews` are unique per booking/reviewer/target, immutable after submission, and have report/moderation metadata. Only visible reviews contribute to public ratings, Trusted Lender eligibility, and account-health calculations. `account_appeals` preserve the member reason, moderator response, and final outcome; only one appeal may be open per member.

**View `public_profiles`:** id, name, avatar, `is_student_verified`, review count/average (visible reviews), completed lendings/borrowings. Contains no student ID, email or account status.

## Simulated ledger semantics
Entries are written from the platform's point of view, and each payment balances (debits = credits):
| Event | Entries |
|---|---|
| Booking paid | debit `borrower_payment` = total · credit `deposit_held` = deposit · credit `rent_payable` (lender) = lender_net · credit `platform_commission` = commission |
| Extension paid | debit `extension_payment` = extra rent · credit `rent_payable` (lender) = extra − commission · credit `platform_commission` |
| Deposit released (clean return) | refund row · debit `deposit_released` = deposit · credit `refund` = deposit (borrower) |
| Late fee / damage compensation (withheld from deposit) | debit `deposit_withheld` · credit `late_fee` or `damage_compensation` (lender) [+ `platform_commission` only if the sample setting enables it]; the rest of the deposit is released as above |
| Rent refund (cancellation or dispute) | refund row · debit `cancellation_adjustment` (lender payable reduction) · debit `cancellation_adjustment` (commission reduction, platform) · credit `refund` (borrower); commission ends at 10% of the rent kept |
| Premium paid | debit `subscription_payment` (payer) · credit `subscription_payment` (platform revenue) |

Platform revenue = `platform_commission` (+ premium). Deposits are liabilities, never revenue.

Failed and expired booking payments keep a `payments` record (`failed` / `expired`) for the audit trail but write **no** ledger lines, because no simulated money moved. Booking ledger keys are per booking (`booking:{id}:paid:{category}`), so a booking can be booked into the ledger only once.

## Authorization model
- **Grants:** `anon` and `authenticated` start with nothing. `authenticated` gets SELECT on app tables (filtered by RLS) plus the three column-scoped self-service UPDATEs. `anon` reads only active terms.
- **RLS:** enabled on every table. Helper predicates (`app_private.is_staff`, `is_booking_party`, `can_view_listing`, …) are SECURITY DEFINER with an empty `search_path`.
- **Marketplace visibility:** active listings are visible only to **verified** students, plus owners, booking parties and staff.
- **Protected changes** (verification status, booking status, payments, refunds, ledger, reviews, roles, account status, settings) are not writable through tables. Phases 4–12 add SECURITY DEFINER RPCs for them.

## Server functions (RPCs) so far
| RPC | Who | Purpose |
|---|---|---|
| `get_my_session_context()` | signed-in | Roles, verification, account status, pending terms (routing source of truth) |
| `accept_current_terms(uuid[])` | signed-in | Records acceptance of the exact active ToS/Privacy versions |
| `enable_marketplace_role(role)` | verified + active | Adds borrower/lender to the same account (idempotent) |
| `submit_verification(...)` | signed-in, terms accepted | Validates and stores a submission → `pending_review` |
| `review_verification(id, decision, reason)` | staff | approve / reject / request_resubmission. Grants roles on approval. |
| `create_academic_year(label, start, end)` / `set_current_academic_year(id)` | admin | Year configuration and the expiry policy |
| `get_profile_summary(user?)` | self; others: verified students and staff | Ratings split by role, completed rentals, badges (`student_verified`, `trusted_lender` per `trusted_lender_rule`), criteria and progress |
| `create_listing(fields)` / `update_listing(id, fields)` | verified active lender / owner | Validated listing fields (centavos). Edits never touch booking snapshots. |
| `set_listing_status(id, status)` | owner | draft→active↔paused/unavailable→removed. Publish needs a verified active lender, rate > 0, ≥1 photo, not hidden. Remove is blocked while bookings are open. |
| `add_listing_image` / `remove_listing_image` / `reorder_listing_images` | owner | Photos checked against storage metadata; ≤8; active keeps ≥1 |
| `add_availability_block` / `remove_availability_block` | owner; multi-day blocks require active Premium | Manual blocks; can't overlap held bookings. Single-day blocks remain available without Premium. |
| `report_listing` / `resolve_listing_report` / `restore_listing` | verified student / staff / staff | Moderation: dismiss or hide (with a note to the lender), restore |
| `search_listings(...)` | verified student / staff | Keyword, category, dates (availability), price, condition, trusted, min rating, sort. Excludes own listings. Returns availability flags only. |
| `get_listing_unavailable_dates(id, from, to)` | verified student / staff | Merged booked/unavailable ranges for the calendar (no booking identities) |
| `quote_booking(id, pickup, return)` | verified student / staff | Server price (same as the future snapshot) + availability. Refuses own listing and invalid date windows. |
| `request_booking(listing, pickup, return, terms_version_id, expected_total?, pickup_arrangement?)` | verified active borrower | Creates `pending_lender_approval` with the immutable snapshot, priced columns, terms acceptance and first event; refuses stale terms or price, unavailable dates, own listing, overlapping own requests, phone numbers; an identical resend returns the same id |
| `decide_booking_request(id, 'accept' \| 'reject', reason?)` | the listing's lender (accept: active lender) | Reject needs a reason. Accept locks booking + listing, sweeps lapsed holds, refuses conflicts (`dates_taken`, `dates_blocked`, `pickup_passed`, `listing_unavailable`) and opens a `payment_hold_minutes` hold. Same decision repeated returns the first result. |
| `pay_booking_demo(id, idempotency_key, 'success' \| 'failure')` | the borrower | Mock gateway: idempotent by key; success → payment + balanced ledger + `confirmed`; failure → failed payment, hold released (`cancelled`); lapsed hold → `payment_expired` |
| `sweep_expired_holds()` | signed-in | Idempotent, server-timed release of lapsed holds (lazy expiry) |
| `get_booking_detail(id)` | parties / staff | Agreement, money split, counterpart, terms, history, payment attempts, server clock, lender-side conflict |
| `list_booking_requests()` | signed-in (own listings) | Lender inbox: pending (with conflict), holds, decisions from the last 30 days |
| `confirm_handover(id, notes?, photo_paths?)` | booking party | Lender first, then borrower receipt → `active`. Window: `handover_opens_days_before` before pickup to the return date. Photos must be the caller's `evidence/{booking}/{user}/…` uploads (≤4). |
| `request_extension(id, new_return)` / `decide_extension(ext, 'approve' \| 'reject', reason?)` | borrower / the lender | Before the due time, while active; agreed daily rate; conflicts refused; approval holds the extra days (`payment_hold_minutes`) |
| `pay_extension_demo(ext, idempotency_key, scenario)` | the borrower | Idempotent. Success → payment + ledger + new return date/due time/price columns; failure/expiry → original dates stand |
| `submit_return(id, notes?, photo_paths?)` / `confirm_clean_return(id, notes?, photo_paths?)` | borrower / lender | Return → `return_requested`; clean on-time inspection → `completed` + deposit released (simulated refund). Late returns wait for Phase 10. |
| `send_message(conv, body)` / `mark_conversation_read(conv)` / `get_conversation(conv)` / `list_my_conversations(role?)` | participants (get: + staff) | Booking messages; closed for declined/cancelled/expired bookings; one notification per unread stretch |
| `list_extension_requests()` | signed-in (own listings) | Lender extension inbox with conflict flags |
| `preview_cancellation(id)` / `cancel_booking(id, reason?, expected_refund)` | parties; staff (listing withdrawn) | Policy version stored on the booking; refund preview; refuses a changed amount; lender/staff need a reason; idempotent; nothing after pickup |
| `report_return_problem(id, 'damaged' \| 'incomplete', description, amount ≤ deposit, photos)` / `report_not_returned(id, description, amount ≤ deposit)` | lender | Opens a dispute (booking → `disputed`); deposit stays held. Not-returned only after the due time. |
| `open_dispute(id, 'not_as_described' \| 'payment' \| 'other', description, amount ≤ rent, photos)` | borrower | While active/overdue/returning |
| `respond_to_dispute(id, body, photos?, request_from?)` / `get_dispute(id)` / `list_disputes(open_only)` | parties + staff | Replies and evidence; awaited reply → `under_review`; staff can ask a party |
| `resolve_dispute(id, deposit_to_lender, rent_refund, 'completed' \| 'cancelled', decision)` | staff | Settles money once (refund + ledger), ends the booking, audit log |
| `appeal_dispute(id, reason)` / `decide_appeal(id, note)` | parties (once, ≤ `dispute_appeal_days`) / staff | Appeal → review note → closed |
| `my_lender_earnings()` | signed-in | Net simulated earnings (payables − refund adjustments + late fees + compensation) |
| `process_due_events()` (and `sweep_expired_holds()`) | signed-in; also **pg_cron every 5 min** | Idempotent, server-timed: expire booking/extension holds, mark overdue, send pickup/due-soon/follow-up reminders (deterministic dedupe keys) |

**Conversations:** a trigger (`bookings_conversation`) creates one conversation with both parties for every booking.

### Trust and account-health RPCs

| RPC | Who | Purpose |
|---|---|---|
| `submit_review(booking, rating, comment?)` / `list_review_prompts()` / `get_booking_reviews(booking)` | completed booking party | One 1--5-star review per party within the sample review window; the server derives the counterpart/direction and rejects duplicate or self reviews |
| `list_reviews(user, direction?)` / `report_review(review, reason)` | signed-in; report: verified recipient or staff | Visible member reviews; a report enters moderation without hiding the review by itself |
| `moderate_review(review, keep\|hide\|restore, note)` | staff | Reasoned, audited moderation. Hidden reviews remain recorded but leave aggregates, badge eligibility, and health calculations |
| `get_my_account_health()` / `submit_account_appeal(reason)` | signed-in member | Account status, visible-review metrics, sample rule, history, active obligations, and appeal workflow |
| `list_account_reviews()` / `get_account_review(user)` / `moderate_account(user, lift\|restrict\|suspend\|request_info, note)` | staff; suspend: admin only | Account-health moderation queue, decisions, audit, notifications, and retained access to active obligations |

### Premium and administration RPCs

| RPC | Who | Purpose |
|---|---|---|
| `get_my_premium()` / `subscribe_premium_demo(key, scenario)` / `cancel_premium()` | signed-in verified active lender | Reads/expirs the current demo plan, runs idempotent PHP 99 mock checkout (success/failure), and cancels it. Successful demo payments write balanced subscription ledger entries; no credentials or real money are involved. |
| `set_featured_listing(listing, enabled)` / `get_lender_analytics()` | owner with active Premium | Controls 30-day featured placement and returns ledger-backed, explicitly simulated lender analytics. Expired/cancelled plans lose access without deletion. |
| `bulk_set_listing_status(listings, paused\|unavailable)` | active Premium lender / owner | Safely changes 1–50 owned, non-removed listings; it cannot publish or remove listings and clears featured placement. |
| `update_platform_setting(key, value, description)` / `create_cancellation_policy(label, rules)` | admin | Versioned, advisory-lock protected configuration and safe activation of a new policy version. Existing bookings retain accepted snapshots. |
| `list_audit_log(limit?)` | staff | Append-only protected-action history, including configuration, Premium and moderation actions. |

Errors use `P0001` with message `kind.reason` and a user-facing `hint` (mapped by `src/lib/errors.ts`).

## Account deletion
Deleting an auth user cascades to their profile and private data. Append-only history (`audit_logs`, `booking_events`) is kept, but its `actor_id` is cleared: the only UPDATE the append-only guard allows (migration 011). Accounts with simulated **ledger** history can't be hard-deleted (`ON DELETE RESTRICT`); they must be anonymised (later phase).

## Storage (all buckets private)
| Bucket | Path | Read | Write |
|---|---|---|---|
| `verification-docs` (10 MB; pdf/jpg/png/heic) | `{user_id}/…` | owner, staff | owner; delete only before submission |
| `avatars` (2 MB) | `{user_id}/…` | members | owner |
| `listing-images` (5 MB) | `{listing_id}/…` | wherever the listing is visible | listing's lender |
| `evidence` (10 MB) | `{booking_id}/{user_id}/…` | booking parties, staff | party, own sub-folder |
