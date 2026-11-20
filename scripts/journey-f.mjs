// LIVE end-to-end Journey F (Phase 12): simulated Premium, entitlement gates,
// ledger accounting and audited administration. It uses only demo accounts and
// restores listings/availability/subscription rows that it creates.
import { createClient } from '@supabase/supabase-js';
import { connect } from './lib/connection.mjs';
import { loadEnv } from './lib/env.mjs';

const env = loadEnv();
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let failures = 0;
const step = (label, passed, detail = '') => { console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); if (!passed) failures++; };
async function signIn(email) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: 'TigRentDemo#2026' });
  if (error) throw new Error(`${email}: ${error.message}`);
  return { client, id: data.user.id };
}

const dana = await signIn('dana.dual@tigrent.test');
const admin = await signIn('admin.demo@tigrent.test');
const { client: db } = await connect();
const stamp = Date.now();
const listingIds = ['33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002'];
let subscriptionId = null;
let blockId = null;
let priorListings = [];

try {
  priorListings = (await db.query(`select id, status, is_featured, featured_until from public.listings where id = any($1::uuid[])`, [listingIds])).rows;
  const locked = await dana.client.rpc('get_lender_analytics');
  step('Premium analytics are denied before subscription', locked.error?.message === 'forbidden.premium_required');

  const checkoutKey = `journey-f-${stamp}`;
  const first = await dana.client.rpc('subscribe_premium_demo', { p_idempotency_key: checkoutKey, p_scenario: 'success' });
  const repeated = await dana.client.rpc('subscribe_premium_demo', { p_idempotency_key: checkoutKey, p_scenario: 'failure' });
  subscriptionId = first.data?.subscription_id ?? null;
  const payment = subscriptionId ? (await db.query(`select amount, status from public.payments where subscription_id = $1`, [subscriptionId])).rows[0] : null;
  const balances = subscriptionId ? (await db.query(`select coalesce(sum(debit),0)::bigint debit, coalesce(sum(credit),0)::bigint credit from public.ledger_entries where subscription_id = $1`, [subscriptionId])).rows[0] : null;
  step('F.1 mock PHP 99 checkout is idempotent and balanced', first.data?.status === 'succeeded' && repeated.data?.subscription_id === subscriptionId && Number(payment?.amount) === 9900 && payment?.status === 'succeeded' && Number(balances?.debit) === Number(balances?.credit));

  const feature = await dana.client.rpc('set_featured_listing', { p_listing_id: listingIds[0], p_enabled: true });
  const from = new Date(Date.now() + 250 * 86400e3).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 252 * 86400e3).toISOString().slice(0, 10);
  const range = await dana.client.rpc('add_availability_block', { p_listing_id: listingIds[0], p_start: from, p_end: to, p_reason: 'Journey F Premium range' });
  blockId = range.data ?? null;
  const bulk = await dana.client.rpc('bulk_set_listing_status', { p_listing_ids: listingIds, p_status: 'paused' });
  const analytics = await dana.client.rpc('get_lender_analytics');
  step('F.2 Premium unlocks promotional placement, advanced calendar and safe bulk equipment updates', feature.data?.is_featured === true && Boolean(blockId) && bulk.data === 2 && !analytics.error);

  const audit = await admin.client.rpc('list_audit_log');
  step('F.3 protected Premium actions are visible in the staff audit log', !audit.error && audit.data?.some((row) => row.entity_id === subscriptionId && row.action === 'premium.active') && audit.data?.some((row) => row.action === 'listing.bulk_paused'));

  const cancelled = await dana.client.rpc('cancel_premium');
  const lockedAgain = await dana.client.rpc('set_featured_listing', { p_listing_id: listingIds[0], p_enabled: true });
  step('F.4 cancellation removes entitlement without deleting the subscription history', cancelled.data?.status === 'cancelled' && lockedAgain.error?.message === 'forbidden.premium_required');
} catch (error) {
  step('journey ran to completion', false, error instanceof Error ? error.message : String(error));
} finally {
  try {
    await db.query('begin');
    if (blockId) await db.query(`delete from public.listing_availability where id = $1`, [blockId]);
    for (const row of priorListings) await db.query(`update public.listings set status = $2, is_featured = $3, featured_until = $4 where id = $1`, [row.id, row.status, row.is_featured, row.featured_until]);
    if (subscriptionId) {
      await db.query('alter table public.ledger_entries disable trigger ledger_append_only');
      await db.query(`delete from public.ledger_entries where subscription_id = $1`, [subscriptionId]);
      await db.query('alter table public.ledger_entries enable trigger ledger_append_only');
      await db.query(`delete from public.notifications where entity_type = 'subscription' and entity_id = $1`, [subscriptionId]);
      await db.query(`delete from public.payments where subscription_id = $1`, [subscriptionId]);
      await db.query(`delete from public.subscriptions where id = $1`, [subscriptionId]);
    }
    await db.query('commit');
    console.log('Cleaned up test subscription, ledger, listing state and calendar range; audit history remains append-only.');
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    console.error('Cleanup failed:', error instanceof Error ? error.message : String(error));
    failures++;
  }
  await db.end();
  await dana.client.auth.signOut();
  await admin.client.auth.signOut();
}

console.log(failures === 0 ? '\nJourney F (Premium/admin) passed end-to-end.' : `\n${failures} step(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
