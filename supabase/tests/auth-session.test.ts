import { createTestDb, DEMO, type TestDb } from './harness';

/** Phase 3: server-side session context, terms acceptance and role enablement. */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb({ seed: true });
});
afterAll(async () => {
  await db.close();
});

type Ctx = { roles: string[]; verification_status: string; account_status: string; pending_terms: { id: string }[]; active_role_pref: string | null };
const ctx = async (who: string) => (await db.as<{ c: Ctx }>(who, `select public.get_my_session_context() as c`))[0]!.c;

describe('get_my_session_context', () => {
  it('reports server-held roles and statuses for each demo account', async () => {
    expect(await ctx(DEMO.bea)).toMatchObject({ roles: ['borrower'], verification_status: 'verified', account_status: 'active', pending_terms: [] });
    expect(await ctx(DEMO.dana)).toMatchObject({ roles: ['borrower', 'lender'], active_role_pref: 'borrower' });
    expect(await ctx(DEMO.paolo)).toMatchObject({ roles: [], verification_status: 'pending_review' });
    expect(await ctx(DEMO.rina)).toMatchObject({ verification_status: 'rejected' });
    expect(await ctx(DEMO.rico)).toMatchObject({ account_status: 'paused_pending_review' });
    expect(await ctx(DEMO.admin)).toMatchObject({ roles: ['admin', 'moderator'] });
  });
  it('lists the active Terms/Privacy versions a new user still has to accept', async () => {
    const pending = (await ctx(DEMO.admin)).pending_terms;
    expect(pending.length).toBe(2);
  });
  it('is not callable anonymously', async () => {
    expect(await db.errorAs('anon', `select public.get_my_session_context()`)).toMatch(/permission denied/);
  });
});

describe('accept_current_terms', () => {
  it('records acceptance of the exact active versions and clears pending terms', async () => {
    const ids = (await ctx(DEMO.admin)).pending_terms.map((t) => t.id);
    const rows = await db.as<{ c: Ctx }>(DEMO.admin, `select public.accept_current_terms($1::uuid[]) as c`, [ids]);
    expect(rows[0]!.c.pending_terms).toEqual([]);
  });
  it('rejects stale or partial version lists', async () => {
    const ids = (await ctx(DEMO.admin)).pending_terms.map((t) => t.id);
    expect(await db.errorAs(DEMO.admin, `select public.accept_current_terms($1::uuid[])`, [ids.slice(0, 1)])).toMatch(/conflict.terms_outdated/);
    expect(await db.errorAs(DEMO.admin, `select public.accept_current_terms($1::uuid[])`, [['00000000-0000-4000-8000-000000000000']]))
      .toMatch(/conflict.terms_outdated/);
  });
});

describe('enable_marketplace_role (one account, both roles: plan §2.1)', () => {
  it('lets a verified, active student add the other role without a second account', async () => {
    const rows = await db.as<{ c: Ctx }>(DEMO.bea, `select public.enable_marketplace_role('lender') as c`);
    expect(rows[0]!.c.roles).toEqual(['borrower', 'lender']);
    // Same transaction-scoped impersonation rolls back; verify there is still a single profile/verification.
    expect((await db.sql(`select id from profiles where id = $1`, [DEMO.bea])).length).toBe(1);
    expect((await db.sql(`select id from student_verifications where user_id = $1`, [DEMO.bea])).length).toBe(1);
  });
  it('is idempotent for a role the user already has', async () => {
    const rows = await db.as<{ c: Ctx }>(DEMO.dana, `select public.enable_marketplace_role('lender') as c`);
    expect(rows[0]!.c.roles).toEqual(['borrower', 'lender']);
  });
  it('refuses unverified students and restricted accounts', async () => {
    expect(await db.errorAs(DEMO.paolo, `select public.enable_marketplace_role('lender')`)).toMatch(/forbidden.not_verified/);
    expect(await db.errorAs(DEMO.rina, `select public.enable_marketplace_role('borrower')`)).toMatch(/forbidden.not_verified/);
    expect(await db.errorAs(DEMO.rico, `select public.enable_marketplace_role('lender')`)).toMatch(/forbidden.account_restricted/);
  });
  it('cannot be used to obtain admin (the parameter type only allows borrower/lender)', async () => {
    expect(await db.errorAs(DEMO.bea, `select public.enable_marketplace_role('admin')`)).toMatch(/invalid input value for enum/);
  });
});
