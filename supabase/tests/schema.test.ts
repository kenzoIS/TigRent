import { createTestDb, DEMO, runSeed, type TestDb } from './harness';

/** Phase 2 gate: migrations apply from empty, seed is repeatable, constraints hold (plan §6.4). */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ seed: true });
});
afterAll(async () => {
  await db.close();
});

const count = async (table: string) => Number((await db.sql<{ n: string }>(`select count(*) as n from ${table}`))[0]!.n);

const TABLES = [
  'profiles', 'user_roles', 'student_verifications', 'listings', 'bookings', 'booking_events', 'payments',
  'refunds', 'ledger_entries', 'reviews', 'notifications', 'messages', 'audit_logs', 'terms_acceptances',
];

describe('migrations + seed', () => {
  it('creates every core table from plan §6.3 with RLS enabled', async () => {
    const rows = await db.sql<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`,
    );
    const names = rows.map((r) => r.tablename);
    for (const t of [
      'academic_years', 'account_appeals', 'audit_logs', 'booking_events', 'booking_terms_acceptances', 'bookings',
      'campus_pickup_points', 'cancellation_policy_versions', 'conversation_participants', 'conversations',
      'dispute_evidence', 'dispute_messages', 'disputes', 'extension_requests', 'handover_reports', 'ledger_entries',
      'listing_availability', 'listing_categories', 'listing_images', 'listing_reports', 'listings', 'messages',
      'notifications', 'payments', 'platform_settings', 'profiles', 'refunds', 'return_reports', 'reviews',
      'student_verifications', 'subscriptions', 'terms_acceptances', 'terms_versions', 'user_roles',
    ]) {
      expect(names).toContain(t);
    }
    expect(rows.filter((r) => !r.rowsecurity).map((r) => r.tablename)).toEqual([]);
  });

  it('seeds the plan §9 demo accounts with the right states', async () => {
    expect(await count(`auth.users where email like '%@tigrent.test'`)).toBe(8);
    const status = async (id: string) =>
      (await db.sql<{ s: string }>(`select app_private.verification_status($1)::text as s`, [id]))[0]!.s;
    expect(await status(DEMO.bea)).toBe('verified');
    expect(await status(DEMO.paolo)).toBe('pending_review');
    expect(await status(DEMO.rina)).toBe('rejected');
    expect(await status(DEMO.admin)).toBe('not_submitted');
    const rico = await db.sql<{ account_status: string }>(`select account_status from profiles where id = $1`, [DEMO.rico]);
    expect(rico[0]!.account_status).toBe('paused_pending_review');
    const roles = await db.sql<{ role: string }>(`select role::text from user_roles where user_id = $1 order by role`, [DEMO.dana]);
    expect(roles.map((r) => r.role)).toEqual(['borrower', 'lender']);
  });

  it('seeds bookings in every important status', async () => {
    const rows = await db.sql<{ status: string }>(`select distinct status::text from bookings`);
    expect(rows.map((r) => r.status).sort()).toEqual(
      ['active', 'awaiting_payment', 'cancelled', 'completed', 'confirmed', 'disputed', 'overdue',
       'payment_expired', 'pending_lender_approval', 'rejected', 'return_requested'].sort(),
    );
  });

  it('keeps the simulated ledger balanced per payment', async () => {
    const unbalanced = await db.sql(`
      select payment_id, sum(debit) d, sum(credit) c from ledger_entries
       where payment_id is not null group by payment_id having sum(debit) <> sum(credit)`);
    expect(unbalanced).toEqual([]);
    // Commission is 10% of rent and never includes the deposit.
    const bad = await db.sql(`select id from bookings where commission <> (subtotal * 1000 + 5000) / 10000`);
    expect(bad).toEqual([]);
  });

  it('is idempotent: running the seed again changes nothing', async () => {
    const before = await Promise.all(TABLES.map(count));
    await runSeed(db);
    const after = await Promise.all(TABLES.map(count));
    expect(after).toEqual(before);
  });

  it('meets the sample trust thresholds on purpose', async () => {
    const [mika] = await db.sql<{ completed_lendings: number; rating_avg: string; review_count: number }>(
      `select completed_lendings, rating_avg::text, review_count from public_profiles where id = $1`, [DEMO.mika]);
    expect(mika!.completed_lendings).toBeGreaterThanOrEqual(5);
    expect(Number(mika!.rating_avg)).toBeGreaterThanOrEqual(4.5);
    const [rico] = await db.sql<{ rating_avg: string; review_count: number }>(
      `select rating_avg::text, review_count from public_profiles where id = $1`, [DEMO.rico]);
    expect(rico!.review_count).toBeGreaterThanOrEqual(3);
    expect(Number(rico!.rating_avg)).toBeLessThan(2.5);
  });
});

describe('constraints (plan §6.4)', () => {
  const err = (q: string, p: unknown[] = []) => db.sql(q, p).then(() => null, (e: Error) => e.message);

  it('allows only one current academic year', async () => {
    expect(await err(`insert into academic_years (label, start_date, end_date, is_current) values ('AY X', '2030-01-01', '2030-12-31', true)`))
      .toMatch(/academic_years_one_current/);
  });

  it('rejects an active listing with a zero rate and negative money', async () => {
    expect(await err(`update listings set daily_rate = 0 where id = '11111111-0000-4000-8000-000000000001'`)).toMatch(/check/i);
    expect(await err(`update listings set deposit = -1 where id = '11111111-0000-4000-8000-000000000001'`)).toMatch(/check/i);
    // Drafts may keep a zero rate until published.
    expect(await err(`update listings set daily_rate = 0 where id = '11111111-0000-4000-8000-000000000006'`)).toBeNull();
  });

  it('blocks overlapping holding bookings for one listing (race-safe inventory)', async () => {
    // B01 holds the DSLR (listing …002) on days +3..+5. A second confirmed booking overlapping it must fail.
    const msg = await err(`
      insert into bookings (listing_id, borrower_id, lender_id, pickup_date, return_date, rental_days, due_at, status,
        snapshot, daily_rate, late_fee_per_day, commission_bps, subtotal, deposit, total, commission, lender_net, policy_version_id, terms_version_id)
      select listing_id, $1, lender_id, pickup_date + 1, return_date + 1, rental_days, due_at + interval '1 day', 'confirmed',
        snapshot, daily_rate, late_fee_per_day, commission_bps, subtotal, deposit, total, commission, lender_net, policy_version_id, terms_version_id
      from bookings where id = 'bbbbbbbb-0000-4000-8000-000000000001'`, [DEMO.dana]);
    expect(msg).toMatch(/bookings_no_overlap/);
  });

  it('forbids self-rental and inconsistent price snapshots', async () => {
    expect(await err(`update bookings set borrower_id = lender_id where id = 'bbbbbbbb-0000-4000-8000-000000000003'`)).toMatch(/check/i);
    expect(await err(`update bookings set total = total + 1 where id = 'bbbbbbbb-0000-4000-8000-000000000003'`)).toMatch(/check/i);
  });

  it('enforces unique idempotency keys and append-only history', async () => {
    expect(await err(`insert into payments (purpose, booking_id, payer_id, amount, idempotency_key)
                      select 'booking', id, borrower_id, total, 'seed:pay:' || id from bookings where id = 'bbbbbbbb-0000-4000-8000-000000000001'`))
      .toMatch(/duplicate key/);
    expect(await err(`update ledger_entries set credit = credit + 1 where id = (select min(id) from ledger_entries)`)).toMatch(/append-only/);
    expect(await err(`delete from booking_events where id = (select min(id) from booking_events)`)).toMatch(/append-only/);
    expect(await err(`delete from audit_logs where id = (select min(id) from audit_logs)`)).toMatch(/append-only/);
  });

  it('never lets refunds exceed the payment', async () => {
    expect(await err(`insert into refunds (payment_id, booking_id, amount, reason, idempotency_key)
                      select id, booking_id, amount + 1, 'too much', 'test:refund:too-much' from payments where idempotency_key = 'seed:pay:bbbbbbbb-0000-4000-8000-000000000001'`))
      .toMatch(/exceed/);
  });

  it('allows one review per reviewer/booking/target and no self-review', async () => {
    expect(await err(`insert into reviews (booking_id, reviewer_id, target_id, direction, rating)
                      values ('bbbbbbbb-0000-4000-8000-000000000013', $1, $2, 'borrower_to_lender', 3)`, [DEMO.bea, DEMO.mika]))
      .toMatch(/duplicate key/);
    expect(await err(`insert into reviews (booking_id, reviewer_id, target_id, direction, rating)
                      values ('bbbbbbbb-0000-4000-8000-000000000013', $1, $1, 'borrower_to_lender', 3)`, [DEMO.bea]))
      .toMatch(/check/i);
    expect(await err(`insert into reviews (booking_id, reviewer_id, target_id, direction, rating)
                      values ('bbbbbbbb-0000-4000-8000-000000000014', $1, $2, 'lender_to_borrower', 6)`, [DEMO.mika, DEMO.dana]))
      .toMatch(/check/i);
  });

  it('computes the inclusive rental-day rule and Manila due time on the server', async () => {
    const [r] = await db.sql<{ same: number; span: number; year: number; due: string }>(`
      select app_private.rental_days('2026-11-18', '2026-11-18') as same,
             app_private.rental_days('2026-11-30', '2026-12-02') as span,
             app_private.rental_days('2026-12-31', '2027-01-01') as year,
             to_char(app_private.manila_timestamp('2026-11-18', '23:59') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as due`);
    expect(r).toEqual({ same: 1, span: 3, year: 2, due: '2026-11-18 15:59' });
  });
});
