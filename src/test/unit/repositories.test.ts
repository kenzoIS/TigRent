import { __setSupabaseForTests, type TigRentClient } from '@/lib/supabase';
import { bookingsRepository, listingsRepository, profilesRepository, verificationsRepository } from '@/repositories';

/** Chainable fake of the supabase-js query builder that records calls and resolves to a fixed response. */
function fakeClient(response: { data: unknown; error: unknown } | Error) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            response instanceof Error ? reject(response) : resolve(response);
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return builder;
        };
      },
    },
  );
  const client = { from: (table: string) => (calls.push({ method: 'from', args: [table] }), builder) } as unknown as TigRentClient;
  return { client, calls };
}

afterEach(() => __setSupabaseForTests(null));

const bookingRow = {
  id: 'b1', listing_id: 'l1', borrower_id: 'u1', lender_id: 'u2', pickup_date: '2026-11-20', return_date: '2026-11-22',
  rental_days: 3, due_at: '2026-11-22T15:59:00Z', status: 'confirmed', total: 42000, deposit: 30000, subtotal: 12000,
  snapshot: { listing_title: 'Casio fx-991EX (agreed title)' },
};

describe('repositories', () => {
  it('map rows to domain entities (camelCase, centavos)', async () => {
    const { client, calls } = fakeClient({
      data: [{ id: 'l1', lender_id: 'u2', title: 'Calculator', category: 'calculators', condition: 'good', daily_rate: 4000, deposit: 30000, late_fee_per_day: 2000, status: 'active', is_featured: true }],
      error: null,
    });
    __setSupabaseForTests(client);
    const r = await listingsRepository.listActive({ category: 'calculators' });
    expect(r).toEqual({ ok: true, data: [expect.objectContaining({ id: 'l1', dailyRate: 4000, lateFeePerDay: 2000, isFeatured: true })] });
    expect(calls).toEqual(expect.arrayContaining([{ method: 'from', args: ['listings'] }, { method: 'eq', args: ['category', 'calculators'] }]));
  });

  it('booking summaries use the agreed snapshot title, not the live listing', async () => {
    __setSupabaseForTests(fakeClient({ data: [bookingRow], error: null }).client);
    const r = await bookingsRepository.listMine();
    expect(r.ok && r.data[0]!.listingTitle).toBe('Casio fx-991EX (agreed title)');
  });

  it('a failing hold-expiry sweep never blocks reading bookings', async () => {
    const { client } = fakeClient({ data: [bookingRow], error: null });
    const withBrokenRpc = Object.assign(client, { rpc: () => { throw new Error('rpc unavailable'); } });
    __setSupabaseForTests(withBrokenRpc);
    const r = await bookingsRepository.listMine();
    expect(r.ok).toBe(true);
  });

  it('turn database errors into typed AppErrors instead of throwing', async () => {
    __setSupabaseForTests(fakeClient({ data: null, error: { code: '42501', message: 'permission denied for table profiles' } }).client);
    const r = await profilesRepository.getMine('u1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('forbidden');
  });

  it('turn thrown network failures into an offline error', async () => {
    __setSupabaseForTests(fakeClient(new TypeError('Network request failed')).client);
    const r = await verificationsRepository.listMine('u1');
    expect(!r.ok && r.error.kind).toBe('network');
  });

  it('self-service profile updates only send permitted columns', async () => {
    const { client, calls } = fakeClient({
      data: { id: 'u1', full_name: 'Bea', avatar_path: null, account_status: 'active', status_reason: null, active_role_pref: 'lender' },
      error: null,
    });
    __setSupabaseForTests(client);
    await profilesRepository.updateMine('u1', { fullName: '  Bea  ', activeRolePref: 'lender' });
    const update = calls.find((c) => c.method === 'update');
    expect(update!.args[0]).toEqual({ full_name: 'Bea', active_role_pref: 'lender' });
  });
});
