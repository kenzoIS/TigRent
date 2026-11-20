import { createTestDb, DEMO, type TestDb } from './harness';

/**
 * Phase 11 gate (backend): reviews only after completion and once per side, aggregates follow moderation,
 * configurable Trusted Lender badge, configurable low-rating rule (never on one rating), restrictions that
 * block new marketplace actions but keep obligations, staff-only decisions with audit, appeals (plan §2.9).
 */
let db: TestDb;
let today = '';
let termsId = '';
const plus = async (n: number) => (await db.sql<{ d: string }>(`select to_char($1::date + $2::int, 'YYYY-MM-DD') as d`, [today, n]))[0]!.d;
const L = {
  casio: '11111111-0000-4000-8000-000000000001',
  projector: '11111111-0000-4000-8000-000000000003',
  tripod: '22222222-0000-4000-8000-000000000001',
  ringLight: '22222222-0000-4000-8000-000000000002',
  ti84: '22222222-0000-4000-8000-000000000003',
  architect: '33333333-0000-4000-8000-000000000001',
};
const SEED = { danaProjectorActive: 'bbbbbbbb-0000-4000-8000-000000000002' };

const one = async <T>(who: string, sql: string, params: unknown[] = []) => (await db.asCommit<{ r: T }>(who, sql, params))[0]!.r;
const status = async (user: string) => (await db.sql<{ s: string }>(`select account_status s from public.profiles where id = $1`, [user]))[0]!.s;
const num = async (sql: string, params: unknown[] = []) => Number((await db.sql<{ n: string }>(sql, params))[0]!.n);
const review = (who: string, booking: string, rating: number, comment: string | null = null) =>
  one<string>(who, `select public.submit_review($1, $2, $3) as r`, [booking, rating, comment]);

async function active(borrower: string, lender: string, listing: string, from: number, to: number) {
  const id = await one<string>(borrower, `select public.request_booking($1, $2::date, $3::date, $4) as r`, [listing, await plus(from), await plus(to), termsId]);
  await one(lender, `select public.decide_booking_request($1, 'accept') as r`, [id]);
  await one(borrower, `select public.pay_booking_demo($1, $2, 'success') as r`, [id, `pay-${id}`]);
  await one(lender, `select public.confirm_handover($1) as r`, [id]);
  await one(borrower, `select public.confirm_handover($1) as r`, [id]);
  return id;
}
async function completed(borrower: string, lender: string, listing: string, from: number, to: number) {
  const id = await active(borrower, lender, listing, from, to);
  await one(borrower, `select public.submit_return($1) as r`, [id]);
  await one(lender, `select public.confirm_clean_return($1) as r`, [id]);
  return id;
}

beforeAll(async () => {
  db = await createTestDb({ seed: true });
  today = (await db.sql<{ d: string }>(`select to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as d`))[0]!.d;
  termsId = (await db.sql<{ id: string }>(`select id from public.terms_versions where doc_type = 'rental_terms' and is_active`))[0]!.id;
});
afterAll(async () => {
  await db.close();
});

describe('reviews', () => {
  let rental = '';
  it('only completed rentals can be reviewed, and only by their parties', async () => {
    expect(await db.errorAsCommit(DEMO.dana, `select public.submit_review($1, 5)`, [SEED.danaProjectorActive])).toMatch(/conflict.not_completed/);
    expect(await db.errorAsCommit(DEMO.bea, `select public.submit_review($1, 5)`, [SEED.danaProjectorActive])).toMatch(/not_found.booking/);
  });
  it('each side reviews the other once; ratings are 1–5; self-reviews are impossible', async () => {
    rental = await completed(DEMO.bea, DEMO.leo, L.casio, 0, 0);
    const prompts = await db.as<{ booking_id: string; my_role: string }>(DEMO.bea, `select * from public.list_review_prompts()`);
    expect(prompts.find((p) => p.booking_id === rental)?.my_role).toBe('borrower');
    const before = (await db.as<{ s: { lender_rating: { count: number } } }>(DEMO.bea, `select public.get_profile_summary($1) as s`, [DEMO.leo]))[0]!.s.lender_rating.count;
    expect(await db.errorAsCommit(DEMO.bea, `select public.submit_review($1, 6)`, [rental])).toMatch(/validation.rating/);
    await review(DEMO.bea, rental, 5, 'Clean calculator, on time.');
    expect(await db.errorAsCommit(DEMO.bea, `select public.submit_review($1, 4)`, [rental])).toMatch(/conflict.already_reviewed/);
    await review(DEMO.leo, rental, 4, 'Returned on time.');
    expect((await db.as<{ booking_id: string }>(DEMO.bea, `select * from public.list_review_prompts()`)).find((p) => p.booking_id === rental)).toBeUndefined();
    const after = (await db.as<{ s: { lender_rating: { count: number } } }>(DEMO.bea, `select public.get_profile_summary($1) as s`, [DEMO.leo]))[0]!.s.lender_rating.count;
    expect(after).toBe(before + 1);
    const err = await db.sql(`insert into public.reviews (booking_id, reviewer_id, target_id, direction, rating) values ($1, $2, $2, 'borrower_to_lender', 5)`, [rental, DEMO.bea])
      .then(() => null, (e: Error) => e.message);
    expect(err).toMatch(/check/);
    expect(await db.errorAs(DEMO.bea, `insert into public.reviews (booking_id, reviewer_id, target_id, direction, rating) values ($1, $2, $3, 'borrower_to_lender', 5)`, [rental, DEMO.bea, DEMO.leo])).toMatch(/permission denied/);
    const both = (await db.as<{ r: { mine: { rating: number }; theirs: { rating: number } } }>(DEMO.bea, `select public.get_booking_reviews($1) as r`, [rental]))[0]!.r;
    expect([both.mine.rating, both.theirs.rating]).toEqual([5, 4]);
  });
  it('reviews close after the configured window', async () => {
    const late = await completed(DEMO.dana, DEMO.mika, L.ti84, 0, 0);
    await db.sql(`update public.bookings set completed_at = now() - interval '31 days' where id = $1`, [late]);
    expect(await db.errorAsCommit(DEMO.dana, `select public.submit_review($1, 5)`, [late])).toMatch(/conflict.review_window/);
    expect((await db.as<{ booking_id: string }>(DEMO.dana, `select * from public.list_review_prompts()`)).find((p) => p.booking_id === late)).toBeUndefined();
  });
  it('reports queue a review without hiding it; moderators keep or hide it and aggregates follow', async () => {
    const id = (await db.sql<{ id: string }>(`select id from public.reviews where booking_id = $1 and reviewer_id = $2`, [rental, DEMO.bea]))[0]!.id;
    expect(await db.errorAsCommit(DEMO.bea, `select public.report_review($1, 'my own')`, [id])).toMatch(/forbidden.own_review/);
    await db.asCommit(DEMO.leo, `select public.report_review($1, 'Not accurate')`, [id]);
    expect((await db.as<{ id: string }>(DEMO.admin, `select id from public.list_reported_reviews()`)).some((r) => r.id === id)).toBe(true);
    const count = async () => (await db.as<{ s: { lender_rating: { count: number } } }>(DEMO.dana, `select public.get_profile_summary($1) as s`, [DEMO.leo]))[0]!.s.lender_rating.count;
    const visibleCount = await count();
    expect(await db.errorAsCommit(DEMO.leo, `select public.moderate_review($1, 'hide', 'I want it gone')`, [id])).toMatch(/forbidden.staff_only/);
    await db.asCommit(DEMO.admin, `select public.moderate_review($1, 'hide', 'Off-topic content')`, [id]);
    expect(await count()).toBe(visibleCount - 1);
    expect((await db.as<{ id: string }>(DEMO.dana, `select id from public.list_reviews($1)`, [DEMO.leo])).some((r) => r.id === id)).toBe(false);
    expect((await db.as<{ id: string }>(DEMO.leo, `select id from public.list_reviews($1)`, [DEMO.leo])).some((r) => r.id === id)).toBe(true); // target still sees it
    await db.asCommit(DEMO.admin, `select public.moderate_review($1, 'restore', 'Restored after review')`, [id]);
    expect(await count()).toBe(visibleCount);
    expect(await num(`select count(*) n from public.audit_logs where entity_id = $1 and action like 'review.%'`, [id])).toBe(2);
  });
});

describe('Verified Trusted Lender badge (configurable)', () => {
  const trusted = async () => (await db.as<{ s: { trusted_lender: { earned: boolean } } }>(DEMO.bea, `select public.get_profile_summary($1) as s`, [DEMO.mika]))[0]!.s.trusted_lender.earned;
  it('is granted and removed by the configured criteria', async () => {
    expect(await trusted()).toBe(true);
    await db.sql(`update public.platform_settings set value = '{"min_completed_lendings": 5, "min_avg_rating": 4.95, "no_unresolved_severe_disputes": true}' where key = 'trusted_lender_rule' and is_current`);
    expect(await trusted()).toBe(false);
    await db.sql(`update public.platform_settings set value = '{"min_completed_lendings": 5, "min_avg_rating": 4.5, "no_unresolved_severe_disputes": true}' where key = 'trusted_lender_rule' and is_current`);
    expect(await trusted()).toBe(true);
  });
  it('is removed while the account is restricted, and returns when lifted', async () => {
    await one(DEMO.admin, `select public.moderate_account($1, 'restrict', 'Temporary restriction for the badge test.') as r`, [DEMO.mika]);
    expect(await trusted()).toBe(false);
    await one(DEMO.admin, `select public.moderate_account($1, 'lift', 'Restriction lifted after the badge test.') as r`, [DEMO.mika]);
    expect(await trusted()).toBe(true);
  });
});

describe('low-rating rule and restrictions', () => {
  let stillOut = '';
  it('one low rating never pauses an account; meeting the configured rule does', async () => {
    stillOut = await active(DEMO.dana, DEMO.mika, L.tripod, 0, 0); // an obligation that must survive the pause
    const r1 = await completed(DEMO.dana, DEMO.leo, L.casio, 1, 1);
    await review(DEMO.leo, r1, 1, 'Late and unresponsive.');
    expect(await status(DEMO.dana)).toBe('active');
    const r2 = await completed(DEMO.dana, DEMO.mika, L.ringLight, 1, 1);
    await review(DEMO.mika, r2, 1, 'Returned damaged.');
    // Dana now has ≥3 visible ratings averaging below 2.5 (sample rule) → paused automatically.
    const m = (await db.as<{ h: { metrics: { review_count: number; avg_rating: number; rule_met: boolean } } }>(DEMO.dana, `select public.get_my_account_health() as h`))[0]!.h.metrics;
    expect(m.rule_met).toBe(true);
    expect(await status(DEMO.dana)).toBe('paused_pending_review');
    expect(await num(`select count(*) n from public.account_status_events where user_id = $1 and actor_id is null`, [DEMO.dana])).toBe(1);
    expect(await num(`select count(*) n from public.notifications where user_id = $1 and type = 'account.paused'`, [DEMO.dana])).toBe(1);
  });
  it('blocks new rentals and listings, hides the member’s listings, and keeps obligations, messages and support', async () => {
    expect(await db.errorAsCommit(DEMO.dana, `select public.request_booking($1, $2::date, $3::date, $4)`, [L.casio, await plus(20), await plus(21), termsId])).toMatch(/forbidden.account_restricted/);
    expect(await db.errorAsCommit(DEMO.dana, `select public.create_listing($1)`, [JSON.stringify({ title: 'New thing', category: 'calculators', condition: 'good', daily_rate: 1000 })])).toMatch(/forbidden.account_restricted/);
    expect((await db.as<{ id: string }>(DEMO.bea, `select id from public.search_listings()`)).some((r) => r.id === L.architect)).toBe(false);
    expect(await db.errorAsCommit(DEMO.bea, `select public.request_booking($1, $2::date, $3::date, $4)`, [L.architect, await plus(20), await plus(21), termsId])).toMatch(/not_found.listing/);
    // Existing obligations stay manageable.
    const conv = (await db.sql<{ id: string }>(`select id from public.conversations where booking_id = $1`, [stillOut]))[0]!.id;
    expect(await db.errorAsCommit(DEMO.dana, `select public.send_message($1, 'Returning it now.')`, [conv])).toBeNull();
    expect((await one<{ status: string }>(DEMO.dana, `select public.submit_return($1) as r`, [stillOut])).status).toBe('return_requested');
    expect((await db.as(DEMO.dana, `select id from public.bookings where id = $1`, [stillOut])).length).toBe(1);
  });
  it('further low ratings don’t stack automatic actions', async () => {
    await one(DEMO.mika, `select public.confirm_clean_return($1) as r`, [stillOut]);
    await review(DEMO.mika, stillOut, 1, 'Again late.');
    expect(await num(`select count(*) n from public.account_status_events where user_id = $1`, [DEMO.dana])).toBe(1);
  });
});

describe('appeals and moderator decisions', () => {
  it('a restricted member appeals once; moderators can ask for more information', async () => {
    expect(await db.errorAsCommit(DEMO.bea, `select public.submit_account_appeal('I am in good standing already.')`)).toMatch(/conflict.not_restricted/);
    expect(await db.errorAsCommit(DEMO.dana, `select public.submit_account_appeal('short')`)).toMatch(/validation.reason/);
    const appeal = await one<string>(DEMO.dana, `select public.submit_account_appeal('Both late returns were caused by a class schedule change.') as r`);
    expect(await db.errorAsCommit(DEMO.dana, `select public.submit_account_appeal('Another appeal while one is open.')`)).toMatch(/conflict.appeal_open/);
    expect((await db.as<{ user_id: string; appeal_status: string }>(DEMO.admin, `select * from public.list_account_reviews()`)).find((r) => r.user_id === DEMO.dana)?.appeal_status).toBe('open');
    await one(DEMO.admin, `select public.moderate_account($1, 'request_info', 'Please share the schedule change notice.') as r`, [DEMO.dana]);
    expect((await db.sql<{ status: string }>(`select status from public.account_appeals where id = $1`, [appeal]))[0]!.status).toBe('needs_info');
    expect(await one<string>(DEMO.dana, `select public.submit_account_appeal('The registrar moved my lab to Friday afternoons.') as r`)).toBe(appeal);
    const a = (await db.sql<{ status: string; reason: string }>(`select status, reason from public.account_appeals where id = $1`, [appeal]))[0]!;
    expect(a.status).toBe('open');
    expect(a.reason).toMatch(/More information: The registrar/);
  });
  it('only staff decide; decisions are recorded, notified and audited; nobody moderates themselves', async () => {
    expect(await db.errorAsCommit(DEMO.leo, `select public.moderate_account($1, 'lift', 'Lifting my friend’s restriction.')`, [DEMO.dana])).toMatch(/forbidden.staff_only/);
    expect(await db.errorAsCommit(DEMO.admin, `select public.moderate_account($1, 'restrict', 'Restricting myself as a test.')`, [DEMO.admin])).toMatch(/forbidden.self/);
    expect(await db.errorAs(DEMO.leo, `select * from public.list_account_reviews()`)).toMatch(/forbidden.staff_only/);
    const r = await one<{ account_status: string; appeal_status: string }>(DEMO.admin, `select public.moderate_account($1, 'lift', 'Schedule change confirmed; restriction lifted.') as r`, [DEMO.dana]);
    expect(r).toEqual({ account_status: 'active', appeal_status: 'lifted' });
    expect(await status(DEMO.dana)).toBe('active');
    expect(await num(`select count(*) n from public.account_status_events where user_id = $1 and actor_id = $2`, [DEMO.dana, DEMO.admin])).toBe(1);
    expect(await num(`select count(*) n from public.audit_logs where entity_id = $1 and action = 'account.active'`, [DEMO.dana])).toBeGreaterThanOrEqual(1);
    expect(await num(`select count(*) n from public.notifications where user_id = $1 and type = 'account.active'`, [DEMO.dana])).toBe(1);
    const h = (await db.as<{ h: { history: unknown[]; appeal: { status: string } } }>(DEMO.dana, `select public.get_my_account_health() as h`))[0]!.h;
    expect(h.appeal.status).toBe('lifted');
    expect(h.history.length).toBe(2);
  });
  it('the seeded restricted member sees why, with the sample rule and history', async () => {
    const h = (await db.as<{ h: { account_status: string; metrics: { rule_met: boolean; rule_is_sample: boolean }; history: unknown[]; open_obligations: number } }>(DEMO.rico, `select public.get_my_account_health() as h`))[0]!.h;
    expect(h.account_status).toBe('paused_pending_review');
    expect(h.metrics.rule_met).toBe(true);
    expect(h.metrics.rule_is_sample).toBe(true);
    expect(h.history.length).toBeGreaterThanOrEqual(1);
  });
});
