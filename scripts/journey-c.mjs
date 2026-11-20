// LIVE end-to-end Journey C (plan §3: request → decision → hold → demo checkout) against the hosted
// project using only the publishable key, including REAL concurrent requests over separate connections.
// Uses seeded demo accounts and far-future dates on one of Leo's listings, then deletes everything it
// created (bookings, history, payments, ledger lines, notifications).
import { createClient } from '@supabase/supabase-js';
import { connect } from './lib/connection.mjs';
import { loadEnv } from './lib/env.mjs';

const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let failures = 0;
const step = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
async function as(email) {
  const c = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: 'TigRentDemo#2026' });
  if (error) throw new Error(`${email}: ${error.message}`);
  return { c, id: data.user.id };
}

const LISTING = '11111111-0000-4000-8000-000000000004'; // Leo's laptop stand
const leo = await as('leo.lender@tigrent.test');
const bea = await as('bea.borrower@tigrent.test');
const dana = await as('dana.dual@tigrent.test');
const paolo = await as('paolo.pending@tigrent.test');
const manilaToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(manilaToday) + n * 86400e3).toISOString().slice(0, 10);
const created = new Set();
const { client: db } = await connect();

try {
  const { data: terms } = await bea.c.from('terms_versions').select('id').eq('doc_type', 'rental_terms').eq('is_active', true).single();
  // Find a free far-future window (demo state can drift during manual testing).
  let offset = null;
  for (const o of [84, 80, 76, 72]) {
    const { data: q } = await bea.c.rpc('quote_booking', { p_listing_id: LISTING, p_pickup: plus(o), p_return: plus(o + 1) });
    if (q?.available) { offset = o; break; }
  }
  if (offset === null) throw new Error('No free far-future window on the test listing.');
  const [p1, r1, p2] = [plus(offset), plus(offset + 1), plus(offset + 3)];
  const { data: quote } = await bea.c.rpc('quote_booking', { p_listing_id: LISTING, p_pickup: p1, p_return: r1 });
  const req = (who, pickup, ret, total = quote.total) =>
    who.c.rpc('request_booking', { p_listing_id: LISTING, p_pickup: pickup, p_return: ret, p_terms_version_id: terms.id, p_expected_total: total });

  // C.6 requests (and a concurrent double tap from one borrower)
  const pend = await req(paolo, p1, r1);
  step('a pending student cannot request', /^forbidden\./.test(pend.error?.message ?? ''), pend.error?.message);
  const [b1, b1again] = await Promise.all([req(bea, p1, r1), req(bea, p1, r1)]);
  [b1.data, b1again.data].forEach((id) => id && created.add(id));
  step('C.6 borrower sends a request; a concurrent double tap returns the same booking', !b1.error && b1.data === b1again.data, b1.error?.hint ?? b1again.error?.hint);
  const b2 = await req(dana, p1, r1);
  if (b2.data) created.add(b2.data);
  step('another borrower may request the same dates (both pending)', !b2.error, b2.error?.hint);
  const stale = await req(dana, p2, p2, 1);
  step('a stale price is refused', stale.error?.message === 'conflict.price_changed');

  // C.7 visibility + inbox
  const seen = await paolo.c.from('bookings').select('id').in('id', [b1.data, b2.data]);
  step('requests are invisible to unrelated students', seen.data?.length === 0);
  const { data: inbox } = await leo.c.rpc('list_booking_requests');
  step('C.7 the lender sees both requests in the inbox', [b1.data, b2.data].every((id) => inbox?.some((r) => r.id === id)));
  const notBorrowerDecides = await bea.c.rpc('decide_booking_request', { p_booking_id: b2.data, p_decision: 'accept' });
  step("a borrower can't accept someone else's request", notBorrowerDecides.error?.message === 'not_found.booking');

  // Concurrent acceptance over two connections: exactly one hold, one clear conflict.
  const [a1, a2] = await Promise.all([
    leo.c.rpc('decide_booking_request', { p_booking_id: b1.data, p_decision: 'accept' }),
    leo.c.rpc('decide_booking_request', { p_booking_id: b2.data, p_decision: 'accept' }),
  ]);
  const okCount = [a1, a2].filter((r) => !r.error && r.data?.status === 'awaiting_payment').length;
  const conflicts = [a1, a2].filter((r) => r.error?.message === 'conflict.dates_taken');
  step('concurrent acceptance: one hold and one "dates no longer available" response', okCount === 1 && conflicts.length === 1,
    `${okCount} ok, ${conflicts.length} conflict${conflicts[0] ? `: ${conflicts[0].error.hint}` : ''}`);
  const winner = !a1.error ? { id: b1.data, who: bea } : { id: b2.data, who: dana };
  const loser = !a1.error ? b2.data : b1.data;
  const hold = (await winner.who.c.rpc('get_booking_detail', { p_booking_id: winner.id })).data;
  const holdMin = (Date.parse(hold.hold_expires_at) - Date.parse(hold.server_now)) / 60000;
  step('the hold uses the configured expiry (sample 15 min)', holdMin > 14 && holdMin <= 15.1, `${holdMin.toFixed(1)} min`);
  const rej = await leo.c.rpc('decide_booking_request', { p_booking_id: loser, p_decision: 'reject', p_reason: 'Journey C: dates taken by another request.' });
  step('the lender declines the other request with a reason', rej.data?.status === 'rejected', rej.error?.hint);

  // C.8 demo checkout: a concurrent double tap pays once.
  const key = `journey-c-${Date.now()}`;
  const [pay1, pay2] = await Promise.all([
    winner.who.c.rpc('pay_booking_demo', { p_booking_id: winner.id, p_idempotency_key: key, p_scenario: 'success' }),
    winner.who.c.rpc('pay_booking_demo', { p_booking_id: winner.id, p_idempotency_key: key, p_scenario: 'success' }),
  ]);
  step('C.8 demo payment succeeds and confirms the booking', pay1.data?.outcome === 'success' && pay1.data?.booking_status === 'confirmed', pay1.error?.hint);
  step('a concurrent double tap returns the same payment', pay2.data?.payment_id === pay1.data?.payment_id && [pay1, pay2].some((p) => p.data?.replayed));
  const { rows: pays } = await db.query(`select count(*)::int n from public.payments where booking_id = $1`, [winner.id]);
  const { rows: ledger } = await db.query(
    `select category, debit, credit from public.ledger_entries where booking_id = $1`, [winner.id]);
  const sum = (k) => ledger.reduce((s, l) => s + Number(l[k]), 0);
  const { rows: [bk] } = await db.query(`select total, deposit, commission, lender_net, subtotal from public.bookings where id = $1`, [winner.id]);
  step('exactly one payment and one balanced set of ledger lines', pays[0].n === 1 && ledger.length === 4 && sum('debit') === sum('credit'), `${ledger.length} lines`);
  step('commission is 10% of rent only; the deposit is held separately',
    Number(bk.commission) === Math.floor((Number(bk.subtotal) * 1000 + 5000) / 10000)
      && Number(ledger.find((l) => l.category === 'deposit_held')?.credit) === Number(bk.deposit)
      && Number(ledger.find((l) => l.category === 'rent_payable')?.credit) === Number(bk.lender_net));
  const otherBorrower = winner.who === bea ? dana : bea;
  const overlap = await req(otherBorrower, p1, r1);
  if (overlap.data) created.add(overlap.data);
  step('confirmed dates are no longer requestable', overlap.error?.message === 'conflict.dates_unavailable', overlap.error?.message);

  // C.9 failure and expiry release the hold.
  const f = await req(dana, p2, p2, null);
  if (f.data) created.add(f.data);
  await leo.c.rpc('decide_booking_request', { p_booking_id: f.data, p_decision: 'accept' });
  const failPay = await dana.c.rpc('pay_booking_demo', { p_booking_id: f.data, p_idempotency_key: `journey-c-fail-${Date.now()}`, p_scenario: 'failure' });
  const { data: freeAfterFail } = await bea.c.rpc('quote_booking', { p_listing_id: LISTING, p_pickup: p2, p_return: p2 });
  const { rows: failLedger } = await db.query(`select count(*)::int n from public.ledger_entries where booking_id = $1`, [f.data]);
  step('C.9 a failed demo payment releases the hold (no ledger lines)', failPay.data?.outcome === 'failure' && freeAfterFail?.available === true && failLedger[0].n === 0);

  const e = await req(dana, p2, p2, null);
  if (e.data) created.add(e.data);
  await leo.c.rpc('decide_booking_request', { p_booking_id: e.data, p_decision: 'accept' });
  await db.query(`update public.bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [e.data]);
  const { data: freeAfterExpiry } = await bea.c.rpc('quote_booking', { p_listing_id: LISTING, p_pickup: p2, p_return: p2 });
  const expPay = await dana.c.rpc('pay_booking_demo', { p_booking_id: e.data, p_idempotency_key: `journey-c-exp-${Date.now()}`, p_scenario: 'success' });
  step('C.9 an expired hold frees the dates and checkout reports it (server time)', freeAfterExpiry?.available === true && expPay.data?.outcome === 'expired' && expPay.data?.booking_status === 'payment_expired', expPay.error?.hint);

  const { rows: notes } = await db.query(`select type, user_id from public.notifications where entity_id = any($1::uuid[])`, [[...created]]);
  const types = new Set(notes.map((n) => n.type));
  step('both parties were notified at every step',
    ['booking.requested', 'booking.request_sent', 'booking.accepted', 'booking.rejected', 'booking.paid', 'booking.payment_failed', 'booking.payment_expired'].every((t) => types.has(t)),
    [...types].sort().join(', '));
} catch (e) {
  step('journey ran to completion', false, e.message);
} finally {
  // Remove everything this run created. Append-only guards are suspended only inside this transaction.
  if (created.size) {
    const ids = [...created];
    try {
      await db.query('begin');
      await db.query('alter table public.booking_events disable trigger booking_events_append_only');
      await db.query('alter table public.ledger_entries disable trigger ledger_append_only');
      await db.query(`delete from public.notifications where entity_id = any($1::uuid[])`, [ids]);
      await db.query(`delete from public.ledger_entries where booking_id = any($1::uuid[])`, [ids]);
      await db.query(`delete from public.payments where booking_id = any($1::uuid[])`, [ids]);
      await db.query(`delete from public.bookings where id = any($1::uuid[])`, [ids]);
      await db.query('alter table public.ledger_entries enable trigger ledger_append_only');
      await db.query('alter table public.booking_events enable trigger booking_events_append_only');
      await db.query('commit');
      console.log(`Cleaned up ${ids.length} test booking(s).`);
    } catch (e) {
      await db.query('rollback').catch(() => undefined);
      console.error('Cleanup failed:', e.message);
      failures++;
    }
  }
  await db.end();
  for (const s of [leo, bea, dana, paolo]) await s.c.auth.signOut();
}
console.log(failures === 0 ? '\nJourney C passed end-to-end.' : `\n${failures} step(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
