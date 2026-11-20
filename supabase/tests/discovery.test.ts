import { createTestDb, DEMO, type TestDb } from './harness';

/** Phase 7 gate: search, filters, availability previews, server quote, own-listing guard. */
let db: TestDb;
let today = '';
const plus = async (n: number) => (await db.sql<{ d: string }>(`select to_char($1::date + $2::int, 'YYYY-MM-DD') as d`, [today, n]))[0]!.d;

beforeAll(async () => {
  db = await createTestDb({ seed: true });
  today = (await db.sql<{ d: string }>(`select to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as d`))[0]!.d;
});
afterAll(async () => {
  await db.close();
});

type Row = { id: string; title: string; daily_rate: string; lender_trusted: boolean; available_for_dates: boolean; total_count: string; lender_id: string };
const search = (who: string, args: Record<string, unknown> = {}) => {
  const a = {
    q: null, cat: null, start: null, end: null, min: null, max: null, cond: null, trusted: false, rating: null, sort: 'featured', ...args,
  } as Record<string, unknown>;
  return db.as<Row>(who, `select * from public.search_listings($1, $2, $3, $4, $5, $6, $7::public.item_condition[], $8, $9, $10)`,
    [a.q, a.cat, a.start, a.end, a.min, a.max, a.cond, a.trusted, a.rating, a.sort]);
};
const titles = (rows: Row[]) => rows.map((r) => r.title).sort();

describe('search', () => {
  it('only verified students can search; own listings are excluded', async () => {
    expect(await db.errorAs(DEMO.paolo, `select * from public.search_listings()`)).toMatch(/forbidden.not_verified/);
    const leoSees = await search(DEMO.leo);
    expect(leoSees.every((r) => r.lender_id !== DEMO.leo)).toBe(true);
  });
  it('returns active, visible listings only (no drafts, paused or hidden)', async () => {
    const rows = await search(DEMO.bea);
    expect(rows.find((r) => r.title === 'Lab gown (medium)')).toBeUndefined(); // draft
    expect(rows.find((r) => r.title.startsWith('USB-C hub'))).toBeUndefined(); // paused
    expect(Number(rows[0]!.total_count)).toBe(rows.length);
  });
  it('matches keywords in title, description or category label', async () => {
    expect(titles(await search(DEMO.bea, { q: 'calculator' }))).toEqual(['Casio fx-991EX scientific calculator', 'TI-84 Plus graphing calculator']);
    expect(titles(await search(DEMO.bea, { q: 'thesis' }))).toEqual(['Portable projector with HDMI cable']);
    expect((await search(DEMO.bea, { q: 'Photo & video' })).length).toBe(3);
  });
  it('every filter narrows results and clearing restores them', async () => {
    const all = (await search(DEMO.bea)).length;
    expect((await search(DEMO.bea, { cat: 'drafting' })).length).toBeLessThan(all);
    const priced = await search(DEMO.bea, { min: 5000, max: 12000 });
    expect(priced.every((r) => Number(r.daily_rate) >= 5000 && Number(r.daily_rate) <= 12000)).toBe(true);
    expect(priced.length).toBeLessThan(all);
    expect((await search(DEMO.bea, { cond: '{like_new}' })).every((r) => r.title !== 'Travel tripod (155 cm)')).toBe(true);
    const trusted = await search(DEMO.bea, { trusted: true });
    expect(trusted.length).toBeGreaterThan(0);
    expect(trusted.every((r) => r.lender_trusted && r.lender_id === DEMO.mika)).toBe(true);
    expect((await search(DEMO.bea, { rating: 4.5 })).every((r) => r.lender_id === DEMO.mika)).toBe(true);
    expect((await search(DEMO.bea)).length).toBe(all);
  });
  it('sorts by price both ways', async () => {
    const asc = (await search(DEMO.bea, { sort: 'price_asc' })).map((r) => Number(r.daily_rate));
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const desc = (await search(DEMO.bea, { sort: 'price_desc' })).map((r) => Number(r.daily_rate));
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    expect(await db.errorAs(DEMO.bea, `select * from public.search_listings(p_sort => 'random')`)).toMatch(/validation.sort/);
  });
  it('date filter hides items booked or blocked for those dates (matches backend conflicts)', async () => {
    // DSLR (…002) is confirmed for +3..+5 and blocked by Leo for +20..+22.
    const booked = await search(DEMO.dana, { start: await plus(4), end: await plus(4) });
    expect(booked.find((r) => r.id === '11111111-0000-4000-8000-000000000002')).toBeUndefined();
    const blocked = await search(DEMO.dana, { start: await plus(21), end: await plus(23) });
    expect(blocked.find((r) => r.id === '11111111-0000-4000-8000-000000000002')).toBeUndefined();
    const free = await search(DEMO.dana, { start: await plus(8), end: await plus(9) });
    expect(free.find((r) => r.id === '11111111-0000-4000-8000-000000000002')).toBeDefined();
    expect(await db.errorAs(DEMO.dana, `select * from public.search_listings(p_start => $1::date)`, [await plus(1)])).toMatch(/validation.dates/);
  });
});

describe('availability calendar', () => {
  it('returns merged ranges without booking details', async () => {
    const rows = await db.as<{ start_date: string; end_date: string; reason: string }>(DEMO.dana,
      `select to_char(start_date, 'YYYY-MM-DD') start_date, to_char(end_date, 'YYYY-MM-DD') end_date, reason from public.get_listing_unavailable_dates('11111111-0000-4000-8000-000000000002', $1, $2)`,
      [today, await plus(60)]);
    expect(rows).toEqual([
      { start_date: await plus(3), end_date: await plus(5), reason: 'booked' },
      { start_date: await plus(20), end_date: await plus(22), reason: 'unavailable' },
    ]);
  });
});

describe('quote_booking (server price = future snapshot)', () => {
  it('computes inclusive days, subtotal, deposit, total and the Manila due time', async () => {
    const { q } = (await db.as<{ q: Record<string, unknown> }>(DEMO.bea, `select public.quote_booking('11111111-0000-4000-8000-000000000001', $1, $2) as q`, [await plus(30), await plus(32)]))[0]!;
    expect(q).toMatchObject({ rental_days: 3, daily_rate: 4000, subtotal: 12000, deposit: 30000, total: 42000, late_fee_per_day: 2000, commission: 1200, lender_net: 10800, available: true, return_due_time_local: '23:59' });
  });
  it('same-day rental is one billable day', async () => {
    const { q } = (await db.as<{ q: { rental_days: number; subtotal: number } }>(DEMO.bea, `select public.quote_booking('11111111-0000-4000-8000-000000000001', $1, $1) as q`, [await plus(40)]))[0]!;
    expect(q).toMatchObject({ rental_days: 1, subtotal: 4000 });
  });
  it('reports unavailability for booked dates', async () => {
    const { q } = (await db.as<{ q: { available: boolean } }>(DEMO.dana, `select public.quote_booking('11111111-0000-4000-8000-000000000002', $1, $2) as q`, [await plus(4), await plus(6)]))[0]!;
    expect(q.available).toBe(false);
  });
  it('refuses own listings, past dates, inverted ranges, too-long and too-far requests', async () => {
    const L = '11111111-0000-4000-8000-000000000001';
    expect(await db.errorAs(DEMO.leo, `select public.quote_booking($1, $2, $2)`, [L, await plus(5)])).toMatch(/forbidden.own_listing/);
    expect(await db.errorAs(DEMO.bea, `select public.quote_booking($1, $2, $2)`, [L, await plus(-1)])).toMatch(/validation.pickup_past/);
    expect(await db.errorAs(DEMO.bea, `select public.quote_booking($1, $2, $3)`, [L, await plus(5), await plus(4)])).toMatch(/validation.dates/);
    expect(await db.errorAs(DEMO.bea, `select public.quote_booking($1, $2, $3)`, [L, await plus(5), await plus(40)])).toMatch(/validation.too_long/);
    expect(await db.errorAs(DEMO.bea, `select public.quote_booking($1, $2, $2)`, [L, await plus(200)])).toMatch(/validation.pickup_too_far/);
    expect(await db.errorAs(DEMO.bea, `select public.quote_booking('11111111-0000-4000-8000-000000000006', $1, $1)`, [await plus(5)])).toMatch(/not_found.listing/);
  });
});

it('profile summary still reports the same badges after moving the shared Trusted Lender rule', async () => {
  const { s } = (await db.as<{ s: { badges: { code: string }[] } }>(DEMO.bea, `select public.get_profile_summary($1) as s`, [DEMO.mika]))[0]!;
  expect(s.badges.map((b) => b.code)).toEqual(['student_verified', 'trusted_lender']);
});
