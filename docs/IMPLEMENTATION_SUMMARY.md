# TigRent implementation summary

Status: functional prototype complete through Phase 14 automated/live validation. Owner device and normal-terminal checks remain before a final demonstration handoff.

## What is implemented

- Verified-student onboarding, terms acceptance, manual sample verification and role-aware routing.
- Listings, private photos, discovery, server-priced booking requests, holds, simulated checkout, ledger entries, refunds, handovers, extensions, returns and receipts.
- Private booking chat, cancellation previews, late fees, disputes, evidence, moderator decisions and appeals.
- Reviews, trust badges, low-rating account health, restrictions, account appeals and staff moderation.
- TigRent Premium as a clearly labelled **PHP 99/month demo**, with idempotent mock checkout, ledger-backed analytics, featured placements, Premium calendar ranges and safe bulk equipment controls.
- Versioned administrative settings, cancellation policies and staff audit history.
- Campus Spotlight is a private-image, featured-only, swipeable and continuously auto-advancing carousel.
- New listings require a Step 1 cover photo, uploaded through the existing private, owner-scoped storage flow before the new draft is handed off for publishing; Android picker recovery preserves a completed selection if the native picker recreates the app.
- Lenders select the canonical campus pickup points (Main Gate/Gate 1, P.Noval/Gate 7, Lacson/Gate 14, Dapitan/Gate 11, Main Building, UST Hospital) or supply a safe custom pickup-and-return point through **Others**.
- **Others** exposes a required field for the lender to specify the exact safe public pickup and return location.
- Versioned Rental Terms & Conditions cover the actual prototype workflow (price, deposit, pickup/return, care, late fees, cancellation, disputes, safety and platform action), with accepted versions preserved on each booking. Institutional/legal review remains required before production.
- Private booking chat uses a compact rounded composer with an icon-only send control sized for touch, while retaining its existing privacy and support safeguards.

## Deliberately simulated or not connected

- Payments, refunds, payouts and Premium billing are mock ledger events. The app never accepts payment credentials or moves money.
- Student verification is a manual demo workflow; it is not connected to UST or an external provider.
- Notifications are in-app only. Push and email are not configured.
- Sample accounts, policies, academic years, photos and verification files are synthetic and clearly labelled.

## Security and data handling

- All app tables use RLS; protected writes go through role-checked, audited database RPCs.
- Verification documents, listing images and dispute evidence are private buckets accessed through scoped policies and signed URLs.
- The application rejects secret/service-role keys at startup and ships only the Supabase publishable key.
- Booking, payment, refund and ledger changes are server-controlled and idempotent where retries can occur.

## Remaining production work

- Replace all mocked payment and verification providers with approved, compliant integrations.
- Set production Auth rate limits, bot protection, email/SMS delivery, monitoring, incident handling and secret rotation.
- Move the session to an appropriately hardened production storage strategy after a platform security review.
- Add paginated discovery, realtime or push notification delivery, and production operational support workflows.
- Conduct legal, privacy, accessibility, device-performance and security review before any real-student deployment.

## Handoff checks still owned by a device/normal terminal

- Run `npx expo lint` locally; the managed terminal can leave worker processes before producing its final summary, though direct ESLint passes.
- Test the documented core journeys on a lower/mid-range Android device and current iOS simulator/device, with screenshots at normal and large text sizes.
- Perform a user-authorized `npm run db:reset-demo -- --confirm <project-ref>` immediately before the final demo, then repeat the chosen demo journeys.
