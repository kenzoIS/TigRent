import { createTestDb, DEMO, type TestDb } from './harness';

/** Account deletion pseudonymises append-only history instead of being blocked by it (migration 011). */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb({ seed: true });
});
afterAll(async () => {
  await db.close();
});

const err = (q: string, p: unknown[] = []) => db.sql(q, p).then(() => null, (e: Error) => e.message);

it('deleting an account with audit history succeeds and clears the actor on its audit rows', async () => {
  const uid = 'abcdabcd-0000-4000-8000-000000000001';
  await db.exec(`insert into auth.users (id, email) values ('${uid}', 'leaving@example.com')`);
  await db.exec(`insert into audit_logs (actor_id, action, entity_type, entity_id) values ('${uid}', 'terms.accepted', 'profile', '${uid}')`);
  expect(await err(`delete from auth.users where id = $1`, [uid])).toBeNull();
  const rows = await db.sql<{ actor_id: string | null; action: string }>(`select actor_id, action from audit_logs where entity_id = $1`, [uid]);
  expect(rows).toEqual([{ actor_id: null, action: 'terms.accepted' }]); // history kept, person unlinked
});

it('still forbids every other change to append-only history', async () => {
  expect(await err(`update audit_logs set action = 'tampered' where id = (select min(id) from audit_logs)`)).toMatch(/append-only/);
  expect(await err(`update audit_logs set actor_id = null, action = 'tampered' where actor_id is not null`)).toMatch(/append-only/);
  expect(await err(`update booking_events set reason = 'tampered' where id = (select min(id) from booking_events)`)).toMatch(/append-only/);
  expect(await err(`delete from audit_logs where id = (select min(id) from audit_logs)`)).toMatch(/append-only/);
  expect(await err(`update ledger_entries set party_id = null where id = (select min(id) from ledger_entries)`)).toMatch(/append-only/);
});

it('financial history keeps accounts with simulated money records from being hard-deleted', async () => {
  expect(await err(`delete from auth.users where id = $1`, [DEMO.bea])).toMatch(/violates foreign key|restrict/i);
});
