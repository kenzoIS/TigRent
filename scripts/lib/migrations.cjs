// Single source of truth for which migration files exist and in what order.
// Used by the hosted migration runner, the PGlite test harness and the type generator.
const fs = require('node:fs');
const path = require('node:path');

const SUPABASE_DIR = path.resolve(__dirname, '..', '..', 'supabase');
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, 'migrations');
const FILE_RE = /^(\d{14})_([a-z0-9_]+)\.sql$/;

function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => FILE_RE.test(f))
    .sort()
    .map((f) => {
      const [, version, name] = FILE_RE.exec(f);
      const file = path.join(MIGRATIONS_DIR, f);
      return { version, name, file, sql: fs.readFileSync(file, 'utf8') };
    });
}

const readSupabaseFile = (rel) => fs.readFileSync(path.join(SUPABASE_DIR, rel), 'utf8');

/** Builds an in-memory Postgres (PGlite) with the Supabase shim and all migrations (optionally seed). */
async function createPgliteDb({ seed = false } = {}) {
  const { PGlite } = require('@electric-sql/pglite');
  const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');
  const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
  const pg = await PGlite.create({ extensions: { btree_gist, pgcrypto } });
  await pg.exec(readSupabaseFile('tests/shim.sql'));
  for (const m of listMigrations()) {
    try {
      await pg.exec(m.sql);
    } catch (e) {
      throw new Error(`Migration ${m.version}_${m.name} failed: ${e.message}`);
    }
  }
  if (seed) await pg.exec(readSupabaseFile('seed.sql'));
  return pg;
}

module.exports = { SUPABASE_DIR, listMigrations, readSupabaseFile, createPgliteDb };
