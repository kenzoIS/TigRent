# TigRent — Demo Guide (started in Phase 2; completed in Phase 14)

Everything below is **fictitious demo data** on the TigRent prototype's Supabase project. Payments, refunds, payouts and student verification are **simulated**; no real money moves and no external provider is connected.

## Demo accounts
All accounts use the reserved `.test` email domain (it can never belong to a real student).
**Password for every demo account:** `TigRentDemo#2026`

| Account | Email | State | Use it to show |
|---|---|---|---|
| Admin / moderator | `admin.demo@tigrent.test` | admin + moderator roles; no student verification | Verification queue, disputes, settings, audit log |
| Borrower | `bea.borrower@tigrent.test` | verified, borrower | Upcoming confirmed rental, pending request, item due back today, payment-expired and cancelled requests, past completed rentals, open damage dispute |
| Lender | `leo.lender@tigrent.test` | verified, lender | 5 active listings + 1 draft, **two overlapping requests** for the same calculator (conflict demo), active rentals, disputed return |
| Dual-role | `dana.dual@tigrent.test` | verified, borrower + lender | Role switching, overdue tripod, awaiting-payment hold, own listings |
| Pending student | `paolo.pending@tigrent.test` | verification pending review | Pending state; marketplace blocked |
| Rejected student | `rina.rejected@tigrent.test` | verification rejected with a reason | Resubmission flow |
| Restricted | `rico.restricted@tigrent.test` | verified, account **paused** (3 reviews averaging 1.67) | Restriction while the active rental stays visible |
| Trusted lender | `mika.lender@tigrent.test` | verified lender, 5 completed lendings, average 4.8, active demo Premium | Trusted Lender badge (Phase 11), Premium (Phase 12) |

Sample policy values (commission 10%, 15-minute payment hold, return due 23:59 Manila, cancellation windows, rating thresholds, email domains, student ID pattern) are stored as versioned settings marked `is_sample` and are **not approved business or legal terms**.

## Auth configuration (owner-set, 2026-11-18)
**Confirm email is OFF** on the demo project (Supabase free tier). New sign-ups get a session immediately and go straight to Terms → student verification. Use a real-looking address you control; `.test` addresses are rejected for new sign-ups. Signing up never verifies a student. Verification is the separate review below.

## Demonstrating student verification (Journey A)
1. Sign up as a new student → accept Terms → fill in **Verify your student status**. Use a `@ust.edu.ph` or `@tigrent.test` email and any ID matching the sample pattern, attach a PDF or photo, and submit. The status screen shows **Waiting for review**.
2. Sign out, then sign in as `admin.demo@tigrent.test` → **Student verification queue** → open the submission → **Open document** (private link valid 5 minutes) → **Approve**, **Request changes** or **Reject** (the last two need a reason).
3. Sign back in as the student. Approved: the student lands in the borrower/lender area for their requested roles. Rejected or sent back: the reason is shown, with a prefilled form for resubmission.
- The seeded pending student `paolo.pending@tigrent.test` is already in the queue with a SAMPLE form, so you can demo step 2 directly.
- **Academic years** (admin): making another year current expires older verifications (sample policy); those students are asked to renew.

## Commands (run in `d:\TigRent`)
| Command | What it does |
|---|---|
| `npm run db:ping` | Checks the database connection (finds the pooler region if needed) |
| `npm run db:status` | Lists applied and pending migrations |
| `npm run db:migrate` | Applies pending migrations to the hosted project |
| `npm run db:seed` | Loads or refreshes demo data (idempotent) |
| `npm run db:reset-demo -- --confirm <project-ref>` | **Deletes all TigRent app data** and reloads the seed. Demo accounts are recreated; other sign-ups keep their login with a fresh unverified profile. Refuses without the matching project ref or when `TIGRENT_ENV=production`. |
| `npm run db:smoke` | Live checks against the hosted project using only the publishable key |
| `npm run db:seed-files` | Uploads any missing SAMPLE registration-form PDFs for seeded students (also run by `db:seed` and the reset) |
| `npm run e2e:journey-a` | Live end-to-end Journey A with a throwaway `@example.com` student, cleaned up afterwards |
| `npm run e2e:journey-b` | Live end-to-end Journey B (Leo lists, publishes, pauses, blocks dates; report → hide → restore → remove), cleaned up afterwards |
| `npm run e2e:journey-c` | Live end-to-end Journey C (requests, **concurrent** acceptance, demo payment success/failure/expiry, ledger and notifications) on far-future dates of Leo's laptop stand, cleaned up afterwards |
| `npm run e2e:journey-d` | Live end-to-end Journey D (Bea rents one of Leo's items today: messages, handover, extension failure + success, return, clean inspection, deposit refund, reminder idempotency), cleaned up afterwards |
| `npm run e2e:journey-e` | Live end-to-end Journey E (cancellation matrix with refund previews, late fee, damage dispute with private evidence, moderator decision, appeal), cleaned up afterwards (one tiny private evidence file remains per run) |
| `npm run e2e:journey-trust` | Live Journey E.5--E.7 (reviews, moderation, low-rating pause, active-rental access, appeal and moderator restoration), cleaned up afterwards |
| `npm run e2e:journey-f` | Live Journey F (simulated Premium checkout, entitlement gates, ledger balance, admin audit log, cancellation), with temporary data cleaned up; append-only audit history remains |
| `npm run db:types` | Regenerates `src/types/database.ts` from the migrations |
| `npm test` / `npm run test:db` / `npm run test:app` | All tests / database tests (PGlite) / app tests |

## Demonstrating listings (Journey B)
Sign in as `leo.lender@tigrent.test` → **Equipment** → **New listing** → three steps (About → Price → Pickup) → **Save draft** → **Photos** (take or choose a photo) → **Publish**. Then try Preview, Pause/Reactivate and Availability (tap a date to block it). Leo's draft "Lab gown (medium)" shows the publish checklist blocking a listing without photos. Every seeded listing shows a clearly-labelled SAMPLE PHOTO.

## Demonstrating a booking (Journey C)
1. As `bea.borrower@tigrent.test`: search → open an item → pick dates → **Review request** → accept the terms → **Send request**.
2. As `leo.lender@tigrent.test` (for Leo's items): **Requests** → open the request → **Accept** (dates are held for the sample 15 minutes) or **Decline** with a reason. Seeded requests from Bea and Dana on Leo's Casio overlap: accepting one shows "Dates no longer available" on the other.
3. As Bea: **Rentals** → the rental → **Pay (demo)** → choose **Simulate success** or **Simulate failure** → see the result, then **View receipt**.
Payments are simulated: no card, e-wallet or bank details are ever asked for and no money moves.

## Demonstrating a rental after payment (Journey D)
Handover opens the day before pickup, so rent an item **starting today** (Journey C above).
1. As Leo: open the booking → **Message Bea** → **Confirm handover** (notes and up to 4 private photos).
2. As Bea: **Confirm receipt**. The booking becomes active and the timeline moves to "Due back".
3. As Bea: **Request more days** → as Leo: approve (or decline with a reason) → as Bea: pay (demo). **Simulate failure** keeps the original due date; success moves it.
4. As Bea: **Return item** → as Leo: **Confirm clean return**. The booking completes and the deposit is released (simulated refund, shown on the payment record).
Reminders (pickup, due soon, overdue, lender follow-ups) appear in Notifications. They are processed every 5 minutes on the server and whenever bookings are opened, and are never duplicated. Seeded examples: Dana's tripod rental from Mika is overdue (late returns are settled in Phase 10); Dana's projector and Rico's laptop stand are active.

## Demonstrating cancellations and disputes (Journey E)
- **Cancel:** any request or paid booking before pickup → **Cancel request/booking**. The preview shows the refund under the booking's *sample* policy: 100% at least 24 h before the pickup day, 50% of the rent after that, the deposit always back, and 100% when the lender cancels. Confirm, then check the payment record.
- **Late return:** return after the due time. The lender sees "Returned N days late", and confirming takes the agreed late fee from the deposit and releases the rest.
- **Problem:**
  - The lender taps **Report a problem** at inspection, or **Report not returned** when overdue; the borrower taps **Report a problem** while the item is out.
  - The other party adds their side in the case.
  - As `admin.demo@tigrent.test`: **Disputes** → case → **Record decision** (deposit to lender, rent refund, completed/cancelled) → both parties can **Appeal** once within 7 days.
- Seeded case: Leo's damage report on Bea's drafting-set rental is waiting for Bea's reply.

## Demonstrating reviews, trust and account health (Journey E.5--E.7)
1. Complete a rental, then open it as each party and use **Rate [member]**. Ratings are one per party, 1--5 stars, optional comments, and are available for the sample 30-day review window only.
2. The recipient can report a received rating. As `admin.demo@tigrent.test`, open **Reported reviews** to keep or hide it with a reason. Hiding retains the audit record but removes the rating from visible aggregates, the Trusted Lender badge, and account-health calculations.
3. `mika.lender@tigrent.test` demonstrates **Verified Trusted Lender**. It is a TigRent prototype badge, not UST endorsement: the sample criteria are verified/active status, at least 5 completed lendings, at least 4.5 average lender rating, and no unresolved severe dispute.
4. `rico.restricted@tigrent.test` demonstrates the sample low-rating outcome (at least 3 ratings averaging below 2.5): new marketplace activity is paused and listings are hidden, while existing rentals, messages, returns, support, and **Appeal this decision** remain accessible. As Admin, use **Users and restrictions** to request information, lift, restrict, or (admin only) suspend with a recorded reason.

## Demonstrating Premium and administration (Journey F)
1. Sign in as `mika.lender@tigrent.test` → **TigRent Premium**. The active plan is explicitly labelled **PHP 99/month demo**: no payment details, recurring billing, or real money are involved. It unlocks ledger-backed simulated analytics, featured placement, multi-day availability blocks, and bulk equipment pause/unavailable controls.
2. Sign in as `dana.dual@tigrent.test` → lender → **TigRent Premium**. Choose a simulated success or failure, then subscribe. Success writes a balanced sample subscription payment and locks or unlocks Premium controls according to the shown state. Cancelling removes entitlement immediately while retaining the recorded history.
3. As `admin.demo@tigrent.test`, open **Policies, fees & thresholds**. Every edit creates a versioned, audited sample setting; use the cancellation-policy action to create a new active version for future bookings. Existing bookings retain the snapshots accepted when requested.
4. In the admin hub open **Audit log** to inspect Premium, configuration, moderation, and protected listing actions. This is staff-only history, not a customer-facing payment statement.

Demo state you change by hand (e.g. enabling a second role, publishing listings, sending requests) persists until a demo reset.

Booking dates are relative to "today" in Asia/Manila, so a reset refreshes the timeline (upcoming rentals stay upcoming).

## Known demo limitations
- Seeded verification records have clearly-labelled SAMPLE PDFs ("SAMPLE: NOT A REAL DOCUMENT"), uploaded by each fictitious student.
- The seeded awaiting-payment hold (Dana → TI-84) lapses 15 minutes after a reset and becomes "Hold expired" within 5 minutes (scheduled job) or as soon as bookings are opened.
- Notifications are in-app only; push and email aren't configured in the prototype.
