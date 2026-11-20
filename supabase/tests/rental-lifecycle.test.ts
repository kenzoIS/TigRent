import { createTestDb, DEMO, type TestDb } from './harness';

/**
 * Phase 9 gate (backend): handover → active → extension → return → completed, booking messages,
 * reminders/overdue (idempotent), and role permissions (plan §2.7, §2.8, Phase 9).
 */
let db: TestDb;
let today = '';
let termsId = '';
const plus = async (n: number) => (await db.sql<{ d: string }>(`select to_char($1::date + $2::int, 'YYYY-MM-DD') as d`, [today, n]))[0]!.d;

const L = { casio: '11111111-0000-4000-8000-000000000001', tripod: '22222222-0000-4000-8000-000000000001' };
const SEED = {
  beaDslrConfirmed: 'bbbbbbbb-0000-4000-8000-000000000001',
  danaProjectorActive: 'bbbbbbbb-0000-4000-8000-000000000002',
  ricoStandActive: 'bbbbbbbb-0000-4000-8000-000000000005',
  beaCasioPending: 'bbbbbbbb-0000-4000-8000-000000000003',
};

const one = async <T>(who: string, sql: string, params: unknown[] = []) => (await db.asCommit<{ r: T }>(who, sql, params))[0]!.r;
const status = async (id: string) => (await db.sql<{ status: string }>(`select status from public.bookings where id = $1`, [id]))[0]!.status;
const count = async (sql: string, params: unknown[] = []) => Number((await db.sql<{ n: string }>(sql, params))[0]!.n);
const process = () => one<number>(DEMO.paolo, `select public.process_due_events() as r`);

/** request → accept → pay: a confirmed booking for the given borrower. */
async function confirmed(borrower: string, lender: string, listing: string, from: number, to: number) {
  const id = await one<string>(borrower, `select public.request_booking($1, $2::date, $3::date, $4) as r`, [listing, await plus(from), await plus(to), termsId]);
  await one(lender, `select public.decide_booking_request($1, 'accept') as r`, [id]);
  await one(borrower, `select public.pay_booking_demo($1, $2, 'success') as r`, [id, `seed-pay-${id}`]);
  return id;
}
async function active(borrower: string, lender: string, listing: string, from: number, to: number) {
  const id = await confirmed(borrower, lender, listing, from, to);
  await one(lender, `select public.confirm_handover($1) as r`, [id]);
  await one(borrower, `select public.confirm_handover($1) as r`, [id]);
  return id;
}

beforeAll(async () => {
  db = await createTestDb({ seed: true });
  today = (await db.sql<{ d: string }>(`select to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as d`))[0]!.d;
  termsId = (await db.sql<{ id: string }>(`select id from public.terms_versions where doc_type = 'rental_terms' and is_active`))[0]!.id;
});
afterAll(async () => {
  await db.close();
});

describe('booking conversations', () => {
  it('every booking has a two-person conversation, including new ones', async () => {
    expect(await count(`select count(*) n from public.bookings b where not exists (select 1 from public.conversations c where c.booking_id = b.id)`)).toBe(0);
    expect(await count(`select count(*) n from public.conversation_participants p join public.conversations c on c.id = p.conversation_id where c.booking_id = $1`, [SEED.beaCasioPending])).toBe(2);
  });

  let conv = '';
  it('only participants can send and read; staff can read for support', async () => {
    conv = (await db.sql<{ id: string }>(`select id from public.conversations where booking_id = $1`, [SEED.beaCasioPending]))[0]!.id;
    await one(DEMO.bea, `select public.send_message($1, 'Hi! Is the calculator exam-approved?') as r`, [conv]);
    expect(await db.errorAsCommit(DEMO.mika, `select public.send_message($1, 'hello')`, [conv])).toMatch(/not_found.conversation/);
    expect((await db.as(DEMO.mika, `select id from public.messages where conversation_id = $1`, [conv])).length).toBe(0);
    expect((await db.as(DEMO.leo, `select id from public.messages where conversation_id = $1`, [conv])).length).toBe(1);
    expect(await db.errorAs(DEMO.mika, `select public.get_conversation($1)`, [conv])).toMatch(/not_found.conversation/);
    const staff = (await db.as<{ c: { messages: unknown[] } }>(DEMO.admin, `select public.get_conversation($1) as c`, [conv]))[0]!.c;
    expect(staff.messages.length).toBe(1);
    expect(await db.errorAs(DEMO.bea, `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'x')`, [conv, DEMO.bea])).toMatch(/permission denied/);
  });
  it('notifies once per unread stretch, and reading clears it', async () => {
    await one(DEMO.bea, `select public.send_message($1, 'Also, can I pick up at 3 PM?') as r`, [conv]);
    const notes = () => count(`select count(*) n from public.notifications where user_id = $1 and entity_id = $2 and type = 'message.new'`, [DEMO.leo, conv]);
    expect(await notes()).toBe(1);
    const list = await db.as<{ conversation_id: string; unread_count: number; my_role: string }>(DEMO.leo, `select * from public.list_my_conversations('lender')`);
    expect(list.find((r) => r.conversation_id === conv)?.unread_count).toBe(2);
    await db.asCommit(DEMO.leo, `select public.mark_conversation_read($1)`, [conv]);
    expect(await count(`select count(*) n from public.notifications where user_id = $1 and entity_id = $2 and read_at is null`, [DEMO.leo, conv])).toBe(0);
    await one(DEMO.bea, `select public.send_message($1, 'Thanks!') as r`, [conv]);
    expect(await notes()).toBe(2);
    expect((await db.as<{ conversation_id: string }>(DEMO.bea, `select * from public.list_my_conversations('lender')`)).find((r) => r.conversation_id === conv)).toBeUndefined();
  });
  it('closes messaging on declined requests', async () => {
    const rejected = 'bbbbbbbb-0000-4000-8000-000000000012';
    const c = (await db.sql<{ id: string }>(`select id from public.conversations where booking_id = $1`, [rejected]))[0]!.id;
    expect(await db.errorAsCommit(DEMO.dana, `select public.send_message($1, 'Please reconsider')`, [c])).toMatch(/conflict.conversation_closed/);
  });
});

describe('handover', () => {
  let id = '';
  it('opens shortly before pickup, not earlier', async () => {
    expect(await db.errorAsCommit(DEMO.leo, `select public.confirm_handover($1)`, [SEED.beaDslrConfirmed])).toMatch(/conflict.handover_too_early/); // pickup +3
  });
  it('needs the lender first, then the borrower; only then is the rental active', async () => {
    id = await confirmed(DEMO.bea, DEMO.leo, L.casio, 0, 1);
    expect(await db.errorAsCommit(DEMO.bea, `select public.confirm_handover($1)`, [id])).toMatch(/conflict.awaiting_lender_handover/);
    expect(await db.errorAsCommit(DEMO.mika, `select public.confirm_handover($1)`, [id])).toMatch(/not_found.booking/);
    expect((await one<{ status: string }>(DEMO.leo, `select public.confirm_handover($1, 'Case and cover included') as r`, [id])).status).toBe('confirmed');
    expect((await one<{ repeated: boolean }>(DEMO.leo, `select public.confirm_handover($1) as r`, [id])).repeated).toBe(true);
    expect(await count(`select count(*) n from public.notifications where entity_id = $1 and type = 'booking.handover'`, [id])).toBe(1);
    expect((await one<{ status: string }>(DEMO.bea, `select public.confirm_handover($1, 'Works fine') as r`, [id])).status).toBe('active');
    expect(await status(id)).toBe('active');
    const [h] = await db.sql<{ lender_notes: string; borrower_notes: string }>(`select * from public.handover_reports where booking_id = $1`, [id]);
    expect([h!.lender_notes, h!.borrower_notes]).toEqual(['Case and cover included', 'Works fine']);
  });
  it('photos must be the caller’s own uploads in the booking’s private folder', async () => {
    const other = await confirmed(DEMO.dana, DEMO.mika, L.tripod, 0, 0);
    expect(await db.errorAsCommit(DEMO.mika, `select public.confirm_handover($1, null, $2::text[])`, [other, `{${other}/${DEMO.mika}/missing.jpg}`])).toMatch(/validation.photo_path/);
    await db.sql(`insert into storage.objects (bucket_id, name, metadata) values ('evidence', $1, '{"size": 1000, "mimetype": "image/jpeg"}')`, [`${other}/${DEMO.dana}/x.jpg`]);
    expect(await db.errorAsCommit(DEMO.mika, `select public.confirm_handover($1, null, $2::text[])`, [other, `{${other}/${DEMO.dana}/x.jpg}`])).toMatch(/validation.photo_path/);
    await db.sql(`insert into storage.objects (bucket_id, name, metadata) values ('evidence', $1, '{"size": 1000, "mimetype": "image/jpeg"}')`, [`${other}/${DEMO.mika}/ok.jpg`]);
    expect(await db.errorAsCommit(DEMO.mika, `select public.confirm_handover($1, null, $2::text[])`, [other, `{${other}/${DEMO.mika}/ok.jpg}`])).toBeNull();
  });
  it('both parties see the same timeline', async () => {
    const ev = async (who: string) => (await db.as<{ d: { events: { kind: string | null; to_status: string }[] } }>(who, `select public.get_booking_detail($1) as d`, [id]))[0]!.d.events;
    const forBea = await ev(DEMO.bea);
    const forLeo = await ev(DEMO.leo);
    expect(forBea.map((e) => [e.to_status, e.kind])).toEqual(forLeo.map((e) => [e.to_status, e.kind]));
    expect(forBea.map((e) => e.kind ?? e.to_status)).toEqual(['pending_lender_approval', 'awaiting_payment', 'confirmed', 'handover_lender', 'handover_borrower', 'active']);
  });
});

describe('extensions', () => {
  let rental = '';
  let blocker = '';
  beforeAll(async () => {
    // Bea rents the TI-free Casio window today..+1; Dana holds +3..+4 afterwards.
    rental = (await db.sql<{ id: string }>(`select id from public.bookings where listing_id = $1 and borrower_id = $2 and status = 'active'`, [L.casio, DEMO.bea]))[0]!.id;
    blocker = await confirmed(DEMO.dana, DEMO.leo, L.casio, 3, 4);
  });
  const requestExt = async (to: number) => one<string>(DEMO.bea, `select public.request_extension($1, $2::date) as r`, [rental, await plus(to)]);
  const requestExtError = async (to: number, who: string = DEMO.bea) => db.errorAsCommit(who, `select public.request_extension($1, $2::date)`, [rental, await plus(to)]);
  const due = async () => (await db.sql<{ return_date: string; due_at: string; total: string; rental_days: number }>(
    `select to_char(return_date, 'YYYY-MM-DD') return_date, due_at::text, total, rental_days from public.bookings where id = $1`, [rental]))[0]!;

  it('only the borrower, before the due time, for later dates without conflicts', async () => {
    expect(await requestExtError(2, DEMO.leo)).toMatch(/forbidden.borrower_only/);
    expect(await requestExtError(1)).toMatch(/validation.new_return/);
    expect(await requestExtError(4)).toMatch(/conflict.extension_dates_taken/); // Dana holds +3..+4
    expect(await requestExtError(40)).toMatch(/validation.too_long/);
  });

  let ext = '';
  it('computes the extra rent from the agreed rate; one open request at a time', async () => {
    ext = await requestExt(2);
    const [e] = await db.sql<{ extra_days: number; extra_amount: string; extra_commission: string }>(`select * from public.extension_requests where id = $1`, [ext]);
    const [b] = await db.sql<{ daily_rate: string; commission_bps: number }>(`select * from public.bookings where id = $1`, [rental]);
    expect(e!.extra_days).toBe(1);
    expect(Number(e!.extra_amount)).toBe(Number(b!.daily_rate));
    expect(Number(e!.extra_commission)).toBe(Math.floor((Number(b!.daily_rate) * b!.commission_bps + 5000) / 10000));
    expect(await requestExtError(2)).toMatch(/conflict.extension_open/);
    expect(await count(`select count(*) n from public.notifications where type = 'extension.requested' and user_id = $1`, [DEMO.leo])).toBe(1);
  });
  it('a conflict that appears later is shown to the lender and blocks approval', async () => {
    const other = await one<string>(DEMO.dana, `select public.request_booking($1, $2::date, $3::date, $4) as r`, [L.casio, await plus(2), await plus(2), termsId]);
    await one(DEMO.leo, `select public.decide_booking_request($1, 'accept') as r`, [other]); // a pending extension is not a hold
    const d = (await db.as<{ d: { extensions: { id: string; conflict: string | null }[] } }>(DEMO.leo, `select public.get_booking_detail($1) as d`, [rental]))[0]!.d;
    expect(d.extensions.find((x) => x.id === ext)?.conflict).toBe('dates_taken');
    expect((await db.as<{ id: string; conflict: string }>(DEMO.leo, `select * from public.list_extension_requests()`)).find((r) => r.id === ext)?.conflict).toBe('dates_taken');
    expect(await db.errorAsCommit(DEMO.leo, `select public.decide_extension($1, 'approve')`, [ext])).toMatch(/conflict.extension_dates_taken/);
    expect(await db.errorAsCommit(DEMO.bea, `select public.decide_extension($1, 'approve')`, [ext])).toMatch(/not_found.extension/);
    // Free the day again: Dana's payment fails.
    await one(DEMO.dana, `select public.pay_booking_demo($1, 'dana-fail-0001', 'failure') as r`, [other]);
  });
  it('rejection keeps the original dates and tells the borrower why', async () => {
    const before = await due();
    expect(await db.errorAsCommit(DEMO.leo, `select public.decide_extension($1, 'reject', '')`, [ext])).toMatch(/validation.reason/);
    expect((await one<{ status: string }>(DEMO.leo, `select public.decide_extension($1, 'reject', 'I need it on Saturday.') as r`, [ext])).status).toBe('rejected');
    expect(await due()).toEqual(before);
    expect(await count(`select count(*) n from public.notifications where type = 'extension.rejected' and body like '%Saturday%'`)).toBe(1);
  });
  it('approval holds the extra days; a failed payment keeps the original due date and releases them', async () => {
    const before = await due();
    ext = await requestExt(2);
    const a = await one<{ status: string; hold_expires_at: string }>(DEMO.leo, `select public.decide_extension($1, 'approve') as r`, [ext]);
    expect(a.status).toBe('approved_awaiting_payment');
    const q = await one<{ available: boolean }>(DEMO.dana, `select public.quote_booking($1, $2, $3) as r`, [L.casio, await plus(2), await plus(2)]);
    expect(q.available).toBe(false); // held for the extension
    expect(await db.errorAsCommit(DEMO.dana, `select public.request_booking($1, $2::date, $3::date, $4)`, [L.casio, await plus(2), await plus(2), termsId])).toMatch(/conflict.dates_unavailable/);
    const f = await one<{ outcome: string; extension_status: string }>(DEMO.bea, `select public.pay_extension_demo($1, 'ext-fail-0001', 'failure') as r`, [ext]);
    expect([f.outcome, f.extension_status]).toEqual(['failure', 'payment_failed']);
    expect(await due()).toEqual(before);
    expect(await count(`select count(*) n from public.ledger_entries where payment_id in (select id from public.payments where extension_id = $1)`, [ext])).toBe(0);
    const q2 = await one<{ available: boolean }>(DEMO.dana, `select public.quote_booking($1, $2, $3) as r`, [L.casio, await plus(2), await plus(2)]);
    expect(q2.available).toBe(true);
  });
  it('the due date changes only after a successful payment, exactly once', async () => {
    const before = await due();
    ext = await requestExt(2);
    await one(DEMO.leo, `select public.decide_extension($1, 'approve') as r`, [ext]);
    expect(await due()).toEqual(before); // approved but unpaid: unchanged
    const p1 = await one<{ outcome: string; payment_id: string }>(DEMO.bea, `select public.pay_extension_demo($1, 'ext-pay-00001', 'success') as r`, [ext]);
    const p2 = await one<{ payment_id: string; replayed: boolean }>(DEMO.bea, `select public.pay_extension_demo($1, 'ext-pay-00001', 'success') as r`, [ext]);
    const p3 = await one<{ payment_id: string }>(DEMO.bea, `select public.pay_extension_demo($1, 'ext-pay-00002', 'success') as r`, [ext]);
    expect(p1.outcome).toBe('success');
    expect([p2.payment_id, p3.payment_id]).toEqual([p1.payment_id, p1.payment_id]);
    expect(p2.replayed).toBe(true);
    const after = await due();
    expect(after.return_date).toBe(await plus(2));
    expect(after.rental_days).toBe(3);
    expect(Number(after.total)).toBeGreaterThan(Number(before.total));
    const ledger = await db.sql<{ debit: string; credit: string }>(`select debit, credit from public.ledger_entries where payment_id = $1`, [p1.payment_id]);
    expect(ledger.length).toBe(3);
    expect(ledger.reduce((s, l) => s + Number(l.debit), 0)).toBe(ledger.reduce((s, l) => s + Number(l.credit), 0));
    expect(await count(`select count(*) n from public.booking_events where booking_id = $1 and metadata ->> 'kind' = 'extended'`, [rental])).toBe(1);
  });
  it('an unpaid approval expires and the original due date stands', async () => {
    const ext2 = await one<string>(DEMO.dana, `select public.request_extension($1, $2::date) as r`, [SEED.danaProjectorActive, await plus(2)]);
    await one(DEMO.leo, `select public.decide_extension($1, 'approve') as r`, [ext2]);
    await db.sql(`update public.extension_requests set hold_expires_at = now() - interval '1 minute' where id = $1`, [ext2]);
    const before = (await db.sql<{ return_date: string }>(`select return_date::text from public.bookings where id = $1`, [SEED.danaProjectorActive]))[0]!.return_date;
    await process();
    expect((await db.sql<{ status: string }>(`select status from public.extension_requests where id = $1`, [ext2]))[0]!.status).toBe('expired');
    expect((await db.sql<{ return_date: string }>(`select return_date::text from public.bookings where id = $1`, [SEED.danaProjectorActive]))[0]!.return_date).toBe(before);
    expect(await count(`select count(*) n from public.notifications where type = 'extension.expired' and entity_id = $1`, [SEED.danaProjectorActive])).toBe(2);
  });
});

describe('reminders and overdue', () => {
  it('marks a rental overdue after its due time and notifies both, once', async () => {
    await db.sql(`update public.bookings set due_at = now() - interval '1 hour' where id = $1`, [SEED.ricoStandActive]);
    await process();
    expect(await status(SEED.ricoStandActive)).toBe('overdue');
    const n = () => count(`select count(*) n from public.notifications where entity_id = $1 and type = 'booking.overdue'`, [SEED.ricoStandActive]);
    expect(await n()).toBe(2);
    await process();
    expect(await n()).toBe(2);
  });
  it('pickup and due-soon reminders are idempotent', async () => {
    await db.sql(`update public.platform_settings set value = '96' where key = 'reminder_due_soon_hours' and is_current`);
    await process();
    const reminders = () => count(`select count(*) n from public.notifications where type like 'reminder.%'`);
    const first = await reminders();
    expect(await count(`select count(*) n from public.notifications where type = 'reminder.due_soon'`)).toBeGreaterThan(0);
    await process();
    await process();
    expect(await reminders()).toBe(first);
    await db.sql(`update public.platform_settings set value = '24' where key = 'reminder_due_soon_hours' and is_current`);
  });
  it('anonymous callers cannot run the job', async () => {
    expect(await db.errorAs('anon', `select public.process_due_events()`)).toMatch(/permission denied/);
  });
});

describe('return', () => {
  let id = '';
  it('the borrower submits; the lender can’t submit for them', async () => {
    id = (await db.sql<{ id: string }>(`select id from public.bookings where listing_id = $1 and borrower_id = $2 and status = 'active'`, [L.casio, DEMO.bea]))[0]!.id;
    expect(await db.errorAsCommit(DEMO.leo, `select public.submit_return($1)`, [id])).toMatch(/forbidden.borrower_only/);
    expect(await db.errorAsCommit(DEMO.bea, `select public.confirm_clean_return($1)`, [id])).toMatch(/forbidden.lender_only/);
    expect((await one<{ status: string }>(DEMO.bea, `select public.submit_return($1, 'Left it at the library desk') as r`, [id])).status).toBe('return_requested');
    expect((await one<{ repeated: boolean }>(DEMO.bea, `select public.submit_return($1) as r`, [id])).repeated).toBe(true);
  });
  it('a clean, on-time return completes the booking, releases the deposit once and frees the item', async () => {
    const r = await one<{ status: string; deposit_released: number }>(DEMO.leo, `select public.confirm_clean_return($1, 'All good') as r`, [id]);
    expect(r.status).toBe('completed');
    expect((await one<{ repeated: boolean }>(DEMO.leo, `select public.confirm_clean_return($1) as r`, [id])).repeated).toBe(true);
    const [b] = await db.sql<{ deposit: string }>(`select deposit from public.bookings where id = $1`, [id]);
    const refunds = await db.sql<{ amount: string; status: string }>(`select amount, status from public.refunds where booking_id = $1`, [id]);
    expect(refunds.map((f) => [Number(f.amount), f.status])).toEqual([[Number(b!.deposit), 'succeeded']]);
    const lines = await db.sql<{ category: string }>(`select category from public.ledger_entries where refund_id is not null and booking_id = $1 order by category`, [id]);
    expect(lines.map((l) => l.category)).toEqual(['deposit_released', 'refund']);
    const q = await one<{ available: boolean }>(DEMO.dana, `select public.quote_booking($1, $2, $3) as r`, [L.casio, await plus(0), await plus(2)]);
    expect(q.available).toBe(true);
    expect(await count(`select count(*) n from public.notifications where entity_id = $1 and type = 'booking.completed'`, [id])).toBe(2);
  });
  it('a late return completes with the agreed late fee taken from the deposit (Phase 10); restricted borrowers can still return', async () => {
    // Rico (restricted by the sample low-rating rule) is overdue on Leo's laptop stand.
    expect((await one<{ status: string; late_days: number }>(DEMO.rico, `select public.submit_return($1) as r`, [SEED.ricoStandActive])).late_days).toBe(1);
    const r = await one<{ status: string; late_days: number; late_fee: number }>(DEMO.leo, `select public.confirm_clean_return($1) as r`, [SEED.ricoStandActive]);
    expect([r.status, r.late_days]).toEqual(['completed', 1]);
    expect(r.late_fee).toBeGreaterThan(0);
  });
});
