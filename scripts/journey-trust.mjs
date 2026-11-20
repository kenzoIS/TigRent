// LIVE end-to-end Journey E.5–E.7 (plan §3: ratings after completion, badge/aggregate updates, the
// low-rating rule, restriction, appeal) against the hosted project with the publishable key. A direct SQL
// connection is used only to tighten the sample rule temporarily (restored in `finally`) and to clean up.
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
const admin = await as('admin.demo@tigrent.test');
const manilaToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const { client: db } = await connect();
let bookingId = null;
let ruleBackup = null;
const startedAt = new Date().toISOString();

try {
  if ((await db.query(`select account_status from public.profiles where id = $1`, [bea.id])).rows[0].account_status !== 'active') {
    throw new Error('Bea is not in good standing in the live demo; reset the demo first.');
  }
  const { data: listings } = await leo.c.from('listings').select('id, title').eq('lender_id', leo.id).eq('status', 'active');
  let listing = null;
  for (const l of listings ?? []) {
    const { data: q } = await bea.c.rpc('quote_booking', { p_listing_id: l.id, p_pickup: manilaToday, p_return: manilaToday });
    if (q?.available) { listing = l; break; }
  }
  if (!listing) throw new Error('None of Leo’s items is free today.');
  const { data: terms } = await bea.c.from('terms_versions').select('id').eq('doc_type', 'rental_terms').eq('is_active', true).single();
  bookingId = (await bea.c.rpc('request_booking', { p_listing_id: listing.id, p_pickup: manilaToday, p_return: manilaToday, p_terms_version_id: terms.id })).data;
  await leo.c.rpc('decide_booking_request', { p_booking_id: bookingId, p_decision: 'accept' });
  await bea.c.rpc('pay_booking_demo', { p_booking_id: bookingId, p_idempotency_key: `journey-trust-${Date.now()}`, p_scenario: 'success' });
  await leo.c.rpc('confirm_handover', { p_booking_id: bookingId });
  await bea.c.rpc('confirm_handover', { p_booking_id: bookingId });
  const early = await bea.c.rpc('submit_review', { p_booking_id: bookingId, p_rating: 5 });
  step('a rental can’t be reviewed before completion', early.error?.message === 'conflict.not_completed');
  await bea.c.rpc('submit_return', { p_booking_id: bookingId });
  const done = await leo.c.rpc('confirm_clean_return', { p_booking_id: bookingId });
  step(`setup: Bea rents “${listing.title}” and the rental completes`, done.data?.status === 'completed', done.error?.hint);

  // E.5 Both parties rate each other once.
  const { data: prompts } = await bea.c.rpc('list_review_prompts');
  step('the borrower is prompted to review', prompts?.some((p) => p.booking_id === bookingId));
  const leoBefore = (await bea.c.rpc('get_profile_summary', { p_user_id: leo.id })).data?.lender_rating.count;
  const r1 = await bea.c.rpc('submit_review', { p_booking_id: bookingId, p_rating: 5, p_comment: 'Journey trust: smooth rental.' });
  const dup = await bea.c.rpc('submit_review', { p_booking_id: bookingId, p_rating: 4 });
  const leoAfter = (await bea.c.rpc('get_profile_summary', { p_user_id: leo.id })).data?.lender_rating.count;
  step('E.5 the borrower rates the lender once; the count updates', Boolean(r1.data) && dup.error?.message === 'conflict.already_reviewed' && leoAfter === leoBefore + 1, `${leoBefore} → ${leoAfter}`);

  // E.6 Report + moderation update aggregates.
  await leo.c.rpc('report_review', { p_review_id: r1.data, p_reason: 'Journey trust: test report' });
  const stillCounted = (await dana.c.rpc('get_profile_summary', { p_user_id: leo.id })).data?.lender_rating.count;
  await admin.c.rpc('moderate_review', { p_review_id: r1.data, p_action: 'hide', p_note: 'Journey trust: hidden for the test' });
  const hiddenCount = (await dana.c.rpc('get_profile_summary', { p_user_id: leo.id })).data?.lender_rating.count;
  await admin.c.rpc('moderate_review', { p_review_id: r1.data, p_action: 'restore', p_note: 'Journey trust: restored after the test' });
  step('E.6 a report doesn’t hide a review; a moderator’s hide/restore updates the aggregate', stillCounted === leoAfter && hiddenCount === leoAfter - 1);

  // E.7 Cross the (temporarily tightened) low-rating rule.
  ruleBackup = (await db.query(`select value from public.platform_settings where key = 'account_health_rule' and is_current`)).rows[0].value;
  const { data: m } = await bea.c.rpc('get_my_account_health');
  const count = m.metrics.review_count + 1;
  await db.query(`update public.platform_settings set value = $1 where key = 'account_health_rule' and is_current`,
    [JSON.stringify({ ...ruleBackup, min_reviews: count, avg_below: 4.99 })]);
  const r2 = await leo.c.rpc('submit_review', { p_booking_id: bookingId, p_rating: 1, p_comment: 'Journey trust: low rating that crosses the test threshold.' });
  const { data: paused } = await bea.c.rpc('get_my_account_health');
  step('E.7 crossing the configured rule pauses the account automatically', Boolean(r2.data) && paused?.account_status === 'paused_pending_review' && paused.history[0]?.automatic === true,
    `${paused?.metrics.review_count} ratings, avg ${paused?.metrics.avg_rating}`);
  const blocked = await bea.c.rpc('request_booking', { p_listing_id: listing.id, p_pickup: manilaToday, p_return: manilaToday, p_terms_version_id: terms.id });
  const { data: stillMine } = await bea.c.from('bookings').select('id').eq('id', bookingId);
  const conv = (await bea.c.rpc('get_booking_detail', { p_booking_id: bookingId })).data?.conversation_id;
  const msg = await bea.c.rpc('send_message', { p_conversation_id: conv, p_body: 'Journey trust: still able to message.' });
  step('new rentals are blocked; existing rentals and messages stay available', blocked.error?.message === 'forbidden.account_restricted' && stillMine?.length === 1 && !msg.error);

  const appeal = await bea.c.rpc('submit_account_appeal', { p_reason: 'Journey trust: please review my account.' });
  await admin.c.rpc('moderate_account', { p_user_id: bea.id, p_decision: 'request_info', p_note: 'Journey trust: tell us more.' });
  await bea.c.rpc('submit_account_appeal', { p_reason: 'Journey trust: here is more information.' });
  const notStaff = await leo.c.rpc('moderate_account', { p_user_id: bea.id, p_decision: 'lift', p_note: 'A student trying to lift.' });
  const lift = await admin.c.rpc('moderate_account', { p_user_id: bea.id, p_decision: 'lift', p_note: 'Journey trust: restriction lifted after review.' });
  const { data: back } = await bea.c.rpc('get_my_account_health');
  step('the member appeals, adds requested info, and only a moderator lifts the restriction',
    Boolean(appeal.data) && notStaff.error?.message === 'forbidden.staff_only' && lift.data?.account_status === 'active' && back?.appeal?.status === 'lifted');
} catch (e) {
  step('journey ran to completion', false, e.message);
} finally {
  try {
    if (ruleBackup) await db.query(`update public.platform_settings set value = $1 where key = 'account_health_rule' and is_current`, [JSON.stringify(ruleBackup)]);
    await db.query('begin');
    await db.query('alter table public.booking_events disable trigger booking_events_append_only');
    await db.query('alter table public.ledger_entries disable trigger ledger_append_only');
    await db.query('alter table public.account_status_events disable trigger account_status_events_append_only');
    // Bea must end in good standing even if a step failed.
    await db.query(`update public.profiles set account_status = 'active', status_reason = null where id = $1 and status_changed_at >= $2`, [bea.id, startedAt]);
    await db.query(`delete from public.account_status_events where user_id = $1 and created_at >= $2`, [bea.id, startedAt]);
    await db.query(`delete from public.account_appeals where user_id = $1 and created_at >= $2`, [bea.id, startedAt]);
    await db.query(`delete from public.notifications where created_at >= $1 and (user_id = $2 or entity_id = $2 or entity_id = $3)`, [startedAt, bea.id, bookingId]);
    if (bookingId) {
      const conv = (await db.query(`select id from public.conversations where booking_id = $1`, [bookingId])).rows.map((r) => r.id);
      await db.query(`delete from public.notifications where entity_id = any($1::uuid[])`, [conv]);
      await db.query(`delete from public.reviews where booking_id = $1`, [bookingId]);
      await db.query(`delete from public.ledger_entries where booking_id = $1`, [bookingId]);
      await db.query(`delete from public.refunds where booking_id = $1`, [bookingId]);
      await db.query(`delete from public.payments where booking_id = $1`, [bookingId]);
      await db.query(`delete from public.bookings where id = $1`, [bookingId]);
    }
    await db.query('alter table public.account_status_events enable trigger account_status_events_append_only');
    await db.query('alter table public.ledger_entries enable trigger ledger_append_only');
    await db.query('alter table public.booking_events enable trigger booking_events_append_only');
    await db.query('commit');
    console.log('Cleaned up: rule restored, Bea in good standing, test booking/reviews/appeal removed.');
  } catch (e) {
    await db.query('rollback').catch(() => undefined);
    console.error('Cleanup failed:', e.message);
    failures++;
  }
  await db.end();
  for (const s of [leo, bea, dana, admin]) await s.c.auth.signOut();
}
console.log(failures === 0 ? '\nJourney E.5–E.7 (trust) passed end-to-end.' : `\n${failures} step(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
