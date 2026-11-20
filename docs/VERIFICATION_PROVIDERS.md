# Student verification providers

**Current state: no external verification provider is connected.** TigRent uses **Manual student review (demo)**. A TigRent reviewer (admin/moderator) approves, rejects or requests resubmission. The app labels it that way, and nothing in TigRent claims live UST enrollment access or SheerID verification (plan §1.3, §10.4).

## How it works today
1. The student uploads a registration form to the private `verification-docs/{user_id}/…` bucket. Paths are generated; filenames are never used.
2. `submit_verification(...)` validates it on the server:
   - Terms accepted; no pending or valid verification already
   - Email domain is on `email_domain_allowlist`; student ID matches `student_id_pattern`
   - Academic year is current (or `allow_non_current_academic_year`)
   - At least one role requested
   - The document exists in the user's folder; size and MIME type are taken **from the storage server's metadata**; the file hasn't been used before
3. A row is stored with `provider = verification_provider_mode` (`manual_demo`), status `pending_review`. The student and all staff are notified, and the action is audited.
4. `review_verification(id, approve | reject | request_resubmission, reason)` is staff-only. It locks the row, refuses self-review and double decisions, and requires a reason (≥10 characters) unless approving. On approval it grants the requested roles and sets `expires_at` to the end of the academic year (23:59 Manila). Every outcome notifies the student and is audited.
5. `set_current_academic_year(id)` (admin) expires verifications for other years when `verification_expiry.expire_on_academic_year_change` is on. Affected students are notified and routed to renewal.

## Adding a real provider later (e.g. SheerID)
Prerequisites (not in place): a provider contract, credentials, legal/privacy approval and onboarding (plan §1.3).

1. **Server:** add a server-side adapter (Edge Function or backend job) holding the provider secret. Never put it in the app.
   - On submit, create the provider request and store `provider = 'sheerid'`, `provider_ref` (the provider's verification id) and `provider_status`.
   - Receive the provider's webhook, verify its signature, and call an internal function that applies the same transition rules as `review_verification` (with `reviewed_by = null` and the provider recorded in the audit metadata).
2. **App:** implement `StudentVerificationProvider` (`src/providers/student-verification/types.ts`) with an honest `label`, `isSimulated = false`, and a `submit` that starts the provider flow. Select it in `manual-demo.ts` → `studentVerificationProvider` behind configuration (`verification_provider_mode`).
3. **Fallback:** keep manual review available for students the provider can't verify.
4. **No schema change is required.** `provider`, `provider_ref` and `provider_status` already exist on `student_verifications`.

## Sample configuration (confirm with the product owner)
| Setting | Sample value | Note |
|---|---|---|
| `email_domain_allowlist` | `ust.edu.ph`, `tigrent.test` | `tigrent.test` is demo-only |
| `student_id_pattern` | `^[A-Za-z0-9-]{4,20}$` | The real UST format is unconfirmed |
| `verification_document` | 10 MB; PDF/JPG/PNG/HEIC | The bucket enforces the same limits |
| `verification_expiry` | expire on academic-year change | |
| `allow_non_current_academic_year` | `false` | Documented demo exception only |
