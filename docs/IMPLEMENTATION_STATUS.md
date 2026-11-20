# TigRent — Implementation Status

Source of truth: [`TigRent_Master_Implementation_Plan.md`](../TigRent_Master_Implementation_Plan.md)

| Phase | Title | Status |
|---|---|---|
| 0 | Repository audit, product mapping, technical baseline | **Complete** (Gate 0 passed 2026-11-18) |
| 1 | App foundation, navigation, tokens, primitives | **Complete** (Gate 1 passed 2026-11-18, owner device check in Expo Go) |
| 2 | Backend foundation, migrations, repositories, seed | **Complete** (Gate 2 passed 2026-11-18) |
| 3 | Auth, profile, role model, route guards | **Complete** (automated gate passed 2026-11-18; owner sign-in check on device requested) |
| 4 | Student verification + academic year + admin review | **Complete** (automated + live Journey A gate passed 2026-11-18; owner device check requested) |
| 5 | Profile, dashboards, role-aware navigation | **Complete** (automated + live gate passed 2026-11-18; owner device check requested) |
| 6 | Lender equipment management + availability | **Complete** (automated + live Journey B gate passed 2026-11-18; owner device check requested) |
| 7 | Borrower discovery, search, detail, price preview | **Complete** (automated + live gate passed 2026-11-18; owner device check requested) |
| 8 | Booking request, decisions, atomic holds, demo checkout | **Complete** (automated + live gate passed 2026-11-19; owner device check requested) |
| 9 | Timeline, handover, messaging, reminders, extension, return | **Complete** (automated + live gate passed 2026-11-19; owner device check requested) |
| 10 | Cancellation, refund, late fee, deposit, disputes | **Complete** (automated + live gate passed 2026-11-20; owner device check requested) |
| 11 | Reviews, badges, account health, moderation | **Complete** (automated + live gate passed 2026-11-20; owner device check requested) |
| 12 | Premium + admin configuration | **In progress** (Premium foundation deployed 2026-11-20) |
| 13 | Visual polish, Tiggy, accessibility, devices | Not started |
| 14 | Regression, security review, demo readiness, handoff | Not started |

---

## Phase 0 — Repository audit (2026-11-18)

### 0.1 Repository assessment
| Item | Finding |
|---|---|
| Existing code | **None.** The workspace contains only `TigRent_Master_Implementation_Plan.md`. Greenfield, so the plan's recommended stack (§0.3) applies. |
| Version control | Not a git repository at audit time. `git init -b main` was run with a `.gitignore` that excludes `.env*` and native folders. No commits yet. |
| Screens / navigation / components | None to reuse. |
| Backend / env config | None. No Supabase project or `.env` exists. |
| Tests | None. Baseline: there's no test suite and no build to run. Recorded as "no baseline". |
| Mascot asset | Supplied by the owner as `mascot.jpg` (1024×572 JPG, white background, no alpha). It is copied unmodified to `assets/mascot/tiggy-source.jpg`, and the original stays in the root. The tiger is orange and black with a white muzzle/belly and a red bandana. |
| Business Model Canvas | **Not present as a file.** Plan §1.1 summarizes it and is used as the BMC reference. |
| "Tagalog peer feedback" (cited in Phase 4) | Not present. Plan §2.2 rules are used in its place. |

### 0.2 Local toolchain inventory (names/versions only)
| Tool | Status |
|---|---|
| Node.js | 22.19.0 |
| npm | 10.9.3 |
| Git | 2.51.0 |
| JDK | 17 (Temurin); `JAVA_HOME` points to Android Studio JBR |
| Docker | **Not installed.** `supabase start` (local Supabase) is unavailable, so a hosted project is used (D7). |
| Supabase CLI | Not installed (can run via `npx supabase` for remote `db push`; local stack still needs Docker) |
| Android SDK / emulator / adb | **Not found.** `ANDROID_HOME=D:\AndroidSDK` does not exist. |
| Maestro | Not installed |
| iOS simulator | Not available (Windows host) |

Environment variables: none defined for this project yet.

### 0.3 Screen inventory mapping (plan §4 → planned routes)
Nothing exists, so every screen will be built new. Planned Expo Router groups:

- `(auth)`: welcome, sign-in, sign-up, forgot-password, email-confirmation
- `(onboarding)`: terms acceptance, verification form, verification status (pending / rejected / needs_resubmission / expired)
- `(borrower)` tabs: Discover · Search · My Rentals · Messages · Profile
- `(lender)` tabs: Dashboard · My Equipment · Requests · Messages · Profile
- `(shared)`: notifications, conversation, rental detail + timeline, extension, return, cancellation preview, dispute case, review form, settings/help/policies, restricted/appeal, premium
- `(admin)`: verification queue, users/restrictions, listing reports, disputes, academic years, policies & fees, commission & premium, trust thresholds, provider modes, audit log, demo reset (dev only)

### 0.4 Agreed stack (confirmed by owner 2026-11-18: **hosted Supabase project**)
- Expo (latest stable SDK at install time) + React Native + TypeScript strict, Expo Router
- Supabase: Auth, Postgres, Storage (private buckets), Realtime for messages/notifications
- React Hook Form + Zod, TanStack Query, Zustand (active-role preference only), lucide-react-native, react-native-reanimated (motion, reduced-motion aware)
- date-fns + date-fns-tz for the single Asia/Manila date helper
- Tests: Jest + React Native Testing Library (domain/components); **PGlite** (Postgres-in-WASM) to run real migrations, RLS policies and RPC concurrency/idempotency tests without Docker; Maestro for device E2E once an emulator or device is available

### 0.5 Architecture decisions
| # | Decision | Reason (plan ref) |
|---|---|---|
| D1 | All protected business operations (request/accept booking, confirm mock payment, refunds, extensions, returns, disputes, reviews, verification review, settings) are **Postgres `SECURITY DEFINER` RPCs** with row locks, enforced transition tables and idempotency keys. Clients only `SELECT` through RLS and call RPCs. | §2.4, §6.5, §10.1. Atomic and race-safe. Deployable as plain migrations with no Docker or Edge Function tooling. |
| D2 | `MockPaymentProvider` / `ManualDemoVerificationProvider` sit behind TS interfaces in `src/providers`. Their *effects* (status changes, ledger rows) happen server-side through RPCs, so a client cannot mark itself paid or verified. Demo payment outcome is chosen from a labelled "Demo outcome" control (success / failure), with an admin-set provider mode. | §2.5, §2.2, §10.4 |
| D3 | Student ID and document paths are never in public profile reads. A `public_profiles` view exposes only safe columns. | §6.3 data minimization |
| D4 | Time-based transitions (payment-hold expiry, overdue, verification expiry, reminders) are evaluated **lazily inside RPCs/reads against server time** plus an idempotent `run_scheduled_maintenance()` function that pg_cron can call where available. | §10.1 "use server time"; reminder idempotency in Phase 9 |
| D5 | Notifications carry a unique `dedupe_key` so reminders and retries never duplicate. | Phase 9 gate |
| D6 | Commission = configured % (sample 10%) of base rent + approved extension rent. It excludes the deposit and is deducted from the lender's payable, not added to the borrower total. Late-fee and damage commission eligibility are separate settings (default **off**). | §1.1, §2.5 |
| D7 | Backend = **hosted Supabase project** (owner choice; no Docker locally). Migrations live in `supabase/migrations` and are pushed with `npx supabase db push`. Automated schema/RLS/RPC tests run the same migrations in PGlite with a stubbed `auth` schema. The app only ever receives the URL and anon key. | §0.3, §6.5, §10.2 |
| D8 | Secondary accent token is **`bandanaRed`** (muted, used sparingly) instead of `mutedTeal`. §5.1 asks for an accent "drawn from the supplied tiger illustration", and the supplied illustration contains no teal. | §5.1 |
| D9 | The mascot source stays untouched. Because the JPG has no transparency, Phase 1 adds a derived `tiggy.png` with only the flat white background made transparent and excess whitespace cropped (no redraw or reshaping). That gives the soft halo something to sit under on cream surfaces. If the cut-out damages edges, Tiggy is shown on `paper`-white surfaces instead. | §5.4 |

### 0.6 Plan ambiguities resolved conservatively (sample policy values, admin-configurable)
| Gap in plan | Interim rule |
|---|---|
| Time of day an item is "due" on the inclusive return date | `return_due_time_local` setting, sample **23:59 Asia/Manila**, so no late fee can accrue during the return date itself |
| Which timestamp ends lateness | The borrower's return-handover timestamp once the lender confirms receipt. A slow lender inspection never adds late days. |
| Late-day rounding | Each started 24 h after due = 1 late day (sample, configurable) |
| Cancellation windows/percentages | Seeded "Sample policy v1" (not legal terms). Lender-cancel-before-pickup = 100% refund and pending-cancel = 100% are fixed safe defaults per §2.6. Every other % is set in policy data. |
| Trusted Lender criteria | Sample: verified + ≥5 completed lendings + avg ≥4.5 + no unresolved severe dispute |
| Low-rating restriction | Sample: ≥3 eligible reviews **and** avg < 2.5 → `paused_pending_review` (§2.9 example) |
| UST email domain | Allowlist setting seeded with a sample domain, labelled as configuration to confirm with the product owner |
| Student ID format | Regex setting, sample permissive pattern, labelled unconfirmed |

### 0.7 Implementation sequence
Plan §7 order is followed without reordering: 1 → 14. Within each phase, work goes domain logic + tests first, then RPC/migration + PGlite tests, then repositories, then screens, then the gate checklist.

### 0.8 Gate 0 checklist
- [x] Repository assessment written
- [x] Reuse plan (nothing to reuse; greenfield)
- [x] Baseline test result recorded (no code, no tests)
- [x] Agreed stack: hosted Supabase (owner decision, D7)
- [x] Implementation sequence written
- [x] No destructive changes made
- [x] Mascot source image copied to `assets/mascot/tiggy-source.jpg`

**Gate 0: PASSED (2026-11-18).**

Files changed: `CLAUDE.md`, `.gitignore`, `docs/IMPLEMENTATION_STATUS.md`, `docs/DATA_MODEL.md`, `assets/mascot/tiggy-source.jpg`. Migrations: none. Commands: toolchain inventory, `git init -b main`. Tests: none exist yet.

### Known issues / open items
1. ~~Phase 2 needs Supabase credentials.~~ **Resolved 2026-11-18.** The project URL, publishable key and DB password are in the local `.env` (git-ignored). The URL and key were verified against `/auth/v1/settings`. Finding: **email confirmation is ON** in the project, so the sign-up flow must handle the "confirm your email" state and demo accounts must be seeded pre-confirmed.
2. There's no Android emulator or iOS simulator. The owner has **Expo Go on a phone**, which is used for device checks. Maestro E2E is blocked until a device or emulator can be driven by automation.

### Exact next step (Phase 0)
Done. Continued in Phase 1.

---

## Phase 1: App foundation, navigation, tokens, primitives (2026-11-18)

### Stack as installed
Expo **SDK 58** (expo ~58.0.26), React Native **0.88.1**, React **19.3**, TypeScript **6.0** (strict + `noUncheckedIndexedAccess`), Expo Router 58 (`main: expo-router/entry`, routes in `src/app`), Reanimated 4.7 + react-native-worklets, react-native-svg, expo-linear-gradient, expo-blur, expo-image, expo-haptics, lucide-react-native 1.x. Tests use jest-expo 58, Jest 30 and Testing Library 14 (async API). Every runtime dependency is one Expo Go bundles, so the app runs in Expo Go without a dev build.

### Files added
- **Config:** `package.json` (scripts: `start`, `lint`, `typecheck`, `test`; Jest config), `app.json` (name TigRent, scheme `tigrent`, cream background, `softwareKeyboardLayoutMode: resize`), `tsconfig.json` (`@/*` and `@assets/*` aliases), `eslint.config.js` (Expo), `.env.example`, `AGENTS.md` (Expo's agent guidance, kept)
- **Theme:** `src/theme/tokens.ts` (palette, semantic colors, spacing, radii, type scale, elevation, icon sizes and stroke, motion durations, font-scale caps), `src/theme/contrast.ts`
- **Lib/config:** `src/config/app.ts`, `src/lib/motion.tsx` (reduced-motion provider: OS setting, then in-app override, then ambient switch), `src/lib/dates.ts` (date-only primitives; "today" in Asia/Manila)
- **Design system** (`src/components/design-system/`): Text, Icon, Button (5 variants; pressed, focus ring, loading/busy, disabled with a visible `disabledReason`, haptics), TextField, PasswordField, SelectField, DateField + Calendar, FieldTrigger, Chip + StatusPill, SegmentedControl (role switcher), ListRow, Sheet, Dialog, Banner, Toast, EmptyState / ErrorState / Skeleton / LoadingRows, ScreenHeader, Screen (safe area, keyboard avoidance, sticky footer, tab-bar spacing)
- **Shared:** AmbientBackground (slow drifting gold curves, static under reduced motion), floating glass TabBar, text-only Wordmark, honest PhaseScaffold, RouteErrorBoundary
- **Mascot:** `assets/mascot/tiggy.png` (derived cut-out, D9) and `src/components/mascot/Tiggy.tsx` (tap/press reaction, web hover, dismissible speech bubble inside reserved space so it never covers controls, subtle radial grounding halo, a11y labels)
- **Auth placeholder:** `src/features/auth/route-resolver.ts` (pure routing for every session, verification, account and role state) and `session.tsx` (Phase 1 always returns `signed_out`)
- **Routes:** `/` → redirect, `/loading`, `(auth)` welcome (fully designed) / sign-in / sign-up / forgot-password / check-email, `/onboarding/{terms,verification,status}`, `/borrower` tabs (Discover, Rentals, Messages, Profile), `/lender` tabs (Dashboard, Equipment, Requests, Messages, Profile), `/admin`, `/notifications`, `/settings`, `/restricted`, `+not-found`, `/dev` route map + `/dev/components` gallery (only in `__DEV__`)
- **Tests:** `src/test/{setup.ts,render.tsx}`, `unit/{theme-contrast,dates,route-resolver}`, `components/{controls,tiggy-motion}`, `navigation/shell`

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D10 | Role areas use real path segments `/borrower`, `/lender`, `/admin` instead of `(borrower)`-style groups | Groups would collide: both roles have `/messages` and `/profile`. Real segments also make deep-link guards explicit. |
| D11 | Removed react-native-gesture-handler. Sheets are built on RN `Modal` + Reanimated. | Fewer dependencies (§10.3). GH 3 renamed its API, and nothing needed gestures yet. |
| D12 | Scaffold screens show "Arrives in Phase N" banners with **no operational-looking controls** | §0.1.6 and Phase 1 ("do not simulate finished data") |
| D13 | Dev route map and component gallery live under `/dev` and redirect away in production builds | Device navigation and visual QA without fake data |
| D14 | Jest maps `lucide-react-native` to its CJS build. tsconfig `types: ["jest","node"]`. | lucide v1 ships ESM under the `react-native` condition. TS 6 defaults `types` to `[]`. |
| D15 | Business "today" uses fixed UTC+8 arithmetic instead of `Intl` time zones | Asia/Manila has no DST. This is deterministic on Hermes and covered by tests. |

### Commands run and results
| Command | Result |
|---|---|
| `npx tsc --noEmit` | **Pass** (0 errors) |
| `npx expo lint` | **Pass** (0 problems) |
| `npx expo-doctor` | **20/20 checks pass** (after adding the `react-native-worklets` peer) |
| `npx jest` | **6 suites, 68 tests, all pass** |
| `npx expo export --platform android --platform ios` | **Both bundles compile** (6.3 MB each). The bundles were scanned: neither the DB password nor `SUPABASE_DB_PASSWORD` appears. |

Bugs the checks caught and fixed:
- `ScreenHeader` called imperative `router.canGoBack()` during render, which crashes before the router mounts. It now uses `useCanGoBack()`.
- `setState` inside effects in Sheet and Tiggy. Replaced with derived state and the adjust-during-render pattern.
- The `TextInput` ref type changed in RN 0.88. Fields now take `ref` as a prop (React 19).

### Gate 1 checklist
- [x] Routes reachable (automated: every route renders; tabs switch; welcome → sign-up; unknown link → not-found → back to start)
- [x] Design tokens centralized (`src/theme`). No hard-coded colors outside tokens except the documented tints in TabBar/Toast.
- [x] Buttons and fields expose focus, disabled, loading and error states (automated)
- [x] Reduced motion disables ambient and nonessential motion (automated; also toggleable in `/dev/components`)
- [x] Component tests cover buttons, fields, role switcher, select sheet, Tiggy and the navigation shell
- [x] Contrast: all text/background token pairs ≥ 4.5:1 (automated)
- [x] **Launches on a physical device in Expo Go.** Owner confirmed 2026-11-18. iOS and Android simulators are unavailable on this Windows host.
- [x] **On-device visual check:** owner reports no overlapping or hidden elements. Owner note: component styling isn't yet fully aligned with the overall product concept. That's expected and is scheduled for Phase 13 visual polish.

**Gate 1: PASSED (2026-11-18).**

### Known issues
1. `npm audit` reports 34 advisories (2 moderate, 32 high) in **transitive** build/dev tooling of the Expo template. `npm audit fix --force` would make breaking downgrades, so it was not run. To be reviewed in the Phase 14 security pass.
2. The welcome screen's buttons lead to Phase 3 scaffolds (sign-in/sign-up), which are labelled as such.

### Exact next step
The owner runs `npx expo start` in `d:\TigRent` and scans the QR code with Expo Go on a phone on the same Wi-Fi (or uses `npx expo start --tunnel`). Check the welcome screen, then **Developer route map** → every route and the **Component gallery** (open the sheet with the keyboard up, toggle Reduce motion, tap Tiggy). Report any layout problems. Once confirmed, Gate 1 closes and **Phase 2** starts (Supabase migrations, RLS, private buckets, PGlite tests, seed/reset).

---

## Phase 2: Backend foundation, migrations, repositories, seed (2026-11-18)

### Backend facts
Hosted Supabase project in `ap-northeast-1`, Postgres **17.12**. The direct DB host is IPv6-only and unreachable from this machine, so tooling uses the **session pooler** `aws-1-ap-northeast-1.pooler.supabase.com:5432` (cached in `.env` as `SUPABASE_DB_HOST/USER`). Email confirmation is ON.

### Files added
- **Migrations** (`supabase/migrations/`): `…01_foundation` (extensions, enums, triggers, versioned settings, cancellation policies, audit log), `…02_identity`, `…03_listings`, `…04_bookings` (business-time and pricing helpers, exclusion constraint), `…05_money`, `…06_trust_and_comms`, `…07_security` (grants, RLS, helper predicates, `public_profiles`), `…08_storage` (4 private buckets + object policies)
- **Seed:** `supabase/seed.sql` (8 demo accounts, 13 listings, 21 bookings across all 11 statuses, balanced simulated ledger, reviews meeting the sample trust and low-rating rules, dispute, conversations, notifications, Premium)
- **Tooling** (`scripts/`): `lib/env.mjs`, `lib/connection.mjs` (pooler discovery), `lib/migrations.cjs` (single migration list + PGlite builder), `lib/gen-types.cjs`, `db-ping`, `db-migrate` (CLI-compatible `supabase_migrations.schema_migrations`), `db-seed`, `db-reset-demo`, `db-smoke`, `gen-db-types`
- **App:** `src/lib/env.ts` (zod validation, rejects secret/service-role keys), `src/lib/supabase.ts` (typed client, AsyncStorage session, URL polyfill), `src/lib/errors.ts` (`AppError`/`Result`, PostgREST error mapping with user-safe messages), `src/lib/money.ts`, `src/domain/entities`, `src/repositories/{base,identity,marketplace}.ts`, `src/types/database.ts` (generated), `ConfigErrorScreen` (root layout refuses to start with missing or unsafe config), plus a dev-only **Backend connection** check in `/dev`
- **Tests:** `supabase/tests/{shim.sql, harness.ts, schema, rls, storage, types-sync}.test.ts` and `src/test/unit/{env-money-errors, repositories}.test.ts`
- **Docs:** `docs/DATA_MODEL.md` (rewritten to match the deployed schema), `docs/DEMO_GUIDE.md` (accounts, commands)

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D16 | Own migration runner and type generator (Node + pg / PGlite) instead of the Supabase CLI | `supabase gen types` needs Docker or an access token. The runner writes the CLI's own history table, so the CLI can take over later. |
| D17 | All protected writes are revoked at the grant level, not just filtered by RLS. RPCs arrive per phase. | Plan §6.5: users can't set verified/completed/refunded/suspended/commission. Grant-level denial is defense in depth. |
| D18 | Student ID and email live only in `student_verifications`. Other users' names come from the `public_profiles` view. | §6.3 data minimization |
| D19 | Marketplace browsing requires a verified student (plus owner, booking party or staff) | Closed verified community (BMC). Pending students can't browse. |
| D20 | DB exclusion constraint `bookings_no_overlap` as the final inventory guard | §2.4 race safety. Phase 8 RPCs add row locks and friendly conflict messages on top. |
| D21 | Demo accounts use `@tigrent.test` with one shared demo password. `tigrent.test` is in the sample email allowlist, labelled demo-only. | Never collide with real student emails (§9). Repeatable demos. |
| D22 | Demo reset truncates app data and recreates demo accounts. It requires `--confirm <project-ref>` and is never shipped in the app. | §0.1.7, Phase 2 "never expose destructive reset in a production build" |
| D23 | Jest runs as two projects (`app`: jest-expo; `db`: node + PGlite) with `--experimental-vm-modules` | PGlite loads WASM via dynamic import |
| D24 | Session storage uses AsyncStorage (supabase-js's recommended RN setup) | Encrypted session storage (SecureStore + AES) is an optional hardening item for production, recorded for Phase 14 |

### Commands run and results
| Command | Result |
|---|---|
| `npm run test:db` | **45/45 pass**: schema (14), RLS (21), storage (9), types-sync (1) |
| `npm test` (app + db) | **135/135 pass**, stable across two consecutive full runs |
| `npm run db:migrate` (hosted) | 8 migrations applied. Re-run: **Up to date** |
| `npm run db:seed` ×2 (hosted) | Identical counts both times (8 accounts / 13 listings / 21 bookings): **idempotent** |
| `npm run db:reset-demo` | Without `--confirm`: refused (exit 1). With confirm: reset ok. Hosted Supabase forbids SQL deletes on storage, which the savepoint handled. |
| `npm run db:smoke` (hosted, publishable key only) | **All 24 live checks pass**, including after a reset |
| `npx tsc --noEmit` / `npx expo lint` / `npx expo-doctor` | Pass / 0 problems / 20/20 |
| `npx expo export` + bundle scan | DB password, `SUPABASE_DB_PASSWORD` and the demo password are **absent**. The only `sb_secret_` hit is the guard's prefix literal. |

Bugs the gate caught and fixed:
- The anon Terms policy called a staff helper anon can't execute; anonymous Terms reads would have failed. Split into anon and member policies.
- The seed's temporary helper broke re-runs in the same session. Now `create or replace`.
- The "no public buckets" smoke check passed vacuously (members can't list buckets). Replaced with a real-file public-URL refusal check plus a signed-URL success check and a bucket-flag check.
- A UI test flaked under parallel load with the DB suite. Raised the async timeout and split a test that mounted two routers.

### Gate 2 checklist
- [x] Migrations apply from an empty database (PGlite, every test run) and on the hosted project. Re-running reports up to date.
- [x] Seed runs repeatedly without duplicates (PGlite test + hosted ×2 + after reset)
- [x] Foreign keys, uniqueness, money constraints, one-current-academic-year, no-overlap, append-only history and refund cap all tested
- [x] RLS: borrower A can't read borrower B's booking or documents; non-admin can't read admin data or self-verify (PGlite + live)
- [x] Private storage denies public access and allows only approved paths (PGlite + live, including signed URLs and MIME rejection)
- [x] Typed repository contracts; generated DB types stay in sync (test)
- [x] Environment validation fails clearly; secret keys are refused
- [x] Controlled reset/seed command for demo only

**Gate 2: PASSED (2026-11-18).**

### Known issues
1. The `awaiting_payment` demo hold expires 15 minutes after a seed or reset, and nothing processes expiry until Phase 8. The booking stays `awaiting_payment` until then.
2. Seeded verification records reference sample document paths with no file yet. Phase 4 uploads clearly-labelled sample PDFs.
3. Storage files can't be deleted by SQL on hosted Supabase, so the reset leaves stale files. They're harmless (private and path-scoped). Phase 4+ tooling can clean them through the Storage API.
4. The 34 transitive `npm audit` advisories noted in Phase 1 are unchanged; review deferred to Phase 14.

### Exact next step
**Phase 3:** Supabase Auth in the app (sign up, sign in, sign out, password reset, the email-confirmation state the hosted project requires, session restore), server-loaded roles, verification and account status feeding `route-resolver`, an active-role switcher for dual-role users, and route guards for every account state. Optionally, the owner can open `/dev` → **Backend connection** in Expo Go to confirm the phone reaches Supabase.

---

## Phase 3: Authentication, profile, role model, route guards (2026-11-18)

### Hosted-auth facts (probed on the live project)
| Behaviour | Finding | App handling |
|---|---|---|
| Sign-up with a `.test` address | Rejected (`email_address_invalid`). No user created. | Real sign-ups need deliverable addresses. Seeded demo accounts are unaffected. |
| Sign-up with an existing email | No error. Supabase returns a placeholder user with `identities: []`. | Detected and shown as "already exists" + "Go to sign in". |
| Wrong password / unconfirmed email | Both return `invalid_credentials` | One message covering both cases |
| Short password | `weak_password` (server minimum 6) | App requires ≥8 with a letter and a number |

### Files added or changed
- **Migration** `20261118000009_auth_session.sql`: `get_my_session_context()`, `accept_current_terms(uuid[])` (rejects stale or partial version lists), `enable_marketplace_role(marketplace_role)` (verified + active only, idempotent, audited). RPC error convention: `P0001` with message `kind.reason` and hint = user text.
- **Auth:** `src/features/auth/{auth-service.ts, validation.ts, session.tsx (live provider + test seam), guards.tsx (AreaGuard / RequireSignedIn / GuestOnly), RoleSwitcher.tsx, AccountScreen.tsx, OnboardingPlaceholder.tsx}`, `src/repositories/session.ts`, `src/lib/errors.ts` (P0001 mapping)
- **Screens:** sign-in, sign-up, check-email (code entry + resend with cooldown), forgot-password (request → code → new password), onboarding/terms (real acceptance), restricted (status, reason, rentals, support, appeal entry), borrower/lender **profile** (account essentials + switcher + sign out), admin home sign-out, status-aware onboarding placeholders with sign-out, `BootScreen` (restore + offline retry)
- **Routing:** `/restricted`, `/notifications`, `/settings` moved into a `(member)` group behind `RequireSignedIn`. Role areas sit behind `AreaGuard`, the auth group behind `GuestOnly`.
- **Design system:** `Checkbox`
- **Tooling:** the type generator now emits exact RPC argument and return types
- **Tests:** `supabase/tests/auth-session.test.ts` (9), `src/test/navigation/guards.test.tsx` (37), `src/test/components/{auth-screens (9), terms (2)}`, `src/test/unit/auth-service.test.ts` (12). The live smoke test has 10 new checks.

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D25 | Email confirmation and password reset use the **emailed numeric code** (`verifyOtp`). Opening the email link and then signing in also works. | Expo Go can't reliably receive custom-scheme links, and redirect URLs need dashboard allow-listing |
| D26 | Forms use Zod + component state instead of React Hook Form | Plan §0.3 allows "equivalent typed tools". Small forms; fewer dependencies (§10.3). |
| D27 | Terms/Privacy acceptance built in Phase 3 (planned scaffold said Phase 4) | Route guards must enforce it (Journey A.4). Small and self-contained. |
| D28 | Restricted/suspended users may still open the role areas they hold, with `/restricted` as their home | §2.9: existing rentals stay reachable. New actions are refused by the Phase 6/8 RPCs. |
| D29 | One RPC returns roles, verification, account status and pending terms | Consistent routing decisions from server facts. The client role preference never grants access (verified live). |
| D30 | App tests stub `fetch`, so a UI test can never reach the network or the live project | Safety and determinism |

### Commands run and results
| Command | Result |
|---|---|
| `npm test` | **183/183 pass** (17 suites: app 127 + db 56) |
| `npx tsc --noEmit` / `npx expo lint` / `npx expo-doctor` | Pass / 0 problems / 20/20 |
| `npm run db:migrate` | `…009_auth_session` applied |
| `npm run db:smoke` | **34/34 live checks pass**, including session restore with a fresh client, sign-out clearing storage, a tampered role preference not granting a role, and role enablement refused for pending and restricted students |

Bug caught and fixed: the Terms loader set state synchronously inside an effect (React Compiler lint). Now it sets state only in the async callback, with an unmount guard.

### Gate 3 checklist
- [x] Sign up / sign in / sign out / password reset / email-confirmation pending / session persistence (automated UI + service tests; live sign-in, restore and sign-out)
- [x] Borrower-only users can't open lender routes and vice versa; staff-only admin (37 guard tests). The server rejects role escalation (PGlite + live).
- [x] Dual-role users switch areas. The switcher appears only with both roles. Profile and verification aren't duplicated (DB test).
- [x] Editing the local role preference or deep-linking can't bypass permissions (guard tests + live tamper check)
- [x] Restricted/paused/suspended users keep access to rentals, support, status and the appeal entry (appeal form: Phase 11)
- [x] Expired session → signed out with a notice. Offline at launch → retry screen. Duplicate email, weak password and pending confirmation are handled.
- [ ] **Owner device check:** sign in on the phone with demo accounts (e.g. Bea, Dana, Rico, Paolo, Admin) and confirm each lands in the right place

**Gate 3: automated checks PASSED (2026-11-18); awaiting the owner's on-device sign-in check.**

### Owner actions for live sign-ups (Supabase dashboard; not needed for demo accounts)
1. **Authentication → Email Templates → "Confirm signup" and "Reset password":** add `{{ .Token }}` so emails include the code the app asks for. Links keep working.
2. **Email delivery:** Supabase's built-in sender is heavily rate-limited and may deliver only to the project team's addresses. For sign-up demos with other addresses, configure custom SMTP or turn off "Confirm email". The app supports both modes.

### Known issues
1. The appeal form, full profile (ratings, badges, role-enable UI), notifications and settings content arrive in Phases 5 and 11. The current controls are labelled or disabled with explanations.
2. Carried over: the awaiting-payment hold isn't processed until Phase 8; sample verification files arrive in Phase 4; 34 transitive `npm audit` advisories await review in Phase 14.

### Exact next step
The owner signs in on the phone with the demo accounts. Then **Phase 4:** the student verification form (UST email/domain allowlist, student ID pattern, academic year, role intent, private document upload with validation, progress and retry), `submit_verification` / `review_verification` RPCs with academic-year rules, the status screen with history, the admin verification queue with signed-URL document review, notifications and audit, and sample documents for seeded accounts.

---

## Phase 4: Student verification, academic years, admin review (2026-11-18)

### Auth setting change (owner)
The owner turned **Confirm email OFF**. Verified live: `mailer_autoconfirm = true`, and a real `@example.com` sign-up received an immediate session with a confirmed email, a profile with the given name, no roles, `not_submitted` and 2 pending terms. The test user was deleted. The code-based confirmation screen stays for when it's turned back on.

### Files added or changed
- **Migrations:**
  - `…010_verification.sql`: `submit_verification`, `review_verification`, `create_academic_year`, `set_current_academic_year`, staff/user notification helpers, one-time-use document constraint
  - `…011_account_deletion.sql`: the append-only guard allows only the FK pseudonymisation of `actor_id` when an account is deleted
- **Providers:**
  - `src/providers/student-verification/{types.ts, manual-demo.ts}`: `StudentVerificationProvider` + `ManualDemoVerificationProvider`, labelled "Manual student review (demo)"
  - `src/providers/storage/private-upload.ts`: XHR upload with progress and cancel, generated paths (never user filenames), typed storage errors, remove, signed URLs
- **Feature:** `src/features/verification/{validation.ts, DocumentField.tsx}` (pre-upload type/size checks, file/camera/photo pickers, progress, cancel, retry, preview, replace/remove with cleanup)
- **Screens:** `onboarding/verification` (form built from the configured rules; server errors mapped to fields; resubmission prefill and reviewer reason), `onboarding/status` (status copy per state, reason, expiry, submission history, state-driven Tiggy tip, check for updates, resubmit/renew), admin hub with a live pending count, `admin/verifications` (filterable queue), `admin/verifications/[id]` (details, 5-minute signed-URL document, approve dialog, reason sheet, self-review blocked), `admin/academic-years` (add; make current with an expiry warning)
- **Data layer:** `src/repositories/verification.ts` (rules from settings, queue, review, academic-year admin), `src/lib/use-async.ts`, `src/lib/format.ts`, `Dialog` `testID`
- **Tooling:**
  - `scripts/lib/sample-pdf.mjs`, `scripts/db-seed-files.mjs`: SAMPLE PDFs uploaded by each seeded student; run by `db:seed` and the reset
  - `scripts/journey-a.mjs` (`npm run e2e:journey-a`): live end-to-end Journey A
  - Type generator: optional RPC parameters for SQL defaults
- **Config:** `expo-document-picker`, `expo-image-picker` (Expo Go compatible) with permission strings in `app.json`
- **Docs:** `docs/VERIFICATION_PROVIDERS.md` (current manual flow + future SheerID adapter steps; no claim of connection), DEMO_GUIDE and DATA_MODEL updates

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D31 | The server trusts **storage metadata** (size, MIME type) for the submitted document, not client values. Each file can back only one submission. | §6.5 / §10.2: don't trust client input. Resubmission requires a new document (history preserved). |
| D32 | Approval grants exactly the roles requested at submission. Verification expires at 23:59 Manila on the academic year's end date. | §2.1/§2.2. The expiry policy is configurable. |
| D33 | Staff can't review their own submission. A decision can only be made once (row lock + status check). | Integrity of the manual review |
| D34 | Denied review attempts are not written to `audit_logs`: the RAISE rolls back any row written in the same call. They appear in Supabase API logs. | An honest limitation instead of a log that silently never persists |
| D35 | Account deletion pseudonymises append-only history (actor cleared) instead of being blocked. Ledger history still blocks hard deletion. | Found by the live Journey A cleanup. §6.5 deletion vs §2.5 retention. |
| D36 | Upload progress uses XHR against the Storage REST endpoint (same auth and policies) | supabase-js upload exposes no progress events. The plan requires progress. |
| D37 | Admin academic-year configuration built in Phase 4 (the plan's full settings screen is Phase 12) | Required by the Phase 4 gate ("change of active academic year triggers expiry") |

### Commands run and results
| Command | Result |
|---|---|
| `npm test` | **228/228 pass on two consecutive full runs** (app 149 + db 79) |
| `npx tsc --noEmit` / `npx expo lint` / `npx expo-doctor` | Pass / 0 problems / 20/20 |
| `npm run db:migrate` | `…010_verification`, `…011_account_deletion` applied |
| `npm run db:seed-files` | 7 SAMPLE registration forms uploaded by their fictitious students |
| `npm run e2e:journey-a` (live) | **19/19 steps pass**: sign up → terms → private upload (public URL refused) → domain rule enforced by the server → submit → duplicate/self-approval/document-deletion refused → admin queue → signed-URL PDF → approve → double decision refused → verified with both roles → both notifications → marketplace visible. Then a full cleanup. |
| `npm run db:smoke` (live) | **40/40 checks pass** (6 new verification checks) |

Problems found and fixed during the gate:
1. **Account deletion was impossible** for any user with audit history (append-only trigger vs `ON DELETE SET NULL`). Fixed by migration 011, with tests.
2. **Jest ignored `testTimeout` inside `projects`.** The Phase 2 setting never took effect, and with 7 DB suites in parallel the 5 s default made whole suites fail under load. Moved to the global config.
3. The first Journey A cleanup crashed (finding 1) and left a test user. It was removed and the cleanup made robust, including orphaned staff notifications.
4. The non-staff review audit line would have been silently rolled back. Removed (D34).
5. Test fixes: PGlite needs Postgres array literals for enum arrays; ambiguous dialog buttons now use `testID`; the guard test was updated for the real status screen.

### Gate 4 checklist
- [x] A valid submission for the active academic year creates `pending_review` (DB + live)
- [x] Missing/invalid documents, oversized, empty and disallowed types, wrong academic year, invalid email/domain, bad student ID: field-level feedback on the client and server-enforced (DB 10 cases + UI tests + live)
- [x] Pending students can't create listings, send bookings, or message (grant-level denial, DB test). They can't browse the marketplace (RLS, live).
- [x] Admin can approve/reject/request changes with a reason. Ordinary users and self-review are refused (DB + UI + live).
- [x] A rejected user can resubmit with a new document; the previous rejection stays in history (DB + UI)
- [x] Changing the active academic year expires older verifications, notifies students and routes them to renewal (DB)
- [x] Document URLs aren't public. Only the owner and staff get short-lived signed URLs (PDF opened live by the admin; another student refused).
- [x] Notifications and audit events for submission and every review outcome (DB + live)
- [x] Provider abstraction + manual demo provider; SheerID integration notes without claiming a connection
- [ ] **Owner device check:** run Journey A on the phone (sign up → verify → admin approves → back in as the student). Also try the camera/photo picker and upload progress, which need a real device.

**Gate 4: automated and live end-to-end checks PASSED (2026-11-18); awaiting the owner's on-device check.**

### Known issues
1. The notification inbox UI arrives in Phase 5. Students see outcomes on the status screen now; notifications are stored.
2. No realtime push of review decisions: the student taps "Check for updates" or reopens the app (in-app notifications are mandatory; push is optional per plan Phase 9).
3. HEIC files from iOS are accepted; picking from photos with quality < 1 converts them to JPEG.
4. Carried over: the awaiting-payment hold is processed in Phase 8; `npm audit` review in Phase 14.

### Exact next step
The owner runs the Phase 4 device check. Then **Phase 5:** full profile (verification state, rating average and count, badges, enabled roles, account status), borrower and lender dashboards from real seeded data, the role-enablement flow (`enable_marketplace_role`), the notification inbox with deep links and read state, basic settings/help, and role-appropriate empty states.

---

## Phase 5: Profile, dashboards, role-aware navigation (2026-11-18)

### Files added or changed
- **Migration** `…012_profile_summary.sql`: `get_profile_summary(user?)` returns ratings split by role (as lender / as borrower; visible reviews only), completed lendings/borrowings, badges (`student_verified`, and `trusted_lender` from the configurable `trusted_lender_rule`: verified + good standing + min completed lendings + min average + no unresolved severe disputes), plus rule and progress for honest explanations. Other members' profiles are visible to verified students and staff only.
- **Domain:** `src/domain/rules/dashboard.ts` (`summarizeBorrower`, `summarizeLender`, `sumCentavos`, `dueLabel`; pure), `src/features/mascot/dialogue.ts` (authored, state-driven Tiggy tips), `src/features/notifications/targets.ts` (deep-link mapping), `src/features/bookings/status.ts` (status wording)
- **Repositories:** `profile.ts` (profile summary, ledger payables, featured listings, unread count, mark all read), `bookingsRepository.getParties`, `lenderNet` on booking summaries; `run`/`runMaybe` mappers typed `NonNullable`
- **Screens:**
  - Borrower home: due-back-next card, stats, upcoming pickups, featured items from other students, unread bell, switcher, Tiggy
  - Borrower **My Rentals**: grouped filters with counts. Replaces the placeholder, so restricted users can see their existing rentals as §2.9 requires.
  - Lender dashboard: requests, 7-day handovers, out on rent with due labels, equipment counts, **simulated** earnings from ledger payables
  - **ProfileScreen** for both areas: badges, split ratings, the "About badges" sheet with criteria and progress, the role-enablement flow with a confirmation dialog and disabled-with-reason states, edit name, account links
  - Notification inbox: unread markers, mark all read, deep links, empty state with a way home
  - Settings & help: persistent reduce motion, help topics, legal, an About section with disclaimers, sign out
  - Policies viewer
- **Shared UI:** `Screen` pull-to-refresh, `NotificationBell`, `Section` / `Group` / `StatRow` (a compact stat row instead of card grids, §5.2), `Dialog` testID
- **Motion:** the reduce-motion override is persisted per device (AsyncStorage)
- **Test seam:** the test session provider now applies context updates like the live provider, so post-action navigation is tested realistically

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D38 | Trusted Lender evaluation is computed now (Phase 5 profile shows badges). Phase 11 adds moderation, health rules and appeals on top. | Plan Phase 5 task "profile … badges"; criteria come from settings and are labelled sample |
| D39 | Ratings are shown separately as lender and as borrower | A single combined average would misrepresent people who mostly borrow or mostly lend (e.g. Rico) |
| D40 | Dashboard and list rows don't navigate to unbuilt detail screens; each section says which phase adds details | §0.1.6: no controls that look operational without working |
| D41 | Estimated earnings = sum of the viewer's `rent_payable` ledger credits, labelled "Simulated · no real payout" | §2.5, §10.4. Deposits excluded; the commission is already deducted. |
| D42 | Booking notifications resolve the viewer's side (lender vs borrower) at tap time | One notification type can concern either role on a dual-role account |

### Commands run and results
| Command | Result |
|---|---|
| `npm test` | **254/254 pass on two consecutive full runs** (app 168 + db 86) |
| `npx tsc --noEmit` / `npx expo lint` / `npx expo-doctor` | Pass / 0 problems / 20/20 |
| `npm run db:migrate` | `…012_profile_summary` applied |
| `npm run db:smoke` | **46/46 live checks pass** (6 new: badges, progress, split ratings, profile visibility, payable-only ledger lines, unread count) |
| `npm run e2e:journey-a` | Still passes end-to-end (regression) |

Issues found and fixed:
1. The earnings caption implied the amount covered only completed rentals; it now describes exactly what's summed.
2. Route files exported a constant; moved to a feature module.
3. The test session seam ignored `applyContext`, so tests couldn't verify navigation after enabling a role or accepting terms. It now updates state like the live provider, and the Terms test asserts the move on to verification.
4. A one-off duplicate-text assertion in the guard test was updated now that the profile shows "Student verified" twice (pill and status row).

### Gate 5 checklist
- [x] Borrower-only, lender-only and dual-role accounts land on the correct screens (guard tests; live session context)
- [x] Enabling the second role doesn't duplicate profile or verification records (DB test). The UI flow enables the role and moves to the new area (UI test). It's refused with reasons for unverified or restricted users (UI + DB + live).
- [x] Navigation tabs and deep links resolve to the correct role context (notification deep links incl. the dual-role lender case; guard tests)
- [x] Empty states provide working next actions (My Equipment, featured items, go home)
- [x] Profile shows verification, ratings (split), badges with criteria, enabled roles and account status
- [x] Dashboards use real repository data via tested pure summaries
- [ ] **Owner device check:** sign in as Bea, Leo, Dana, Mika and Rico and review dashboards, profile, badges, notifications and settings

**Gate 5: automated and live checks PASSED (2026-11-18); awaiting the owner's on-device check.**

### Known issues
1. Listing details, search and filters arrive in Phase 7; request actions in Phase 8; rental details and returns in Phases 8–9. Lists show data but don't open details yet (labelled).
2. Avatars aren't editable yet (initial-only header); planned with Phase 13 polish if time allows. Not a plan requirement beyond `avatar_path`.
3. Carried over: hold expiry processing in Phase 8; `npm audit` review in Phase 14.

### Exact next step
The owner runs the Phase 5 device check. Then **Phase 6:** lender equipment management: a listing create/edit wizard with validation, image upload/reorder/removal, draft → preview → publish → pause → reactivate → remove, the lender equipment list with search and sort, availability calendar blocks, immutable booking snapshots after edits, and listing reports/moderation status.

---

## Phase 6: Lender equipment management and availability (2026-11-18)

### Files added or changed
- **Migration** `…013_listing_management.sql`:
  - `create_listing`, `update_listing`, `set_listing_status` (allowed transitions; publish needs a verified + active lender, rate > 0, ≥1 photo, not hidden; removal blocked while requests or rentals are open)
  - `add_listing_image` (storage metadata: JPG/PNG/WebP ≤5 MB, max 8), `remove_listing_image` (an active listing keeps ≥1), `reorder_listing_images`
  - `add_availability_block` (no overlap with held bookings, not in the past, ≤1 year), `remove_availability_block`
  - `report_listing` (verified, not own, once while open), `resolve_listing_report` (staff: dismiss / hide with a note; lender notified), `restore_listing`
  - Internal helpers are not executable by members.
- **Seed:** one SAMPLE cover photo per seeded listing (the draft is deliberately left without one). `scripts/gen-listing-placeholders.ps1` → `assets/listings/*.png`; `db-seed-files.mjs` uploads them as each lender.
- **Domain:** `src/domain/listings.ts` (form schema with peso → centavos, phone-number guard in notes, pickup requirement; publish checklist; allowed statuses; equipment filter/sort)
- **Repositories:** `listing-management.ts` (my listings with cover, listing detail with images, blocks and held booking ranges; categories and pickup points; all listing RPCs; photo removal deletes the record, then the file; signed photo URLs; moderation queue)
- **Screens:**
  - `lender/equipment`: search, status filters with counts, sort, cover thumbnails, moderation flags, gated New listing
  - `manage/listings/new` and `[id]/edit`: three-step wizard (About → Price → Pickup) with step validation; server errors jump to the field's step; the commission is read from settings
  - `[id]` overview: status, moderation banner, publish checklist, pause/unavailable/reactivate/remove with confirmations, "edits apply to new requests only"
  - `[id]/photos`: camera/library, progress, reorder, remove
  - `[id]/availability`: tap a free date to block; booked and blocked dates crossed out
  - `[id]/preview`: `ListingDetailView`, reused for the Phase 7 listing detail
  - `admin/reports`: open reports, dismiss / hide with a note; hidden listings with restore
- **Navigation:** guarded `/manage` stack for lenders; listing notifications deep-link to the listing overview
- **Tooling:** `scripts/journey-b.mjs` (`npm run e2e:journey-b`)

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D43 | Publishing requires ≥1 photo; an active listing can't drop to 0 photos | Plan Phase 6 validates photos; honest listings |
| D44 | Removal is blocked while any request or rental is open (pending → disputed). Pause and unavailable are always allowed and never touch existing bookings. | §2.6 "do not silently cancel"; the withdrawal-refund path arrives in Phase 10 |
| D45 | Restricted lenders may pause, mark unavailable or remove, but not create or (re)publish | §2.9 "prevent new listings"; safety actions stay available |
| D46 | Hidden listings stay visible to their lender and to existing booking parties | Owners must see moderation state; parties keep access to their rentals |
| D47 | Notes refuse phone-number patterns on the client (UX). The server doesn't yet. | §2.3 "safe, non-sensitive instructions". A server check would need a new migration; tracked below. |
| D48 | Sample cover photos are generated locally and clearly labelled "SAMPLE PHOTO" | §9 "safe placeholder images"; no third-party or real photos |
| D49 | Live checks don't assume demo roles stay unchanged; they compare against server records or use accounts that can't change role | Owner testing legitimately changed Bea's roles |

### Commands run and results
| Command | Result |
|---|---|
| `npm test` | **301/301 pass on two consecutive full runs** (app 196 + db 105) |
| `npx tsc --noEmit` / `npx expo lint` / `npx expo-doctor` | Pass / 0 problems / 20/20 |
| `npm run db:migrate` + `npm run db:seed` | `…013` applied; 12 sample photos uploaded |
| `npm run e2e:journey-b` (live) | **25/25 steps pass**: invalid money rejected → non-lender refused → draft invisible → publish needs a photo → private upload (foreign upload refused) → publish → visible to the borrower with a signed photo → edit → pause hides → reactivate → block dates → report → non-staff can't resolve → moderator hides → hidden from borrowers → republish refused → lender notified → restore → remove → removed is locked. Then a full cleanup. |
| `npm run db:smoke` | **48/48 live checks pass** |
| `npm run e2e:journey-a` | Still passes (regression) |

Issues found and fixed:
1. **Seeded "active" listings had no photos**, contradicting the new publish rule (a paused demo listing could never be republished). Added labelled sample photos to the seed.
2. Journey B found that **Bea had enabled lending** during owner testing (audit `role.enabled`, 14:22 UTC). The first run created a stray draft as her, which was removed. The checks now use accounts whose roles can't change (D49), and two smoke checks were hardened the same way.
3. A route file exported a constant again; moved to `features/listings/status.ts`.
4. The wizard's commission note was hard-coded; it now reads `commission_bps`.
5. The moderation test assumed a booking party can't see a hidden listing; parties correctly keep access (D46).

### Gate 6 checklist
- [x] Create → draft → preview → publish → edit → pause → reactivate → remove (DB + UI + live)
- [x] Invalid money and missing required fields are rejected (client schema + server: DB tests 8 cases, live)
- [x] Images upload to allowed storage locations and can be removed and reordered; foreign uploads are refused (DB + UI + live)
- [x] Paused, removed, draft and hidden listings don't appear to borrowers (RLS; DB + live)
- [x] Existing bookings keep their agreed price, title and terms after listing edits (DB test on seeded booking B01)
- [x] Availability calendar with manual blocks and existing reservations; blocks can't overlap held bookings
- [x] Listing reports and moderation status (report → hide/dismiss → restore; lender notified)
- [ ] **Owner device check:** as Leo, create a listing with a real photo from the phone, publish, pause, block dates, preview; as Admin, review a report (create one in Phase 7 or via `e2e:journey-b`)

**Gate 6: automated and live end-to-end checks PASSED (2026-11-18); awaiting the owner's on-device check.**

### Known issues
1. The phone-number guard for pickup and equipment notes is client-side only (D47). Add server enforcement in a later migration.
2. Students can only report a listing once the Phase 7 listing detail exists (the RPC and admin queue work now; exercised live by Journey B).
3. Demo state changed by manual testing (e.g. Bea now borrows and lends) persists until `npm run db:reset-demo -- --confirm <ref>`.
4. Carried over: hold-expiry processing (Phase 8); `npm audit` review (Phase 14).

### Exact next step
The owner runs the Phase 6 device check. Then **Phase 7:** borrower discovery: search and categories, filters (date availability, price range, category, condition, trust), sorting, listing detail with lender profile, ratings, badges, pickup, deposit, late fee and the availability calendar, the single shared pricing/date helper with the inclusive-day rule and a full PHP breakdown, report listing, loading/no-result/unavailable/network states, and "can't request your own listing".

---

## Owner feedback fix: dashboard header and Tiggy (2026-11-18)
The owner's device check (Phase 6) confirmed listing creation works and reported too much header whitespace, with Tiggy placed oddly under the greeting.

Causes:
- `ScreenHeader` added a 48 pt bar row whenever a right control existed; on the device, Expo Go's floating gear button also covered the bell.
- Tiggy reserved 76 pt above himself for his bubble.

Fix:
- New `GreetingHeader`: the bell sits on the eyebrow line, and a larger Tiggy stands beside the greeting.
- A "Tiggy has a tip for you" link, with the tip opening in place below; nothing is reserved while it's closed.
- Tiggy gets a periodic greeting **wave**: the whole illustration rocks from the feet, so the artwork is never altered (plan §5.4). It runs only while the screen is focused and is skipped under reduced motion.
- `ScreenHeader` large titles now share the row with the right control.

Tests were added (`greeting-header.test.tsx`).

**Follow-up (2026-11-19):** the owner reported that the greeting slid down when Tiggy was tapped.
- Cause: the "has a tip" link unmounted when the tip opened, which shortened the bottom-aligned text column.
- Fix: the link stays mounted and toggles to "Hide Tiggy’s tip" (single line), so the column height is constant and only the bubble appears below. The test asserts the toggle row persists.
- Checks: `npm test` 346/346; typecheck and lint clean.

---

## Phase 7: Borrower discovery, search, listing detail, price preview (2026-11-18)

### Files added or changed
- **Migration** `…014_discovery.sql`:
  - `app_private.is_trusted_lender` / `lender_rating` (one Trusted Lender rule, now also used by `get_profile_summary`)
  - `listing_is_free` (holds past their payment window don't block)
  - `search_listings` (keyword in title, description or category; category; date availability; price range; conditions; trusted only; minimum lender rating; sort featured/newest/price/rating; excludes own listings; verified students and staff only)
  - `get_listing_unavailable_dates` (merged ranges, generic reason, no booking identities)
  - `quote_booking` (server price: inclusive days, subtotal, deposit, total, late fee, commission, lender net, Manila due time, availability; refuses own listing, past or inverted dates, too long / too far ahead)
  - Sample settings `max_rental_days` (30) and `max_advance_days` (90)
- **Domain:** `src/domain/pricing.ts`, the **single app pricing/date helper** (`rentalDays`, `commissionAmount`, `quoteRental`, `checkRentalDates`, `dueLabelFor`); `src/domain/search.ts` (filter model, count, clear, price range, server args)
- **Repositories:** `discovery.ts` (search, borrower listing, unavailable dates, quote, lender listings, categories, request window, report)
- **Screens:**
  - `explore/search`: debounced keyword; filter sheet (category, dates, price, condition, trusted, rating); filter count; Clear all; sort; result count; editorial result rows; empty/loading/offline states
  - `explore/listing/[id]`: shared `ListingDetailView`; lender card with badges and lender rating; date pickers with booked/unavailable dates crossed out; instant estimate plus a server-confirmed `PriceBreakdown`; report sheet; own-listing / paused / restricted handling
  - `explore/lender/[id]`: public lender profile and active items
  - `explore/request/[id]`: server quote, rental terms with acceptance; **Send disabled with the reason "Phase 8"**
  - Borrower home: search bar, category shortcuts, tappable featured items, "Browse all"
- **Components:** `PriceBreakdown`, `ResultRow`, `GreetingHeader`; Tiggy `wave` / `external` / `header` size
- **Tooling:** the type generator now emits exact row types for `RETURNS TABLE` functions; the db Jest project maps `@/` (for the parity test)

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D50 | Tiggy's "wave" rocks the whole supplied illustration from the feet; no limbs are cut or redrawn | Owner request + §5.4 "do not redesign the tiger" |
| D51 | Pricing is defined once in the app (`domain/pricing.ts`) and once on the server (SQL), with a **parity test** proving they agree | §2.3/§10.1. The server is authoritative; the app needs instant previews. |
| D52 | Search and quotes are SECURITY DEFINER RPCs that return availability flags and merged date ranges, never other students' booking records | Borrowers need availability; booking privacy (§6.5) still holds |
| D53 | A borrower's own listings are excluded from search; their detail page says "This is your listing" with no request action | Journey C / gate: "borrowers cannot request their own listing" (also enforced by `quote_booking`) |
| D54 | The request review screen exists now, but sending (with the immutable snapshot and terms acceptance) is Phase 8, labelled on a disabled button | Plan order: Phase 8 implements the booking request use case |
| D55 | Rental length and advance-booking limits are sample settings (30 / 90 days) | §0.1.9: no hard-coded policy |

### Commands run and results
| Command | Result |
|---|---|
| `npm test` | **346/346 pass on two consecutive full runs** (app 223 + db 123) |
| `npx tsc --noEmit` / `npx expo lint` / `npx expo-doctor` | Pass / 0 problems / 20/20 |
| `npm run db:migrate` | `…014_discovery` applied |
| `npm run db:smoke` | **57/57 live checks pass** (9 new discovery checks: keyword, price filter + sort, trusted filter, own listings excluded, date filter vs real bookings, no booking identities in calendar data, server quote ₱420 for 3 inclusive days, own-listing quote refused, pending students can't search) |
| `npm run e2e:journey-a` / `e2e:journey-b` | Both still pass (regression) |

Bugs found and fixed:
1. **An empty `category` URL parameter became an active "" filter** (it counted as a filter and was sent to the server). It now means no category.
2. Table-returning RPCs were typed `unknown[]`; the generator now emits exact row types.
3. A garbled line in a new test was replaced; an ambiguous Tiggy query in an older test was made specific after the header gained a second tip control.

### Gate 7 checklist
- [x] Search by title, description or category returns the expected seeded listings (DB + live)
- [x] Every filter and sort changes results; clearing restores the full set (DB + UI + live)
- [x] Availability previews match backend conflicts: the search date filter, calendar ranges and quote availability all use the same `listing_is_free` / held-booking rules (DB + live)
- [x] Pricing handles same-day, multi-day, month and year boundaries and leap years consistently (unit + parity with SQL)
- [x] Deposit and late fee are visible on the listing and in the breakdown before any request
- [x] Borrowers can't request their own listing (excluded from search; quote refused; UI hides the action)
- [x] Loading, no-result, unavailable and network-error states
- [ ] **Owner device check:** as Bea or Dana, search, filter, open an item, pick dates and review the request; also look at the new dashboard header and Tiggy's wave

**Gate 7: automated and live checks PASSED (2026-11-18); awaiting the owner's on-device check.**

### Known issues
1. Sending the request is Phase 8 (disabled with an explanation).
2. Search paginates server-side (30 per page) but the UI shows the first page only; enough for demo data. Add infinite scroll if listings grow.
3. Carried over: server-side phone-number check for listing notes; hold-expiry processing (Phase 8); `npm audit` review (Phase 14).

### Exact next step
The owner runs the Phase 7 device check. Then **Phase 8:** `request_booking` (snapshot, policy version, terms acceptance), the borrower's request tracking and the lender's request inbox and detail, accept/reject with reasons, an atomic availability check with a row lock and a payment hold with configurable expiry, `PaymentProvider` + `MockPaymentProvider` (deterministic success/failure), demo checkout with result/receipt/expired-hold states, ledger entries, notifications for every step, idempotent checkout, and concurrent-acceptance tests.

---

## Phase 8: Booking request, lender decisions, atomic holds, demo checkout (2026-11-19)

### Files added or changed
- **Migration** `20261119000015_booking_flow.sql` (deployed):
  - `app_private.booking_transition_allowed` + `log_transition`: the single server definition of the booking state machine; every change is validated and appended to `booking_events`.
  - `request_booking(listing, pickup, return, terms_version_id, expected_total, pickup_arrangement)`:
    - Verified, active borrower only. Locks the listing row.
    - Re-checks the request window and availability, and refuses own listing, stale rental terms, a changed price, phone numbers in the note, and overlapping requests by the same borrower.
    - An identical resend returns the existing booking (idempotent).
    - Stores the immutable snapshot (title, condition, rates, deposit, late fee, pickup point, cover, commission bps, due time, policy and terms versions), the priced columns, the terms acceptance and the first event.
    - Notifies both parties.
  - `decide_booking_request(id, accept|reject, reason)`:
    - Only the listing's lender. A rejection needs a reason (3–300 characters).
    - Accept requires an active lender, locks the booking **and the listing row**, sweeps lapsed holds on that listing, and explains any conflict (`dates_taken`, `dates_blocked`, `pickup_passed`, `listing_unavailable`).
    - It then creates the hold with `payment_hold_minutes` (sample 15); the `bookings_no_overlap` exclusion constraint is the final backstop.
    - Repeating the same decision returns the first result. Both parties are notified.
  - `pay_booking_demo(id, idempotency_key, scenario)`: the mock gateway.
    - Locks the booking; the same key replays the original result; an already-paid booking returns its payment.
    - A lapsed hold is released (and reported) instead of charged.
    - Success: one `payments` row (`provider = 'mock'`), a balanced ledger (borrower payment = rent payable + platform commission + deposit held), status `confirmed`.
    - Failure: a `failed` payment row, hold released (`cancelled`, reason recorded), no ledger lines.
    - Both parties are notified either way.
  - `expire_hold` / `expire_stale_holds` / `sweep_expired_holds()`: lazy, idempotent expiry on **server time** (`FOR UPDATE SKIP LOCKED`). Writes an `expired` payment record and notifies both parties.
  - `get_booking_detail(id)`: parties and staff only. Returns agreement, money split, counterpart (name, verification, role rating), terms, history, payment attempts, the server clock for countdowns, and (lender/staff) the conflict reason.
  - `list_booking_requests()`: the lender inbox (pending with conflict flags, holds, last 30 days of decisions).
  - `quote_booking` now shares `check_request_window` with `request_booking`.
  - `validate_listing_fields` now rejects phone numbers in pickup notes server-side (closes the Phase 6 known issue).
- **Domain:** `src/domain/bookings.ts`:
  - transition table (parity-tested against SQL)
  - holding statuses, conflict messages, server-clock countdown, available actions per role, reject-reason check, inbox grouping
  - `hasPhoneNumber` exported from `domain/listings.ts`
- **Providers:** `src/providers/payments/{types,mock}.ts`. `PaymentProvider` interface, `MockPaymentProvider` ("Demo payment", deterministic success/failure scenarios), per-attempt idempotency keys.
- **Repositories:**
  - `bookings.ts` (`bookingFlowRepository`: request, decide, detail, inbox, sweep)
  - `bookingsRepository.listMine` sweeps lapsed holds first
  - `BookingSummary.holdExpiresAt`
- **Screens:**
  - `explore/request/[id]`: **Send request** enabled once terms are accepted. It sends the server-confirmed total and the terms version, offers an optional pickup note (no phone numbers), and handles price/terms/date conflicts by refreshing and asking for re-acceptance.
  - `booking/[id]`: shared by both parties.
    - Status with a plain-language explainer, and a live hold countdown on the server clock.
    - Lender **Accept** (confirm dialog) / **Decline** (reason chips or free text); a conflict banner disables Accept with the reason.
    - Counterpart card; pickup and return; the agreed price (borrower `PriceBreakdown` / lender `LenderPayout`: gross, commission, estimated net, deposit kept apart).
    - Accepted terms and policy; link to the payment record; history timeline.
  - `booking/[id]/checkout`: visibly simulated.
    - The countdown and a "no card/GCash/Maya/bank details" banner.
    - A **Simulate success / Simulate failure** choice; the pay button is guarded against double taps, with one idempotency key per visit.
    - Success (confirmation and reference), failure and expired-hold result states.
  - `booking/[id]/receipt`: demo receipt (reference, time, method, line items, total). The lender/staff view adds the commission split; failed and expired attempts are listed too.
  - `lender/requests`: the real inbox (new requests with conflict warnings, waiting for payment, recent decisions), replacing the Phase 8 scaffold.
  - My Rentals rows and lender dashboard rows open the booking; awaiting-payment rows show "Pay … by HH:MM".
  - Booking notifications now open `/booking/[id]` directly.
- **Tests:**
  - `supabase/tests/booking-flow.test.ts` (24)
  - `src/test/unit/booking-rules.test.ts`
  - `src/test/components/booking-flow.test.tsx`
  - Repository sweep robustness test
  - `asCommit` / `errorAsCommit` added to the db harness
- **Live tooling:**
  - `scripts/journey-c.mjs` (`npm run e2e:journey-c`) with real concurrent requests over separate connections and transactional clean-up of everything it creates.
  - `db-smoke` section 12 (booking guards, read-only).

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D56 | The price, terms and policy snapshot is taken **when the request is sent** (the borrower's agreed numbers) and never re-priced on acceptance or payment | §2.4/§10.1: later listing or policy edits must not rewrite an agreement. The borrower pays exactly what they accepted. |
| D57 | Hold expiry is **lazy and server-timed**: holds past `hold_expires_at` never block availability, are swept before accepts and booking reads (`sweep_expired_holds`), and checkout releases them instead of charging. There is no background scheduler yet. | §10.1 "use server time". Expo Go + free tier has no worker; Phase 9 reminders will add scheduled processing. |
| D58 | A **failed** demo payment releases the hold immediately: the booking becomes `cancelled` with the reason "Demo payment failed, so the hold was released." The borrower can send a new request. | §2.4 "a failed or expired payment releases the hold". The enum has no `payment_failed` booking status, and `awaiting_payment → cancelled` is an allowed transition. |
| D59 | Failed and expired payments write a `payments` record (audit trail) but **no ledger lines** | No simulated money moved; the ledger records only money movements (§2.5 "as appropriate"). |
| D60 | The demo outcome is the borrower's explicit choice (sample setting `payment_provider_mode = mock_user_choice`); `mock_always_succeed` / `mock_always_fail` are honoured server-side for Phase 12's admin modes | §2.5 deterministic success/failure scenarios; the server, not the client, records the result |
| D61 | Lender cannot accept another person's request: callers who aren't the listing's lender get `not_found` (no information leak). Restricted lenders may still decline but not accept. | §2.9: restricted accounts can't start new rentals, but must not be stuck with open requests |
| D62 | Multiple pending requests may share dates; only acceptance creates a hold (listing row lock + exclusion constraint). Other overlapping requests stay pending with a visible "Dates no longer available" conflict until declined. | §2.4 wording; the lender decides, nothing is auto-rejected silently |
| D63 | Borrower cancellation of a pending request is **not** offered yet | It belongs to Phase 10's versioned cancellation policy engine; offering it now would bypass that policy |

### Commands run and results
| Command | Result |
|---|---|
| `npm run db:types` | Regenerated; new RPC arg/return types (incl. `list_booking_requests` rows) |
| `npm test` | **393/393 pass on two consecutive full runs** (app 250 + db 143) |
| `npx tsc --noEmit` / `npx expo lint` / `npx expo-doctor` | Pass / 0 problems / 20/20 |
| `npm run db:migrate` | `20261119000015_booking_flow` applied |
| `npm run db:smoke` | **66/66 live checks pass.** New booking checks: pending students can't request, outdated terms refused, own listing refused, only the lender decides, only the borrower pays, details hidden from non-parties, borrower detail has the receipt and no lender-only data, the inbox loads, anon can't sweep, no direct table writes. |
| `npm run e2e:journey-c` | **Passed end-to-end live.** Steps covered: concurrent double-tap request gives one booking; two overlapping requests with **concurrent acceptance** gave 1 hold + 1 "dates no longer available"; hold 15.0 min; reasoned decline; concurrent double-tap payment gives one payment and 4 balanced ledger lines (10% commission on rent only, deposit held); confirmed dates no longer requestable; failure and expiry both release the hold; all 7 notification types sent; 4 test bookings cleaned up; append-only triggers verified re-enabled. |
| `npm run e2e:journey-a` / `e2e:journey-b` | Both still pass (regression) |

Bugs found and fixed:
1. **A failing expiry sweep could have broken the bookings list.** If building the sweep call threw synchronously, the error escaped `listMine`. The sweep is now always contained; a regression test was added.
2. The booking detail read the terms version from the acceptance snapshot, whose keys differ between seeded and new bookings. It now reads the immutable `terms_versions` row.
3. A test assumed Bea could be refused for "dates unavailable" on the DSLR. She already holds those dates, and the server correctly answers "duplicate request"; the test now checks both cases.

### Gate 8 checklist
- [x] A request is visible to its borrower and lender only (RLS, detail RPC, inbox; DB + live)
- [x] A lender cannot accept a request for another person's listing (DB + live)
- [x] Two overlapping requests cannot both become held/confirmed (listing lock + exclusion constraint; DB backstop test + live)
- [x] **Concurrent** acceptance gives one valid hold and one clear conflict response (live, two connections)
- [x] A successful mock payment confirms the booking exactly once (same-key and new-key retries, concurrent double tap; DB + UI + live)
- [x] Failed/expired payment releases the hold, adds no ledger lines and never creates a completed rental (DB + UI + live)
- [x] Commission (10% of rent, half-up) and deposit are shown separately and calculated correctly (ledger + borrower/lender/receipt views)
- [x] Double-tapping checkout doesn't duplicate payments or ledger entries (UI guard + idempotency key + DB + live)
- [x] Both parties are notified for request, acceptance, rejection, payment success/failure and expiry (DB + live)
- [ ] **Owner device check** (see Exact next step)

**Gate 8: automated and live checks PASSED (2026-11-19); awaiting the owner's on-device check.**

### Known issues
1. Expiry is lazy (D57): an expired hold shows its new status the next time anyone opens bookings, but the server never treats it as held after its deadline. A scheduled sweep comes with Phase 9 reminders.
2. Borrowers can't withdraw a pending request yet (D63, Phase 10).
3. Booking messages, handover and return are Phase 9; the rentals banner says so.
4. Carried over: search shows the first page only; `npm audit` review (Phase 14).

### Exact next step
Owner device check:
1. As `bea.borrower@tigrent.test`, open an item, pick dates, review, accept the terms and **Send request**.
2. As `leo.lender@tigrent.test`, open **Requests**, open it, and **Accept** (or Decline with a reason).
3. As Bea, open the rental: the countdown runs. **Pay (demo)**, try **Simulate failure** once on another request, and open the receipt.

Then **Phase 9:** rental timeline, handover confirmations, booking messaging, reminders (with scheduled processing), extensions and returns.

---

## Phase 9: Rental timeline, handover, messaging, reminders, extension, return (2026-11-19)

The owner approved Phase 8 and asked to proceed.

### Files added or changed
- **Migration** `20261119000016_rental_lifecycle.sql` (deployed):
  - **Handover:** `confirm_handover(booking, notes, photos)`.
    - The lender confirms first, then the borrower confirms receipt; only then does the booking become `active`.
    - Available from `handover_opens_days_before` (sample 1) before pickup until the return date.
    - Notes are stored in `handover_reports`; photos must be the caller's own uploads in `evidence/{booking}/{user}/`.
  - **Messages:**
    - A trigger gives every booking a two-person conversation (existing bookings backfilled).
    - `send_message` (participants only; closed for declined/cancelled/expired bookings; one notification per unread stretch).
    - `mark_conversation_read` (also clears its notifications), `get_conversation` (participants + staff), `list_my_conversations(role)` (unread counts).
  - **Extensions** (plan §2.8):
    - `request_extension`: borrower, while active and before the due time. Priced at the agreed daily rate. Refused if the extra days are already taken or blocked, or exceed `max_rental_days`. One open request per booking.
    - `decide_extension`: lender only. A rejection needs a reason. Approval locks the listing, re-checks conflicts and **holds the extra days** for `payment_hold_minutes`.
    - `pay_extension_demo`: idempotent. On success it records the payment and a balanced ledger (`extension_payment` = `rent_payable` + `platform_commission`) and only then updates `return_date`, `due_at`, `rental_days` and the priced columns. A failure or expiry leaves the original dates.
    - `list_extension_requests` for the lender inbox.
    - Extension holds are now respected by `listing_is_free`, `request_conflict` and the calendar ranges (functions replaced).
  - **Return:**
    - `submit_return`: borrower; active/overdue → `return_requested`; cancels open extensions.
    - `confirm_clean_return`: lender; on-time only. It sets `completed`, records the inspection, and **releases the deposit by simulated refund** (refund row + `deposit_released`/`refund` ledger lines, idempotent).
    - Late returns are refused with an explanation (Phase 10).
  - **Reminders and time-based changes:** `app_private.process_reminders()`.
    - Expires lapsed booking and extension holds, and marks `active → overdue` after the due time (pending extensions expire then).
    - Sends pickup (today/tomorrow), due-soon (`reminder_due_soon_hours`, sample 24) and lender follow-ups (`reminder_followup_hours`, sample 6) for undecided extensions and uninspected returns.
    - Every reminder has a deterministic dedupe key; due-time keys re-arm after an extension.
    - It runs **every 5 minutes via pg_cron** on the hosted project (verified succeeded) and via `process_due_events()` whenever the app reads bookings. `sweep_expired_holds` now delegates to it.
  - `get_booking_detail` now also returns:
    - handover, return, extensions (with lender-side conflict), refunds and conversation id
    - handover-opens date, live late days, and event kinds/metadata
  - Seed: messages look conversations up by booking. Migration-created settings (`max_rental_days`, `max_advance_days`, the new sample settings) are also in `seed.sql`, so a demo reset keeps them.
- **Domain:** `src/domain/rental.ts`:
  - `lateDays` (same rule as SQL)
  - `extensionQuote`
  - `rentalActions` (who can do what, and why not)
  - `rentalMilestones` (the shared timeline)
- **Providers:** `PaymentProvider.payExtension` (mock).
- **Repositories:**
  - `bookingFlowRepository`: confirmHandover, submitReturn, confirmCleanReturn, requestExtension, decideExtension, extensionInbox; reads run `process_due_events`
  - `messagesRepository` (list, get, send, markRead)
  - `signedEvidenceUrls`
- **Screens and components:**
  - `booking/[id]`:
    - Rental panel: handover/receipt steps with notes; return; inspection, with **Report a problem disabled and labelled Phase 10**; overdue banner with the agreed late fee; completed state showing the released deposit.
    - Extension cards: lender conflict, approve (dialog) and decline (reason).
    - **Message** link; private handover/return photos (signed URLs).
    - **Rental timeline** (requested → accepted → paid → picked up → due back → returned → completed) plus the full history with labelled event kinds.
  - `booking/[id]/extend`: date picker with taken days crossed out, extra-rent quote, request, waiting state, demo payment with countdown and double-tap guard, and result states.
  - `messages/[id]`: chat with 8-second refresh while open, read state and "Seen", and a closed state.
  - Borrower and lender **Messages** tabs now list real conversations with unread counts, replacing the scaffolds.
  - Lender **Requests** gains an **Extension requests** section.
  - The receipt lists extension payments and the deposit refund separately.
  - Message notifications open the conversation.
  - `EvidenceSheet`: notes plus up to 4 photos uploaded to the private `evidence` bucket.
- **Tests:**
  - `supabase/tests/rental-lifecycle.test.ts` (21)
  - `src/test/unit/rental-rules.test.ts`
  - `src/test/components/rental-lifecycle.test.tsx` (13)
  - RLS test updated for booking-linked conversations
- **Live tooling:**
  - `scripts/journey-d.mjs` (`npm run e2e:journey-d`), with full clean-up
  - `db-smoke` section 13 (13 read-only lifecycle and messaging checks)

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D64 | Time-based work (hold expiry, overdue, reminders) runs in one idempotent server function, **scheduled every 5 min with pg_cron** on the hosted project and also triggered whenever the app reads bookings. In-app notifications are the only delivery channel; push/email aren't configured (the `channel` column is ready). | Phase 9 "scheduled/in-app reminder abstraction"; plan allows simulated push/email. Closes Phase 8 known issue 1 (lazy-only expiry). |
| D65 | Handover order: the lender confirms first, then the borrower confirms receipt. The window opens 1 day before pickup (sample setting) and closes after the return date. | §2.7 / Journey D.2 "active only after the defined handover checks complete" |
| D66 | **Clean, on-time returns complete the booking and release the deposit (simulated refund) now.** Late, damaged, incomplete and missing outcomes, late-fee charging and deposit withholding stay in Phase 10: a late return waits in `return_requested` with an explanation, and "Report a problem" is disabled and labelled. | Gate 9 requires "clean return completes the booking"; §2.7 says a clean return releases the deposit. Completing while still holding the deposit would leave an inconsistent ledger. |
| D67 | Late days run from the agreed due time to the **borrower's return submission** (the handback moment the lender then confirms), counting each started 24 h (sample `late_day_rounding`) | §2.7 "never before the due time"; a slow inspection must not create late days |
| D68 | A *pending* extension isn't a hold (others may still book those days). Approval re-checks under the listing lock and holds the extra days until payment, and the due date changes only on payment success. When the rental becomes overdue, pending extensions expire; at return, open ones are cancelled. | §2.8 |
| D69 | Every booking gets a conversation automatically. Messaging closes for declined/cancelled/expired bookings. Notifications are one per unread stretch. The chat refreshes every 8 s while open rather than using realtime. Staff can read conversations for support. Report/block controls come with Phase 11 moderation. | §4.1, Phase 9 check "visible only to participants and support/admin" |
| D70 | Restricted members keep full access to existing bookings: messages, return, extension status | §2.9 "active bookings and support remain accessible" |
| D71 | Settings created by migrations are also listed in `seed.sql` | A demo reset truncates settings and reloads only the seed; found while adding Phase 9 settings |

### Commands run and results
| Command | Result |
|---|---|
| `npm run db:types` | Regenerated (new RPCs incl. `list_my_conversations` / `list_extension_requests` row types) |
| `npm test` | **434/434 pass on two consecutive full runs** (app 270 + db 164) |
| `npx tsc --noEmit` / `npx expo lint` / `npx expo-doctor` | Pass / 0 problems / 20/20 |
| `npm run db:migrate` | `20261119000016_rental_lifecycle` applied. pg_cron is installed; job `tigrent-due-events` (`*/5 * * * *`) ran and **succeeded** at 03:55 UTC. All bookings have conversations. |
| `npm run db:smoke` | **79/79 live checks pass.** 13 new: conversations exist, participant read, non-participants can't read/send/list, lender can't return, borrower can't inspect, lender can't extend, unknown extension refused, non-party handover refused, anon can't run the job, extension inbox loads. |
| `npm run e2e:journey-d` | **Passed end-to-end live** (Bea rents one of Leo's items today). Steps covered: messages with unread count and one notification per stretch; private to participants; receipt refused before handover; handover + receipt → active; lender can't extend; approved extension holds the extra day; failed extension payment keeps the due date; approval alone doesn't move it; concurrent double-tap payment moves it once, with a balanced 3-line ledger; lender can't return, borrower can't inspect; clean return completes and releases the deposit once; item available again; identical timelines for both sides; re-running the job sends no duplicates; all 13 notification types sent; cleaned up. |
| `npm run e2e:journey-a` / `-b` / `-c` | All still pass (regression) |

Bugs found and fixed:
1. **Demo reset would drop sample settings created by migrations** (`max_rental_days`, `max_advance_days`). The app only worked because of code fallbacks. Fixed by listing them in the seed (D71).
2. A helper returning both a row and a value couldn't be used with `SELECT … INTO` in PL/pgSQL; it now returns the locked row only.
3. The rental panel read the device clock during render (React purity lint); it now uses the server time returned with the booking.
4. Void RPCs return `null` data, which the generic runner treats as "not found"; `mark_conversation_read` uses `runMaybe`.

### Gate 9 checklist
- [x] Both parties see the same booking timeline; permissions are correct per side (DB + live: identical event lists)
- [x] A borrower can't confirm lender-only steps (handover first, inspection) and vice versa (borrower-only return and extension) (DB + UI + live)
- [x] Messages are visible only to participants, and to staff for support (DB + live)
- [x] A successful extension changes the due date only after payment success (DB + UI + live)
- [x] A failed extension payment leaves the original due date intact; expiry too (DB + live)
- [x] Extension conflicts are detected and the lender can't approve them (DB + UI)
- [x] A clean return completes the booking and makes the item available again (DB + live)
- [x] Reminder scheduling is idempotent: no duplicate in-app notifications (DB + live)
- [x] Confirmed → active → completed, with messaging, extension and return reflected on both roles (Journey D live)
- [ ] **Owner device check** (see Exact next step)

**Gate 9: automated and live checks PASSED (2026-11-19); awaiting the owner's on-device check.**

### Known issues
1. Late, damaged, incomplete or missing returns can't be completed until Phase 10 (D66). The seeded overdue tripod rental (Dana → Mika) demonstrates this.
2. Push/email notifications aren't configured; in-app only (honest; D64).
3. Chat refreshes by polling (8 s) and has no attachments or report/block yet (Phase 11 moderation).
4. Borrowers can't withdraw a pending request or extension yet (Phase 10 cancellation engine).
5. Carried over: search shows the first page only; `npm audit` review (Phase 14).

### Exact next step
Owner device check (best right after `npm run db:reset-demo -- --confirm ixxeqiiusexgmavcrxmh`):
1. As `bea.borrower@tigrent.test`, rent one of Leo's items **starting today** (request → Leo accepts → Bea pays).
2. As Leo: open the booking → **Message Bea** → **Confirm handover** (try adding a photo).
3. As Bea: **Confirm receipt** (the timeline moves to "Due back") → **Request more days** → as Leo approve → as Bea pay (demo). Try **Simulate failure** once and see the due date stay.
4. As Bea: **Return item** → as Leo: **Confirm clean return**. The booking completes and the receipt shows the deposit refund.
5. Check both **Messages** tabs and the notifications.

Then **Phase 10:** cancellation policy and refund previews, late-fee settlement, deposit withholding, damage/missing-item disputes with private evidence, moderator resolution and appeals.

---

## Phase 10: Cancellation, refund, late fee, deposit, damage and dispute resolution (2026-11-20)

The owner asked to continue with Phase 10.

### Files added or changed
- **Migration** `20261120000017_exceptions.sql` (deployed):
  - **One settlement path** `app_private.settle_booking_money(booking, rent_refund, deposit_to_lender, category, key, reason)`:
    - Creates one refund record linked to the booking payment (never overwriting it) and balanced, idempotent ledger lines.
    - Lines: deposit released → `deposit_released`/`refund`; deposit withheld → `deposit_withheld` and lender `late_fee` / `damage_compensation` / `cancellation_adjustment`, with commission only if the sample settings say so.
    - A rent refund re-bases the lender payable and the platform commission on the rent kept (`cancellation_adjustment` lines).
    - Helpers: `post_ledger` (skips zero lines, unique keys) and `pct` (half-up).
  - **Cancellation policy engine:** `app_private.cancellation_quote` uses the policy version stored on the booking and covers every §2.6 scenario:
    - pending cancelled by the borrower;
    - borrower before pickup (time windows; unpaid holds cost nothing);
    - lender before pickup (100%; reason required);
    - TigRent withdrawing a listing (staff, 100%);
    - payment failure/timeout (Phase 8, nothing charged);
    - after pickup refused → return or dispute;
    - dispute-driven → moderator decision.
    - `preview_cancellation(id)` returns the breakdown and a plain explanation. `cancel_booking(id, reason, expected_refund)` refuses if the amount changed since the preview, and is idempotent.
  - **Late fees:** `confirm_clean_return` replaced. The agreed `late_fee_per_day` (booking snapshot) × started late days is withheld from the deposit, capped at it, and the rest is released. `return_reports` records the outcome (`clean`/`late`), late days and fee.
  - **Disputes:**
    - `report_return_problem` (lender at inspection: damaged/incomplete, claim ≤ deposit, photos)
    - `report_not_returned` (lender, only after the due time; `missing_item`, severe)
    - `open_dispute` (borrower while out/returning: not as described/payment/other, ≤ rent paid)
    - Opening a case moves the booking to `disputed`; one open case per booking. Evidence must be the caller's own uploads (stored in `dispute_evidence`); return/inspection photos also count.
    - `respond_to_dispute`: the awaited party's reply → `under_review`. Staff may message and ask a party.
    - `resolve_dispute`: staff only. Deposit to lender + rent refund + completed/cancelled, settled once, audited.
    - `appeal_dispute`: once, within the sample `dispute_appeal_days` = 7. `decide_appeal`: staff; closes with a recorded note.
    - `get_dispute` (parties + staff), `list_disputes` (queue ordered by appeal/review/severity/age).
  - `get_booking_detail` now also returns `late_fee_now` and the latest `dispute`. `my_lender_earnings()` gives net simulated earnings.
- **Domain:** `src/domain/exceptions.ts`:
  - dispute status and category labels
  - `canOfferCancel`
  - `lateFeeSettlement`
  - `checkClaimAmount` / `checkDescription`
  - `decisionPreview` (who gets what)
  - `rentalActions` gains `reportReturnProblem` / `reportNotReturned` / `reportProblem`; late returns can now be confirmed
- **Repositories:**
  - `bookingFlowRepository`: previewCancellation, cancel, reportReturnProblem, reportNotReturned, openDispute
  - `disputesRepository` (get, list, respond, resolve, appeal, decideAppeal)
  - `ledgerRepository.myPayables` now uses the server's net earnings
- **Screens and components:**
  - Booking: **Cancel request/booking** with a `CancelSheet`.
    - Server refund preview: rent %, deposit %, total, what the lender keeps, "Sample policy" label.
    - A lender must give a reason; the screen re-previews if the window moved.
  - Rental panel:
    - Late-fee preview and confirmation; **Report a problem** (lender at inspection, borrower while out or returning).
    - **Report not returned** (lender when overdue).
    - A dispute banner with **Open the case**.
    - The completed state shows the late fee and the refund.
  - `ProblemSheet` (outcome/category chips, claim within the held amount, description, private photos).
  - `dispute/[id]`:
    - Summary with the money held, the late fee, private evidence by party, and the conversation; "Your reply is needed".
    - The decision box, and a one-time appeal.
    - Moderator **decision panel** with a who-gets-what preview and confirm dialog; appeal review.
  - `admin/disputes` queue (open/all); the admin hub row is now enabled.
  - The receipt lists every refund with its reason.
  - Dispute notifications open the case.
  - `EvidenceSheet` gains extra fields and a photo toggle.
- **Seed:** `dispute_appeal_days` added (survives a demo reset).
- **Tests:**
  - `supabase/tests/exceptions.test.ts` (22: the full §2.6 matrix and policy-version snapshot; late fees on time / late / capped; damage dispute, privacy, responses, staff-only decision, idempotent settlement, appeal; not-returned escalation; not-as-described rent refund; earnings)
  - `src/test/unit/exception-rules.test.ts`
  - `src/test/components/exceptions.test.tsx` (11)
  - Phase 9 tests updated where Phase 10 intentionally changed behaviour (late returns now complete)
- **Live tooling:**
  - `scripts/journey-e.mjs` (`npm run e2e:journey-e`)
  - `db-smoke` section 14 (12 checks)
  - The Phase 7 date-filter check now uses the seeded booking's real dates (it drifted as days passed)

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D72 | Cancellations use the **policy version stored on the booking**. Time windows count to the start of the pickup day (00:00 Manila); once the pickup day starts (before handover) the lowest window applies. The user confirms the previewed amount and the server refuses if it changed. | §2.6 "previewed before confirmation"; versioned policy; deterministic results |
| D73 | Rent kept after a borrower's late cancellation goes to the lender as compensation, with commission re-based to 10% of the rent kept, through `cancellation_adjustment` lines | §2.5/§2.6 "explain who receives what"; commission only on retained rent |
| D74 | The late fee (the agreed per-day fee × started late days) is withheld from the deposit **automatically at return confirmation**, capped at the deposit. Any excess isn't collected in the prototype, which says so. Commission on late fees/damage follows the sample settings (off). | The fee was disclosed and accepted, so this is a recorded, rule-based path (§2.7). The prototype only holds the deposit. |
| D75 | Damage or missing-item compensation comes **only from a moderator decision**, never the lender. Claims are capped at the deposit held; borrower refund requests at the rent paid. | §2.7 "no unilateral conversion of the deposit" |
| D76 | A dispute moves the booking to `disputed` (one open case per booking). The awaited party's reply → `under_review`; staff can ask a party. Decisions set deposit-to-lender, rent refund and completed/cancelled, settled once. | §2.7 finite dispute states; Phase 10 checks |
| D77 | One appeal per case within 7 days (sample). The review records the outcome and closes the case; money already moved isn't reversed automatically (a correction would be a recorded manual step). | Plan asks for appeal states; reversing simulated money is out of prototype scope |
| D78 | "Not returned" is a lender escalation available only after the due time; nothing is ever marked lost automatically | §2.7 |
| D79 | Lender earnings are computed on the server, net of refunds and adjustments, plus late fees and compensation | The dashboard would otherwise over-count after refunds |
| D80 | Journey E's test evidence photo can't be deleted afterwards (no user delete policy on `evidence`; hosted Supabase forbids SQL deletes on storage). One tiny private orphan per run, unreachable once its booking is gone. | Keeps evidence immutable for real users |

### Commands run and results
| Command | Result |
|---|---|
| `npm run db:types` | Regenerated |
| `npm test` | **473/473 pass on two consecutive full runs** (app 287 + db 186) |
| `npx tsc --noEmit` / `npx expo lint` / `npx expo-doctor` | Pass / 0 problems / 20/20 |
| `npm run db:migrate` | `20261120000017_exceptions` applied |
| `npm run db:smoke` | **91/91 live checks pass.** 12 new: server refund preview; non-parties can't preview; lenders decline rather than cancel requests; "not returned" refused before due; disputes refused before pickup; party reads the case; case private; non-parties can't reply; only moderators decide; queue lists the case; server-side earnings; anon refused. |
| `npm run e2e:journey-e` | **Passed end-to-end live.** Pending cancel (no refund); stale refund amount refused; 50% window refunds exactly the preview, once, balanced; lender cancel needs a reason and refunds everything; late return withholds the agreed fee and releases the rest; evidence upload is private (outsider upload refused, outsider URL refused, party loads it); damage report keeps the deposit held; replies move it to review; only staff decide; decision withholds once and refunds the rest, balanced; one appeal, closed by review; all exception notifications sent; cleaned up (one private evidence orphan, D80). |
| `npm run e2e:journey-a` … `-d` | All still pass (regression); append-only triggers re-enabled; pg_cron runs succeeding |

Bugs found and fixed:
1. **The dispute status had no explicit type cast** (`CASE` text → `dispute_status`); opening any dispute would have failed.
2. **`list_disputes` had an ambiguous `id`** (its output column against a sub-query); the queue would have failed for everyone.
3. Switching the active cancellation policy in one statement violated the one-active index; the test now switches in two steps (the admin tool in Phase 12 must too; noted for Phase 12).
4. The Phase 7 smoke check drifted with the calendar (fixed offsets against a seed made on an earlier day).

### Gate 10 checklist
- [x] Every §2.6 cancellation scenario has a deterministic expected result (DB matrix + live)
- [x] Refund amounts match the configured policy and are previewed before the user confirms (DB + UI + live)
- [x] Repeated refund requests do not duplicate refunds (cancel and resolve repeated; DB + live)
- [x] The deposit is never revenue and is released/withheld only through a recorded path (ledger checks; balanced every time)
- [x] A late fee is never charged before the due time and uses the accepted fee snapshot (live listing fee changed in the test; DB + live)
- [x] Evidence is private to the parties and staff (RLS + storage; DB + live)
- [x] Moderator resolution produces the right refund, compensation and ledger results (DB + live)
- [x] Active bookings aren't abandoned when a user is restricted: Rico (restricted) returns a late item and the return completes (DB)
- [ ] **Owner device check** (see Exact next step)

**Gate 10: automated and live checks PASSED (2026-11-20); awaiting the owner's on-device check.**

### Known issues
1. Appeals don't reverse money automatically (D77).
2. Late fees beyond the deposit aren't collected (D74).
3. Disputes can't be opened on a completed booking (state machine). The borrower can contest while the return is pending.
4. One private evidence orphan per Journey E run (D80).
5. Carried over: search shows the first page only; chat polls (8 s); `npm audit` review (Phase 14).

### Exact next step
Owner device check (ideally after `npm run db:reset-demo -- --confirm ixxeqiiusexgmavcrxmh`):
1. As Bea: open her confirmed DSLR rental → **Cancel booking**, read the preview (sample policy, refund amounts), and confirm. Then check the payment record's refund.
2. As Bea: rent one of Leo's items starting today → handover → **Return item**. As Leo: **Report a problem** (damaged, a claim, a photo).
3. As Bea: open the case → **Add your side**.
4. As `admin.demo@tigrent.test`: **Disputes** → open the case → **Record decision** → check the who-gets-what preview.
5. As Bea: see the decision and **Appeal**; as admin, close the appeal.
6. Seeded example: the drafting-set case (Leo vs Bea) is waiting for Bea's reply.

Then **Phase 11:** reviews and ratings after completion, trust badges, account-health restrictions from low ratings, review moderation, and account appeals.

---

## Phase 11: Reviews, trust badges, account health and moderation (2026-11-20)

### Recovered implementation state
Phase 11 was already implemented and deployed as migration `20261120000018_trust.sql`, but its handoff entry had not yet been written here. The implementation was reviewed against the master plan before its tests and live journey were rerun.

### Files added or changed
- **Migration** `20261120000018_trust.sql` (deployed):
  - `submit_review`, `list_review_prompts`, `get_booking_reviews`, and `list_reviews`: only booking parties can submit exactly one 1--5-star review after `completed`, within the sample 30-day review window. Server-side target/direction derivation prevents self-review and direct table writes remain denied.
  - `report_review`, `moderate_review`, review report fields, and the staff report queue. Reports do not hide a review; a reasoned moderator keep/hide/restore action is audited. Hidden reviews are excluded from public aggregates, the Trusted Lender badge, and account-health evaluation.
  - `account_health_metrics`, `evaluate_account_health`, `account_status_events`, and restricted-listing visibility. The configurable sample rule is at least three visible ratings averaging below 2.5; it automatically moves only an active account to `paused_pending_review`, then notifies the member and staff once.
  - `submit_account_appeal`, `moderate_account`, `get_my_account_health`, `list_account_reviews`, and `get_account_review`: reasoned moderator lift/restrict/suspend/request-information decisions, append-only status history, audit/notification events, and appeal workflow.
- **App/domain/data:** `src/domain/trust.ts`, `src/repositories/trust.ts`, regenerated `src/types/database.ts`, review components (`StarRating`, prompts, booking review card, review list, report sheet), `/reviews`, `/restricted`, `/admin/reviews`, `/admin/accounts`, and account-review detail.
- **Integration:** completed booking details, borrower rentals, lender dashboard, profile/notification links, and the admin hub now surface reviews, moderation, restrictions, and appeals.
- **Verification:** `supabase/tests/trust.test.ts`, `src/test/unit/trust-rules.test.ts`, `src/test/components/trust.test.tsx`, `scripts/journey-trust.mjs`, and Phase 11 live smoke checks.

### Decisions & deviations
| # | Decision | Reason |
|---|---|---|
| D81 | Reviews are immutable after submission; only the reporter's target may report a received review, and moderation never silently deletes it. | Â§2.9 requires one review per side, auditability, and transparent moderation. |
| D82 | Only currently visible reviews count toward rating aggregates, badge eligibility, and account health. A report alone does not change those signals; a staff hide action does. | Prevents unilateral manipulation while allowing harmful content to be removed after review. |
| D83 | A low-rating rule pauses an account for review rather than automatically suspending it. New booking/listing actions and marketplace visibility stop, but existing rentals, messages, returns, support, and an appeal remain available. | Â§2.9 safety and existing-obligation priority. |
| D84 | Suspension is administrator-only; moderators may lift, restrict, or request information. Every decision requires a member-visible reason and is appended to account history. | Clear authority boundary and transparent review process. |

### Commands run and results
| Command | Result |
|---|---|
| `npm run db:status` | `20261120000018_trust` confirmed applied and the migration history is up to date. |
| `npm run db:types` | Pass; regenerated `src/types/database.ts` (2,178 lines). |
| `npm run test:db -- --runTestsByPath supabase/tests/trust.test.ts` | **12/12 pass**. |
| `npm run test:app -- --runInBand --runTestsByPath src/test/unit/trust-rules.test.ts src/test/components/trust.test.tsx` | **13/13 pass**. |
| `npm run e2e:journey-trust` | **8/8 live steps pass** and the temporary booking, reviews, appeal, and rule change were cleaned up. |
| `npm run db:smoke` | **All live checks pass**, including Phase 11 review, restriction, moderation, account-queue, and public/anonymous-access checks. |
| `npx tsc --noEmit` / `npx eslint src --max-warnings 0` | Pass / pass. |

### Gate 11 checklist
- [x] Only completed bookings can be reviewed; each side reviews the other once; invalid, duplicate, self, and non-party reviews are rejected.
- [x] Rating count/average update from visible reviews and moderation changes them accurately.
- [x] The configurable Trusted Lender badge is granted/removed according to criteria and current account standing, with a criteria explanation.
- [x] One low rating cannot pause an account; the configured count-and-average rule pauses it once and records the reason.
- [x] A restricted account cannot publish or request new rentals; its listings leave search; active rentals, messages, returns, support, and appeal remain reachable.
- [x] Review reports and moderator keep/hide/restore actions are reasoned and audited.
- [x] Account queue, moderator decisions, appeal/request-information flow, staff-only enforcement, notifications, and history are covered by PGlite and live tests.
- [ ] **Owner device check:** complete a seeded rental, submit a review, report it from the recipient side, moderate it as Admin, then sign in as Rico to inspect the restriction, existing rental, and appeal UI.

**Gate 11: automated and live end-to-end checks PASSED (2026-11-20); awaiting the owner's on-device check.**

### Known issues
1. The managed terminal's `npx expo lint` launcher did not return a final summary after more than 90 seconds and left stale worker processes; those exact workers were stopped. The same ESLint configuration completed cleanly against `src`. Re-run `npx expo lint` from a normal local terminal before the final Phase 14 handoff.
2. Carried over: search currently displays its first server page only; message refresh polls every 8 seconds; Phase 14 owns the transitive `npm audit` review.

### Exact next step
**Phase 12:** simulated TigRent Premium at PHP 99/month, entitlement gating for premium tools, lender analytics from ledger data, and audited admin configuration for academic years, validation rules, policies, commission, holds, trust thresholds, late-fee settings, and provider modes.

---

## Phase 12: Premium and administrative configuration (2026-11-20)

### Implementation
- Deployed `20261120000019_premium_and_admin.sql`, immutable corrective `20261120000020_premium_enum_fix.sql`, safe cancellation-policy activation in `20261120000021_cancellation_policy_admin.sql`, and the backend-enforced Premium tools in `20261120000022_premium_tools.sql`.
- Added server-authoritative simulated PHP 99/month Premium: inactive, active, cancelled, expired and payment-failed states; idempotent success/failure checkout; cancellation; notifications; audit events; and balanced subscription-payment ledger entries. The UI never requests payment credentials or claims that money moved.
- Entitlement gates now protect featured placement, ledger-backed simulated analytics, multi-day availability blocks (single-day blocks remain free), and safe bulk pause/unavailable equipment actions. Cancellation/expiry remove access without deleting listings, subscriptions, payments, or ledger history.
- Added the lender Premium screen, dashboard entry, promotion controls, and bulk-equipment surface. The admin hub now includes the versioned policy/settings editor and staff audit log.
- Admins can version all critical existing configuration keys, including academic/verification rules, cancellation policy, commission, holds, trust/badge thresholds, late-fee settings and provider modes. The server writes an audit event and existing booking snapshots remain unchanged.

### Verification
| Command | Result |
|---|---|
| `npm run db:migrate` / `npm run db:types` | Migrations 019–023 applied to the hosted project; generated DB contract refreshed. |
| `npm run test:db -- --runInBand --runTestsByPath supabase/tests/premium.test.ts` | **4/4 pass**: PHP 99 idempotency/balanced ledger, analytics reconciliation, entitlement/admin restriction, policy versions, range/bulk gates, cancellation removal. |
| `npm run test:app -- --runInBand --runTestsByPath src/test/components/listing-management.test.tsx` | **9/9 pass**. The Phase 12 entitlement mock is included in the existing management suite. |
| `npx tsc --noEmit` | Pass. |
| `npm run e2e:journey-f` | **5/5 live steps pass**: locked pre-subscription analytics; idempotent PHP 99 checkout; featured/range/bulk unlock; admin audit visibility; cancellation locks the tools. Temporary data is cleaned up; append-only audit history remains. |

### Gate 12 checklist
- [x] Successful simulated checkout unlocks each intended Premium capability.
- [x] Failed/cancelled/expired plans remove entitlement without destructive data loss.
- [x] PHP 99 is consistent in the UI and persisted payment record.
- [x] Analytics use actual booking/ledger data and refundable deposits are not platform revenue.
- [x] Only administrators can version critical configuration; changes are audited.
- [x] A new cancellation-policy version is safely activated for new bookings while prior snapshots remain intact.
- [ ] **Owner device check:** as Dana, run the visible Premium success/failure and cancellation flow, then as Admin edit a clearly labelled sample setting and inspect its audit entry.

**Gate 12: automated and live end-to-end checks PASSED (2026-11-20); awaiting the owner's on-device check.**

### Known issues
1. The managed terminal's `npx expo lint` wrapper issue remains queued for Phase 14; direct ESLint passed in Phase 11.
2. Carried over: search displays its first server page only; messages poll every 8 seconds; Phase 14 owns the transitive `npm audit` review.

### Exact next step
**Phase 13:** visual polish, Tiggy interactions, accessibility and device refinement across every route.

---

## Phase 13: Visual polish, Tiggy interactions, accessibility and device refinement (2026-11-20)

### Review and verification
- Reviewed the shared visual system across the route tree: warm ambient background, restrained elevation, typography scale, 48pt primary controls, safe-area/tab-bar spacing, keyboard-aware footers, visible focus treatment, loading/error states and responsive image use.
- Tiggy is state-driven and dismissible: truthful contextual tips only, tap/press reaction, web hover reaction, grounding halo and focus-aware wave. The motion provider respects both the system setting and a persisted in-app **Reduce motion** preference; nonessential ambient and mascot motion stop when enabled.
- Contrast is token-tested, tabs expose tab roles/selected state, controls have labels/hints, and text styles support dynamic scaling with sensible limits for dense controls.
- `npx expo export --platform web` completed successfully, bundling every Expo Router route and assets.

### Checks
| Command | Result |
|---|---|
| `npm run test:app -- --runInBand --runTestsByPath src/test/components/tiggy-motion.test.tsx src/test/unit/theme-contrast.test.ts src/test/navigation/shell.test.tsx` | **39/39 pass**. |
| `npx expo export --platform web` | Pass; 71 route bundles and all static assets emitted. |

### Gate 13 checklist
- [x] Tiggy tips are contextual, accessible, dismissible and reduced-motion aware.
- [x] Automated contrast, navigation semantics and shared-motion checks pass.
- [x] Web production export succeeds.
- [ ] **Owner device visual QA:** capture and inspect major routes at target sizes, large text and keyboard-open states on Android and iOS; assess scrolling/performance and any clipping/overlap.

**Gate 13: code and automated accessibility checks PASSED (2026-11-20); awaiting owner device visual QA.**

---

## Phase 14: Regression, security review, demo readiness and handoff (2026-11-20)

### Regression and security evidence
- Corrected a Phase 12 regression with `20261120000023_premium_availability_gate_order.sql`: existing booked-date conflicts now take precedence over the Premium range gate. Free lenders retain single-day blocks; valid multi-day blocks remain Premium-only.
- All hosted migrations are applied through 023. Journey B now deliberately validates the free single-day block, while Journey F validates the Premium multi-day block.
- Live Journeys A, B, C, D, E, trust (E.5--E.7) and F pass, each cleaning up temporary core data. Journey E leaves its documented private evidence orphan because hosted Storage disallows direct SQL deletion.
- RLS/storage targeted tests pass **30/30**; smoke checks again confirm private buckets, signed URLs, anonymous refusal, cross-user isolation, role enforcement and protected state changes.
- `npm audit --omit=dev --audit-level=high` reports **0 vulnerabilities**. A production web export contains the public URL/key as intended; bundle scan found no database password, demo password or `sb_secret_` key value.

### Delivery artifacts
- `docs/DEMO_GUIDE.md` includes credentials, reset protection, commands, all live scenarios and simulation wording.
- `docs/DATA_MODEL.md` documents tables, protected RPCs, money/ledger semantics, privacy and authorization.
- `docs/IMPLEMENTATION_SUMMARY.md` separates completed features, simulated integrations and production work.

### Gate 14 checklist
- [x] Hosted migration history is up to date; targeted app/database/RLS/storage checks, direct ESLint and TypeScript pass.
- [x] All six core live journeys (A--F, with trust as E.5--E.7) pass after the Phase 12 calendar regression fix.
- [x] Payment failure/retry, missing/private uploads, backend errors, expired holds/sessions and access-control denial paths are covered by automated and live journeys.
- [x] No service-role/secret key is bundled; private documents, messages and evidence are protected by live checks.
- [x] Demo reset refuses without its explicit project-ref confirmation.
- [ ] **Owner final checks:** normal-terminal `npx expo lint`; authorized fresh demo reset; Android/iOS device performance and screenshot review.

**Gate 14: automated, live and documentation handoff checks PASSED (2026-11-20); final sign-off awaits the owner device/normal-terminal checks above.**

---

## Live Revisions & Visual Polish (Post-Phase 14)

### 2026-11-20: Discovery UI Refinement & Sort Control Fix
- **Issue Reported**: Floating, orphaned `"Sort"` text in `src/app/explore/search.tsx` sticking out above the `[Filters]` button due to `SelectField` form-label nesting in a flex-end toolbar.
- **Resolutions**:
  - Realigned toolbar using a dedicated Sort trigger pill (`ArrowUpDown` + active label + `ChevronDown`), matching the 38pt height and geometry of `[Filters]`.
  - Added dedicated Sort `Sheet` with clean checkmark options.
  - Added `hideLabel` support to `TextField` for modern search header styling.
  - Injected category Lucide icons and updated selected `Chip` styling to UST Tiger Gold (`colors.primary`) with warm elevation.
  - Elevated `ResultRow` cards with soft shadow, golden star ratings, and vibrant status badges (`✨ Featured`, `🛡️ Trusted Lender`).
  - Elevated Borrower Home ([src/app/borrower/index.tsx](src/app/borrower/index.tsx)) with a styled pill search hero card, category icons, and featured student listing tags.
- **Files**: `src/app/explore/search.tsx`, `src/features/discovery/ResultRow.tsx`, `src/app/borrower/index.tsx`, `src/components/design-system/TextField.tsx`, `src/components/design-system/Chip.tsx`, `src/components/design-system/Banner.tsx`, `TigRent_Master_Implementation_Plan.md`.
- **Checks**: `npx tsc --noEmit` pass; `npm run test:db` (16/16 suites, 202 tests pass). Live hot-reload verified on iOS device.

### 2026-11-20: Discover Tab Spotlight & Tiggy Autonomous Speech Dialogue
- **Automated "Featured from Students" Spotlight Showcase**:
  - Replaced manual swipe carousel in `src/app/borrower/index.tsx` with an autonomous Spotlight Showcase card that auto-advances every 3.8s without manual left/right scrolling friction.
  - Added slide indicator progress pills (`● ○ ○`), live item index badges (`Featured · 1/N`), floating price chips, category pill tag, condition status, and direct "Check Availability" call-to-action button.
- **De-cluttered & Segmented UI/UX (Zero Wordy Text Stacks)**:
  - Eliminated stacked paragraph text from "Your rentals", "Upcoming pickups", and "Due back next".
  - Introduced clean visual segmentations:
    - **Rental Overview Bento Strip**: Compact segmented grid for Active rentals, Upcoming pickups, and Pending requests with quick-glance count badges.
    - **Compact Due-Back Banner**: Amber alert pill showing countdown to return deadline without verbose prose.
    - **Quick Exploration Chips**: High-intent filters ("Budget Gear <₱200", "UST Verified Gear", "Top Rated 4.5★+").
  - Varied font typography hierarchy: modern bold titles (`largeTitle`), clean uppercase tracked category metadata (`overline`), and vibrant high-contrast badges.
- **Tiggy's Autonomous 30s Speech Cloud Dialogue**:
  - Transformed `src/components/shared/GreetingHeader.tsx` from click-to-open into an autonomous dialogue assistant.
  - Tiggy automatically pops out a dialogue speech cloud every 30 seconds with tips on how to use the app and campus rental advice.
  - Designed a connected speech cloud bubble featuring a comic tail (`transform: [{ rotate: '45deg' }]`) pointing directly to Tiggy's mouth on the right side of the header.
  - Included a subtle dismiss button (`X`) and polite screen-reader accessibility (`accessibilityLiveRegion="polite"`), with zero manual clicking required.
- **Checks**: `npx tsc --noEmit` pass (0 errors). Dev server running cleanly on Metro.

### 2026-11-20: Profile Tab Role Switch Navigation Fix
- **Issue**: Clicking "Lending" in the Profile tab while in borrower mode navigated to `/lender` (Lender Dashboard) instead of staying in the Profile tab.
- **Fix**:
  - Enhanced `RoleSwitcher` (`src/features/auth/RoleSwitcher.tsx`) to inspect active route segments (`useSegments()`, `usePathname()`) and accept an explicit `screen` prop.
  - When switching roles from `profile` or `messages`, the switcher now preserves the active screen in the destination role area (e.g. `/borrower/profile` → `/lender/profile`).
  - Updated `ProfileScreen.tsx` to pass `screen="profile"` and updated `enableRole` redirect.
  - Updated `src/test/navigation/guards.test.tsx` expectation.
- **Checks**: `npx tsc --noEmit` pass (0 errors).

### 2026-11-20: Creative Multi-Tab Enhancements & Spatial Polish
- **Smooth Automated Spotlight Transitions**:
  - Implemented `Animated.View` entering/exiting transitions with cubic easing and animated progress pill indicators in `src/app/borrower/index.tsx`.
- **Tiggy Head Speech Cloud Positioning**:
  - Positioned dialogue speech cloud directly above Tiggy's head in `src/components/shared/GreetingHeader.tsx` (`bottom: 96, right: -8`) with comic tail pointing down into the head.
- **Rentals Tab Modernization & Spacing**:
  - Completely redesigned `src/app/borrower/rentals.tsx` with elevated rental cards, gold package icon badges, timeline date pill, price breakdown, urgency alert, and icons on filter chips.
  - Separated the guarantee banner with generous `spacing.xxl` (32px) top margin to fix the crowding issue.
- **Messages & Profile Tabs**:
  - Modernized `src/features/messages/ConversationList.tsx` with student conversation cards, avatar circles with initials, and unread badges.
  - Added Student Identity Hero Card in `src/features/profile/ProfileScreen.tsx` with gold-ringed avatar and verification status.
- **Equipment Tab Polish**:
  - Upgraded `src/app/lender/equipment.tsx` with distinct elevated cards and rounded photo thumbnails.
- **Full Upper Header Redesign & Bounded Tiggy Dialogue**:
  - Replaced artificial pills and floating text with a personalized student top bar (Avatar initials + `Hi, {Name} 👋` + UST Manila status).
  - Placed the dialogue bubble safely inside the horizontal mascot hero row to guarantee it is never cut on top.
  - Connected the right-facing speech tail (`tailRight`) directly into Tiggy's raised waving hand.
  - Added an interactive campus prompt card when the tip is closed so the upper-left is always active and never empty.
- **Lender Dashboard Handovers Card Fix**:
  - Simplified metric label in `src/app/lender/index.tsx` from `'Handovers (7 days)'` to `'Handovers'`.
  - Added centered label alignment in `src/components/shared/Layout.tsx` to eliminate cut-off parentheses and text truncation.
- **Profile Tab Strategic Redesign & Redundancy Elimination**:
  - Cleaned `ScreenHeader` to remove duplicate student name and email.
  - Added in-place name editing pencil in `studentHeroCard`, eliminating duplicate "Edit name" row.
  - Made student verification badge interactive with direct link to `/onboarding/status`, eliminating duplicate "Verification status" row.
  - Removed redundant static "Roles" list; replaced with contextual `unlockRoleCard` when `missingRole` is present.
  - Segmented account options into cohesive "Activity & feedback" and "Support & policies" groups.
- **Tab Switch Content Displacement & Top Inset Fix**:
  - Added `contentInsetAdjustmentBehavior="never"` and `automaticallyAdjustContentInsets={false}` on `Screen.tsx` to prevent iOS UIKit from injecting double insets on tab switch.
  - Replaced `<SafeAreaView>` with direct `useSafeAreaInsets()` `{ paddingTop: insets.top, ... }` padding to ensure rock-solid, zero-jump layout bounds.
  - Provided `initialMetrics={initialWindowMetrics}` to root `<SafeAreaProvider>`.
- **Verification Status Tiggy Enlargement**:
  - Added `xl: 220` size specification to `Tiggy.tsx`.
  - Upgraded Tiggy on `/onboarding/status` from `size="sm"` (`72px`) to `size="xl"` (`220px`) with animated greeting wave and contextual tips for all statuses.
- **Removed Developer Route Map**:
  - Removed "Developer route map" button from `src/app/(auth)/welcome.tsx` footer.
  - Removed `src/app/dev/index.tsx` route map screen.
- **Checks**: `npx tsc --noEmit` pass (0 errors).
