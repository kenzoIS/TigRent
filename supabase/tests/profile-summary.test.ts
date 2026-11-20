import { createTestDb, DEMO, type TestDb } from './harness';

/** Phase 5: profile summary, ratings split by role, configurable Trusted Lender badge. */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb({ seed: true });
});
afterAll(async () => {
  await db.close();
});

type Summary = {
  badges: { code: string }[];
  completed_lendings: number;
  lender_rating: { avg: number | null; count: number };
  borrower_rating: { avg: number | null; count: number };
  trusted_lender: { earned: boolean; rule_is_sample: boolean; progress: Record<string, unknown> };
};
const summary = async (viewer: string, target?: string) =>
  (await db.as<{ s: Summary }>(viewer, `select public.get_profile_summary($1) as s`, [target ?? null]))[0]!.s;
const codes = (s: Summary) => s.badges.map((b) => b.code);

it('Mika meets the sample Trusted Lender rule and gets both badges', async () => {
  const s = await summary(DEMO.mika);
  expect(codes(s)).toEqual(['student_verified', 'trusted_lender']);
  expect(s.completed_lendings).toBeGreaterThanOrEqual(5);
  expect(Number(s.lender_rating.avg)).toBeGreaterThanOrEqual(4.5);
  expect(s.trusted_lender.rule_is_sample).toBe(true);
});

it('ratings are split: Rico is rated low as a borrower, not as a lender', async () => {
  const s = await summary(DEMO.rico);
  expect(s.borrower_rating.count).toBe(3);
  expect(Number(s.borrower_rating.avg)).toBeLessThan(2.5);
  expect(s.lender_rating.count).toBe(0);
  expect(codes(s)).toEqual(['student_verified']); // paused account can't hold Trusted Lender
});

it('Leo is verified but below the completed-lendings threshold, with progress explained', async () => {
  const s = await summary(DEMO.bea, DEMO.leo);
  expect(codes(s)).toEqual(['student_verified']);
  expect(s.trusted_lender.earned).toBe(false);
  expect(s.trusted_lender.progress).toMatchObject({ student_verified: true, account_in_good_standing: true });
});

it('the rule is configurable: lowering the threshold grants the badge', async () => {
  await db.exec(`update platform_settings set value = '{"min_completed_lendings": 1, "min_avg_rating": 4, "no_unresolved_severe_disputes": true}' where key = 'trusted_lender_rule'`);
  expect(codes(await summary(DEMO.leo))).toContain('trusted_lender');
  await db.exec(`update platform_settings set value = '{"min_completed_lendings": 5, "min_avg_rating": 4.5, "no_unresolved_severe_disputes": true}' where key = 'trusted_lender_rule'`);
  expect(codes(await summary(DEMO.leo))).not.toContain('trusted_lender');
});

it('an unresolved severe dispute removes the badge', async () => {
  await db.exec(`insert into disputes (booking_id, opener_id, category, severity, description) values ('bbbbbbbb-0000-4000-8000-000000000013', '${DEMO.bea}', 'damage', 'severe', 'Sample severe dispute for test')`);
  expect(codes(await summary(DEMO.mika))).not.toContain('trusted_lender');
  await db.exec(`delete from disputes where description = 'Sample severe dispute for test'`);
});

it('pending students can see only their own summary', async () => {
  expect((await summary(DEMO.paolo)).badges).toEqual([]);
  expect(await db.errorAs(DEMO.paolo, `select public.get_profile_summary($1)`, [DEMO.leo])).toMatch(/forbidden.not_verified/);
  expect(await db.errorAs('anon', `select public.get_profile_summary(null)`)).toMatch(/permission denied/);
});
