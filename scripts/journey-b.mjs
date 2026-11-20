// LIVE end-to-end Journey B (plan §3: "Lender lists an item") + moderation, against the hosted project
// using only the publishable key. Uses demo lender Leo and removes everything it creates.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, ROOT } from './lib/env.mjs';
import { connect } from './lib/connection.mjs';

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
const admin = await as('admin.demo@tigrent.test');
const paolo = await as('paolo.pending@tigrent.test'); // pending, no roles: can never list
const fields = {
  title: 'Journey B test: graphing calculator', description: 'Automated test listing.', category: 'calculators', condition: 'good',
  daily_rate: 5000, deposit: 20000, late_fee_per_day: 2500, pickup_point_id: 'ffffffff-0000-4000-8000-000000000002', pickup_notes: 'Weekdays',
};
let listingId = null;
let photoPath = null;
try {
  const bad = await leo.c.rpc('create_listing', { p_fields: { ...fields, daily_rate: -5 } });
  step('B.3 invalid money is rejected by the server', bad.error?.message === 'validation.daily_rate', bad.error?.hint);
  // (Demo roles can change during manual testing, so use the pending student, who holds no roles.)
  const notLender = await paolo.c.rpc('create_listing', { p_fields: fields });
  step('a student without the lender role cannot create listings', /^forbidden./.test(notLender.error?.message ?? ''), notLender.error?.message);

  const created = await leo.c.rpc('create_listing', { p_fields: fields });
  listingId = created.data;
  step('B.2 lender creates a draft', !created.error && Boolean(listingId), created.error?.hint);
  const draftSeen = await bea.c.from('listings').select('id').eq('id', listingId);
  step('drafts are invisible to borrowers', draftSeen.data.length === 0);
  const noPhoto = await leo.c.rpc('set_listing_status', { p_id: listingId, p_status: 'active' });
  step('publishing requires a photo', noPhoto.error?.message === 'validation.photos');

  photoPath = `${listingId}/journey-b.png`;
  const png = fs.readFileSync(path.join(ROOT, 'assets', 'listings', '22222222-0000-4000-8000-000000000003.png'));
  const up = await leo.c.storage.from('listing-images').upload(photoPath, png, { contentType: 'image/png' });
  step('photo uploads to the listing’s private folder', !up.error, up.error?.message);
  const foreign = await bea.c.storage.from('listing-images').upload(`${listingId}/intruder.png`, png, { contentType: 'image/png' });
  step('another student cannot upload photos to it', Boolean(foreign.error));
  const added = await leo.c.rpc('add_listing_image', { p_listing_id: listingId, p_path: photoPath });
  step('photo is registered from storage metadata', !added.error, added.error?.hint);

  const pub = await leo.c.rpc('set_listing_status', { p_id: listingId, p_status: 'active' });
  step('B.4 publish', pub.data === 'active', pub.error?.hint);
  const seen = await bea.c.from('listings').select('id, daily_rate').eq('id', listingId);
  step('B.5 active listing appears for a verified borrower', seen.data.length === 1 && seen.data[0].daily_rate === 5000);
  const signed = await bea.c.storage.from('listing-images').createSignedUrl(photoPath, 60);
  const img = signed.data ? await fetch(signed.data.signedUrl) : null;
  step('borrower can view the photo through a signed URL', img?.status === 200);

  const edit = await leo.c.rpc('update_listing', { p_id: listingId, p_fields: { ...fields, daily_rate: 6000 } });
  step('B.4 edit price', !edit.error);
  await leo.c.rpc('set_listing_status', { p_id: listingId, p_status: 'paused' });
  const paused = await bea.c.from('listings').select('id').eq('id', listingId);
  step('paused listing disappears from borrowers', paused.data.length === 0);
  const re = await leo.c.rpc('set_listing_status', { p_id: listingId, p_status: 'active' });
  step('reactivate', re.data === 'active');

  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const plus = (n) => new Date(Date.parse(today) + n * 86400e3).toISOString().slice(0, 10);
  // A single-day block is available to every lender; Journey F covers the Premium multi-day path.
  const block = await leo.c.rpc('add_availability_block', { p_listing_id: listingId, p_start: plus(10), p_end: plus(10), p_reason: 'Test' });
  step('single-day availability block saved', !block.error, block.error?.hint);
  const blocks = await bea.c.from('listing_availability').select('id').eq('listing_id', listingId);
  step('borrowers can see blocked dates (for the calendar)', blocks.data.length === 1);

  const rep = await bea.c.rpc('report_listing', { p_listing_id: listingId, p_reason: 'Automated test report' });
  step('verified borrower reports the listing', !rep.error, rep.error?.hint);
  const notStaff = await bea.c.rpc('resolve_listing_report', { p_report_id: rep.data, p_action: 'hide', p_note: 'Trying to moderate' });
  step('non-staff cannot resolve reports', notStaff.error?.message === 'forbidden.staff_only');
  const hide = await admin.c.rpc('resolve_listing_report', { p_report_id: rep.data, p_action: 'hide', p_note: 'Automated test: hiding the listing.' });
  step('moderator hides the listing', !hide.error, hide.error?.hint);
  const hidden = await bea.c.from('listings').select('id').eq('id', listingId);
  step('hidden listing disappears from borrowers', hidden.data.length === 0);
  await leo.c.rpc('set_listing_status', { p_id: listingId, p_status: 'paused' });
  const blocked = await leo.c.rpc('set_listing_status', { p_id: listingId, p_status: 'active' });
  step('lender cannot republish a hidden listing', blocked.error?.message === 'forbidden.listing_hidden');
  const { data: note } = await leo.c.from('notifications').select('type').eq('entity_id', listingId);
  step('lender is notified with the reason', note.some((n) => n.type === 'listing.hidden'));
  const restore = await admin.c.rpc('restore_listing', { p_listing_id: listingId, p_note: 'Automated test: restored.' });
  step('moderator restores it', !restore.error);

  const removed = await leo.c.rpc('set_listing_status', { p_id: listingId, p_status: 'removed' });
  step('B.4 remove (no open bookings)', removed.data === 'removed', removed.error?.hint);
  const afterRemove = await leo.c.rpc('update_listing', { p_id: listingId, p_fields: fields });
  step('removed listings can’t be edited', afterRemove.error?.message === 'conflict.listing_removed');
} catch (e) {
  step('unexpected error', false, e.message);
} finally {
  if (photoPath) await leo.c.storage.from('listing-images').remove([photoPath]); // while the listing still exists (storage policy)
  if (listingId) {
    const { client: db } = await connect();
    await db.query(`delete from public.notifications where entity_type = 'listing' and entity_id = $1`, [listingId]);
    await db.query(`delete from public.listings where id = $1`, [listingId]); // images, blocks, reports cascade
    await db.end();
    console.log('cleanup: removed the test listing, its photo, report and notifications');
  }
  for (const s of [leo, bea, admin, paolo]) await s.c.auth.signOut();
}
console.log(failures === 0 ? '\nJourney B passed end-to-end.' : `\n${failures} Journey B step(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
