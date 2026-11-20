// Writes src/types/database.ts from the migrations (via PGlite). No Docker or Supabase token needed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './lib/env.mjs';

const require = createRequire(import.meta.url);
const { createPgliteDb } = require('./lib/migrations.cjs');
const { generateDatabaseTypes } = require('./lib/gen-types.cjs');

const pg = await createPgliteDb();
const out = await generateDatabaseTypes(async (sql) => (await pg.query(sql)).rows);
await pg.close();
const file = path.join(ROOT, 'src', 'types', 'database.ts');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, out);
console.log(`Wrote ${path.relative(ROOT, file)} (${out.split('\n').length} lines)`);
