# TigRent — agent instructions

**Source of truth:** [TigRent_Master_Implementation_Plan.md](TigRent_Master_Implementation_Plan.md) is the sole basis for all TigRent development. If code, docs, or a request conflicts with it, follow the plan and record the conflict in `docs/IMPLEMENTATION_STATUS.md` → "Decisions & deviations".

## Working rules (from plan §0, §7, §10)
- Implement phases 0 → 14 strictly in order. A phase is done only when its gate checks pass and are recorded in `docs/IMPLEMENTATION_STATUS.md` (status, files, migrations, commands, tests, known issues, next step).
- Screens never own money math, booking transitions, authorization, or verification logic. Those live in `src/domain` + server-side RPCs.
- Money is integer centavos. Rental dates use the single helper in `src/domain/rules` (Asia/Manila, inclusive days, min 1).
- Every simulated integration is labelled in the UI ("Demo payment", "Simulated refund", "Manual student review"). Never claim real money, real SheerID, or UST endorsement.
- No service-role key or secrets in the app or in the repo. RLS is on for every user-data table; documents and evidence live in private buckets behind signed URLs.
- Every visible control works or is disabled with an explanation. No emoji icons; one icon set (lucide).
- Policy values (academic year, email domains, student-ID pattern, cancellation %, thresholds, hold expiry) are admin-configurable data labelled "sample policy", never hard-coded.
- Don't add features outside the plan's scope (§1.2/§1.3).

## Backend workflow (Phase 2+)
- Schema changes go in a new `supabase/migrations/<14-digit>_<name>.sql`. Never edit an applied migration. Then run `npm run db:types`, `npm run test:db`, `npm run db:migrate`, `npm run db:smoke`.
- Protected state changes are `SECURITY DEFINER` RPCs with `set search_path = ''`. Tables stay read-only to `authenticated` except the three column-scoped self-service updates.
- Tests run with `npm test` (Jest projects `app` + `db`; the db project uses PGlite plus `supabase/tests/shim.sql`).
- Demo data: `npm run db:seed` (idempotent) / `npm run db:reset-demo -- --confirm <ref>`. Accounts are in `docs/DEMO_GUIDE.md`.
