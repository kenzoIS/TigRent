// DEMO RESET: wipes all TigRent app data on the demo database and reloads the seed.
// Development/demo tooling only. It is not part of the app bundle and cannot be triggered from the app.
//
// Safety:
//   • requires --confirm <project-ref> matching SUPABASE_PROJECT_REF
//   • requires TIGRENT_ENV != "production"
//   • removes only demo auth accounts (@tigrent.test); other sign-ups keep their login and get a fresh,
//     unverified profile (their app data is cleared like everyone else's)
import { createRequire } from 'node:module';
import { connect } from './lib/connection.mjs';
import { loadEnv } from './lib/env.mjs';

const require = createRequire(import.meta.url);
const { readSupabaseFile } = require('./lib/migrations.cjs');

const env = loadEnv();
const idx = process.argv.indexOf('--confirm');
const confirmRef = idx > -1 ? process.argv[idx + 1] : undefined;
if (env.TIGRENT_ENV === 'production') {
  console.error('Refusing to reset: TIGRENT_ENV is "production".');
  process.exit(1);
}
if (!confirmRef || confirmRef !== env.SUPABASE_PROJECT_REF) {
  console.error(`This deletes all TigRent data in project ${env.SUPABASE_PROJECT_REF}.\nRe-run with: npm run db:reset-demo -- --confirm ${env.SUPABASE_PROJECT_REF}`);
  process.exit(1);
}

const APP_TABLES = [
  'ledger_entries', 'refunds', 'payments', 'subscriptions', 'messages', 'conversation_participants', 'conversations',
  'notifications', 'dispute_evidence', 'dispute_messages', 'disputes', 'reviews', 'account_appeals',
  'extension_requests', 'return_reports', 'handover_reports', 'booking_terms_acceptances', 'booking_events', 'bookings',
  'listing_reports', 'listing_availability', 'listing_images', 'listings', 'terms_acceptances', 'student_verifications',
  'user_roles', 'audit_logs', 'profiles', 'terms_versions', 'academic_years', 'campus_pickup_points', 'listing_categories',
  'cancellation_policy_versions', 'platform_settings',
].map((t) => `public.${t}`);

const { client, host } = await connect();
try {
  await client.query('begin');
  await client.query(`truncate ${APP_TABLES.join(', ')} restart identity cascade`);
  // Best effort: hosted Supabase may forbid direct SQL deletes on storage (Storage API only).
  // Stale files are harmless: every path is owner/booking-scoped and the buckets stay private.
  await client.query('savepoint storage_cleanup');
  try {
    await client.query(`delete from storage.objects where bucket_id in ('verification-docs', 'avatars', 'listing-images', 'evidence')`);
  } catch (e) {
    await client.query('rollback to savepoint storage_cleanup');
    console.warn(`Storage files were left in place (${e.message.split('\n')[0]}).`);
  }
  await client.query(`delete from auth.users where email like '%@tigrent.test'`);
  // Non-demo sign-ups keep their login with a fresh, unverified profile.
  await client.query(`insert into public.profiles (id, full_name)
                      select id, left(coalesce(raw_user_meta_data ->> 'full_name', ''), 120) from auth.users
                      on conflict (id) do nothing`);
  await client.query(readSupabaseFile('seed.sql'));
  await client.query('commit');
  console.log(`Demo data reset on ${host}.`);
  // Re-upload any missing SAMPLE registration forms (runs after the connection closes below).
  process.on('beforeExit', function once() {
    process.removeListener('beforeExit', once);
    if (!process.exitCode) import('./db-seed-files.mjs');
  });
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error('Reset failed (nothing changed):', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
