import { createTestDb, DEMO, type TestDb } from './harness';

/** Phase 2 gate: RLS isolates private data and blocks protected writes (plan §6.5, §8 privacy rows). */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb({ seed: true });
});
afterAll(async () => {
  await db.close();
});

const B = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe('anonymous visitors', () => {
  it('cannot read any member data', async () => {
    for (const t of ['profiles', 'listings', 'bookings', 'student_verifications', 'public_profiles', 'payments', 'messages']) {
      expect(await db.errorAs('anon', `select * from ${t} limit 1`)).toMatch(/permission denied/);
    }
  });
  it('can read the active Terms and Privacy Notice before signing up', async () => {
    const rows = await db.as<{ doc_type: string }>('anon', `select doc_type::text from terms_versions order by doc_type`);
    expect(rows.map((r) => r.doc_type)).toEqual(['privacy', 'rental_terms', 'tos']);
  });
});

describe('bookings are private to the two parties (borrower A cannot read borrower B)', () => {
  it('a borrower sees only their own bookings', async () => {
    const rows = await db.as<{ id: string; borrower_id: string; lender_id: string }>(DEMO.bea, `select id, borrower_id, lender_id from bookings`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.borrower_id === DEMO.bea || r.lender_id === DEMO.bea)).toBe(true);
    expect(ids(rows)).not.toContain(B(2)); // Dana's active projector rental
  });
  it('a lender sees requests for their own listings, not other lenders', async () => {
    const rows = await db.as<{ id: string }>(DEMO.leo, `select id from bookings`);
    expect(ids(rows)).toEqual(expect.arrayContaining([B(2), B(3), B(4)]));
    expect(ids(rows)).not.toContain(B(7)); // Mika's listing
  });
  it('booking history, payments and handovers follow the same boundary', async () => {
    expect(await db.as(DEMO.dana, `select * from booking_events where booking_id = $1`, [B(1)])).toEqual([]);
    expect(await db.as(DEMO.dana, `select * from payments where booking_id = $1`, [B(1)])).toEqual([]);
    expect((await db.as(DEMO.bea, `select * from payments where booking_id = $1`, [B(1)])).length).toBe(1);
    expect((await db.as(DEMO.leo, `select * from payments where booking_id = $1`, [B(1)])).length).toBe(1);
  });
  it('a restricted account still sees its active rental (plan §2.9)', async () => {
    expect(ids(await db.as<{ id: string }>(DEMO.rico, `select id from bookings where status = 'active'`))).toEqual([B(5)]);
  });
});

describe('student verification data', () => {
  it('only the owner and staff can read a verification record', async () => {
    expect(await db.as(DEMO.dana, `select * from student_verifications where user_id = $1`, [DEMO.bea])).toEqual([]);
    expect((await db.as(DEMO.bea, `select * from student_verifications where user_id = $1`, [DEMO.bea])).length).toBe(1);
    expect((await db.as(DEMO.admin, `select * from student_verifications`)).length).toBe(7);
  });
  it('public profiles never expose student ID, email or account status', async () => {
    const cols = await db.sql<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_profiles'`);
    const names = cols.map((c) => c.column_name);
    for (const banned of ['student_id', 'student_email', 'email', 'account_status', 'status_reason']) expect(names).not.toContain(banned);
    expect((await db.as(DEMO.dana, `select id from public_profiles`)).length).toBe(8);
  });
  it('other users’ private profile rows are hidden', async () => {
    expect(await db.as(DEMO.bea, `select * from profiles where id = $1`, [DEMO.rico])).toEqual([]);
  });
});

describe('listings visibility (closed community)', () => {
  it('verified students see active listings but not drafts or paused items of others', async () => {
    const rows = await db.as<{ id: string; status: string }>(DEMO.bea, `select id, status::text from listings`);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.find((r) => r.id === '11111111-0000-4000-8000-000000000006')).toBeUndefined(); // Leo's draft
    expect(rows.find((r) => r.id === '22222222-0000-4000-8000-000000000004')).toBeUndefined(); // Mika's paused hub
  });
  it('lenders see their own drafts', async () => {
    const rows = await db.as<{ id: string }>(DEMO.leo, `select id from listings where status = 'draft'`);
    expect(ids(rows)).toEqual(['11111111-0000-4000-8000-000000000006']);
  });
  it('a student pending verification cannot browse the marketplace', async () => {
    expect(await db.as(DEMO.paolo, `select * from listings`)).toEqual([]);
  });
});

describe('protected writes are impossible through table access (plan §6.5)', () => {
  it('students cannot self-verify, grant roles, or change account status', async () => {
    expect(await db.errorAs(DEMO.paolo, `update student_verifications set status = 'verified' where user_id = $1`, [DEMO.paolo]))
      .toMatch(/permission denied/);
    expect(await db.errorAs(DEMO.bea, `insert into user_roles (user_id, role) values ($1, 'admin')`, [DEMO.bea]))
      .toMatch(/permission denied/);
    expect(await db.errorAs(DEMO.rico, `update profiles set account_status = 'active' where id = $1`, [DEMO.rico]))
      .toMatch(/permission denied/);
  });
  it('students cannot create bookings, payments, refunds, ledger rows or reviews directly', async () => {
    for (const q of [
      `insert into bookings (listing_id) values ('11111111-0000-4000-8000-000000000001')`,
      `update bookings set status = 'completed' where id = '${B(1)}'`,
      `insert into payments (purpose, booking_id, payer_id, amount, idempotency_key) values ('booking', '${B(1)}', '${DEMO.bea}', 1, 'hack-attempt-1')`,
      `insert into refunds (payment_id, amount, reason, idempotency_key) select id, 1, 'hack', 'hack-attempt-2' from payments limit 1`,
      `insert into ledger_entries (category, credit, idempotency_key) values ('refund', 100, 'hack-attempt-3')`,
      `insert into reviews (booking_id, reviewer_id, target_id, direction, rating) values ('${B(3)}', '${DEMO.bea}', '${DEMO.leo}', 'borrower_to_lender', 5)`,
      `update listings set status = 'active' where id = '11111111-0000-4000-8000-000000000006'`,
      `update platform_settings set value = '0' where key = 'commission_bps'`,
    ]) {
      expect(await db.errorAs(DEMO.bea, q)).toMatch(/permission denied/);
    }
  });
  it('profile self-service is limited to safe columns and the owner’s row', async () => {
    const own = await db.as<{ full_name: string }>(DEMO.bea, `update profiles set full_name = 'Bea S.' where id = $1 returning full_name`, [DEMO.bea]);
    expect(own).toEqual([{ full_name: 'Bea S.' }]);
    const other = await db.as(DEMO.bea, `update profiles set full_name = 'Hacked' where id = $1 returning id`, [DEMO.dana]);
    expect(other).toEqual([]);
  });
  it('internal writer functions are not callable by members', async () => {
    expect(await db.errorAs(DEMO.bea, `select app_private.audit('x', 'y', 'z')`)).toMatch(/permission denied/);
  });
});

describe('admin-only data', () => {
  it('non-staff cannot read the audit log; staff can', async () => {
    expect(await db.as(DEMO.bea, `select * from audit_logs`)).toEqual([]);
    expect((await db.as(DEMO.admin, `select * from audit_logs`)).length).toBeGreaterThan(0);
  });
  it('commission ledger lines are staff-only; parties see their own lines', async () => {
    expect(await db.as(DEMO.leo, `select * from ledger_entries where category = 'platform_commission'`)).toEqual([]);
    const leoLines = await db.as<{ category: string }>(DEMO.leo, `select category::text from ledger_entries`);
    expect(leoLines.length).toBeGreaterThan(0);
    expect(leoLines.every((l) => l.category === 'rent_payable')).toBe(true);
    expect((await db.as(DEMO.admin, `select * from ledger_entries where category = 'platform_commission'`)).length).toBeGreaterThan(0);
  });
});

describe('messages, disputes, notifications', () => {
  it('only conversation participants can read messages', async () => {
    expect((await db.as(DEMO.bea, `select * from messages where conversation_id = (select id from conversations where booking_id = 'bbbbbbbb-0000-4000-8000-000000000001')`)).length).toBe(2);
    expect(await db.as(DEMO.bea, `select * from messages where conversation_id = (select id from conversations where booking_id = 'bbbbbbbb-0000-4000-8000-000000000002')`)).toEqual([]);
  });
  it('dispute cases are visible to the parties and staff only', async () => {
    expect((await db.as(DEMO.bea, `select * from disputes`)).length).toBe(1);
    expect((await db.as(DEMO.leo, `select * from disputes`)).length).toBe(1);
    expect(await db.as(DEMO.dana, `select * from disputes`)).toEqual([]);
  });
  it('notifications are private; users may only mark their own as read', async () => {
    const mine = await db.as<{ user_id: string }>(DEMO.leo, `select user_id from notifications`);
    expect(mine.every((n) => n.user_id === DEMO.leo)).toBe(true);
    expect((await db.as(DEMO.leo, `update notifications set read_at = now() returning id`)).length).toBe(mine.length);
    expect(await db.errorAs(DEMO.leo, `update notifications set title = 'x'`)).toMatch(/permission denied/);
  });
});
