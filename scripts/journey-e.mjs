// LIVE end-to-end Journey E (plan §3: cancellation, refunds, late fee, disputes) against the hosted project
// using only the publishable key (plus a direct SQL connection only to simulate time passing and to clean
// up). Uses Bea, Dana, Leo and the demo admin; deletes everything it created.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { connect } from './lib/connection.mjs';
import { loadEnv, ROOT } from './lib/env.mjs';

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
const admin = await as('admin.demo@tigrent.test');
const manilaToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(manilaToday) + n * 86400e3).toISOString().slice(0, 10);
const { client: db } = await connect();
const created = new Set();
let evidencePath = null;

const balanced = async (id) => {
  const { rows: [r] } = await db.query(`select coalesce(sum(debit), 0)::bigint d, coalesce(sum(credit), 0)::bigint c from public.ledger_entries where booking_id = $1`, [id]);
  return Number(r.d) === Number(r.c);
};

try {
  const { data: listings } = await leo.c.from('listings').select('id, title').eq('lender_id', leo.id).eq('status', 'active');
  let listing = null;
  for (const l of listings ?? []) {
    const { data: q } = await bea.c.rpc('quote_booking', { p_listing_id: l.id, p_pickup: plus(0), p_return: plus(3) });
    if (q?.available) { listing = l; break; }
  }
  if (!listing) throw new Error('None of Leo’s items is free today through +3 days.');
  const { data: terms } = await bea.c.from('terms_versions').select('id').eq('doc_type', 'rental_terms').eq('is_active', true).single();
  const request = async (who, from, to) => {
    const r = await who.c.rpc('request_booking', { p_listing_id: listing.id, p_pickup: plus(from), p_return: plus(to), p_terms_version_id: terms.id });
    if (!r.data) throw new Error(`request failed: ${r.error?.hint}`);
    created.add(r.data);
    return r.data;
  };
  const confirmed = async (who, from, to) => {
    const id = await request(who, from, to);
    await leo.c.rpc('decide_booking_request', { p_booking_id: id, p_decision: 'accept' });
    await who.c.rpc('pay_booking_demo', { p_booking_id: id, p_idempotency_key: `journey-e-${id}`, p_scenario: 'success' });
    return id;
  };
  const active = async (who, from, to) => {
    const id = await confirmed(who, from, to);
    await leo.c.rpc('confirm_handover', { p_booking_id: id });
    await who.c.rpc('confirm_handover', { p_booking_id: id });
    return id;
  };
  const refundsOf = async (id) => (await db.query(`select amount::bigint a from public.refunds where booking_id = $1`, [id])).rows.map((r) => Number(r.a));

  // E.1 Cancel a pending request.
  const pending = await request(bea, 3, 3);
  const { data: pq } = await bea.c.rpc('preview_cancellation', { p_booking_id: pending });
  const pc = await bea.c.rpc('cancel_booking', { p_booking_id: pending, p_expected_refund: pq?.refund_total });
  step('E.1 a pending request is cancelled with nothing to refund', pq?.rule === 'pending_cancel_by_borrower' && pc.data?.status === 'cancelled' && (await refundsOf(pending)).length === 0);

  // E.2 Borrower cancels after payment, inside the 24 h window (sample policy: 50% rent).
  const late = await confirmed(bea, 1, 1);
  const { data: lq } = await bea.c.rpc('preview_cancellation', { p_booking_id: late });
  const moved = await bea.c.rpc('cancel_booking', { p_booking_id: late, p_expected_refund: (lq?.refund_total ?? 0) + 1 });
  step('a stale refund amount is refused (preview first)', moved.error?.message === 'conflict.refund_changed');
  const lc = await bea.c.rpc('cancel_booking', { p_booking_id: late, p_expected_refund: lq?.refund_total });
  const again = await bea.c.rpc('cancel_booking', { p_booking_id: late, p_expected_refund: lq?.refund_total });
  step('E.2 borrower cancellation follows the sample policy window and refunds exactly the preview, once',
    lq?.rent_refund_pct === 50 && lc.data?.status === 'cancelled' && again.data?.repeated === true && JSON.stringify(await refundsOf(late)) === JSON.stringify([lq.refund_total]) && await balanced(late),
    `${lq?.rent_refund_pct}% rent, ₱${(lq?.refund_total ?? 0) / 100}`);

  // Lender cancels before pickup: full refund, reason required.
  const lenderCancel = await confirmed(dana, 2, 2);
  const { data: lcq } = await leo.c.rpc('preview_cancellation', { p_booking_id: lenderCancel });
  const noReason = await leo.c.rpc('cancel_booking', { p_booking_id: lenderCancel, p_expected_refund: lcq?.refund_total });
  await leo.c.rpc('cancel_booking', { p_booking_id: lenderCancel, p_reason: 'Journey E: item unavailable', p_expected_refund: lcq?.refund_total });
  const { rows: [paid] } = await db.query(`select amount::bigint a from public.payments where booking_id = $1 and status = 'succeeded'`, [lenderCancel]);
  step('E.2 lender cancellation before pickup refunds everything and needs a reason',
    noReason.error?.message === 'validation.reason' && (await refundsOf(lenderCancel))[0] === Number(paid.a) && await balanced(lenderCancel));

  // Late return: the agreed late fee is withheld from the deposit, the rest released.
  const lateReturn = await active(bea, 0, 0);
  await db.query(`update public.bookings set due_at = now() - interval '30 hours' where id = $1`, [lateReturn]); // simulate time passing
  await bea.c.rpc('submit_return', { p_booking_id: lateReturn });
  const lr = await leo.c.rpc('confirm_clean_return', { p_booking_id: lateReturn });
  const { rows: [lb] } = await db.query(`select deposit::bigint dep, late_fee_per_day::bigint fee from public.bookings where id = $1`, [lateReturn]);
  const fee = Math.min(2 * Number(lb.fee), Number(lb.dep));
  step('a late return withholds the agreed late fee from the deposit and releases the rest',
    lr.data?.late_days === 2 && lr.data?.late_fee_withheld === fee && lr.data?.deposit_released === Number(lb.dep) - fee && await balanced(lateReturn),
    `₱${fee / 100} late fee`);

  // E.3 Damage dispute with private evidence.
  const damaged = await active(bea, 1, 1).catch(async () => active(bea, 0, 0));
  await bea.c.rpc('submit_return', { p_booking_id: damaged });
  evidencePath = `${damaged}/${leo.id}/journey-e.png`;
  const png = fs.readFileSync(path.join(ROOT, 'assets', 'listings', '22222222-0000-4000-8000-000000000003.png'));
  const up = await leo.c.storage.from('evidence').upload(evidencePath, png, { contentType: 'image/png' });
  const foreign = await dana.c.storage.from('evidence').upload(`${damaged}/${dana.id}/x.png`, png, { contentType: 'image/png' });
  step('evidence uploads to the booking’s private folder; outsiders can’t upload', !up.error && Boolean(foreign.error), up.error?.message);
  const { rows: [db1] } = await db.query(`select deposit::bigint dep from public.bookings where id = $1`, [damaged]);
  const claim = Math.floor(Number(db1.dep) / 2);
  const dispute = await leo.c.rpc('report_return_problem', { p_booking_id: damaged, p_outcome: 'damaged', p_description: 'Journey E: cracked casing on return.', p_requested_amount: claim, p_photo_paths: [evidencePath] });
  const disputeId = dispute.data;
  step('E.3 the lender reports damage; the deposit stays held while a moderator decides', Boolean(disputeId) && (await refundsOf(damaged)).length === 0, dispute.error?.hint);
  const peek = await paolo.c.rpc('get_dispute', { p_dispute_id: disputeId });
  const danaUrl = await dana.c.storage.from('evidence').createSignedUrl(evidencePath, 60);
  const beaUrl = await bea.c.storage.from('evidence').createSignedUrl(evidencePath, 60);
  const img = beaUrl.data ? await fetch(beaUrl.data.signedUrl) : null;
  step('the case and its evidence are private to the parties (and staff)', peek.error?.message === 'not_found.dispute' && Boolean(danaUrl.error) && img?.status === 200);
  await bea.c.rpc('respond_to_dispute', { p_dispute_id: disputeId, p_body: 'Journey E: it was already scratched at pickup.' });
  const { data: reviewing } = await admin.c.rpc('get_dispute', { p_dispute_id: disputeId });
  step('each party responds; the case moves to moderator review', reviewing?.status === 'under_review' && reviewing.messages.length === 1 && reviewing.evidence.length >= 1);

  // E.4 Moderator decision → refund + compensation; appeal.
  const notStaff = await leo.c.rpc('resolve_dispute', { p_dispute_id: disputeId, p_deposit_to_lender: claim, p_rent_refund: 0, p_booking_outcome: 'completed', p_decision: 'Lender decides their own case.' });
  const award = Math.floor(claim / 2);
  const res = await admin.c.rpc('resolve_dispute', { p_dispute_id: disputeId, p_deposit_to_lender: award, p_rent_refund: 0, p_booking_outcome: 'completed', p_decision: 'Journey E: partial damage confirmed by photos; half the claim awarded.' });
  await admin.c.rpc('resolve_dispute', { p_dispute_id: disputeId, p_deposit_to_lender: award, p_rent_refund: 0, p_booking_outcome: 'completed', p_decision: 'Journey E: repeated decision attempt.' });
  const { rows: comp } = await db.query(`select coalesce(sum(credit), 0)::bigint c from public.ledger_entries where booking_id = $1 and category = 'damage_compensation' and party_id = $2`, [damaged, leo.id]);
  step('E.4 only a moderator decides; the decision withholds part of the deposit once and refunds the rest',
    notStaff.error?.message === 'forbidden.staff_only' && res.data?.status === 'resolved_compensation' && Number(comp[0].c) === award
      && JSON.stringify(await refundsOf(damaged)) === JSON.stringify([Number(db1.dep) - award]) && await balanced(damaged));
  await bea.c.rpc('appeal_dispute', { p_dispute_id: disputeId, p_reason: 'Journey E: please review the handover notes.' });
  const second = await bea.c.rpc('appeal_dispute', { p_dispute_id: disputeId, p_reason: 'Journey E: appealing twice should fail.' });
  await admin.c.rpc('decide_appeal', { p_dispute_id: disputeId, p_note: 'Journey E: reviewed; the decision stands.' });
  const { data: closed } = await bea.c.rpc('get_dispute', { p_dispute_id: disputeId });
  step('either party may appeal once; the review closes the case', Boolean(second.error) && closed?.status === 'closed');

  const { rows: types } = await db.query(`select distinct type from public.notifications where entity_id = any($1::uuid[]) or entity_id = $2 order by 1`, [[...created], disputeId]);
  const t = types.map((r) => r.type);
  step('notifications for every exception', ['booking.cancelled', 'dispute.opened', 'dispute.response', 'dispute.resolved', 'dispute.appealed', 'dispute.appeal_decided', 'booking.completed'].every((x) => t.includes(x)), t.join(', '));
  created.add(`dispute:${disputeId}`);
} catch (e) {
  step('journey ran to completion', false, e.message);
} finally {
  const bookings = [...created].filter((x) => !x.startsWith('dispute:'));
  const disputeIds = [...created].filter((x) => x.startsWith('dispute:')).map((x) => x.slice(8));
  if (bookings.length) {
    try {
      await db.query('begin');
      await db.query('alter table public.booking_events disable trigger booking_events_append_only');
      await db.query('alter table public.ledger_entries disable trigger ledger_append_only');
      const ds = (await db.query(`select id from public.disputes where booking_id = any($1::uuid[])`, [bookings])).rows.map((r) => r.id);
      const convs = (await db.query(`select id from public.conversations where booking_id = any($1::uuid[])`, [bookings])).rows.map((r) => r.id);
      await db.query(`delete from public.notifications where entity_id = any($1::uuid[])`, [[...bookings, ...ds, ...disputeIds, ...convs]]);
      await db.query(`delete from public.disputes where booking_id = any($1::uuid[])`, [bookings]);
      await db.query(`delete from public.ledger_entries where booking_id = any($1::uuid[])`, [bookings]);
      await db.query(`delete from public.refunds where booking_id = any($1::uuid[])`, [bookings]);
      await db.query(`delete from public.payments where booking_id = any($1::uuid[])`, [bookings]);
      await db.query(`delete from public.bookings where id = any($1::uuid[])`, [bookings]);
      await db.query('alter table public.ledger_entries enable trigger ledger_append_only');
      await db.query('alter table public.booking_events enable trigger booking_events_append_only');
      await db.query('commit');
      console.log(`Cleaned up ${bookings.length} test booking(s) and their cases.`);
    } catch (e) {
      await db.query('rollback').catch(() => undefined);
      console.error('Cleanup failed:', e.message);
      failures++;
    }
  }
  if (evidencePath) {
    const rm = await db.query(`delete from storage.objects where bucket_id = 'evidence' and name = $1`, [evidencePath]).catch((e) => ({ error: e }));
    if (rm.error) console.warn(`The test evidence photo was left in private storage (${rm.error.message.split('\n')[0]}).`);
  }
  await db.end();
  for (const s of [leo, bea, dana, paolo, admin]) await s.c.auth.signOut();
}
console.log(failures === 0 ? '\nJourney E passed end-to-end.' : `\n${failures} step(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
