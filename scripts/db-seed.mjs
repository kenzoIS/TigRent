// Loads (or refreshes) the demo seed on the hosted database. Idempotent: safe to run repeatedly.
import { createRequire } from 'node:module';
import { connect } from './lib/connection.mjs';

const require = createRequire(import.meta.url);
const { readSupabaseFile } = require('./lib/migrations.cjs');

const { client, host } = await connect();
try {
  await client.query('begin');
  await client.query(readSupabaseFile('seed.sql'));
  await client.query('commit');
  const { rows } = await client.query(`
    select (select count(*) from auth.users where email like '%@tigrent.test') as demo_accounts,
           (select count(*) from public.listings) as listings,
           (select count(*) from public.bookings) as bookings`);
  console.log(`Seed applied on ${host}:`, rows[0]);
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error('Seed failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
