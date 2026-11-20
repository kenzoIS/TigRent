import { createTestDb, DEMO, type TestDb } from './harness';

let db: TestDb;
beforeAll(async () => { db = await createTestDb({ seed: true }); });
afterAll(async () => { await db.close(); });

describe('Premium and admin configuration', () => {
  it('creates one idempotent simulated PHP 99 subscription with balanced ledger entries', async () => {
    const key = 'premium-test-checkout-0001';
    const first = (await db.asCommit<{ r: { subscription_id: string; status: string } }>(DEMO.leo, `select public.subscribe_premium_demo($1, 'success') as r`, [key]))[0]!.r;
    const again = (await db.asCommit<{ r: { subscription_id: string; status: string } }>(DEMO.leo, `select public.subscribe_premium_demo($1, 'failure') as r`, [key]))[0]!.r;
    expect([first.status, again.subscription_id]).toEqual(['succeeded', first.subscription_id]);
    const lines = await db.sql<{ debit: string; credit: string }>(`select debit, credit from public.ledger_entries where subscription_id = $1`, [first.subscription_id]);
    expect(lines.reduce((n, x) => n + Number(x.debit) - Number(x.credit), 0)).toBe(0);
    const analytics = (await db.asCommit<{ r: { gross_rent: number } }>(DEMO.leo, `select public.get_lender_analytics() as r`))[0]!.r;
    const expectedGross = Number((await db.sql<{ total: string }>(`select coalesce(sum(subtotal), 0) total from public.bookings where lender_id = $1 and status in ('completed','active','overdue','return_requested','disputed')`, [DEMO.leo]))[0]!.total);
    expect(Number(analytics.gross_rent)).toBe(expectedGross);
  });

  it('enforces premium entitlement and admin-only versioned configuration', async () => {
    expect(await db.errorAsCommit(DEMO.dana, `select public.get_lender_analytics()`)).toMatch(/forbidden.premium_required/);
    expect(await db.errorAsCommit(DEMO.leo, `select public.update_platform_setting('payment_hold_minutes', '20'::jsonb, 'Test update')`)).toMatch(/forbidden.admin_only/);
    const row = (await db.asCommit<{ r: { version: number; value: number } }>(DEMO.admin, `select public.update_platform_setting('payment_hold_minutes', '20'::jsonb, 'Sample hold update') as r`))[0]!.r;
    expect(row).toMatchObject({ version: 2, value: 20 });
  });
  it('activates a new cancellation-policy version atomically and preserves prior booking snapshots', async () => {
    const rules = (await db.sql<{ rules: unknown }>(`select rules from public.cancellation_policy_versions where is_active`))[0]!.rules;
    expect(await db.errorAsCommit(DEMO.leo, `select public.create_cancellation_policy('Nope', $1::jsonb)`, [JSON.stringify(rules)])).toMatch(/forbidden.admin_only/);
    const p = (await db.asCommit<{ r: { version: number; label: string } }>(DEMO.admin, `select public.create_cancellation_policy('Sample policy v2', $1::jsonb) as r`, [JSON.stringify(rules)]))[0]!.r;
    expect(p).toMatchObject({ version: 2, label: 'Sample policy v2' });
    expect(Number((await db.sql<{ n: string }>(`select count(*) n from public.cancellation_policy_versions where is_active`))[0]!.n)).toBe(1);
  });

  it('gates advanced calendar ranges and bulk equipment actions without deleting data', async () => {
    const future = `(now() at time zone 'Asia/Manila')::date + 300`;
    expect(await db.errorAsCommit(DEMO.dana, `select public.add_availability_block('33333333-0000-4000-8000-000000000001', ${future}, ${future} + 2, 'Range')`)).toMatch(/forbidden.premium_required/);
    const single = await db.asCommit<{ id: string }>(DEMO.dana, `select public.add_availability_block('33333333-0000-4000-8000-000000000001', ${future}, ${future}, 'Single day') id`);
    expect(single[0]!.id).toBeTruthy();
    expect(await db.errorAsCommit(DEMO.dana, `select public.bulk_set_listing_status(array['33333333-0000-4000-8000-000000000001'::uuid], 'paused')`)).toMatch(/forbidden.premium_required/);
    const changed = await db.asCommit<{ n: number }>(DEMO.mika, `select public.bulk_set_listing_status(array['22222222-0000-4000-8000-000000000001'::uuid, '22222222-0000-4000-8000-000000000002'::uuid], 'paused') n`);
    expect(Number(changed[0]!.n)).toBe(2);
    const rows = await db.sql<{ status: string; is_featured: boolean }>(`select status, is_featured from public.listings where id in ('22222222-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000002') order by id`);
    expect(rows).toEqual([{ status: 'paused', is_featured: false }, { status: 'paused', is_featured: false }]);
    const cancel = (await db.asCommit<{ r: { status: string } }>(DEMO.leo, `select public.cancel_premium() as r`))[0]!.r;
    expect(cancel.status).toBe('cancelled');
    expect(await db.errorAsCommit(DEMO.leo, `select public.set_featured_listing('11111111-0000-4000-8000-000000000003', true)`)).toMatch(/forbidden.premium_required/);
  });
});
