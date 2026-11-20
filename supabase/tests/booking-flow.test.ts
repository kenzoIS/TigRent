import { BOOKING_TRANSITIONS } from '@/domain/bookings';
import { createTestDb, DEMO, type TestDb } from './harness';

/**
 * Phase 8 gate (backend): booking request → lender decision → atomic payment hold → demo checkout,
 * including conflicts, idempotency, expiry and ledger balance (plan §2.4, §2.5, Phase 8).
 */
let db: TestDb;
let today = '';
let termsId = '';
const plus = async (n: number) => (await db.sql<{ d: string }>(`select to_char($1::date + $2::int, 'YYYY-MM-DD') as d`, [today, n]))[0]!.d;

const L = {
  casio: '11111111-0000-4000-8000-000000000001',
  dslr: '11111111-0000-4000-8000-000000000002',
  projector: '11111111-0000-4000-8000-000000000003',
  tripod: '22222222-0000-4000-8000-000000000001',
  ringLight: '22222222-0000-4000-8000-000000000002',
  ti84: '22222222-0000-4000-8000-000000000003',
  architect: '33333333-0000-4000-8000-000000000001',
};
const SEED = {
  beaCasioPending: 'bbbbbbbb-0000-4000-8000-000000000003',
  danaCasioPending: 'bbbbbbbb-0000-4000-8000-000000000004',
  danaTi84Awaiting: 'bbbbbbbb-0000-4000-8000-000000000007',
};

const REQUEST = `select public.request_booking($1, $2::date, $3::date, $4, $5, $6) as id`;
async function request(who: string, listing: string, from: number, to: number, opts: { total?: number | null; note?: string | null; terms?: string } = {}) {
  const rows = await db.asCommit<{ id: string }>(who, REQUEST, [listing, await plus(from), await plus(to), opts.terms ?? termsId, opts.total ?? null, opts.note ?? null]);
  return rows[0]!.id;
}
async function requestError(who: string, listing: string, from: number, to: number, opts: { total?: number | null; note?: string | null; terms?: string } = {}) {
  return db.errorAsCommit(who, REQUEST, [listing, await plus(from), await plus(to), opts.terms ?? termsId, opts.total ?? null, opts.note ?? null]);
}
const decide = async (who: string, id: string, decision: string, reason: string | null = null) =>
  (await db.asCommit<{ r: { status: string; hold_expires_at: string | null; repeated: boolean } }>(who, `select public.decide_booking_request($1, $2, $3) as r`, [id, decision, reason]))[0]!.r;
const decideError = (who: string, id: string, decision: string, reason: string | null = null) =>
  db.errorAsCommit(who, `select public.decide_booking_request($1, $2, $3)`, [id, decision, reason]);
type PayResult = { payment_id: string; outcome: string; amount: number; replayed: boolean; booking_status: string; provider: string; provider_ref: string | null };
const pay = async (who: string, id: string, key: string, scenario = 'success') =>
  (await db.asCommit<{ r: PayResult }>(who, `select public.pay_booking_demo($1, $2, $3) as r`, [id, key, scenario]))[0]!.r;
const status = async (id: string) => (await db.sql<{ status: string }>(`select status from public.bookings where id = $1`, [id]))[0]!.status;
const count = async (sql: string, params: unknown[] = []) => Number((await db.sql<{ n: string }>(sql, params))[0]!.n);
const expireNow = (id: string) => db.sql(`update public.bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [id]);

beforeAll(async () => {
  db = await createTestDb({ seed: true });
  today = (await db.sql<{ d: string }>(`select to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as d`))[0]!.d;
  termsId = (await db.sql<{ id: string }>(`select id from public.terms_versions where doc_type = 'rental_terms' and is_active`))[0]!.id;
});
afterAll(async () => {
  await db.close();
});

describe('transition table', () => {
  it('matches src/domain/bookings.ts exactly', async () => {
    const rows = await db.sql<{ f: string; t: string }>(`
      select f::text, t::text from unnest(enum_range(null::public.booking_status)) f, unnest(enum_range(null::public.booking_status)) t
       where app_private.booking_transition_allowed(f, t) order by 1, 2`);
    const server: Record<string, string[]> = {};
    for (const r of rows) (server[r.f] ??= []).push(r.t);
    for (const [from, to] of Object.entries(BOOKING_TRANSITIONS)) {
      expect([...(server[from] ?? [])].sort()).toEqual([...to].sort());
    }
  });
});

describe('request_booking', () => {
  it('only verified, active borrowers can request, and never their own listing', async () => {
    expect(await requestError(DEMO.paolo, L.projector, 20, 21)).toMatch(/^forbidden\./); // pending, no roles
    expect(await requestError(DEMO.rico, L.projector, 20, 21)).toMatch(/forbidden.account_restricted/); // low-rating restriction
    expect(await requestError(DEMO.dana, L.architect, 20, 21)).toMatch(/forbidden.own_listing/);
  });
  it('rejects stale terms, a changed price, contact details and unavailable dates', async () => {
    expect(await requestError(DEMO.bea, L.projector, 20, 21, { terms: '00000000-0000-4000-8000-000000000000' })).toMatch(/conflict.terms_changed/);
    expect(await requestError(DEMO.bea, L.projector, 20, 21, { total: 1 })).toMatch(/conflict.price_changed/);
    expect(await requestError(DEMO.bea, L.projector, 20, 21, { note: 'Text me at 0917 123 4567' })).toMatch(/validation.contact_details/);
    expect(await requestError(DEMO.dana, L.dslr, 4, 4)).toMatch(/conflict.dates_unavailable/); // Bea's confirmed +3..+5
    expect(await requestError(DEMO.bea, L.dslr, 4, 4)).toMatch(/conflict.duplicate_request/); // …and Bea already holds it
    expect(await requestError(DEMO.bea, L.projector, -1, 2)).toMatch(/validation.pickup_past/);
  });

  let id = '';
  it('creates a pending request with the server price snapshot, terms acceptance, history and notifications', async () => {
    const quote = (await db.as<{ q: { total: number; subtotal: number; commission: number; lender_net: number } }>(DEMO.bea,
      `select public.quote_booking($1, $2, $3) as q`, [L.projector, await plus(20), await plus(22)]))[0]!.q;
    id = await request(DEMO.bea, L.projector, 20, 22, { total: quote.total, note: 'After my 1 PM class' });
    const [b] = await db.sql<{ status: string; total: string; subtotal: string; commission: string; lender_net: string; rental_days: number; snapshot: Record<string, unknown>; pickup_arrangement: string }>(
      `select * from public.bookings where id = $1`, [id]);
    expect(b!.status).toBe('pending_lender_approval');
    expect(Number(b!.total)).toBe(quote.total);
    expect(Number(b!.commission)).toBe(quote.commission);
    expect(Number(b!.lender_net)).toBe(quote.lender_net);
    expect(b!.rental_days).toBe(3);
    expect(b!.snapshot.listing_title).toBe('Portable projector with HDMI cable');
    expect(b!.snapshot.policy_version).toBe(1);
    expect(b!.pickup_arrangement).toBe('After my 1 PM class');
    expect(await count(`select count(*) n from public.booking_terms_acceptances where booking_id = $1 and user_id = $2`, [id, DEMO.bea])).toBe(1);
    expect(await count(`select count(*) n from public.booking_events where booking_id = $1 and to_status = 'pending_lender_approval'`, [id])).toBe(1);
    expect(await count(`select count(*) n from public.notifications where entity_id = $1 and user_id = $2 and type = 'booking.requested'`, [id, DEMO.leo])).toBe(1);
    expect(await count(`select count(*) n from public.notifications where entity_id = $1 and user_id = $2 and type = 'booking.request_sent'`, [id, DEMO.bea])).toBe(1);
  });
  it('a resend of the same request returns the same booking; overlapping dates are refused', async () => {
    expect(await request(DEMO.bea, L.projector, 20, 22)).toBe(id);
    expect(await requestError(DEMO.bea, L.projector, 21, 23)).toMatch(/conflict.duplicate_request/);
    expect(await count(`select count(*) n from public.bookings where listing_id = $1 and borrower_id = $2 and status = 'pending_lender_approval'`, [L.projector, DEMO.bea])).toBe(1);
  });
  it('is visible to its borrower and lender only', async () => {
    const sees = async (who: string) => (await db.as(who, `select id from public.bookings where id = $1`, [id])).length;
    expect(await sees(DEMO.bea)).toBe(1);
    expect(await sees(DEMO.leo)).toBe(1);
    expect(await sees(DEMO.dana)).toBe(0);
    expect(await sees(DEMO.mika)).toBe(0);
    expect(await db.errorAs(DEMO.mika, `select public.get_booking_detail($1)`, [id])).toMatch(/not_found.booking/);
    const inbox = await db.as<{ id: string }>(DEMO.mika, `select id from public.list_booking_requests()`);
    expect(inbox.find((r) => r.id === id)).toBeUndefined();
  });
  it('clients cannot change bookings or payments directly', async () => {
    expect(await db.errorAs(DEMO.bea, `update public.bookings set status = 'confirmed' where id = $1`, [id])).toMatch(/permission denied/);
    expect(await db.errorAs(DEMO.bea, `insert into public.payments (purpose, booking_id, payer_id, amount, idempotency_key) values ('booking', $1, $2, 100, 'fake-payment-key')`, [id, DEMO.bea])).toMatch(/permission denied/);
  });
});

describe('lender decision', () => {
  it('only the listing’s lender can decide', async () => {
    expect(await decideError(DEMO.bea, SEED.beaCasioPending, 'accept')).toMatch(/not_found.booking/);
    expect(await decideError(DEMO.mika, SEED.beaCasioPending, 'accept')).toMatch(/not_found.booking/);
  });
  it('a rejection needs a reason', async () => {
    expect(await decideError(DEMO.leo, SEED.danaCasioPending, 'reject', ' ')).toMatch(/validation.reason/);
  });
  it('accepting creates a payment hold with the configured expiry, once', async () => {
    const r = await decide(DEMO.leo, SEED.beaCasioPending, 'accept');
    expect(r.status).toBe('awaiting_payment');
    const minutes = (Date.parse(r.hold_expires_at!) - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15.1);
    expect((await decide(DEMO.leo, SEED.beaCasioPending, 'accept')).repeated).toBe(true);
    expect(await count(`select count(*) n from public.booking_events where booking_id = $1 and to_status = 'awaiting_payment'`, [SEED.beaCasioPending])).toBe(1);
    expect(await count(`select count(*) n from public.notifications where entity_id = $1 and type = 'booking.accepted'`, [SEED.beaCasioPending])).toBe(2);
  });
  it('an overlapping request cannot also be accepted, and the lender is told why', async () => {
    const detail = (await db.as<{ d: { conflict: string | null; my_role: string } }>(DEMO.leo, `select public.get_booking_detail($1) as d`, [SEED.danaCasioPending]))[0]!.d;
    expect(detail.my_role).toBe('lender');
    expect(detail.conflict).toBe('dates_taken');
    const inbox = await db.as<{ id: string; conflict: string | null }>(DEMO.leo, `select id, conflict from public.list_booking_requests()`);
    expect(inbox.find((r) => r.id === SEED.danaCasioPending)?.conflict).toBe('dates_taken');
    expect(await decideError(DEMO.leo, SEED.danaCasioPending, 'accept')).toMatch(/conflict.dates_taken/);
    expect(await status(SEED.danaCasioPending)).toBe('pending_lender_approval');
  });
  it('the exclusion constraint is the final backstop against two overlapping holds', async () => {
    const err = await db.sql(`update public.bookings set status = 'awaiting_payment', hold_expires_at = now() + interval '5 minutes' where id = $1`, [SEED.danaCasioPending])
      .then(() => null, (e: Error) => e.message);
    expect(err).toMatch(/bookings_no_overlap/);
  });
  it('rejecting records the reason and notifies the borrower; a decided request can’t be re-decided', async () => {
    const r = await decide(DEMO.leo, SEED.danaCasioPending, 'reject', 'I need it myself that week.');
    expect(r.status).toBe('rejected');
    const [n] = await db.sql<{ body: string }>(`select body from public.notifications where entity_id = $1 and user_id = $2 and type = 'booking.rejected'`, [SEED.danaCasioPending, DEMO.dana]);
    expect(n!.body).toMatch(/I need it myself that week/);
    expect(await decideError(DEMO.leo, SEED.danaCasioPending, 'accept')).toMatch(/conflict.already_decided/);
  });
  it('blocked dates stop an acceptance with a clear reason', async () => {
    // DSLR has a lender block at +20..+22.
    const id = await request(DEMO.bea, L.dslr, 30, 31);
    await db.sql(`insert into public.listing_availability (listing_id, start_date, end_date, reason) values ($1, $2, $3, 'Test block')`, [L.dslr, await plus(31), await plus(31)]);
    expect(await decideError(DEMO.leo, id, 'accept')).toMatch(/conflict.dates_blocked/);
  });
  it('the hold length is admin-configurable', async () => {
    await db.sql(`update public.platform_settings set value = '5' where key = 'payment_hold_minutes' and is_current`);
    const id = await request(DEMO.dana, L.ringLight, 40, 41);
    const r = await decide(DEMO.mika, id, 'accept');
    const minutes = (Date.parse(r.hold_expires_at!) - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(4);
    expect(minutes).toBeLessThanOrEqual(5.1);
    await db.sql(`update public.platform_settings set value = '15' where key = 'payment_hold_minutes' and is_current`);
  });
});

describe('demo checkout', () => {
  it('only the borrower can pay', async () => {
    expect(await db.errorAsCommit(DEMO.dana, `select public.pay_booking_demo($1, 'dana-key-123', 'success')`, [SEED.beaCasioPending])).toMatch(/not_found.booking/);
    expect(await db.errorAsCommit(DEMO.leo, `select public.pay_booking_demo($1, 'leo-key-1234', 'success')`, [SEED.beaCasioPending])).toMatch(/not_found.booking/);
  });
  it('a successful demo payment confirms the booking exactly once with a balanced ledger', async () => {
    const first = await pay(DEMO.bea, SEED.beaCasioPending, 'checkout-key-0001');
    expect(first.outcome).toBe('success');
    expect(first.provider).toBe('mock');
    expect(first.booking_status).toBe('confirmed');
    expect(first.replayed).toBe(false);
    // Double tap (same key) and a second attempt (new key) both return the original payment.
    const again = await pay(DEMO.bea, SEED.beaCasioPending, 'checkout-key-0001');
    expect(again.payment_id).toBe(first.payment_id);
    expect(again.replayed).toBe(true);
    const other = await pay(DEMO.bea, SEED.beaCasioPending, 'checkout-key-0002');
    expect(other.payment_id).toBe(first.payment_id);
    expect(await status(SEED.beaCasioPending)).toBe('confirmed');
    expect(await count(`select count(*) n from public.payments where booking_id = $1`, [SEED.beaCasioPending])).toBe(1);
    expect(await count(`select count(*) n from public.booking_events where booking_id = $1 and to_status = 'confirmed'`, [SEED.beaCasioPending])).toBe(1);

    const [b] = await db.sql<{ total: string; subtotal: string; deposit: string; commission: string; lender_net: string; commission_bps: number }>(
      `select * from public.bookings where id = $1`, [SEED.beaCasioPending]);
    const ledger = await db.sql<{ category: string; debit: string; credit: string; party_id: string | null }>(
      `select category, debit, credit, party_id from public.ledger_entries where booking_id = $1`, [SEED.beaCasioPending]);
    const amt = (c: string) => ledger.filter((l) => l.category === c).reduce((s, l) => s + Number(l.debit) + Number(l.credit), 0);
    expect(amt('borrower_payment')).toBe(Number(b!.total));
    expect(amt('deposit_held')).toBe(Number(b!.deposit));
    expect(amt('platform_commission')).toBe(Number(b!.commission));
    expect(amt('rent_payable')).toBe(Number(b!.lender_net));
    // Commission is on rent only (10% half-up), never on the deposit.
    expect(Number(b!.commission)).toBe(Math.floor((Number(b!.subtotal) * b!.commission_bps + 5000) / 10000));
    const debits = ledger.reduce((s, l) => s + Number(l.debit), 0);
    const credits = ledger.reduce((s, l) => s + Number(l.credit), 0);
    expect(debits).toBe(credits);
    expect(ledger.length).toBe(4);
    expect(await count(`select count(*) n from public.notifications where entity_id = $1 and type = 'booking.paid'`, [SEED.beaCasioPending])).toBe(2);
  });
  it('the lender sees the payment but only their own ledger lines', async () => {
    const pays = await db.as(DEMO.leo, `select id from public.payments where booking_id = $1`, [SEED.beaCasioPending]);
    expect(pays.length).toBe(1);
    const lines = await db.as<{ category: string }>(DEMO.leo, `select category from public.ledger_entries where booking_id = $1`, [SEED.beaCasioPending]);
    expect(lines.map((l) => l.category)).toEqual(['rent_payable']);
  });
  it('a failed demo payment releases the hold without ledger entries', async () => {
    const id = await request(DEMO.bea, L.tripod, 50, 51);
    await decide(DEMO.mika, id, 'accept');
    const r = await pay(DEMO.bea, id, 'checkout-fail-0001', 'failure');
    expect(r.outcome).toBe('failure');
    expect(r.booking_status).toBe('cancelled');
    expect(await count(`select count(*) n from public.ledger_entries where booking_id = $1`, [id])).toBe(0);
    expect(await count(`select count(*) n from public.payments where booking_id = $1 and status = 'failed'`, [id])).toBe(1);
    expect(await count(`select count(*) n from public.notifications where entity_id = $1 and type = 'booking.payment_failed'`, [id])).toBe(2);
    // The dates are free again for someone else.
    const q = (await db.as<{ q: { available: boolean } }>(DEMO.dana, `select public.quote_booking($1, $2, $3) as q`, [L.tripod, await plus(50), await plus(51)]))[0]!.q;
    expect(q.available).toBe(true);
    // Replaying the failed attempt returns the failure; it can't be paid any more.
    expect((await pay(DEMO.bea, id, 'checkout-fail-0001', 'success')).outcome).toBe('failure');
    expect(await db.errorAsCommit(DEMO.bea, `select public.pay_booking_demo($1, 'checkout-late-0001', 'success')`, [id])).toMatch(/conflict.not_payable/);
  });
  it('an expired hold is released at checkout (server time), not charged', async () => {
    await expireNow(SEED.danaTi84Awaiting);
    const r = await pay(DEMO.dana, SEED.danaTi84Awaiting, 'checkout-exp-0001');
    expect(r.outcome).toBe('expired');
    expect(r.booking_status).toBe('payment_expired');
    expect(await count(`select count(*) n from public.ledger_entries where booking_id = $1`, [SEED.danaTi84Awaiting])).toBe(0);
    expect(await count(`select count(*) n from public.notifications where entity_id = $1 and type = 'booking.payment_expired'`, [SEED.danaTi84Awaiting])).toBe(2);
    expect(await count(`select count(*) n from public.bookings where id = $1 and status = 'completed'`, [SEED.danaTi84Awaiting])).toBe(0);
  });
  it('a lapsed hold never blocks a new acceptance (the accept sweeps it first)', async () => {
    const first = await request(DEMO.bea, L.ringLight, 60, 61);
    await decide(DEMO.mika, first, 'accept');
    await expireNow(first);
    const second = await request(DEMO.dana, L.ringLight, 60, 61); // lapsed holds don't block requests
    expect((await decide(DEMO.mika, second, 'accept')).status).toBe('awaiting_payment');
    expect(await status(first)).toBe('payment_expired');
  });
  it('the sweep expires lapsed holds idempotently', async () => {
    const id = await request(DEMO.bea, L.ti84, 70, 71);
    await decide(DEMO.mika, id, 'accept');
    await expireNow(id);
    const n = (await db.asCommit<{ n: number }>(DEMO.paolo, `select public.sweep_expired_holds() as n`))[0]!.n;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await status(id)).toBe('payment_expired');
    expect((await db.asCommit<{ n: number }>(DEMO.paolo, `select public.sweep_expired_holds() as n`))[0]!.n).toBe(0);
    expect(await count(`select count(*) n from public.payments where booking_id = $1 and status = 'expired'`, [id])).toBe(1);
    expect(await db.errorAs('anon', `select public.sweep_expired_holds()`)).toMatch(/permission denied/);
  });
});

describe('booking detail', () => {
  it('returns the agreement, money split, history and receipt to the borrower', async () => {
    const d = (await db.as<{ d: Record<string, unknown> }>(DEMO.bea, `select public.get_booking_detail($1) as d`, [SEED.beaCasioPending]))[0]!.d;
    expect(d.my_role).toBe('borrower');
    expect(d.status).toBe('confirmed');
    expect(d.conflict).toBeNull(); // borrowers never get lender conflict data
    expect((d.counterpart as { id: string }).id).toBe(DEMO.leo);
    expect((d.events as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect((d.payments as { status: string }[]).map((p) => p.status)).toEqual(['succeeded']);
    expect((d.terms as { version: number }).version).toBe(1);
  });
});

describe('listing notes (server-side contact guard)', () => {
  it('rejects phone numbers in pickup notes', async () => {
    const fields = { title: 'Casio fx-991EX scientific calculator', description: 'x', category: 'calculators', condition: 'like_new', daily_rate: 3000, deposit: 30000, late_fee_per_day: 1500, pickup_notes: 'Call 09171234567' };
    expect(await db.errorAs(DEMO.leo, `select public.update_listing($1, $2)`, [L.casio, JSON.stringify(fields)])).toMatch(/validation.pickup_notes/);
  });
});
