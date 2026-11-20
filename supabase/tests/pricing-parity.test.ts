import { commissionAmount, rentalDays } from '../../src/domain/pricing';
import { createTestDb, type TestDb } from './harness';

/** The app's pricing helper and the server's SQL must agree exactly (plan §10.1: no duplicate rules drifting). */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

const DATE_CASES: [string, string][] = [
  ['2026-11-18', '2026-11-18'], ['2026-11-25', '2026-11-27'], ['2026-11-30', '2026-12-02'], ['2026-12-31', '2027-01-01'],
  ['2028-02-28', '2028-03-01'], ['2027-02-28', '2027-03-01'], ['2026-01-01', '2026-01-30'],
];
const MONEY_CASES: [number, number][] = [[12000, 1000], [12345, 1000], [12344, 1000], [1, 1000], [0, 1000], [99_999_999, 1000], [12345, 1250], [500, 0]];

it('rental days match app_private.rental_days', async () => {
  for (const [a, b] of DATE_CASES) {
    const [r] = await db.sql<{ d: number }>(`select app_private.rental_days($1::date, $2::date) as d`, [a, b]);
    expect([a, b, r!.d]).toEqual([a, b, rentalDays(a, b)]);
  }
});

it('commission matches app_private.commission_amount', async () => {
  for (const [rent, bps] of MONEY_CASES) {
    const [r] = await db.sql<{ c: string }>(`select app_private.commission_amount($1::bigint, $2::int)::text as c`, [rent, bps]);
    expect([rent, bps, Number(r!.c)]).toEqual([rent, bps, commissionAmount(rent, bps)]);
  }
});
