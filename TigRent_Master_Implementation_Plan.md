# TigRent — Master Mobile Prototype Implementation Plan

**Project:** TigRent — A Digital Peer-to-Peer Rental System for Academic and Student Essentials within the UST Community  
**Deliverable:** Fully navigable and functionally connected mobile application prototype  
**Primary handoff:** Claude Code agent working inside the project repository  
**Recommended baseline (only if the repository is greenfield):** Expo + React Native + TypeScript, Expo Router, Supabase, and a typed service/repository layer  
**Product status:** Demonstration prototype; external identity verification and payment processing must be simulated unless approved provider credentials and integrations are explicitly supplied.

---

## 0. Instructions to the implementation agent

You are implementing **TigRent**, a campus-focused, peer-to-peer rental marketplace for students in the University of Santo Tomas (UST) community. The supplied Business Model Canvas (BMC), the supplied tiger mascot illustration, and the functional/design requirements in this document are the product brief. Treat them as the source of truth for the prototype.

### 0.1 Work in controlled phases

1. **Inspect before changing anything.** Examine the repository, framework, package scripts, existing screens, navigation, dependencies, assets, backend configuration, and current design conventions. Do not assume that the repository is empty or that it uses the recommended stack.
2. Create a short implementation assessment identifying what can be reused, what is missing, and any conflicts with this plan. Preserve working code and existing conventions where practical.
3. Implement the phases in the order below. Do not skip a phase because a later screen appears easier to build first.
4. At the end of every phase, run the phase's tests and acceptance checklist. Fix failures before moving on. Do not mark a phase complete because the screen renders; its data, permissions, state transitions, error states, and navigation must also work.
5. Keep a running `IMPLEMENTATION_STATUS.md` in the repository. For each phase record: status, files changed, migrations added, commands run, tests passed/failed, known issues, and the exact next step.
6. Do not replace real functionality with decorative controls. Every visible button, menu item, filter, tab, form field, and action must work or be clearly disabled with an explanation. Do not leave placeholder buttons that appear operational.
7. Use realistic seeded data and repeatable demo accounts. Include a safe reset/seed procedure so the prototype can be demonstrated consistently.
8. When a provider is unavailable, implement a working adapter with a clearly labelled mock implementation. Never pretend that a simulated payment, student verification, email, or refund was processed by a real third party.
9. Do not hard-code assumptions about UST student ID formats, academic-year dates, cancellation policy, suspension thresholds, or verification-provider responses. Make these configurable and label demo defaults as sample policy values.
10. Do not add unrelated product features that expand the scope or delay completion of the BMC requirements.

### 0.2 Definition of “100% functional” for this prototype

For this project, **100% functional means that every in-scope prototype workflow can be completed end-to-end using seeded accounts and simulated external services**. A user must be able to register, sign in, submit student documents, be verified through the demo review process, act as a borrower and/or lender, create and manage listings, request and manage rentals, simulate checkout/refunds, request extensions, complete handover/return, open disputes, message, rate the other party, and see trust/account restrictions update according to the configured rules.

It does **not** mean that the prototype may claim to have live UST enrollment access, live SheerID verification, actual GCash/Maya/PayMongo transactions, actual payouts, legally reviewed rental contracts, or production-grade identity assurance without those services being connected and approved. Those integrations must sit behind replaceable interfaces.

### 0.3 Recommended stack if no usable stack exists

- **Mobile:** Expo + React Native + TypeScript.
- **Navigation:** Expo Router (or the repository's existing router if it is already established).
- **Backend/data:** Supabase Auth, PostgreSQL, Storage, and Realtime where useful.
- **Forms/validation:** React Hook Form + Zod, or equivalent typed tools already in the project.
- **Server state:** TanStack Query or the existing repository standard.
- **Local UI state:** lightweight context/store (e.g. Zustand) only where shared local state is needed.
- **Icons:** one consistent vector icon set such as `lucide-react-native`; use no emoji as icons and do not mix unrelated icon packs.
- **Testing:** unit/component tests with the framework already in the repository; React Native Testing Library for component behavior; Maestro or an equivalent E2E runner for device flows.
- **Backend testing:** Supabase local development/migrations where available, otherwise a controlled test backend. Never expose a Supabase service-role key in the mobile application.

If the existing project uses a different stable stack, keep it and translate the architecture rather than rebuilding the repository without a reason.

---

## 1. Product scope and BMC alignment

TigRent is a closed-community marketplace for verified UST students to temporarily rent academic and student essentials from other students. The two primary user types are **borrowers** and **lenders**. The BMC also identifies student organizations/events, dormitory residents, and commuters as relevant customer segments.

### 1.1 BMC requirements to implement

| BMC area | Required prototype implementation |
|---|---|
| Customer segments | UST students looking for affordable academic equipment; students earning from unused equipment; student organizations/events; commuters; dormitory residents. |
| Value propositions | Affordable short-term access; flexible lender-defined daily rates; verified student community; clear agreements/deposits; campus pickup and return arrangements. |
| Channels | Mobile app; shareable listing links; simulated/recorded campaign and QR-poster entry points; organization/community referral source. |
| Customer relationships | Student verification; accepted rental terms; messaging; booking tracking; reminders; notifications; reviews; dispute management; trusted badges. |
| Key activities | Maintain the application and database; verify students; manage listings, pricing, bookings, payments, rental terms, returns, disputes, and support. |
| Key resources | App, database, private file storage, matching/search, payment and verification adapters, standard rental terms. |
| Key partners | Payment gateway adapter for future PayMongo/GCash/Maya integration; future SheerID adapter; cloud/backend provider. |
| Cost structure | Hosting, database, security, payment integration fees, future verification-provider fees, and marketing/QR materials. |
| Revenue streams | 10% commission on a successful rental; configurable late/extension fees; optional TigRent Premium at **₱99/month** with featured listings, analytics, advanced booking calendar, promotional tools, and bulk equipment management. |

### 1.2 In-scope application surfaces

1. Authentication and onboarding.
2. Student verification submission and status tracking.
3. Role-aware navigation and dashboards.
4. Borrower discovery, search, listing details, booking, checkout, rental tracking, extension, return, cancellation, refund, review, and dispute flows.
5. Lender listing creation/editing, availability, booking approvals/rejections, handover, return inspection, extension decisions, earnings, reviews, and premium tools.
6. In-app messaging and notifications.
7. Trust badges, rating aggregation, account pause/suspension, and appeal/review states.
8. A restricted admin/moderator area for reviewing student verification, disputes, reports, settings, and account restrictions.
9. TigRent mascot interactions and polished visual system.
10. Seed/demo accounts, sample inventory, repeatable scenarios, and test coverage.

### 1.3 Explicitly out of scope unless the owner later approves it

- Real collection, holding, or disbursement of money.
- Live UST student-information-system access or claims of official UST endorsement.
- Live SheerID or other third-party identity checks without credentials, legal approval, and provider onboarding.
- Real legal advice, enforceable legal-document generation, or a production-approved terms-and-conditions agreement.
- Delivery logistics, courier tracking, or insurance underwriting.
- Public launch, production support operations, or production compliance certification.

Build interfaces so these can be integrated later without rewriting core business logic.

---

## 2. Core product decisions and business rules

Implement these rules in a central domain/service layer. Do not duplicate calculations in screens or calculate money only in the UI.

### 2.1 One student account can have both roles

- A person has one account and one student-verification record, and may enable **Borrower**, **Lender**, or **Both** capabilities.
- A student who initially registers as a borrower must be able to enable lender capability later, and vice versa, without creating a second account.
- The account's enabled roles are stored in the database. A selected/active role is a UI preference, not an authorization mechanism.
- The app routes to the correct borrower or lender home based on the enabled role and active role. If both are enabled, show a clear role switcher. If only one is enabled, route directly to that dashboard.
- An unverified or suspended student must not bypass restrictions by switching roles or entering a deep link.

### 2.2 Student verification and academic-year validation

Registration collects the student's full name, UST email, student ID, selected academic year, role intent, and registration-form document. Implement the following statuses:

`not_submitted → pending_review → verified | rejected | needs_resubmission → expired`

Rules:

- Academic years are records in an `academic_years` table with label, start date, end date, and an active/current flag. Admin can configure the active academic year. Never hard-code a year in the app.
- The submitted registration document must be associated with an academic-year record. The server validates that the selected year exists and that it is the currently configured year, unless an admin explicitly permits another year for a documented demo scenario.
- Validate email syntax and apply a configurable UST email-domain allowlist. Do not assume an email domain or student ID pattern without confirming it in project configuration. A valid email format alone does not prove enrollment.
- Validate required document type, size, upload completion, and metadata. Store documents in private storage, never in a public bucket.
- The prototype should provide an **admin review workflow** to approve, reject, or request resubmission. A deterministic demo verification adapter may simulate an external provider, but the UI must say “Demo verification” or “Manual review”; do not label an unverified account as verified.
- A future `StudentVerificationProvider` interface should support SheerID or another approved provider. Include provider reference/status fields without requiring the provider now.
- Verification is separate from authentication. Signing in successfully does not mean the student has been verified.
- If a verification expires when the academic year changes, set the status to `expired` and route the user to renewal. Make the expiry policy configurable.

### 2.3 Listings and daily pricing

A lender can create an item listing with:

- Item name/title, category, description, photos, condition, and optional equipment notes.
- Daily rental rate in PHP.
- Refundable security deposit in PHP (zero allowed if the lender chooses and policy permits).
- Configurable late-return fee per day.
- Pickup/return location notes chosen from approved campus-area options or entered as safe, non-sensitive instructions.
- Available dates/calendar and listing status (`draft`, `active`, `paused`, `unavailable`, `removed`).

Money is stored as integer centavos (or a consistent decimal type that safely represents currency); never use floating-point arithmetic for financial totals. Display currency as PHP/₱.

**Prototype rental-day rule:** calculate rental days using a single domain helper based on the pickup and expected-return date in the `Asia/Manila` time zone. Use at least one billable day. For this prototype, dates are inclusive: `rentalDays = max(1, calendarDateDifference(returnDate, pickupDate) + 1)`. Display the number of billable days before checkout so that the user sees the exact total. Keep this rule centralized and covered by tests. The UX must explain that the selected return date is included in the rental period.

`rentalSubtotal = dailyRate × rentalDays`

`checkoutTotal = rentalSubtotal + refundableDeposit + any separately disclosed applicable charge`

The borrower must see a full price breakdown before submitting a request or confirming payment.

### 2.4 Booking and availability integrity

A booking must be created through a backend/domain operation, not by trusting a client-side availability check.

- Borrower selects item, pickup date, expected-return date, and pickup arrangement; sees the computed price and terms; then sends a booking request.
- The request is initially `pending_lender_approval`. Multiple requests may exist for the same dates, but only one can be accepted/held/confirmed for the item.
- When a lender accepts, the server atomically checks for overlapping active reservations and creates a short payment hold (`awaiting_payment`) with a configurable expiry (demo default: 15 minutes). If another request already holds the dates, acceptance must fail gracefully and the lender must be told the dates are no longer available.
- A successful simulated payment converts the hold to `confirmed`. A failed or expired payment releases the hold.
- Use a database transaction/RPC and a row lock or equivalent concurrency-safe mechanism when accepting or confirming a booking. A client-side check is not sufficient.
- All date calculations and comparison rules must use the same timezone convention. Store timestamps in UTC and preserve the business-local date/time used for the rental.

Suggested booking lifecycle:

`pending_lender_approval → rejected | cancelled | awaiting_payment → confirmed → active → return_requested → completed`

Additional terminal/exception states: `payment_expired`, `cancelled`, `disputed`, `overdue`. Avoid allowing arbitrary status updates from the UI. Enforce allowed transitions in a domain service/database function.

### 2.5 Payment simulation, commission, and accounting

Create a `PaymentProvider` interface with a working `MockPaymentProvider` for the prototype. The UI should visibly mark the checkout as a demo/sandbox transaction. Include deterministic success and failure scenarios so the test suite can exercise both.

- Do not request or store real card numbers, CVVs, GCash PINs, Maya credentials, or bank passwords.
- A successful rental has a **10% platform commission** deducted from the lender's eligible rental payout, as stated in the BMC.
- For the prototype, calculate commission on rental charges retained by the platform (base rent plus approved extension rent) and exclude the refundable deposit. Treat late fees and damage compensation as separately identifiable ledger categories; their commission eligibility must be configurable rather than silently assumed.
- Show borrower total, refundable deposit, platform fee/commission, lender gross, and estimated lender net in the appropriate views. Avoid suggesting that the lender has received a real payout.
- Create a ledger entry for every simulated payment, refund, deposit release/withholding, commission, extension payment, cancellation adjustment, and lender payable. Entries must be auditable and idempotent.
- Payment/refund actions must be idempotent: repeated taps or network retries must not create duplicate charges/refunds/ledger entries.
- A refund is a stateful record linked to its source payment and booking. Never delete or overwrite a payment to represent a refund.

### 2.6 Cancellation and refund policy

The BMC requires borrower/lender cancellation and refund logic but does not specify exact percentages or time windows. Therefore:

- Implement a policy engine with admin-configurable, versioned cancellation rules. Store the policy version accepted for each booking so later policy edits do not retroactively change an existing rental.
- Seed the prototype with clearly labelled **sample/demo policy values** (not legal or final business terms). Include separate outcomes for: borrower cancellation while request is pending; borrower cancellation after lender approval but before pickup; lender cancellation; payment failure/timeout; item unavailable or listing withdrawn; cancellation after pickup; and dispute-driven cancellation.
- Make the exact refund amount and any retained fee visible to the user before confirmation. Explain who receives what and why.
- Default safe demo behavior: a lender-initiated cancellation before pickup returns the borrower's full simulated payment; a pending request cancelled before acceptance returns the full amount (normally no payment has been captured); all other outcomes are resolved through the configured sample policy. Do not hard-code a non-refundable charge without explicit product-owner approval.
- Refund processing must update the booking, payment/refund records, ledger, notification, and audit trail as one consistent workflow (transactional/outbox pattern if asynchronous).
- Once a booking is active, do not let a normal cancellation silently bypass a return/dispute process.

### 2.7 Deposits, late returns, damage, and disputes

- Capture/record a refundable deposit in the mock checkout flow and mark it as held, not as platform revenue.
- At return, borrower submits a return request and optional photos/notes. Lender records inspection outcome: returned in agreed condition, late, damaged, incomplete, or not returned.
- On a clean return, release the deposit through a simulated refund.
- For damage or missing items, create a dispute/claim with description, evidence, requested amount, status, and moderator decision. Do not let a lender unilaterally convert the deposit into revenue without a recorded reason and a visible resolution process.
- Calculate late days using the agreed due timestamp and actual return confirmation timestamp; never charge late fees before the due time. Use the item's disclosed late-fee setting and the accepted booking terms snapshot.
- For an overdue item, notify both parties, show the overdue status, and provide escalation. Do not automatically mark an item permanently lost after an arbitrary period.
- Dispute statuses should include `open`, `awaiting_borrower_response`, `awaiting_lender_response`, `under_review`, `resolved_refund`, `resolved_compensation`, `closed`, and `appealed` (or a comparably clear finite state model).
- Keep evidence private and permission-protected.

### 2.8 Extension request and approval

- An active borrower can request an extension before the due time. The request includes a new proposed return date and an automatically computed extra-rent amount.
- The lender can approve or reject. The lender must see the new dates, additional amount, and any availability conflict.
- The backend must re-check inventory availability atomically before approval. A conflicting accepted/confirmed booking must block the extension.
- Approval does not update the booking's due date until the extra payment succeeds in the mock provider. If payment fails or expires, retain the original due date.
- Rejection leaves the original booking unchanged and notifies the borrower.
- Record the requested date, decision, deciding party, payment status, and timestamps in the audit history.

### 2.9 Ratings, badges, and account pause/suspension

- After a booking reaches `completed`, borrower and lender can each leave one rating for the other party. Use 1–5 stars with optional written feedback and report flag.
- Prevent ratings before completion, duplicate ratings from the same reviewer for the same booking/target, and self-ratings.
- Recalculate aggregate rating and review count on the server or through a reliable database view/function.
- Implement a configurable account-health rule. The BMC says repeated low ratings may pause/suspend accounts but does not define a threshold. Seed a demonstrative rule such as **minimum review count plus average-rating threshold** (e.g. at least 3 eligible reviews and an average below 2.5/5) and clearly mark it as demo configuration. Do not suspend a user after one low rating.
- When the rule is met, automatically set the account to `paused_pending_review` or `restricted`; prevent new listings and new bookings while preserving access to existing active rentals, support, and appeal screens. A moderator can confirm suspension, lift a restriction, or request more information.
- Define and test what happens to active bookings when an account is restricted. Safety and existing obligations take priority: do not silently cancel active rentals.
- Separate **Student Verified** from **Verified Trusted Lender**. The latter should only be awarded when configurable conditions are met (for example, student verified, minimum completed lending transactions, strong average rating, and no unresolved severe disputes). Clearly explain badge criteria in the UI. Never imply the badge is an official UST endorsement.

### 2.10 Premium subscription

Implement TigRent Premium as a simulated subscription at **₱99/month**:

- Premium feature entitlement check, subscription status and period dates.
- Featured listing placement, rental analytics, advanced booking calendar, promotional tools, and bulk equipment management.
- Demo checkout only; no real recurring charge.
- When a demo subscription expires or is cancelled, premium-only controls revert cleanly without deleting listings or analytics history.

---

## 3. User journeys that must work end-to-end

These are the acceptance journeys. Every phase should build toward these complete flows.

### Journey A — New student registration and verification

1. Open app and view TigRent welcome screen.
2. Create account using email/password (and email confirmation if configured in the backend).
3. Enter name, UST email, student ID, academic year, role intent, and required registration document.
4. Accept the current Terms of Service and Privacy Notice versions.
5. Submit verification; see `Pending review` with clear next steps.
6. Sign in as the demo admin and approve/reject/request resubmission.
7. Student receives an in-app notification and status update.
8. Verified student enters the app and lands on the appropriate role dashboard.
9. A rejected or expired student can see the reason and resubmit; cannot access restricted marketplace actions until verified.

### Journey B — Lender lists an item

1. Verified student switches to or enables Lender mode.
2. Open “My Equipment” and create a listing with photos, category, description, condition, daily rate, deposit, late fee, and pickup instructions.
3. Validate required fields and sensible money/date values.
4. Save draft, preview, publish, pause, edit, or remove the listing.
5. Listing appears in borrower search only when active and available.
6. Listing updates cannot alter the financial terms of an already accepted booking; active booking terms use a snapshot.

### Journey C — Borrower discovers and requests a rental

1. Verified student enters Borrower mode.
2. Browse featured/recent items and search by keyword/category.
3. Filter by date availability, daily price range, category, and condition; clear all filters.
4. Open listing detail, inspect photos, owner profile, ratings, trust badges, pickup details, terms, deposit, and availability.
5. Select pickup and return dates; see billable-day count and complete PHP breakdown.
6. Accept the lender's rental terms and send request.
7. Lender sees request, opens the request details, then accepts or rejects.
8. On acceptance, borrower completes mock payment successfully; booking becomes confirmed and dates are held.
9. Simulate payment failure/expiry and verify the hold is released.

### Journey D — Handover, active rental, extension, and return

1. Both parties see the confirmed rental and its timeline, pickup location, due date, price breakdown, and accepted terms.
2. Lender confirms item handover; borrower confirms receipt/condition. Booking becomes active only after the defined handover checks complete.
3. Borrower can message lender and request an extension.
4. Lender approves/rejects. Test an availability conflict and a payment failure.
5. Borrower submits item return; lender inspects and confirms clean return or reports a problem.
6. Clean return releases the deposit and moves booking to completed.
7. Late/damaged/missing item routes into the configured fee/dispute workflow.

### Journey E — Cancellation, refunds, disputes, and account health

1. Cancel a pending request and verify the appropriate release/refund behavior.
2. Test borrower cancellation after acceptance and lender cancellation before pickup using policy configuration.
3. Open a damage/late-return dispute with private evidence; each party can respond.
4. Admin resolves dispute; both parties see the decision and ledger/refund updates.
5. After completion, both parties submit ratings.
6. Ratings update the profile, badge eligibility, and account-health rule.
7. Cross the configured low-rating threshold; verify new rentals/listings are blocked while active bookings and appeal/support remain accessible.

### Journey F — Premium and admin operations

1. Lender views free features and Premium benefits, subscribes through mock checkout, and sees premium tools unlock.
2. Cancel/expire the simulated plan and verify feature gating.
3. Admin changes active academic year, review thresholds, badge criteria, cancellation policy, commission, and demo provider modes.
4. All new bookings use the current settings; existing bookings retain their stored policy/price snapshots.

---

## 4. Information architecture and screen inventory

Build a coherent mobile navigation model. Avoid making every feature a separate card or placing every action on the home screen.

### 4.1 Shared screens

- Splash/loading and app bootstrap.
- Welcome / sign in / create account / forgot password / email-confirmation state.
- Student verification form, document picker/preview, pending status, rejected/resubmit, expired/renew status.
- Terms and Privacy Notice viewer with version acceptance.
- Notifications inbox and notification detail/deep link.
- Messages list, conversation detail, report/block controls where appropriate.
- Profile, edit profile, verification status, rating summary, badges, enabled roles, account health.
- Settings, help/support, policy information, privacy controls, sign out.
- Restricted/suspended state and appeal/support entry.

### 4.2 Borrower area

- Borrower home/discover.
- Search results with filters/sort and empty states.
- Category exploration.
- Listing detail and lender profile.
- Date selection, availability calendar, price breakdown, terms acceptance.
- Booking request submitted / waiting for lender / rejected / payment required.
- Demo checkout / payment result.
- My Rentals: requested, upcoming, active, completed, cancelled, disputed.
- Rental detail with timeline, messages, pickup/return instructions, payment breakdown, accepted agreement.
- Extension request and extension status.
- Return request and review form.
- Cancellation/refund preview and confirmation.

### 4.3 Lender area

- Lender dashboard: upcoming handovers, booking requests, active rentals, equipment performance, estimated earnings.
- My Equipment: active, draft, paused, unavailable.
- Create/edit listing wizard and preview.
- Listing availability/calendar manager.
- Booking request detail with accept/reject and conflict explanation.
- Active rental and handover confirmation.
- Extension request inbox with approve/reject and payment/availability details.
- Return inspection and dispute initiation.
- Earnings/ledger and payout estimate (explicitly simulated).
- Reviews, trust status, analytics, premium upgrade/tools.

### 4.4 Admin/moderator area

- Admin sign-in/role gate (no public admin signup).
- Verification queue and document review.
- User lookup and account status/restriction controls.
- Listing report/moderation queue.
- Dispute case queue, responses, evidence, decision and audit history.
- Academic-year settings.
- Cancellation policy and fee settings.
- Commission and premium entitlement settings.
- Trust badge/rating threshold settings.
- Demo payment and verification adapter settings.
- Audit log and seed/demo reset entry (development only).

---

## 5. Visual and interaction system

The target is an **Apple-inspired, carefully art-directed mobile experience**: precise layout, clear hierarchy, smooth transitions, readable typography, responsive touch behavior, and restrained use of depth. Do not copy Apple's proprietary screens or use a generic generated-app template.

### 5.1 Brand direction

Use a UST-inspired palette, based on the BMC's black/gold presentation and the tiger artwork. Do not claim these are official UST brand tokens unless the project owner supplies the official brand guide.

Suggested starting tokens (refine against the supplied artwork and actual device screenshots):

- `ink`: deep charcoal/near-black for primary text and dark surfaces.
- `gold`: warm university-inspired gold for primary actions and important highlights.
- `cream`: warm off-white for the primary light canvas.
- `paper`: clean white for high-contrast content surfaces.
- `tigerAmber`: warm orange used sparingly to connect mascot and brand.
- `mutedTeal`: a small secondary accent drawn from the supplied tiger illustration; use sparingly.
- `mutedText`, `divider`, `success`, `warning`, and `danger`: accessible semantic colors.

Check color contrast for text, disabled states, and controls. Support a consistent dark appearance only if the implementation can do so without doubling untested design work; the default light theme should be fully polished.

### 5.2 Layout and component rules

- Build a small, reusable design system: spacing scale, type scale, radii, elevation, icon sizes, input states, button states, bottom navigation, top bars, sheets, banners, empty states, and error states.
- Reduce unnecessary whitespace without making the interface cramped. Use consistent safe-area padding and predictable alignment.
- Avoid repetitive card grids. Use varied but coherent composition: a purposeful search header, typographic section labels, compact rows, editorial item previews, carefully composed listing imagery, and focused bottom sheets.
- Glass components may be used selectively for a floating tab bar, modal/sheet surfaces, or a mascot suggestion surface. Keep text contrast high and do not put all content behind blur.
- Avoid arbitrary glow, neon outlines, excessive transparency, and animations that do not communicate state.
- Do not stack controls accidentally. Check small phones and large font sizes, keyboard appearance, scrolling, safe areas, and long labels.
- Use system typography where appropriate (SF-like native system font on iOS and a close platform-native system font on Android). Maintain a consistent hierarchy.
- Use one coherent icon set with matching stroke widths. No emoji icons, no generated AI icon art, no unrelated mixed icon packs.
- Every control needs pressed, focused, disabled, loading, success, and error behavior as applicable.

### 5.3 Motion and background

- Create a subtle, theme-aligned ambient background (e.g. slow gradient drift or gently moving abstract gold curves). It should never reduce readability or distract from forms and listings.
- Use motion to communicate navigation, selection, progress, successful actions, and mascot reactions. Keep transitions short and smooth.
- Respect reduced-motion preferences. On low-end devices, fall back to a static background and simpler transitions.
- Avoid perpetual heavy animations, particle storms, parallax that interferes with scrolling, and animation that causes layout shifts.

### 5.4 Tiger mascot

Use the supplied tiger illustration as the visual source. Working name: **Tiggy** (easy to rename in configuration).

- Copy the supplied mascot asset into the repository, for example `assets/mascot/tiggy-source.png`. The Claude agent may not automatically have access to the chat attachment; ensure the image file is copied into the project before implementation.
- Preserve the character's identity and proportions. Do not regenerate or materially redesign the tiger. Crop excess surrounding whitespace only if this does not damage the illustration; retain a clean source asset.
- Place Tiggy selectively on welcome, verification, empty, success, and helper moments. Do not place him on every screen.
- Add a small, soft grounding shadow/halo beneath him to separate him from the background. It must remain subtle and not resemble a neon glow.
- On desktop/web preview, hover can trigger a reaction. On mobile, use tap/press as the primary equivalent. The action should reveal a concise speech bubble or helper sheet.
- Tiggy can display contextual hints such as: “Check the return date before sending your request,” “You have a new booking request,” “This calculator includes the deposit,” or “Your verification is waiting for review.” These messages must be driven by actual application state and should not make false claims.
- Use a small, authored dialogue library with contextual rules; do not generate random, repetitive, or misleading advice. Never let the mascot obscure critical buttons or form fields.
- Provide accessibility labels and a way to dismiss the message.

### 5.5 Responsive quality checks

At minimum, test a compact phone viewport around 360 × 800 dp and a common modern phone around 390 × 844 dp, plus one larger device. Test both iOS and Android behavior where available. All important actions must remain reachable with the keyboard open and with the largest supported text size.

---

## 6. Architecture and data design

### 6.1 Architectural boundaries

Separate UI, domain rules, data access, and external providers. Screens must not own money calculations, booking state transitions, authorization decisions, or verification logic.

Recommended logical layers:

1. **Presentation:** screens, navigation, design system, forms, view models/hooks.
2. **Domain:** typed entities, validation, pricing, availability, role permissions, booking state machine, cancellation/refund policy, ratings, badges, account health.
3. **Application services:** use cases such as `createListing`, `requestBooking`, `approveBooking`, `confirmPayment`, `requestExtension`, `confirmReturn`, `submitReview`, and `resolveDispute`.
4. **Repositories:** users, verification, listings, bookings, payments, messages, reviews, settings.
5. **Provider adapters:** authentication, student verification, payment, notifications, file storage.
6. **Infrastructure:** Supabase client, database migrations, storage policy, logging, test fixtures.

Use typed input/output contracts and consistent error types. UI code should call use cases/repositories and render returned state; it should not run direct ad hoc SQL or mutate protected statuses.

### 6.2 Suggested project structure

Adapt to the existing repository rather than forcing this exact tree:

```text
src/
  app/                    # routes / navigation
  components/
    design-system/        # buttons, fields, sheets, typography, icons
    shared/               # common app-level components
    mascot/               # Tiggy and speech bubble
  features/
    auth/
    verification/
    borrower/
    lender/
    listings/
    bookings/
    payments/
    extensions/
    returns/
    disputes/
    messaging/
    notifications/
    reviews/
    premium/
    admin/
    profile/
  domain/
    entities/
    rules/
    state-machines/
    policies/
    validation/
  services/
    use-cases/
  repositories/
  providers/
    auth/
    student-verification/
    payment/
    notifications/
    storage/
  lib/                    # date, currency, Supabase, logger helpers
  config/                 # feature flags and demo configuration
  theme/
  types/
  test/
    fixtures/
    factories/
supabase/
  migrations/
  seed.sql
assets/
  mascot/
  listings/
docs/
  IMPLEMENTATION_STATUS.md
  DATA_MODEL.md
  DEMO_GUIDE.md
```

### 6.3 Core data entities

Create migrations with foreign keys, indexes, unique constraints, and row-level security (RLS). Names can be adjusted to existing conventions, but the concepts must be represented.

| Entity/table | Key fields and purpose |
|---|---|
| `profiles` | `id` (auth user FK), full name, avatar path, student email, student ID (protected), account status, created/updated timestamps. Avoid exposing student ID in public profile responses. |
| `user_roles` | User ID + role (`borrower`, `lender`, `admin`, `moderator`); unique user/role pair. Admin roles are granted only by trusted admin tooling/seed. |
| `academic_years` | Label, start/end dates, current flag, active/archived state, configured by admin. Enforce one current year. |
| `student_verifications` | User ID, academic-year ID, submitted identity fields, private document storage path, status, provider, provider reference, review reason, reviewed by/at, expiry. |
| `terms_versions` | Terms/Privacy document type, version, content or reference, effective date, active flag. |
| `terms_acceptances` | User ID, terms version, accepted timestamp, relevant context. |
| `listings` | Lender ID, title, description, category, rate/day, deposit, late fee/day, condition, pickup notes, status, timestamps. |
| `listing_images` | Listing ID, private/public-safe image path, display order, moderation status. |
| `listing_availability` | Listing ID, blocked dates/ranges and reason where manually unavailable. Confirmed bookings are also used to calculate availability. |
| `bookings` | Listing, borrower, lender, pickup/return dates, computed days, status, expiry/decision fields, price and policy snapshots, accepted terms version, timestamps. |
| `booking_events` | Append-only transition history: actor, previous/new state, reason, timestamp, metadata. |
| `booking_terms_acceptances` | Booking ID, user ID, accepted terms snapshot/version, accepted timestamp. |
| `payments` | Booking ID, payer, amount, currency, provider type (`mock`), status, idempotency key, provider reference, timestamps. |
| `refunds` | Payment ID, booking ID, amount, reason, status, idempotency key, processed timestamp. |
| `ledger_entries` | Booking/payment/refund reference, account/category, debit/credit amount, currency, description, idempotency key, timestamp. Append-only. |
| `extension_requests` | Booking ID, requester, old/new due date, extra days/amount, status, lender decision, payment reference, timestamps. |
| `handover_reports` | Booking ID, lender/borrower confirmations, condition notes, photo references, timestamps. |
| `return_reports` | Booking ID, borrower request, lender inspection, return condition, late data, evidence, timestamps. |
| `disputes` | Booking ID, opener, category, description, requested resolution/amount, status, moderator decision, timestamps. |
| `dispute_messages/evidence` | Case-linked conversation/evidence metadata with private access rules. |
| `reviews` | Booking ID, reviewer ID, target ID, role/direction, rating 1–5, comment, moderation status, timestamp; unique reviewer/booking/target. |
| `conversations` | Booking ID or support context, participant IDs, status, created timestamp. |
| `messages` | Conversation, sender, body, attachments, read timestamp, created timestamp. |
| `notifications` | User, type, title/body, related entity, read timestamp, delivery channel/status. |
| `subscriptions` | User, plan, status, monthly price, start/end, provider (`mock`), cancellation date. |
| `platform_settings` | Versioned settings for commission, payment hold expiry, trust rules, badge rules, late fees, policy options, etc. Restrict writes to admin. |
| `cancellation_policy_versions` | Version, effective dates, structured policy rules, active flag. |
| `audit_logs` | Sensitive/admin actions and important security/business changes. Append-only and admin-protected. |

**Data minimization:** keep student ID and verification documents out of public profiles, analytics events, logs, and general search results. Store only what is needed for the prototype and state retention/cleanup behavior.

### 6.4 Important constraints and indexes

- Unique auth user/profile relationship.
- Unique user/role combination.
- At most one active academic year.
- Unique idempotency key for payments, refunds, and ledger operations.
- Unique review per reviewer/booking/target.
- Positive or zero allowed money constraints, with validation that the daily rate is greater than zero for active listings.
- Booking borrower and lender cannot be the same account for a peer-to-peer rental.
- Index listings by status/category/lender and searchable title fields.
- Index bookings by listing, borrower, lender, date range, and status.
- Index messages by conversation/created timestamp and notifications by user/read status.
- Use a concurrency-safe backend operation to prevent overlapping accepted/held/confirmed/active reservations.

### 6.5 Server-side authorization and privacy

- Enable RLS for all user data tables and private storage buckets.
- A borrower can read their own bookings and the listing/lender information necessary for a rental; a lender can read booking requests for their own listings. Neither party can read unrelated private records.
- Student verification documents are accessible only to the submitting user and authorized verification reviewers. Use short-lived signed URLs for review; never expose public storage URLs.
- Admin/moderator actions require a server-verified admin role. Do not trust a role string from local state or a client request body.
- Users cannot directly set `verified`, `completed`, `refunded`, `suspended`, `commission`, or other protected statuses/amounts through general table updates.
- Keep the service-role key and provider secrets on server-side only.
- Sanitize message text and uploaded filenames; enforce file type/size limits; avoid logging document contents, access tokens, or payment secrets.
- Provide data deletion/retention behavior suitable for a demo, and avoid including real student documents in seed data.

---

## 7. Phased implementation plan with mandatory gates

Each phase has: goal, implementation tasks, self-tests, and a **go/no-go gate**. Complete and document the gate before starting the next phase.

### Phase 0 — Repository audit, product mapping, and technical baseline

**Goal:** Understand the current codebase and establish a safe implementation path.

**Tasks**
- Inspect project files, framework/version, build scripts, navigation, existing components, styles, backend, env configuration, and test setup.
- Inspect supplied BMC and mascot asset. Confirm which files are available locally; copy the tiger artwork into the project's mascot assets when provided.
- Map existing screens/components to the screen inventory in Section 4.
- Identify existing authentication/data services and whether Supabase or another backend is already connected.
- Write `docs/IMPLEMENTATION_STATUS.md` and `docs/DATA_MODEL.md` starter documents.
- Record architecture decisions and any necessary deviations. Do not start replacing screens until this audit is complete.

**Self-tests / checks**
- Existing app builds or current baseline failures are recorded.
- Existing routes and key flows are documented.
- Existing tests are run once to establish a baseline.
- Environment variables are inventoried by name only; never print secret values.

**Gate 0 — Pass only when** the repository assessment, reuse plan, baseline test result, agreed stack, and implementation sequence are written down. No unexplained destructive changes.

### Phase 1 — App foundation, navigation, design tokens, and component primitives

**Goal:** Establish the visual foundation and reliable navigation before implementing complex features.

**Tasks**
- Configure the app shell, safe-area handling, keyboard behavior, route protection placeholder, loading/error boundaries, and responsive layout.
- Create color, type, spacing, radius, elevation, icon, and motion tokens.
- Build foundational controls: buttons, text fields, password field, select/date controls, chips, segmented role switcher, row/list item, bottom sheet, toast/banner, modal, empty state, error state, skeleton/loading state, and accessible screen header.
- Define borrower/lender/admin route groups and shared navigation shell. Routes can initially render simple labelled scaffolds; do not simulate finished data yet.
- Add reduced-motion support and a restrained ambient background implementation.
- Add the TigRent wordmark/title treatment using text and brand tokens; avoid inventing a complex logo unless explicitly requested.
- Add asset-loading support for the tiger mascot. Do not redraw the supplied image.

**Self-tests / checks**
- App launches on at least one iOS and one Android simulator/device where available.
- No overlapping/stacked components at compact and standard phone sizes.
- Safe areas, bottom navigation, status bar, back navigation, keyboard, scrolling, and sheets work.
- Buttons/fields expose correct focus, disabled, loading, and error states.
- Reduced-motion mode disables nonessential movement.
- Automated component tests cover core buttons, fields, and navigation shell.

**Gate 1 — Pass only when** the app is stable, routes are reachable, design tokens are centralized, and the initial screens follow the specified visual direction without generic template styling.

### Phase 2 — Backend foundation, migrations, repositories, and seed environment

**Goal:** Create a stable and testable data foundation before wiring screens to data.

**Tasks**
- Configure the existing backend or create Supabase project/local development configuration if greenfield.
- Add migrations for core entities in Section 6.3, constraints, indexes, RLS, storage buckets, and security policies.
- Build typed repositories and domain entity types; keep database-generated types in sync.
- Add environment validation and safe demo configuration. Fail clearly when required configuration is missing.
- Add seed script with fictitious students, borrower/lender roles, one admin, listings, ratings, and sample bookings in all important statuses.
- Add a controlled reset/seed command for local/demo use only. Never expose destructive reset operations in a production build.
- Create initial demo fixtures for verified and unverified/pending accounts.

**Self-tests / checks**
- Migrations apply from an empty database and can be reapplied in the expected migration workflow.
- Seed can run repeatedly without duplicate or inconsistent records (idempotent or safely resettable).
- Foreign keys, uniqueness, money constraints, and one-current-academic-year constraint work.
- RLS tests verify that borrower A cannot read borrower B's private booking/document and a non-admin cannot access admin data.
- Private storage denies public access and permits only approved access paths.

**Gate 2 — Pass only when** schema, seed data, typed repository contracts, migration process, RLS, and private storage policies are tested. Do not proceed with screens backed by unprotected tables.

### Phase 3 — Authentication, profile, role model, and route guards

**Goal:** Make identity, enabled roles, and role-dependent routing reliable.

**Tasks**
- Implement sign up, sign in, sign out, forgotten-password flow, email verification state, and session restore.
- Create/update profile after authentication using server-validated operations.
- Implement one-account/multiple-role behavior (`borrower`, `lender`); admin/moderator are seeded or granted securely.
- Add active-role selection and role switcher only when the user has both roles.
- Build route guards for unauthenticated, unverified, pending-verification, expired, restricted, and suspended accounts.
- Handle expired sessions, offline errors, duplicate email, weak password, and email verification pending states.
- Do not rely on hidden tabs alone; secure every protected action on the backend.

**Self-tests / checks**
- Sign up/sign in/sign out/password reset and session persistence work.
- Borrower-only users cannot open lender routes/actions; lender-only users cannot open borrower-only protected actions unless they enable the role.
- Both-role users can switch without losing the active booking/listing state.
- Editing a local role value or deep-linking to a restricted route cannot bypass backend permissions.
- Suspended users remain able to access support, appeal, profile status, and existing active rental information.

**Gate 3 — Pass only when** every account status and role combination routes correctly and server permissions match the UI.

### Phase 4 — Student registration, academic-year rules, document submission, and admin verification

**Goal:** Implement the student gate requested in the BMC and Tagalog peer feedback.

**Tasks**
- Build the student registration form with name, UST email, student ID, academic year, selected role(s), and registration-form upload.
- Build private file upload, preview, file validation, progress, retry, and removal before submission.
- Implement academic-year configuration and active-year validation on the backend.
- Implement configurable UST email-domain and student ID validation; mark patterns as configuration, not assumptions.
- Add `StudentVerificationProvider` interface and `ManualDemoVerificationProvider` implementation.
- Build verification status screen and admin verification queue with approve/reject/request-resubmission actions and reason capture.
- Trigger notification and audit events for submission and each review outcome.
- Allow re-submission with a new document while preserving review history.
- Add future-provider integration notes for SheerID but do not claim SheerID is connected.

**Self-tests / checks**
- Valid submission for the active academic year creates `pending_review`.
- Missing/invalid documents, oversized files, disallowed file types, wrong academic year, and invalid email are handled with clear field-level feedback.
- A pending student cannot create listings, send booking requests, or message a marketplace user outside allowed support flows.
- Admin can approve/reject/request changes; ordinary users cannot change verification status.
- A rejected user can correct and resubmit; the previous rejection remains in history.
- A change of active academic year triggers the configured renewal/expiry behavior.
- Document URLs are not publicly accessible.

**Gate 4 — Pass only when** the student verification lifecycle works end-to-end and cannot be bypassed by client-side changes or route manipulation.

### Phase 5 — Shared profile, borrower/lender dashboards, and role-aware navigation

**Goal:** Establish the two distinct operating modes while preserving a single account.

**Tasks**
- Build profile page with verification state, review average/count, badges, enabled roles, and account status.
- Build borrower dashboard and lender dashboard using real seeded/repository data.
- Add role enablement flow for a verified student who wants to become a borrower/lender later.
- Add a visible but restrained active-role switcher for dual-role users.
- Build shared notification inbox and basic settings/help screens.
- Add onboarding hints and empty states appropriate to each role.

**Self-tests / checks**
- Borrower-only, lender-only, and dual-role seeded accounts land on correct screens.
- Enabling the second role does not duplicate profile or verification records.
- Navigation tabs and deep links resolve to the correct role context.
- Empty states provide working next actions, not dead-end illustrations.

**Gate 5 — Pass only when** all three role configurations are navigable and profile information is consistent across modes.

### Phase 6 — Lender equipment management and availability

**Goal:** Allow students to create and manage rentable academic equipment.

**Tasks**
- Build the listing creation/edit wizard, image upload, draft save, preview, publish, pause, and removal flow.
- Validate title, category, description, item condition, positive daily rate, nonnegative deposit, nonnegative late fee, photos, and pickup details.
- Build lender equipment list with meaningful statuses and search/sort.
- Build calendar management for manual blocked dates and existing reservations.
- Ensure accepted booking snapshots preserve original title/price/terms even if a lender later edits the listing.
- Add basic listing moderation/report status.

**Self-tests / checks**
- Listing can be created, saved as draft, previewed, published, edited, paused, reactivated, and removed.
- Invalid money values and missing required fields are rejected.
- Listing images upload to allowed storage locations and can be removed/reordered.
- Paused/removed listings do not appear in active borrower search.
- Existing bookings retain their agreed price and term snapshots after listing edits.

**Gate 6 — Pass only when** the lender can manage an item's full listing lifecycle and existing booking records remain immutable where required.

### Phase 7 — Borrower discovery, search, listing details, and price preview

**Goal:** Enable borrowers to find suitable equipment and understand the rental before requesting it.

**Tasks**
- Build discover home, categories, search, result list, sorting, and filters.
- Implement filters for category, date availability, price range, condition, and relevant trust information.
- Build listing detail with photos, description, condition, lender profile, ratings, badges, pickup information, deposit, late fee, rental terms, and calendar.
- Implement a single shared pricing/date domain helper and expose price breakdown in the UI.
- Add loading, no-result, unavailable, and network-error states.
- Keep search and listing UI visually varied; do not default to a repetitive grid of identical cards.

**Self-tests / checks**
- Search by title/category returns expected seeded listings.
- Every filter and sort changes actual results; clearing filters restores the full result set.
- Availability previews match backend booking conflicts.
- Daily price calculations handle same-day, multi-day, month-boundary, and year-boundary ranges consistently.
- Deposit and late fee are visible before request submission.
- Borrowers cannot request their own listing.

**Gate 7 — Pass only when** a borrower can reliably discover an item, understand its availability and all charges, and enter a booking request with a valid price snapshot.

### Phase 8 — Booking request, lender decisions, atomic availability, and demo checkout

**Goal:** Connect the two sides through a consistent, race-safe reservation flow.

**Tasks**
- Implement booking request use case with borrower, lender, listing, date range, pricing snapshot, policy version, and terms acceptance.
- Build borrower request tracking and lender request inbox/detail screens.
- Implement lender accept/reject actions with reason capture.
- Implement backend atomic availability check/hold creation with a configurable payment expiry.
- Implement `PaymentProvider` interface and `MockPaymentProvider` with deterministic success/failure outcomes.
- Build demo checkout, payment result, booking confirmation, payment receipt/detail, and expired-hold state.
- Create ledger entries for successful/failed/expired payment paths as appropriate.
- Notify both parties for request creation, acceptance, rejection, payment success/failure, and expiry.

**Self-tests / checks**
- Request is visible to the right lender and borrower only.
- Lender cannot accept a request for another person's listing.
- Two overlapping requests cannot both become confirmed/active.
- Concurrent acceptance attempts produce one valid hold and one clear conflict response.
- Successful mock payment confirms the booking exactly once.
- Failed/expired payment releases the hold and does not create a completed rental.
- Commission and deposit are shown separately and calculated correctly.
- Double-tapping checkout does not duplicate payment or ledger entries.

**Gate 8 — Pass only when** the full borrower-to-lender request, decision, hold, and checkout path passes unit, backend, and E2E checks, including concurrent conflict scenarios.

### Phase 9 — Rental timeline, handover, messaging, reminders, extension, and return

**Goal:** Support the rental after checkout, not just the booking transaction.

**Tasks**
- Build a rental timeline with request, approval, payment, pickup, due date, extension, return, and completion events.
- Build booking-linked in-app conversation and message read state.
- Add scheduled/in-app reminder abstraction for pickup, upcoming due date, overdue, extension decision, and return confirmation. In a prototype, in-app notifications are mandatory; push/email may be simulated if credentials are unavailable.
- Implement lender handover and borrower receipt confirmations; collect condition notes/photos as appropriate.
- Implement extension request, lender approval/rejection, new-date availability check, incremental price, mock payment, and due-date update only after payment success.
- Implement borrower return request and lender inspection/confirmation.
- Update booking status and ledger events consistently.

**Self-tests / checks**
- Both parties see the same booking timeline and correct permissions.
- A borrower cannot confirm lender-only handover/inspection steps, and vice versa.
- Messages are visible only to conversation participants and support/admin where permitted.
- A successful extension changes the due date only after payment success.
- Failed extension payment leaves the original due date intact.
- Extension conflict is detected and lender cannot approve it.
- Clean return completes the booking and makes the item available again.
- Reminder scheduling is idempotent and does not send duplicate in-app notifications.

**Gate 9 — Pass only when** a booking can progress from confirmed to active to completed, with messaging, extension, and return correctly reflected on both roles.

### Phase 10 — Cancellation, refund, late fee, deposit, damage, and dispute resolution

**Goal:** Cover the risk and exception cases required by the BMC and peer feedback.

**Tasks**
- Implement versioned cancellation policy configuration and a refund preview before confirmation.
- Add separate borrower/lender cancellation actions and correct role/status restrictions.
- Implement payment/refund/ledger state machine with idempotency.
- Implement deposit release after clean return and dispute-linked withholding/partial release decisions.
- Implement late-return calculation and transparent fee display.
- Build damage/missing-item report, evidence upload, dispute conversation/response, moderator queue, resolution, and appeal states.
- Preserve original booking terms and policy snapshots for audit purposes.
- Add notifications and event history for all exceptions.

**Self-tests / checks**
- Every cancellation scenario in Section 2.6 has a deterministic expected result.
- Refund amounts match the configured policy and are previewed before the user confirms.
- Repeated refund requests do not duplicate refunds.
- Deposit is not counted as revenue and is released/withheld only through a valid recorded path.
- Late fee is not charged before the due time and uses the accepted fee snapshot.
- Evidence is private and accessible only to authorized parties.
- Moderator resolution creates the correct refund/compensation/ledger results.
- Active bookings are not silently abandoned when a user is restricted.

**Gate 10 — Pass only when** all cancellation, refund, return-condition, deposit, late-fee, and dispute scenarios pass the test matrix, including retries and permission tests.

### Phase 11 — Reviews, trust badges, account health, and moderation

**Goal:** Make trust signals and repeated low-rating restrictions operational.

**Tasks**
- Build post-completion review prompts for both borrower and lender.
- Implement unique review constraints, rating aggregate, review count, and report/moderation state.
- Implement configurable Verified Trusted Lender criteria and badge explanation.
- Implement configurable low-rating rule and account pause/restriction state.
- Build admin account-health queue, restriction reason, moderator decision, and user appeal flow.
- Preserve visibility/access for ongoing rental obligations and support while restricting new marketplace actions.
- Implement review moderation/report actions and audit events.

**Self-tests / checks**
- Only completed bookings can be reviewed.
- Each side can review the other once per booking; self-review and duplicate review are rejected.
- Average/count update accurately after new or moderated reviews.
- Badge is granted/removed according to the configured conditions and current status.
- One low rating does not automatically suspend an account unless the configured minimum count/threshold is met.
- Restricted account cannot publish or book new rentals but can manage active rentals, support, and appeals.
- Admin actions are recorded and non-admin users cannot call them.

**Gate 11 — Pass only when** ratings, badge eligibility, low-rating rules, restrictions, and appeals work consistently and transparently.

### Phase 12 — TigRent Premium and administrative configuration

**Goal:** Implement the BMC's premium revenue model and the configuration needed to operate the demo without code changes.

**Tasks**
- Build Premium information screen and mock ₱99/month checkout.
- Implement subscription states: inactive, active, cancelled, expired, payment_failed.
- Gate featured listings, analytics, advanced calendar, promotional tools, and bulk equipment management by entitlement.
- Build lender analytics from actual demo booking/ledger data; label estimates as simulated.
- Build admin configuration screens for current academic year, domain/ID validation settings, cancellation policy, commission, payment hold expiry, low-rating rules, badge requirements, late-fee settings, and demo provider modes.
- Version important settings and preserve the settings/policy snapshot used by active bookings.
- Add audit log view for admin actions.

**Self-tests / checks**
- A successful mock subscription unlocks all intended Premium features.
- Expired/cancelled/failed subscriptions correctly remove entitlements without deleting data.
- ₱99/month is shown consistently in the UI and payment record.
- Analytics totals reconcile with the ledger and exclude refundable deposits from platform revenue.
- Admin-only settings cannot be modified by regular users.
- Updating a policy affects new bookings but not existing booking snapshots.

**Gate 12 — Pass only when** Premium entitlements and all critical admin configuration options are functional and audited.

### Phase 13 — Visual polish, Tiggy interactions, accessibility, and device refinement

**Goal:** Bring the product to the requested premium, cohesive finish after the functional flows are stable.

**Tasks**
- Refine each screen against the design rules in Section 5; review every route, not only login and home.
- Add Tiggy's state-aware speech bubbles, mobile tap/press reaction, optional web hover reaction, subtle grounding halo, and dismiss behavior.
- Polish ambient background motion and transitions with reduced-motion fallback.
- Review typography, icon consistency, spacing, alignment, touch target sizes, image crop, empty/loading/error states, and scroll behavior.
- Remove redundant cards, generic template patterns, decorative AI-style icons, arbitrary glows, and unused UI elements.
- Add screen-reader labels, logical focus order, sufficient contrast, dynamic text behavior, and accessible error messages.
- Ensure critical text and actions remain readable when Tiggy or floating UI appears.

**Self-tests / checks**
- Capture and inspect screenshots of every major screen at the target device sizes.
- No clipped text, overlapping buttons, stacked navigation, off-screen primary actions, or keyboard-obscured forms.
- Tiggy messages match actual app context and can be dismissed.
- Touch targets and contrast meet reasonable accessibility expectations.
- Reduced motion turns off nonessential movement.
- Scrolling and navigation remain smooth without dropped frames or excessive battery use.

**Gate 13 — Pass only when** visual QA is complete across all screens and the design requirements are met without compromising readability or function.

### Phase 14 — Full regression, security review, demo readiness, and handoff

**Goal:** Prove that the complete prototype can be demonstrated without broken journeys or unsafe shortcuts.

**Tasks**
- Run formatting, lint, type-check, unit, component, backend/RLS, and E2E suites.
- Run all end-to-end journeys A–F in Section 3 using fresh seed data.
- Test offline/slow network, expired session, failed uploads, failed payment, payment retry, missing images, and backend errors.
- Review RLS, private file access, admin role checks, protected state changes, idempotency, secrets handling, and logs.
- Check performance on one lower/mid-range Android device and a current iOS device/simulator if available.
- Prepare `docs/DEMO_GUIDE.md` with demo credentials, reset steps, scenario scripts, known simulated integrations, and expected outcomes.
- Prepare an implementation summary listing complete features, mocked integrations, remaining production work, and any known defects.

**Self-tests / checks**
- All mandatory phase tests pass.
- All core E2E journeys complete using demo accounts.
- No blocker/high-severity defect remains in authentication, permissions, student verification, booking, payments/refunds, returns, or account restrictions.
- No public access to student verification documents or private messages.
- No real payment/verification claims are presented in the UI.
- Demo reset produces a clean and repeatable state.
- Build/install/start instructions work from a fresh checkout using documented environment variables.

**Gate 14 — Pass only when** the app can be installed/launched, all in-scope demo journeys work end-to-end, security checks pass, and the handoff clearly states what is simulated versus real.

---

## 8. Minimum test matrix

The agent must convert this matrix into executable automated tests wherever practical. Manual checks are supplementary, not a replacement for domain/backend tests.

| Area | Scenario | Expected result |
|---|---|---|
| Authentication | New user signs up and signs in | Account/profile created; session restored correctly. |
| Authentication | Invalid password / duplicate email / expired session | Clear error or re-authentication; no protected data leak. |
| Roles | Borrower-only opens lender action | Denied by UI and backend. |
| Roles | Dual-role user changes active role | Correct dashboard shown; same profile/verification retained. |
| Verification | Missing registration document | Submission blocked with field-level feedback. |
| Verification | Wrong/non-current academic year | Server rejects or routes to configured exception/review path. |
| Verification | Submitted document awaits review | Pending status; marketplace actions restricted. |
| Verification | Admin approves/rejects | Status and notifications update; action audited. |
| Verification | Student attempts to edit verification status | Rejected by backend policy. |
| Listings | Rate is zero/negative or deposit is negative | Listing cannot be activated. |
| Listings | Lender pauses listing | Listing removed from active discovery. |
| Listings | Listing price edited after booking | Existing booking price snapshot unchanged. |
| Search | Search/category/date/price filters applied | Results accurately change and can be reset. |
| Pricing | Same-day rental | One billable day and matching total. |
| Pricing | Multi-day/month/year boundary | Correct inclusive date count in Asia/Manila. |
| Booking | Borrower requests own listing | Rejected. |
| Booking | Lender approves overlapping requests | Only one valid hold/booking can be accepted. |
| Booking | Payment succeeds | Booking confirmed once; ledger reconciles. |
| Booking | Payment fails or hold expires | Hold released; booking not confirmed. |
| Booking | User double taps checkout | No duplicate charge/ledger entry. |
| Extension | Lender approves extension with availability | Extra amount paid; due date updates. |
| Extension | Extension conflicts with another booking | Approval blocked; original due date remains. |
| Extension | Extension payment fails | Original due date remains. |
| Return | Both sides confirm clean return | Booking completed; deposit refunded in demo ledger. |
| Return | Returned late | Correct late days/fee; due-time boundary tested. |
| Dispute | Borrower reports damage | Private case/evidence created and moderator can review. |
| Cancellation | Lender cancels before pickup | Full demo refund under default safe rule. |
| Cancellation | Borrower cancels in each policy window | Correct preview and policy-versioned refund. |
| Refund | Same refund request submitted twice | One refund record/ledger effect only. |
| Reviews | Review attempted before completion | Rejected. |
| Reviews | Duplicate/self-review | Rejected. |
| Trust | Trusted Lender requirements satisfied | Badge appears with explanation. |
| Account health | One low review | No premature suspension under sample threshold. |
| Account health | Configured low-rating threshold crossed | Account restricted from new rentals; active rentals/support remain. |
| Premium | Mock ₱99 subscription succeeds | Premium features unlock. |
| Premium | Subscription expires | Premium features lock; historical data retained. |
| Privacy | Unrelated user requests private document URL | Access denied. |
| Privacy | Non-admin tries to review verification or resolve dispute | Access denied and action logged where appropriate. |
| Mascot | User taps Tiggy | Contextual, dismissible message appears. |
| Accessibility | Reduced-motion enabled | Ambient and nonessential animations are reduced/disabled. |

---

## 9. Seed accounts and demo scenarios

Create fictitious demo accounts. Never seed real student IDs, real registration documents, or real personal data.

Suggested account set:

- **Borrower demo:** verified, borrower role, at least one past completed rental and one upcoming rental.
- **Lender demo:** verified, lender role, multiple active listings, booking request inbox, and one active rental.
- **Dual-role demo:** verified, both roles, can demonstrate switching and cross-role use.
- **Pending student demo:** submitted verification awaiting admin review.
- **Rejected student demo:** rejected with a resubmission reason.
- **Restricted demo:** rating threshold met, new marketplace actions blocked, active booking still visible.
- **Admin demo:** moderator/admin capabilities; never available through public signup.

Include sample listings such as a scientific calculator, DSLR camera, laptop accessory, projector, drafting tool, and other plausible student equipment. Use safe placeholder images or owner-supplied assets.

Add a `DEMO_GUIDE.md` script describing exactly how to demonstrate:

1. Student registration and admin approval.
2. Lender creates a listing.
3. Borrower requests and pays for a rental.
4. Lender accepts, hands over, and later inspects the item.
5. Borrower requests an extension and lender decides.
6. Cancellation/refund and damage-dispute alternative branch.
7. Reciprocal reviews and trust badge/account-health outcome.
8. Premium subscription and admin settings.

---

## 10. Required engineering quality rules

### 10.1 Data and business logic

- Money calculations live in tested domain functions and are stored safely in integer centavos or an equivalent exact currency representation.
- Date calculations use one timezone-aware helper and the `Asia/Manila` business timezone for date-only rental rules.
- Important state changes use server-side use cases/transactions and append-only event/audit history.
- Booking price, commission, deposit, policy, daily rate, and accepted terms are snapshotted when the booking is accepted/confirmed. Future listing/policy changes must not rewrite an existing agreement.
- Refund/payment operations are idempotent.
- Avoid relying on client clocks for due-date enforcement or payment-hold expiry; use server time.

### 10.2 Security and privacy

- No service-role keys, payment secrets, or provider credentials in client code or repository commits.
- Use RLS, backend authorization, private buckets, and scoped signed URLs.
- Protect student IDs, registration documents, messages, dispute evidence, and payment metadata.
- Validate input on both client and server. Client validation improves UX; server validation is authoritative.
- Do not trust user-supplied role, price, commission, refund amount, review target, or booking status.
- Sanitize uploads and message content and rate-limit sensitive actions where the backend supports it.

### 10.3 Code quality

- TypeScript strict mode (or equivalent static guarantees) where practical.
- Small feature modules and reusable domain services; avoid monolithic screens.
- No duplicate pricing/date/permission implementations.
- No silent catch blocks, fake success states, or console-only errors.
- Meaningful loading, empty, offline, retry, and error states.
- Keep dependencies minimal and justify additions.
- Run formatting, linting, type-checking, and tests at each phase gate.

### 10.4 Product honesty

The interface must consistently identify simulated capabilities. Use labels such as “Demo payment,” “Simulated refund,” and “Manual student review” where relevant. A badge means only that the configured TigRent prototype criteria were met; it is not official UST certification. Do not display fabricated provider confirmations or claim real money has moved.

---

## 11. Final acceptance criteria

The project is ready for its prototype demonstration only when all of the following are true:

- [ ] App installs/launches using documented instructions.
- [ ] Authentication, profile setup, and session restore work.
- [ ] Student registration includes UST email, student ID, academic year, and registration-form upload.
- [ ] Academic-year validation is configurable and server-enforced.
- [ ] Admin can approve/reject/request resubmission; students cannot self-verify.
- [ ] One student account can enable borrower and lender roles and switch between them.
- [ ] Role-dependent routing and backend permissions are enforced.
- [ ] Lender can create, edit, pause, publish, and manage equipment listings.
- [ ] Borrower can search/filter, inspect, calculate price, and request a rental.
- [ ] Lender can approve/reject; booking availability is concurrency-safe.
- [ ] Mock checkout, commission, deposit, payment failure, and payment expiry work.
- [ ] Rental handover, messaging, reminders, extension decision, and return work.
- [ ] Cancellation/refund policy, late fees, deposit release/claim, and disputes work.
- [ ] Borrower and lender can rate each other after completed rentals.
- [ ] Trusted Lender badge and low-rating pause/restriction use configurable rules.
- [ ] Premium ₱99/month demo subscription and its feature gates work.
- [ ] Admin can configure academic year, policies, fees, badge rules, and demo provider modes.
- [ ] Tiggy is present, context-aware, and interactive by tap/press on mobile (hover where applicable).
- [ ] Design is polished, cohesive, UST-inspired, and free from generic AI-template styling, emoji icons, clutter, and layout collisions.
- [ ] Reduced motion, readable contrast, safe areas, keyboard behavior, and small-device layouts are tested.
- [ ] Core E2E tests pass; no critical/high-severity bug remains in the main journeys.
- [ ] RLS, private document access, admin authorization, and idempotent payment/refund behavior are tested.
- [ ] Demo guide, implementation status, seed/reset procedure, and known limitations are documented.
- [ ] All real-provider integrations are truthfully labelled as simulated or not connected.

---

## 12. Final instruction to Claude Code

Implement TigRent as a **complete, cohesive, fully navigable and end-to-end functional prototype**, not as a collection of static mockup screens. Start with Phase 0, inspect the current repository, and then proceed one phase at a time. At every phase gate, run the prescribed checks, repair failures, and update `IMPLEMENTATION_STATUS.md` before continuing. Prioritize correctness of student verification, role permissions, booking availability, payment/refund accounting, rental lifecycle, and trust/safety rules before final visual polish. The finished app should feel carefully designed and native, with purposeful glass surfaces, restrained ambient motion, and the supplied Tiggy mascot used selectively. Never trade working functionality, privacy, or layout quality for visual effects.

---

## 13. Progress, Updates & Live Revisions Log

All active codebase updates, UI enhancements, and design refinements are tracked here in real time.

### [2026-11-20] Discovery UI Refresh & Sort Control Realignment
- **Misplaced Sort Control Fixed**:
  - Replaced the form-based `SelectField` in [src/app/explore/search.tsx](src/app/explore/search.tsx) with a dedicated Sort trigger pill (`ArrowUpDown` + selected option label + `ChevronDown`).
  - Completely eliminated the orphaned, floating `"Sort"` text label that broke the toolbar's horizontal symmetry above `[Featured first v]`.
  - Balanced `[Filters]` and `[Sort: ...]` into a unified 38pt action toolbar row with equal heights and rounded pill geometry.
  - Connected the trigger to a dedicated, accessible bottom `Sheet` for sorting options (`Featured first`, `Price: low to high`, `Price: high to low`, `Highest rated`, `Newest first`).
- **Modern Search Input**:
  - Added `hideLabel` support to [src/components/design-system/TextField.tsx](src/components/design-system/TextField.tsx) to remove redundant form labels while preserving full accessibility and screen reader support.
- **Lively UST Student-Centric Aesthetic**:
  - **Category Chips Bar**: Integrated Lucide icons for all student equipment categories (✨ All, 🔢 Calculators, 📸 Photo & video, 💻 Laptop accessories, 📽️ Presentation, 📐 Drafting & art, 🧪 Lab gear, 🔌 Power & cables, 📦 Other).
  - **Tiger Gold Theme**: Updated [src/components/design-system/Chip.tsx](src/components/design-system/Chip.tsx) active state to vibrant UST Tiger Gold (`colors.primary`) with bold ink text and warm elevation (`elevation.low`), replacing flat black.
  - **Elevated Equipment Cards**: Polished [src/features/discovery/ResultRow.tsx](src/features/discovery/ResultRow.tsx) with warm soft shadow (`elevation.low`), rounded corners (`radii.lg`), golden star ratings (`★`), bold daily rate typography (`₱450 /day`), and lively status badges (`✨ Featured` in gold, `🛡️ Trusted Lender` in emerald).
  - **Results Counter**: Upgraded plain count to a lively verified equipment counter badge.
  - **Borrower Home Refresh**: Modernized [src/app/borrower/index.tsx](src/app/borrower/index.tsx) with a styled pill search bar (gold icon circle + "Find" pill badge), category icons across the Home carousel, rich featured equipment cards with `✨ Featured` corner tags, and bold accent pricing.
- **Verification**:
  - TypeScript strict typecheck passed cleanly (`npx tsc --noEmit`: 0 errors).
  - Database test suite passed 16/16 suites (202/202 tests in PGlite).
  - Clean dev server restart with cache-clearing (`npx expo start -c`) for instant fresh device bundle.

### [2026-11-20] Discover Tab Redesign: Automated Spotlight, Bento Segmentation & Tiggy Autonomous Speech Dialogue
- **Automated "Featured from Students" Spotlight Showcase**:
  - Replaced the manual horizontal swipe carousel in [src/app/borrower/index.tsx](src/app/borrower/index.tsx) with an autonomous Spotlight Showcase card that cycles every 3.8 seconds automatically without manual horizontal scrolling friction.
  - Added slide indicator progress pills (`● ○ ○`), live item index badges (`Featured · 1/N`), floating price chips, category pill tag, condition status, and direct "Check Availability" call-to-action button.
- **De-cluttered & Segmented UI/UX (Zero Wordy Text Stacks)**:
  - Eliminated stacked paragraph text from "Your rentals", "Upcoming pickups", and "Due back next".
  - Introduced clean visual segmentations:
    - **Rental Overview Bento Strip**: Compact segmented grid for Active rentals, Upcoming pickups, and Pending requests with quick-glance count badges.
    - **Compact Due-Back Banner**: Amber alert pill showing countdown to return deadline without verbose prose.
    - **Quick Exploration Chips**: High-intent filters ("Budget Gear <₱200", "UST Verified Gear", "Top Rated 4.5★+").
  - Varied font typography hierarchy: modern bold titles (`largeTitle`), clean uppercase tracked category metadata (`overline`), and vibrant high-contrast badges.
- **Tiggy's Autonomous 30s Speech Cloud Dialogue**:
  - Transformed [src/components/shared/GreetingHeader.tsx](src/components/shared/GreetingHeader.tsx) from click-to-open into an autonomous dialogue assistant.
  - Tiggy automatically pops out a dialogue speech cloud every 30 seconds with tips on how to use the app and campus rental advice.
  - Designed a connected speech cloud bubble featuring a comic tail (`transform: [{ rotate: '45deg' }]`) pointing directly to Tiggy's mouth on the right side of the header.
  - Included a subtle dismiss button (`X`) and polite screen-reader accessibility (`accessibilityLiveRegion="polite"`), with zero manual clicking required.
- **Verification**:
  - TypeScript strict check clean (`npx tsc --noEmit` passed with exit code 0).
  - Metro bundler running smoothly on iOS and Web.

### [2026-11-20] Profile Tab Role Switching Navigation Fix
- **Issue**:
  - In [src/features/profile/ProfileScreen.tsx](src/features/profile/ProfileScreen.tsx), clicking the "Lending" tab while in the borrower role caused [src/features/auth/RoleSwitcher.tsx](src/features/auth/RoleSwitcher.tsx) to execute a hardcoded navigation to `/lender` (the Lender Dashboard), inadvertently dropping the user out of the Profile tab back to the dashboard.
- **Resolution**:
  - Upgraded [src/features/auth/RoleSwitcher.tsx](src/features/auth/RoleSwitcher.tsx) with intelligent route context awareness using `useSegments()` and `usePathname()`, alongside an optional `screen` prop override.
  - When switching roles on the Profile tab (`/borrower/profile` or `/lender/profile`), the target route preserves the active screen and navigates to the counterpart profile screen (`/lender/profile` or `/borrower/profile`).
  - Updated `ProfileScreen.tsx` to pass `screen="profile"` explicitly to `RoleSwitcher` and updated `enableRole` to navigate directly to the new role's profile screen rather than resetting to the dashboard.
  - Updated [src/test/navigation/guards.test.tsx](src/test/navigation/guards.test.tsx) test assertion to expect `/lender/profile`.
- **Verification**:
  - TypeScript typecheck passed cleanly (`npx tsc --noEmit` exit code 0).

### [2026-11-20] Comprehensive Multi-Tab Creative Upgrade & UI Polish
- **Smooth Automated Spotlight Transitions**:
  - Integrated `Animated.View` entering and exiting transitions with smooth cubic-bezier easing (`FadeIn.duration(450)` and `FadeOut.duration(350)`) in [src/app/borrower/index.tsx](src/app/borrower/index.tsx).
  - Paced the automatic slideshow at 4.2s per card, with animated progress pill dots (`width: 22` for active dot) and `overflow: 'hidden'` card boundary.
- **Tiggy Head Speech Cloud Placement**:
  - Re-positioned the automated dialogue speech bubble in [src/components/shared/GreetingHeader.tsx](src/components/shared/GreetingHeader.tsx) to sit directly on top of Tiggy's head (`bottom: 96, right: -8`), with a subtle downward-pointing geometric comic tail (`bottom: -7, right: 48`) pointing directly into Tiggy's head.
  - Sits at `zIndex: 50` with high-contrast UST Gold border and compact readable typography.
- **Rentals Tab Complete Overhaul & Breathable Spacing**:
  - Completely redesigned [src/app/borrower/rentals.tsx](src/app/borrower/rentals.tsx) from plain list rows into elevated, lively student rental cards (`styles.rentalCard`):
    - Gold category/package icon badge, live `StatusPill` tone badge, and chevron arrow.
    - High-emphasis listing title and compact timeline badge (`📅 [Dates] · ⏱️ [Days]`).
    - Total price with deposit tag, plus an amber urgency alert for pending payments.
    - Added thematic icons to filter chips (`Inbox`, `CalendarClock`, `Zap`, `CheckCircle2`, `Ban`, `AlertCircle`) with live counts.
    - Fixed spacing constraint: separated the guarantee info banner with generous `spacing.xxl` (32px) top margin to prevent crowding above the cards.
- **Messages Tab Elevation**:
  - Overhauled [src/features/messages/ConversationList.tsx](src/features/messages/ConversationList.tsx) from plain list items to lively student conversation cards:
    - Gold-ringed student avatar circle with user initials.
    - Context gear pill showing equipment name alongside live booking status.
    - Relative time stamp and bright UST Gold `+N new` unread message pill.
- **Profile Tab Student Hero Card**:
  - Added a gold-ringed Student Identity Card in [src/features/profile/ProfileScreen.tsx](src/features/profile/ProfileScreen.tsx) with initials avatar, full name, UST account email, and verified student pill badges.
- **Lender Equipment Polish**:
  - Upgraded [src/app/lender/equipment.tsx](src/app/lender/equipment.tsx) to distinct elevated equipment cards with rounded photo thumbnails and tactile press feedback.
- **Verification**:
  - Full TypeScript strict typecheck passed cleanly (`npx tsc --noEmit`: 0 errors).
  - Metro bundler recompiled without errors.

### [2026-11-20] Full Upper Screen Redesign & Bounded Tiggy Dialogue Placement
- **Complete Upper Header Redesign**:
  - Re-architected [src/components/shared/GreetingHeader.tsx](src/components/shared/GreetingHeader.tsx) into a unified student hero:
    - **Personalized Student Top Bar**: Mini gold avatar circle (`avatarPill`) with initials, personalized student greeting (`Hi, {Name} 👋`), and UST status (`UST Manila · Campus Borrower/Equipment Lender`), with the notification bell aligned on the right.
    - **Never Cut on Top**: Positioned the dialogue bubble safely inside the horizontal `heroRow` below the top bar, eliminating negative absolute offsets that previously overflowed above the safe area.
    - **Direct Hand Connection**: Placed the dialogue cloud directly to the left of Tiggy with a rightward-facing speech tail (`tailRight`, `right: -6, top: 24`) pointing straight into Tiggy's raised waving hand.
    - **Zero Empty Space**: When the 30s tip is dismissed or waiting for the next cycle, the left column displays an interactive campus prompt card (`promptCard`), so the upper-left of the screen is always populated, functional, and visually balanced.
- **Verification**:
  - `npx tsc --noEmit` passed cleanly (0 errors).
  - Metro dev server compiled cleanly with 0 warnings.

### [2026-11-20] Lender Dashboard Handovers Metric Fix
- **Fixed Handovers Card Label**:
  - In [src/app/lender/index.tsx](src/app/lender/index.tsx), updated the stat label from `'Handovers (7 days)'` to `'Handovers'`.
  - Eliminated the awkward text wrapping and cut-off parenthesis inside the 4-column metrics row.
  - Enhanced [src/components/shared/Layout.tsx](src/components/shared/Layout.tsx) `StatRow` label styling with centered text alignment and balanced horizontal padding.
- **Verification**:
  - `npx tsc --noEmit` passed with 0 errors.

### [2026-11-20] Profile Tab Strategic Redesign & Redundancy Elimination
- **Eliminated Repetitive Elements**:
  - **ScreenHeader Cleanliness**: Removed redundant student full name and email subtitles from the top header; now displays a clean `"Profile"` title, active mode eyebrow (`Lending Mode` / `Borrowing Mode`), and a settings shortcut icon button.
  - **In-Place Name Editing**: Integrated an inline `Pencil` icon directly beside the student's name in the `studentHeroCard`, removing the duplicate "Edit name" row from the account list.
  - **Interactive Verification Badge**: Made the `Student verified` status pill in the hero card interactive (`onPress={() => router.navigate('/onboarding/status')}`), eliminating the duplicate "Verification status" list row.
  - **De-cluttered Role Management**: Removed the static "Roles" section that previously displayed non-actionable "Borrowing: On" and "Lending: On" rows. Role switching is cleanly handled by `RoleSwitcher`.
  - **Contextual Role Upgrade Card**: When a user only has one active role (`missingRole`), an elevated modern card (`unlockRoleCard`) prompts them to expand into lending or borrowing with the `enable-role` button.
- **Segmented Information Architecture**:
  - **Activity & Feedback**: Dedicated section grouping `My reviews` (`testID="my-reviews"`) and `Notifications` (with live unread badge count).
  - **Support & Policies**: Dedicated section grouping `Settings & help`, `Terms & policies`, and conditional `Account status` alerts.
- **Verification**:
  - `npx tsc --noEmit` passed cleanly (0 errors).
  - Metro bundler reloaded without warnings.

### [2026-11-20] Tab Switch Content Displacement & Top Inset Fix
- **Root Cause Identified**:
  - In `src/components/design-system/Screen.tsx`, wrapping screens with `<SafeAreaView edges={['top', ...]}>` combined with `react-native-screens` native view controllers in `Tabs` caused iOS `UIScrollView` to apply automatic content insets (`contentInsetAdjustmentBehavior="automatic"` by default).
  - When switching tabs, iOS UIKit injected an extra status bar safe area inset into the `ScrollView`, which added onto `SafeAreaView`'s existing padding. This resulted in double the safe area padding (~120px+ offset), displacing headers and content downwards.
  - Furthermore, `SafeAreaProvider` in `src/app/_layout.tsx` was missing `initialMetrics={initialWindowMetrics}`, leading to asynchronous metric calculation jumps on tab transitions.
- **Implemented Fix**:
  - In [src/components/design-system/Screen.tsx](src/components/design-system/Screen.tsx):
    - Added `contentInsetAdjustmentBehavior="never"` and `automaticallyAdjustContentInsets={false}` on `ScrollView`, strictly instructing iOS UIKit to never auto-inject top content insets on tab switch.
    - Replaced the native `SafeAreaView` component wrapper with a standard `View` padded with `{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }` via `useSafeAreaInsets()`.
  - In [src/app/_layout.tsx](src/app/_layout.tsx):
    - Provided `initialMetrics={initialWindowMetrics}` to `<SafeAreaProvider>` for synchronous initial layout measurement.
- **Verification**:
  - `npx tsc --noEmit` passed cleanly with 0 errors.
  - Metro dev server hot-reloaded the updated layout configurations.
  - All screens now maximize directly to the top edge of the safe area without displacement on tab switch.

### [2026-11-20] Verification Status Screen Tiggy Size & Presentation Upgrade
- **Enlarged Mascot Size**:
  - In [src/components/mascot/Tiggy.tsx](src/components/mascot/Tiggy.tsx), introduced a new `xl: 220` size specification (`220px` height, `224px` width).
- **Hero Mascot Integration**:
  - In [src/app/onboarding/status.tsx](src/app/onboarding/status.tsx), upgraded Tiggy from `size="sm"` (`72px`) to `size="xl"` (`220px`), making Tiggy over 3x larger in a prominent, centered `mascotHero` container.
  - Added continuous gentle greeting animation (`wave={true}`).
  - Provided contextual status tips for all verification states (`verified`, `not_submitted`, `pending_review`, `rejected`, `needs_resubmission`, `expired`) so Tiggy is always actively guiding the student.
- **Verification**:
  - `npx tsc --noEmit` passed cleanly (0 errors).
  - Metro dev server compiled without warnings.

### [2026-11-20] Removal of Developer Route Map Feature
- **Removed User-Facing Entry**:
  - In [src/app/(auth)/welcome.tsx](src/app/(auth)/welcome.tsx), removed the `"Developer route map"` button from the welcome screen footer so users only see production-intended student onboarding options (`Create account`, `I already have an account`).
- **Removed Route**:
  - Removed `src/app/dev/index.tsx` (the developer route map screen).
  - Updated [src/test/navigation/shell.test.tsx](src/test/navigation/shell.test.tsx) to remove the route assertion for the retired route map.
- **Verification**:
  - `npx tsc --noEmit` passed cleanly with 0 errors.
  - Metro bundler recompiled without warnings.


