import { createTestDb, DEMO, type TestDb } from './harness';

/** Phase 6 gate: listing lifecycle, validation, photos, availability, snapshots, reports (plan §2.3, Phase 6). */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb({ seed: true });
});
afterAll(async () => {
  await db.close();
});

const FIELDS = {
  title: 'Scientific calculator (backup)',
  description: 'Spare calculator.',
  category: 'calculators',
  condition: 'good',
  daily_rate: 3500,
  deposit: 20000,
  late_fee_per_day: 1500,
  pickup_point_id: 'ffffffff-0000-4000-8000-000000000002',
  pickup_notes: 'After 3 PM',
};

/** Runs statements as a user and COMMITS (unlike db.as, which rolls back). */
async function asCommit<T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []): Promise<T[]> {
  let rows: T[] = [];
  await db.pg.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated' })]);
    await tx.exec('set local role authenticated');
    rows = (await tx.query<T>(sql, params)).rows;
  });
  return rows;
}
const putImage = (listingId: string, name: string, size = 120000, mime = 'image/jpeg') =>
  db.sql(`insert into storage.objects (bucket_id, name, metadata) values ('listing-images', $1, $2)`, [`${listingId}/${name}`, JSON.stringify({ size, mimetype: mime })]);

let listingId = '';

describe('create and validate', () => {
  it('only verified, active lenders can create listings', async () => {
    expect(await db.errorAs(DEMO.bea, `select public.create_listing($1)`, [FIELDS])).toMatch(/forbidden.not_lender/);
    expect(await db.errorAs(DEMO.paolo, `select public.create_listing($1)`, [FIELDS])).toMatch(/forbidden.not_lender/);
    expect(await db.errorAs(DEMO.rico, `select public.create_listing($1)`, [FIELDS])).toMatch(/forbidden.account_restricted/);
  });

  it.each([
    ['short title', { title: 'x' }, /validation.title/],
    ['unknown category', { category: 'spaceships' }, /validation.category/],
    ['missing condition', { condition: null }, /validation.condition/],
    ['negative rate', { daily_rate: -1 }, /validation.daily_rate/],
    ['fractional rate', { daily_rate: 10.5 }, /validation.daily_rate/],
    ['negative deposit', { deposit: -100 }, /validation.deposit/],
    ['negative late fee', { late_fee_per_day: -1 }, /validation.late_fee_per_day/],
    ['unknown pickup point', { pickup_point_id: '00000000-0000-4000-8000-000000000000' }, /validation.pickup_point_id/],
  ])('rejects %s', async (_l, patch, msg) => {
    expect(await db.errorAs(DEMO.leo, `select public.create_listing($1)`, [{ ...FIELDS, ...patch }])).toMatch(msg);
  });

  it('creates a draft owned by the lender', async () => {
    listingId = (await asCommit<{ id: string }>(DEMO.leo, `select public.create_listing($1) as id`, [FIELDS]))[0]!.id;
    const [l] = await db.sql<{ status: string; lender_id: string; daily_rate: string }>(`select status::text, lender_id, daily_rate::text from listings where id = $1`, [listingId]);
    expect(l).toEqual({ status: 'draft', lender_id: DEMO.leo, daily_rate: '3500' });
    // Drafts are invisible to borrowers.
    expect(await db.as(DEMO.bea, `select id from listings where id = $1`, [listingId])).toEqual([]);
  });
});

describe('photos', () => {
  it('requires at least one photo to publish', async () => {
    expect(await db.errorAs(DEMO.leo, `select public.set_listing_status($1, 'active')`, [listingId])).toMatch(/validation.photos/);
  });
  it('registers uploaded photos using storage metadata and enforces type/size', async () => {
    await putImage(listingId, 'a.jpg');
    await putImage(listingId, 'b.jpg');
    await putImage(listingId, 'huge.jpg', 9_000_000);
    await putImage(listingId, 'doc.pdf', 1000, 'application/pdf');
    await asCommit(DEMO.leo, `select public.add_listing_image($1, $2)`, [listingId, `${listingId}/a.jpg`]);
    await asCommit(DEMO.leo, `select public.add_listing_image($1, $2)`, [listingId, `${listingId}/b.jpg`]);
    expect(await db.errorAs(DEMO.leo, `select public.add_listing_image($1, $2)`, [listingId, `${listingId}/huge.jpg`])).toMatch(/validation.photo_file/);
    expect(await db.errorAs(DEMO.leo, `select public.add_listing_image($1, $2)`, [listingId, `${listingId}/doc.pdf`])).toMatch(/validation.photo_file/);
    expect(await db.errorAs(DEMO.leo, `select public.add_listing_image($1, $2)`, [listingId, `${listingId}/never.jpg`])).toMatch(/validation.photo_missing/);
    expect(await db.errorAs(DEMO.leo, `select public.add_listing_image($1, $2)`, [listingId, `${listingId}/a.jpg`])).toMatch(/conflict.photo_exists/);
    expect(await db.errorAs(DEMO.dana, `select public.add_listing_image($1, $2)`, [listingId, `${listingId}/a.jpg`])).toMatch(/not_found.listing/);
  });
  it('reorders photos (first = cover) and rejects stale lists', async () => {
    const imgs = await db.sql<{ id: string; path: string }>(`select id, path from listing_images where listing_id = $1 order by sort_order`, [listingId]);
    await asCommit(DEMO.leo, `select public.reorder_listing_images($1, $2::uuid[])`, [listingId, `{${imgs[1]!.id},${imgs[0]!.id}}`]);
    const after = await db.sql<{ path: string }>(`select path from listing_images where listing_id = $1 order by sort_order`, [listingId]);
    expect(after.map((r) => r.path)).toEqual([imgs[1]!.path, imgs[0]!.path]);
    expect(await db.errorAs(DEMO.leo, `select public.reorder_listing_images($1, $2::uuid[])`, [listingId, `{${imgs[0]!.id}}`])).toMatch(/conflict.photos_changed/);
  });
});

describe('lifecycle', () => {
  it('publishes, pauses (hidden from borrowers), reactivates', async () => {
    await asCommit(DEMO.leo, `select public.set_listing_status($1, 'active')`, [listingId]);
    expect((await db.as(DEMO.bea, `select id from listings where id = $1`, [listingId])).length).toBe(1);
    await asCommit(DEMO.leo, `select public.set_listing_status($1, 'paused')`, [listingId]);
    expect(await db.as(DEMO.bea, `select id from listings where id = $1`, [listingId])).toEqual([]);
    await asCommit(DEMO.leo, `select public.set_listing_status($1, 'active')`, [listingId]);
    const [l] = await db.sql<{ status: string; published_at: string | null }>(`select status::text, published_at from listings where id = $1`, [listingId]);
    expect(l!.status).toBe('active');
    expect(l!.published_at).not.toBeNull();
  });
  it('an active listing must keep at least one photo and a positive rate', async () => {
    const imgs = await db.sql<{ id: string }>(`select id from listing_images where listing_id = $1`, [listingId]);
    await asCommit(DEMO.leo, `select public.remove_listing_image($1)`, [imgs[0]!.id]);
    expect(await db.errorAs(DEMO.leo, `select public.remove_listing_image($1)`, [imgs[1]!.id])).toMatch(/validation.photos/);
    expect(await db.errorAs(DEMO.leo, `select public.update_listing($1, $2)`, [listingId, { ...FIELDS, daily_rate: 0 }])).toMatch(/validation.daily_rate/);
  });
  it('cannot go back to draft; others cannot change it', async () => {
    expect(await db.errorAs(DEMO.leo, `select public.set_listing_status($1, 'draft')`, [listingId])).toMatch(/validation.status/);
    expect(await db.errorAs(DEMO.mika, `select public.set_listing_status($1, 'paused')`, [listingId])).toMatch(/not_found.listing/);
    expect(await db.errorAs(DEMO.mika, `select public.update_listing($1, $2)`, [listingId, FIELDS])).toMatch(/not_found.listing/);
  });
  it('a restricted lender may pause but not (re)publish', async () => {
    expect(await db.errorAs(DEMO.rico, `select public.set_listing_status('44444444-0000-4000-8000-000000000001', 'paused')`)).toBeNull();
    expect(await db.errorAs(DEMO.rico, `select public.set_listing_status('44444444-0000-4000-8000-000000000001', 'unavailable')`)).toBeNull();
  });
  it('removal is blocked while requests or rentals are open, then allowed', async () => {
    // Leo's calculator has two pending requests in the seed.
    expect(await db.errorAs(DEMO.leo, `select public.set_listing_status('11111111-0000-4000-8000-000000000001', 'removed')`)).toMatch(/conflict.open_bookings/);
    await asCommit(DEMO.leo, `select public.set_listing_status($1, 'removed')`, [listingId]);
    expect(await db.errorAs(DEMO.leo, `select public.update_listing($1, $2)`, [listingId, FIELDS])).toMatch(/conflict.listing_removed/);
    expect(await db.as(DEMO.bea, `select id from listings where id = $1`, [listingId])).toEqual([]);
  });
});

describe('booking snapshots are immutable (Journey B.6)', () => {
  it('editing price and title does not change an existing booking', async () => {
    const before = (await db.sql<{ daily_rate: string; total: string; t: string }>(
      `select daily_rate::text, total::text, snapshot ->> 'listing_title' as t from bookings where id = 'bbbbbbbb-0000-4000-8000-000000000001'`))[0]!;
    await asCommit(DEMO.leo, `select public.update_listing('11111111-0000-4000-8000-000000000002', $1)`, [{ ...FIELDS, title: 'Renamed DSLR', category: 'photo-video', daily_rate: 99900 }]);
    const after = (await db.sql<{ daily_rate: string; total: string; t: string }>(
      `select daily_rate::text, total::text, snapshot ->> 'listing_title' as t from bookings where id = 'bbbbbbbb-0000-4000-8000-000000000001'`))[0]!;
    expect(after).toEqual(before);
    expect(before.t).toBe('Canon EOS 200D DSLR with 18–55mm lens');
  });
});

describe('availability blocks', () => {
  it('blocks free dates, refuses dates that overlap held bookings, and can be removed', async () => {
    const today = (await db.sql<{ d: string }>(`select to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as d`))[0]!.d;
    const plus = async (n: number) => (await db.sql<{ d: string }>(`select to_char($1::date + $2::int, 'YYYY-MM-DD') as d`, [today, n]))[0]!.d;
    // DSLR (…002) is confirmed for days +3..+5.
    expect(await db.errorAs(DEMO.leo, `select public.add_availability_block('11111111-0000-4000-8000-000000000002', $1, $2)`, [await plus(4), await plus(6)])).toMatch(/conflict.dates_booked/);
    expect(await db.errorAs(DEMO.leo, `select public.add_availability_block('11111111-0000-4000-8000-000000000002', $1, $2)`, [await plus(9), await plus(8)])).toMatch(/validation.dates/);
    const { id } = (await asCommit<{ id: string }>(DEMO.leo, `select public.add_availability_block('11111111-0000-4000-8000-000000000002', $1, $2, 'Exam day') as id`, [await plus(30), await plus(30)]))[0]!;
    expect(await db.errorAs(DEMO.mika, `select public.remove_availability_block($1)`, [id])).toMatch(/not_found.listing/);
    await asCommit(DEMO.leo, `select public.remove_availability_block($1)`, [id]);
    expect(await db.sql(`select id from listing_availability where id = $1`, [id])).toEqual([]);
  });
});

describe('reports and moderation', () => {
  const L = '22222222-0000-4000-8000-000000000003'; // Mika's TI-84
  it('verified students report listings once; owners and pending students cannot', async () => {
    expect(await db.errorAs(DEMO.mika, `select public.report_listing($1, 'Wrong photos')`, [L])).toMatch(/forbidden.own_listing/);
    expect(await db.errorAs(DEMO.paolo, `select public.report_listing($1, 'Wrong photos')`, [L])).toMatch(/forbidden.not_verified/);
    await asCommit(DEMO.bea, `select public.report_listing($1, 'Photos look like a different model')`, [L]);
    expect(await db.errorAs(DEMO.bea, `select public.report_listing($1, 'Again')`, [L])).toMatch(/conflict.already_reported/);
    expect((await db.sql<{ m: string }>(`select moderation_status::text m from listings where id = $1`, [L]))[0]!.m).toBe('reported');
  });
  it('only staff resolve; hiding needs a reason, removes it from browsing, blocks republishing and notifies the lender', async () => {
    const { id } = (await db.sql<{ id: string }>(`select id from listing_reports where listing_id = $1 and status = 'open'`, [L]))[0]!;
    expect(await db.errorAs(DEMO.bea, `select public.resolve_listing_report($1, 'hide', 'Because I said so')`, [id])).toMatch(/forbidden.staff_only/);
    expect(await db.errorAs(DEMO.admin, `select public.resolve_listing_report($1, 'hide', 'no')`, [id])).toMatch(/validation.note_required/);
    await asCommit(DEMO.admin, `select public.resolve_listing_report($1, 'hide', 'Photos show a different calculator model.')`, [id]);
    expect(await db.as(DEMO.leo, `select id from listings where id = $1`, [L])).toEqual([]); // other students: hidden
    expect((await db.as(DEMO.mika, `select id from listings where id = $1`, [L])).length).toBe(1); // owner still sees it
    expect((await db.as(DEMO.dana, `select id from listings where id = $1`, [L])).length).toBe(1); // a booking party keeps access to its rental
    await asCommit(DEMO.mika, `select public.set_listing_status($1, 'paused')`, [L]);
    expect(await db.errorAs(DEMO.mika, `select public.set_listing_status($1, 'active')`, [L])).toMatch(/forbidden.listing_hidden/);
    expect((await db.sql(`select 1 from notifications where user_id = $1 and type = 'listing.hidden'`, [DEMO.mika])).length).toBe(1);
    await asCommit(DEMO.admin, `select public.restore_listing($1, 'Lender replaced the photos.')`, [L]);
    expect(await db.errorAs(DEMO.mika, `select public.set_listing_status($1, 'active')`, [L])).toBeNull();
  });
});
