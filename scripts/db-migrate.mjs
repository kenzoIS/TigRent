// Applies pending migrations to the hosted Supabase database, one transaction per file.
// Records them in supabase_migrations.schema_migrations (same table the Supabase CLI uses).
//   node scripts/db-migrate.mjs            apply pending migrations
//   node scripts/db-migrate.mjs --status   list applied / pending, change nothing
import { createRequire } from 'node:module';
import { connect } from './lib/connection.mjs';

const require = createRequire(import.meta.url);
const { listMigrations } = require('./lib/migrations.cjs');
const statusOnly = process.argv.includes('--status');

const { client, host } = await connect();
try {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
  const applied = new Set((await client.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version));
  const all = listMigrations();
  const pending = all.filter((m) => !applied.has(m.version));

  console.log(`Database: ${host}`);
  for (const m of all) console.log(`  ${applied.has(m.version) ? 'applied' : 'PENDING'}  ${m.version}_${m.name}`);
  if (statusOnly || pending.length === 0) {
    console.log(pending.length === 0 ? 'Up to date.' : `${pending.length} pending.`);
  } else {
    for (const m of pending) {
      process.stdout.write(`Applying ${m.version}_${m.name} … `);
      await client.query('begin');
      try {
        await client.query(m.sql);
        await client.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)', [m.version, m.name, [m.sql]]);
        await client.query('commit');
        console.log('ok');
      } catch (e) {
        await client.query('rollback');
        console.log('FAILED');
        console.error(e.message);
        process.exitCode = 1;
        break;
      }
    }
  }
} finally {
  await client.end();
}
