// Resolves a Postgres connection to the hosted Supabase project.
// Order: SUPABASE_DB_HOST from .env (cached) → direct host (IPv6 on free tier) → session pooler per region.
import pg from 'pg';
import { loadEnv, requireEnv } from './env.mjs';

const REGIONS = [
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-south-1',
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1',
  'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1',
];

function candidates(env) {
  const ref = env.SUPABASE_PROJECT_REF;
  const list = [];
  if (env.SUPABASE_DB_HOST) list.push({ host: env.SUPABASE_DB_HOST, user: env.SUPABASE_DB_USER ?? `postgres.${ref}` });
  list.push({ host: `db.${ref}.supabase.co`, user: 'postgres' });
  for (const prefix of ['aws-0', 'aws-1']) for (const r of REGIONS) list.push({ host: `${prefix}-${r}.pooler.supabase.com`, user: `postgres.${ref}` });
  return list;
}

async function tryConnect(env, { host, user }) {
  const client = new pg.Client({
    host,
    user,
    port: 5432,
    database: 'postgres',
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    return client;
  } catch (e) {
    await client.end().catch(() => undefined);
    return { error: e.message };
  }
}

/** Returns a connected pg.Client plus the host/user that worked. */
export async function connect({ verbose = false } = {}) {
  const env = loadEnv();
  requireEnv(env, ['SUPABASE_PROJECT_REF', 'SUPABASE_DB_PASSWORD']);
  for (const c of candidates(env)) {
    const res = await tryConnect(env, c);
    if (res instanceof pg.Client) {
      if (verbose) console.log(`Connected via ${c.host} as ${c.user}`);
      return { client: res, host: c.host, user: c.user };
    }
    if (verbose) console.log(`  ${c.host}: ${res.error.split('\n')[0]}`);
    // A wrong password is fatal everywhere; stop instead of hammering every region.
    if (/password authentication failed/i.test(res.error)) {
      throw new Error('Database password was rejected. Check SUPABASE_DB_PASSWORD in .env.');
    }
  }
  throw new Error('Could not reach the Supabase database on the direct host or any session pooler.');
}

/** Connection string for CLI tools (password URL-encoded). Never print it. */
export function connectionString(env, host, user) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@${host}:5432/postgres?sslmode=require`;
}
