// LIVE end-to-end Journey D (plan §3: handover, active rental, messages, extension, return) against the
// hosted project using only the publishable key. Bea rents one of Leo's items starting today, then the
// script deletes everything it created (booking, history, messages, payments, refunds, ledger, notifications).
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

const leo = await as('leo.lender@tigrent.test');
const bea = await as('bea.borrower@tigrent.test');
const dana = await as('dana.dual@tigrent.test');
const paolo = await as('paolo.pending@tigrent.test');
const manilaToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(manilaToday) + n * 86400e3).toISOString().slice(0, 10);
const { client: db } = await connect();
let bookingId = null;
let conversationId = null;

try {
  // Find one of Leo's items free today..+2 (demo state can drift during manual testing).
  const { data: listings } = await leo.c.from('listings').select('id, title').eq('lender_id', leo.id).eq('status', 'active');
  let listing = null;
  for (const l of listings ?? []) {
    const { data: q } = await bea.c.rpc('quote_booking', { p_listing_id: l.id, p_pickup: plus(0), p_return: plus(2) });
    if (q?.available) { listing = l; break; }
  }
  if (!listing) throw new Error('None of Leo’s items is free today through +2 days.');
  const { data: terms } = await bea.c.from('terms_versions').select('id').eq('doc_type', 'rental_terms').eq('is_active', true).single();
  const req = await bea.c.rpc('request_booking', { p_listing_id: listing.id, p_pickup: plus(0), p_return: plus(1), p_terms_version_id: terms.id });
  bookingId = req.data;
  if (!bookingId) throw new Error(`request failed: ${req.error?.hint}`);
  await leo.c.rpc('decide_booking_request', { p_booking_id: bookingId, p_decision: 'accept' });
  const paid = await bea.c.rpc('pay_booking_demo', { p_booking_id: bookingId, p_idempotency_key: `journey-d-${Date.now()}`, p_scenario: 'success' });
  step(`setup: Bea rents “${listing.title}” today → tomorrow (demo payment)`, paid.data?.booking_status === 'confirmed', paid.error?.hint);

  // Messaging
  const detail = async (who = bea) => (await who.c.rpc('get_booking_detail', { p_booking_id: bookingId })).data;
  conversationId = (await detail()).conversation_id;
  const sent = await bea.c.rpc('send_message', { p_conversation_id: conversationId, p_body: 'Hi Leo, can I pick it up at 3 PM?' });
  await bea.c.rpc('send_message', { p_conversation_id: conversationId, p_body: 'At the library entrance.' });
  const { data: leoList } = await leo.c.rpc('list_my_conversations', { p_role: 'lender' });
  step('D.3 the borrower messages the lender; the lender sees 2 unread', !sent.error && leoList?.find((c) => c.conversation_id === conversationId)?.unread_count === 2);
  const { rows: msgNotes } = await db.query(`select count(*)::int n from public.notifications where entity_id = $1 and user_id = $2`, [conversationId, leo.id]);
  step('one notification per unread stretch (not one per message)', msgNotes[0].n === 1, `${msgNotes[0].n}`);
  await leo.c.rpc('mark_conversation_read', { p_conversation_id: conversationId });
  await leo.c.rpc('send_message', { p_conversation_id: conversationId, p_body: 'Sure, see you there.' });
  const peek = await paolo.c.rpc('get_conversation', { p_conversation_id: conversationId });
  step('messages are private to the two participants', peek.error?.message === 'not_found.conversation');

  // D.2 Handover
  const early = await bea.c.rpc('confirm_handover', { p_booking_id: bookingId });
  step('the borrower can’t confirm receipt before the lender hands over', early.error?.message === 'conflict.awaiting_lender_handover', early.error?.message);
  const h1 = await leo.c.rpc('confirm_handover', { p_booking_id: bookingId, p_notes: 'Journey D: with case' });
  const h2 = await bea.c.rpc('confirm_handover', { p_booking_id: bookingId, p_notes: 'Journey D: works' });
  step('D.2 lender handover + borrower receipt make the rental active', h1.data?.status === 'confirmed' && h2.data?.status === 'active', h1.error?.hint ?? h2.error?.hint);

  // D.3–D.4 Extension: failure keeps the date; success moves it, once.
  const before = await detail();
  const lenderAsks = await leo.c.rpc('request_extension', { p_booking_id: bookingId, p_new_return: plus(2) });
  step('a lender cannot request the borrower’s extension', lenderAsks.error?.message === 'forbidden.borrower_only');
  const e1 = await bea.c.rpc('request_extension', { p_booking_id: bookingId, p_new_return: plus(2) });
  await leo.c.rpc('decide_extension', { p_extension_id: e1.data, p_decision: 'approve' });
  const { data: heldQuote } = await dana.c.rpc('quote_booking', { p_listing_id: listing.id, p_pickup: plus(2), p_return: plus(2) });
  step('an approved extension holds the extra day from other borrowers', heldQuote?.available === false);
  const fail = await bea.c.rpc('pay_extension_demo', { p_extension_id: e1.data, p_idempotency_key: `journey-d-ext-fail-${Date.now()}`, p_scenario: 'failure' });
  const afterFail = await detail();
  step('D.4 a failed extension payment keeps the original due date', fail.data?.outcome === 'failure' && afterFail.due_at === before.due_at && afterFail.return_date === before.return_date);
  const e2 = await bea.c.rpc('request_extension', { p_booking_id: bookingId, p_new_return: plus(2) });
  await leo.c.rpc('decide_extension', { p_extension_id: e2.data, p_decision: 'approve' });
  const unpaid = await detail();
  step('approval alone doesn’t change the due date', unpaid.due_at === before.due_at);
  const key = `journey-d-ext-${Date.now()}`;
  const [x1, x2] = await Promise.all([
    bea.c.rpc('pay_extension_demo', { p_extension_id: e2.data, p_idempotency_key: key, p_scenario: 'success' }),
    bea.c.rpc('pay_extension_demo', { p_extension_id: e2.data, p_idempotency_key: key, p_scenario: 'success' }),
  ]);
  const extended = await detail(leo);
  step('a successful extension payment moves the due date, once (concurrent double tap)',
    x1.data?.outcome === 'success' && x2.data?.payment_id === x1.data?.payment_id && extended.return_date === plus(2) && extended.rental_days === 3,
    `${extended.return_date}, ${extended.rental_days} days`);
  const { rows: extLedger } = await db.query(`select debit, credit from public.ledger_entries where payment_id = $1`, [x1.data?.payment_id]);
  const sum = (k) => extLedger.reduce((s, l) => s + Number(l[k]), 0);
  step('the extension is booked once in a balanced ledger', extLedger.length === 3 && sum('debit') === sum('credit'));

  // D.5–D.6 Return and clean inspection.
  const lenderReturns = await leo.c.rpc('submit_return', { p_booking_id: bookingId });
  step('a lender cannot submit the return', lenderReturns.error?.message === 'forbidden.borrower_only');
  const ret = await bea.c.rpc('submit_return', { p_booking_id: bookingId, p_notes: 'Journey D: returned at the library' });
  const borrowerInspects = await bea.c.rpc('confirm_clean_return', { p_booking_id: bookingId });
  step('D.5 the borrower submits the return; only the lender can inspect', ret.data?.status === 'return_requested' && borrowerInspects.error?.message === 'forbidden.lender_only');
  const done = await leo.c.rpc('confirm_clean_return', { p_booking_id: bookingId, p_notes: 'Journey D: all good' });
  const { rows: refunds } = await db.query(`select amount, status from public.refunds where booking_id = $1`, [bookingId]);
  const final = await detail();
  step('D.6 a clean return completes the booking and releases the deposit once (simulated refund)',
    done.data?.status === 'completed' && refunds.length === (final.deposit > 0 ? 1 : 0) && (final.deposit === 0 || Number(refunds[0].amount) === final.deposit));
  const { data: freeAgain } = await dana.c.rpc('quote_booking', { p_listing_id: listing.id, p_pickup: plus(0), p_return: plus(2) });
  step('the item is available again', freeAgain?.available === true);
  const forLeo = await detail(leo);
  step('both parties see the same timeline', JSON.stringify(final.events.map((e) => e.kind ?? e.to_status)) === JSON.stringify(forLeo.events.map((e) => e.kind ?? e.to_status)),
    final.events.map((e) => e.kind ?? e.to_status).join(' → '));

  // Reminders: idempotent.
  const countNotes = async () => (await db.query(`select count(*)::int n from public.notifications where entity_id = any($1::uuid[])`, [[bookingId, conversationId]])).rows[0].n;
  const n1 = await countNotes();
  await bea.c.rpc('process_due_events');
  await leo.c.rpc('process_due_events');
  step('running the due-events job again sends no duplicates', (await countNotes()) === n1, `${n1} notifications`);
  const { rows: types } = await db.query(`select distinct type from public.notifications where entity_id = any($1::uuid[]) order by 1`, [[bookingId, conversationId]]);
  const t = types.map((r) => r.type);
  step('both parties were notified at each step',
    ['message.new', 'booking.handover', 'booking.active', 'extension.requested', 'extension.approved', 'extension.payment_failed', 'extension.paid', 'booking.return_submitted', 'booking.completed'].every((x) => t.includes(x)),
    t.join(', '));
} catch (e) {
  step('journey ran to completion', false, e.message);
} finally {
  if (bookingId) {
    try {
      await db.query('begin');
      await db.query('alter table public.booking_events disable trigger booking_events_append_only');
      await db.query('alter table public.ledger_entries disable trigger ledger_append_only');
      await db.query(`delete from public.notifications where entity_id = any($1::uuid[])`, [[bookingId, conversationId].filter(Boolean)]);
      await db.query(`delete from public.ledger_entries where booking_id = $1`, [bookingId]);
      await db.query(`delete from public.refunds where booking_id = $1`, [bookingId]);
      await db.query(`delete from public.payments where booking_id = $1`, [bookingId]);
      await db.query(`delete from public.bookings where id = $1`, [bookingId]);
      await db.query('alter table public.ledger_entries enable trigger ledger_append_only');
      await db.query('alter table public.booking_events enable trigger booking_events_append_only');
      await db.query('commit');
      console.log('Cleaned up the test booking and everything linked to it.');
    } catch (e) {
      await db.query('rollback').catch(() => undefined);
      console.error('Cleanup failed:', e.message);
      failures++;
    }
  }
  await db.end();
  for (const s of [leo, bea, dana, paolo]) await s.c.auth.signOut();
}
console.log(failures === 0 ? '\nJourney D passed end-to-end.' : `\n${failures} step(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
