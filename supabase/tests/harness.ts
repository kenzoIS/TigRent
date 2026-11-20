/**
 * PGlite test harness: real Postgres (WASM) + Supabase shim + the exact migration files deployed to
 * the hosted project (decision D7). Database construction is shared with the type generator
 * through scripts/lib/migrations.cjs so they can never diverge.
 */
import { createPgliteDb, readSupabaseFile } from '../../scripts/lib/migrations.cjs';

type PGlite = Awaited<ReturnType<typeof createPgliteDb>>;
type Transaction = Parameters<Parameters<PGlite['transaction']>[0]>[0];

/** A user id, or one of the API roles. */
export type Actor = string | 'anon' | 'service';

export const DEMO = {
  admin: 'aaaaaaaa-0000-4000-8000-000000000001',
  bea: 'aaaaaaaa-0000-4000-8000-000000000002',
  leo: 'aaaaaaaa-0000-4000-8000-000000000003',
  dana: 'aaaaaaaa-0000-4000-8000-000000000004',
  paolo: 'aaaaaaaa-0000-4000-8000-000000000005',
  rina: 'aaaaaaaa-0000-4000-8000-000000000006',
  rico: 'aaaaaaaa-0000-4000-8000-000000000007',
  mika: 'aaaaaaaa-0000-4000-8000-000000000008',
} as const;

class Rollback extends Error {}

export class TestDb {
  readonly pg: PGlite;
  constructor(pg: PGlite) {
    this.pg = pg;
  }

  /** Superuser query (setup/assertions only). */
  async sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pg.query<T>(query, params)).rows;
  }

  async exec(query: string): Promise<void> {
    await this.pg.exec(query);
  }

  /** Run a query as an API role with Supabase-style JWT claims, inside a rolled-back transaction. */
  async as<T = Record<string, unknown>>(actor: Actor, query: string, params: unknown[] = []): Promise<T[]> {
    let rows: T[] = [];
    try {
      await this.pg.transaction(async (tx) => {
        await impersonate(tx, actor);
        rows = (await tx.query<T>(query, params)).rows;
        throw new Rollback(); // never persist changes made while impersonating
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    return rows;
  }

  /** Like `as`, but COMMITS (multi-step flows such as request → accept → pay). */
  async asCommit<T = Record<string, unknown>>(actor: Actor, query: string, params: unknown[] = []): Promise<T[]> {
    let rows: T[] = [];
    await this.pg.transaction(async (tx) => {
      await impersonate(tx, actor);
      rows = (await tx.query<T>(query, params)).rows;
    });
    return rows;
  }

  /** `asCommit` that returns the error message instead of throwing (null on success). */
  async errorAsCommit(actor: Actor, query: string, params: unknown[] = []): Promise<string | null> {
    try {
      await this.asCommit(actor, query, params);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  /** Like `as`, but returns the error message (or null when the statement succeeds). */
  async errorAs(actor: Actor, query: string, params: unknown[] = []): Promise<string | null> {
    try {
      await this.as(actor, query, params);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  close() {
    return this.pg.close();
  }
}

async function impersonate(tx: Transaction, actor: Actor) {
  const claims =
    actor === 'service' ? { role: 'service_role' } : actor === 'anon' ? { role: 'anon' } : { sub: actor, role: 'authenticated' };
  const role = actor === 'service' ? 'service_role' : actor === 'anon' ? 'anon' : 'authenticated';
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await tx.exec(`set local role ${role}`);
}

export async function createTestDb({ seed = false }: { seed?: boolean } = {}): Promise<TestDb> {
  return new TestDb(await createPgliteDb({ seed }));
}

export async function runSeed(db: TestDb) {
  await db.exec(readSupabaseFile('seed.sql'));
}
