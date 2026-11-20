import { createTestDb, DEMO, type TestDb } from './harness';

/**
 * Phase 10 gate (backend): every cancellation scenario in plan §2.6 with a deterministic result,
 * refund previews, idempotent refunds, late fees from the agreed snapshot, deposit withholding only
 * through a recorded path, private evidence, moderator resolution and appeals (plan §2.6, §2.7).
 */
let db: TestDb;
let today = '';
let termsId = '';
const plus = async (n: number) => (await db.sql<{ d: string }>(`select to_char($1::date + $2::int, 'YYYY-MM-DD') as d`, [today, n]))[0]!.d;

const L = {
  casio: '11111111-0000-4000-8000-000000000001',
  projector: '11111111-0000-4000-8000-000000000003',
  stand: '11111111-0000-4000-8000-000000000004',
  drafting: '11111111-0000-4000-8000-000000000005',
  tripod: '22222222-0000-4000-8000-000000000001',
  ringLight: '22222222-0000-4000-8000-000000000002',
  ti84: '22222222-0000-4000-8000-000000000003',
};
const SEED = {
  beaDslrConfirmed: 'bbbbbbbb-0000-4000-8000-000000000001',
  danaProjectorActive: 'bbbbbbbb-0000-4000-8000-000000000002',
  beaCasioPending: 'bbbbbbbb-0000-4000-8000-000000000003',
  danaCasioPending: 'bbbbbbbb-0000-4000-8000-000000000004',
  ricoStandActive: 'bbbbbbbb-0000-4000-8000-000000000005',
  beaDraftingDisputed: 'bbbbbbbb-0000-4000-8000-000000000006',
  danaTi84Awaiting: 'bbbbbbbb-0000-4000-8000-000000000007',
  danaTripodOverdue: 'bbbbbbbb-0000-4000-8000-000000000008',
  seededDispute: '77777777-0000-4000-8000-000000000001',
};

type Quote = { allowed: boolean; rule: string; reason?: string; refund_total: number; rent_refund: number; deposit_refund: number; rent_refund_pct: number | null; lender_net_after: number; commission_after: number; rent_kept: number; explanation: string };
const one = async <T>(who: string, sql: string, params: unknown[] = []) => (await db.asCommit<{ r: T }>(who, sql, params))[0]!.r;
const preview = (who: string, id: string) => one<Quote>(who, `select public.preview_cancellation($1) as r`, [id]);
const cancel = (who: string, id: string, expected: number | null, reason: string | null = null) =>
  one<Quote & { status: string; repeated: boolean }>(who, `select public.cancel_booking($1, $2, $3) as r`, [id, reason, expected]);
const status = async (id: string) => (await db.sql<{ status: string }>(`select status from public.bookings where id = $1`, [id]))[0]!.status;
const num = async (sql: string, params: unknown[] = []) => Number((await db.sql<{ n: string }>(sql, params))[0]!.n);
const refunds = (id: string) => db.sql<{ amount: string }>(`select amount from public.refunds where booking_id = $1`, [id]);
const balanced = async (id: string) => {
  const [r] = await db.sql<{ d: string; c: string }>(`select coalesce(sum(debit), 0) d, coalesce(sum(credit), 0) c from public.ledger_entries where booking_id = $1`, [id]);
  return Number(r!.d) === Number(r!.c);
};
const net = (party: string | null, id: string, cats: string[]) =>
  num(`select coalesce(sum(credit - debit), 0) n from public.ledger_entries where booking_id = $1 and party_id is not distinct from $2 and category = any($3::public.ledger_category[])`, [id, party, `{${cats.join(',')}}`]);
const booking = async (id: string) => (await db.sql<{ subtotal: string; deposit: string; total: string; commission: string; lender_net: string; late_fee_per_day: string; commission_bps: number }>(`select * from public.bookings where id = $1`, [id]))[0]!;

async function confirmed(borrower: string, lender: string, listing: string, from: number, to: number) {
  const id = await one<string>(borrower, `select public.request_booking($1, $2::date, $3::date, $4) as r`, [listing, await plus(from), await plus(to), termsId]);
  await one(lender, `select public.decide_booking_request($1, 'accept') as r`, [id]);
  await one(borrower, `select public.pay_booking_demo($1, $2, 'success') as r`, [id, `pay-${id}`]);
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

describe('cancellation matrix (plan §2.6)', () => {
  it('borrower cancels a pending request: nothing was charged, nothing to refund', async () => {
    const q = await preview(DEMO.bea, SEED.beaCasioPending);
    expect([q.allowed, q.rule, q.refund_total]).toEqual([true, 'pending_cancel_by_borrower', 0]);
    expect((await cancel(DEMO.bea, SEED.beaCasioPending, 0)).status).toBe('cancelled');
    expect((await cancel(DEMO.bea, SEED.beaCasioPending, 0)).repeated).toBe(true);
    expect(await refunds(SEED.beaCasioPending)).toEqual([]);
    expect(await num(`select count(*) n from public.notifications where entity_id = $1 and type = 'booking.cancelled'`, [SEED.beaCasioPending])).toBe(2);
  });
  it('a lender declines rather than cancels a pending request', async () => {
    expect((await preview(DEMO.leo, SEED.danaCasioPending)).allowed).toBe(false);
    expect(await db.errorAsCommit(DEMO.leo, `select public.cancel_booking($1, 'x', 0)`, [SEED.danaCasioPending])).toMatch(/conflict.cannot_cancel/);
  });
  it('cancelling an unpaid hold releases the dates without a refund', async () => {
    expect((await cancel(DEMO.dana, SEED.danaTi84Awaiting, 0)).refund_total).toBe(0);
    expect(await status(SEED.danaTi84Awaiting)).toBe('cancelled');
  });
  it('borrower cancels ≥24 h before pickup: full rent and deposit back, once', async () => {
    const b = await booking(SEED.beaDslrConfirmed);
    const q = await preview(DEMO.bea, SEED.beaDslrConfirmed);
    expect([q.rule, q.rent_refund_pct, q.refund_total]).toEqual(['borrower_cancel_before_pickup', 100, Number(b.total)]);
    await cancel(DEMO.bea, SEED.beaDslrConfirmed, q.refund_total);
    await cancel(DEMO.bea, SEED.beaDslrConfirmed, q.refund_total);
    expect((await refunds(SEED.beaDslrConfirmed)).map((r) => Number(r.amount))).toEqual([Number(b.total)]);
    expect(await balanced(SEED.beaDslrConfirmed)).toBe(true);
    expect(await net(DEMO.leo, SEED.beaDslrConfirmed, ['rent_payable', 'cancellation_adjustment'])).toBe(0);
  });

  let late = '';
  it('borrower cancels within 24 h of pickup: the sample 50% rent window, previewed and confirmed exactly', async () => {
    late = await confirmed(DEMO.bea, DEMO.mika, L.ringLight, 1, 2);
    const b = await booking(late);
    const q = await preview(DEMO.bea, late);
    expect(q.rent_refund_pct).toBe(50);
    expect(q.rent_refund).toBe(Math.floor((Number(b.subtotal) * 50 + 50) / 100));
    expect(q.deposit_refund).toBe(Number(b.deposit));
    expect(q.explanation).toMatch(/sample policy/);
    expect(await db.errorAsCommit(DEMO.bea, `select public.cancel_booking($1, null, $2)`, [late, q.refund_total + 1])).toMatch(/conflict.refund_changed/);
    await cancel(DEMO.bea, late, q.refund_total);
    expect((await refunds(late)).map((r) => Number(r.amount))).toEqual([q.refund_total]);
    expect(await balanced(late)).toBe(true);
    // The lender keeps the retained rent minus 10% commission on it; deposit is never revenue.
    expect(await net(DEMO.mika, late, ['rent_payable', 'cancellation_adjustment'])).toBe(q.lender_net_after);
    expect(await net(null, late, ['platform_commission', 'cancellation_adjustment'])).toBe(q.commission_after);
  });
  it('lender cancels before pickup: full refund, and a reason is required', async () => {
    const id = await confirmed(DEMO.dana, DEMO.leo, L.casio, 12, 13);
    const q = await preview(DEMO.leo, id);
    expect([q.rule, q.refund_total]).toEqual(['lender_cancel_before_pickup', Number((await booking(id)).total)]);
    expect(await db.errorAsCommit(DEMO.leo, `select public.cancel_booking($1, null, $2)`, [id, q.refund_total])).toMatch(/validation.reason/);
    await cancel(DEMO.leo, id, q.refund_total, 'The calculator broke.');
    expect(await net(DEMO.leo, id, ['rent_payable', 'cancellation_adjustment'])).toBe(0);
    expect(await balanced(id)).toBe(true);
  });
  it('TigRent withdraws a listing: staff cancel with a full refund', async () => {
    const id = await confirmed(DEMO.dana, DEMO.mika, L.tripod, 20, 21);
    const q = await preview(DEMO.admin, id);
    expect(q.rule).toBe('listing_withdrawn');
    await cancel(DEMO.admin, id, q.refund_total, 'Listing withdrawn after a safety report.');
    expect((await refunds(id)).map((r) => Number(r.amount))).toEqual([q.refund_total]);
  });
  it('after pickup, cancelling is refused and routed to return or dispute', async () => {
    const q = await preview(DEMO.dana, SEED.danaProjectorActive);
    expect([q.allowed, q.rule]).toEqual([false, 'after_pickup']);
    expect(await db.errorAsCommit(DEMO.dana, `select public.cancel_booking($1, null, 0)`, [SEED.danaProjectorActive])).toMatch(/conflict.cannot_cancel/);
  });
  it('strangers can’t preview or cancel', async () => {
    expect(await db.errorAs(DEMO.mika, `select public.preview_cancellation($1)`, [SEED.danaCasioPending])).toMatch(/not_found.booking/);
  });
  it('existing bookings keep the policy version they were made under', async () => {
    const old = await confirmed(DEMO.dana, DEMO.leo, L.casio, 30, 31);
    await db.exec(`update public.cancellation_policy_versions set is_active = false;
      insert into public.cancellation_policy_versions (id, version, label, is_sample, is_active, rules) values
        ('cccccccc-0000-4000-8000-000000000002', 2, 'Sample v2 (no rent refunds)', true, true,
         '{"borrower_cancel_before_pickup": {"windows": [{"min_hours_before_pickup": 0, "rent_refund_pct": 0}], "deposit_refund_pct": 100}}')`);
    const fresh = await confirmed(DEMO.dana, DEMO.leo, L.casio, 40, 41);
    expect((await preview(DEMO.dana, old)).rent_refund_pct).toBe(100);
    expect((await preview(DEMO.dana, fresh)).rent_refund_pct).toBe(0);
    await db.exec(`update public.cancellation_policy_versions set is_active = false where version = 2; update public.cancellation_policy_versions set is_active = true where version = 1`);
  });
});

describe('late fees', () => {
  it('are never charged for an on-time return: the whole deposit is released', async () => {
    await one(DEMO.dana, `select public.submit_return($1) as r`, [SEED.danaProjectorActive]);
    const r = await one<{ late_fee: number; deposit_released: number }>(DEMO.leo, `select public.confirm_clean_return($1) as r`, [SEED.danaProjectorActive]);
    expect(r.late_fee).toBe(0);
    expect(r.deposit_released).toBe(Number((await booking(SEED.danaProjectorActive)).deposit));
  });
  it('use the agreed fee per started day, withheld from the deposit; the rest is released', async () => {
    await db.sql(`update public.bookings set due_at = now() - interval '30 hours' where id = $1`, [SEED.ricoStandActive]);
    await one(DEMO.paolo, `select public.process_due_events() as r`); // → overdue
    // Changing the live listing's late fee must not matter: the booking keeps its agreed fee.
    await db.sql(`update public.listings set late_fee_per_day = 999999 where id = $1`, [L.stand]);
    await one(DEMO.rico, `select public.submit_return($1) as r`, [SEED.ricoStandActive]); // restricted members can still return
    const b = await booking(SEED.ricoStandActive);
    const r = await one<{ late_days: number; late_fee: number; late_fee_withheld: number; deposit_released: number }>(DEMO.leo, `select public.confirm_clean_return($1) as r`, [SEED.ricoStandActive]);
    expect(r.late_days).toBe(2);
    expect(r.late_fee).toBe(2 * Number(b.late_fee_per_day));
    expect(r.late_fee_withheld).toBe(Math.min(r.late_fee, Number(b.deposit)));
    expect(r.deposit_released).toBe(Number(b.deposit) - r.late_fee_withheld);
    expect(await net(DEMO.leo, SEED.ricoStandActive, ['late_fee'])).toBe(r.late_fee_withheld);
    expect(await num(`select coalesce(sum(credit), 0) n from public.ledger_entries where booking_id = $1 and category = 'platform_commission' and idempotency_key like '%withheld%'`, [SEED.ricoStandActive])).toBe(0); // sample: no commission on late fees
    expect(await balanced(SEED.ricoStandActive)).toBe(true);
  });
  it('are capped at the deposit the platform holds', async () => {
    await db.sql(`update public.bookings set due_at = now() - interval '200 days' where id = $1`, [SEED.danaTripodOverdue]);
    await one(DEMO.dana, `select public.submit_return($1) as r`, [SEED.danaTripodOverdue]);
    const r = await one<{ late_fee: number; late_fee_withheld: number; late_fee_uncollected: number; deposit_released: number }>(DEMO.mika, `select public.confirm_clean_return($1) as r`, [SEED.danaTripodOverdue]);
    const b = await booking(SEED.danaTripodOverdue);
    expect(r.late_fee_withheld).toBe(Number(b.deposit));
    expect(r.late_fee_uncollected).toBe(r.late_fee - Number(b.deposit));
    expect(r.deposit_released).toBe(0);
    expect(await balanced(SEED.danaTripodOverdue)).toBe(true);
  });
});

describe('disputes', () => {
  let rental = '';
  let dispute = '';
  it('a lender reports damage at inspection: the deposit stays held and the booking is disputed', async () => {
    rental = await active(DEMO.bea, DEMO.leo, L.casio, 0, 1);
    await one(DEMO.bea, `select public.submit_return($1) as r`, [rental]);
    const deposit = Number((await booking(rental)).deposit);
    expect(await db.errorAsCommit(DEMO.leo, `select public.report_return_problem($1, 'damaged', 'Cracked screen on return.', $2)`, [rental, deposit + 1])).toMatch(/validation.requested_amount/);
    expect(await db.errorAsCommit(DEMO.bea, `select public.report_return_problem($1, 'damaged', 'Cracked screen on return.', 100)`, [rental])).toMatch(/forbidden.lender_only/);
    await db.sql(`insert into storage.objects (bucket_id, name, metadata) values ('evidence', $1, '{"size": 2000, "mimetype": "image/jpeg"}')`, [`${rental}/${DEMO.leo}/crack.jpg`]);
    dispute = await one<string>(DEMO.leo, `select public.report_return_problem($1, 'damaged', 'Cracked screen on return.', 5000, $2::text[]) as r`, [rental, `{${rental}/${DEMO.leo}/crack.jpg}`]);
    expect(await status(rental)).toBe('disputed');
    const d = (await db.as<{ r: { status: string; my_role: string; evidence: unknown[]; booking: { deposit: number } } }>(DEMO.bea, `select public.get_dispute($1) as r`, [dispute]))[0]!.r;
    expect([d.status, d.my_role, d.evidence.length]).toEqual(['awaiting_borrower_response', 'borrower', 1]);
    expect(await refunds(rental)).toEqual([]);
    expect(await num(`select count(*) n from public.notifications where entity_id = $1 and user_id = $2`, [dispute, DEMO.admin])).toBe(1);
  });
  it('evidence and the case are private to the parties and staff', async () => {
    expect(await db.errorAs(DEMO.mika, `select public.get_dispute($1)`, [dispute])).toMatch(/not_found.dispute/);
    expect((await db.as(DEMO.mika, `select id from public.dispute_evidence where dispute_id = $1`, [dispute])).length).toBe(0);
    expect((await db.as(DEMO.mika, `select id from public.list_disputes(false)`)).find((r) => (r as { id: string }).id === dispute)).toBeUndefined();
    expect((await db.as<{ id: string }>(DEMO.admin, `select id from public.list_disputes()`)).some((r) => r.id === dispute)).toBe(true);
  });
  it('each party responds; the case moves to review; only staff can decide', async () => {
    await db.asCommit(DEMO.bea, `select public.respond_to_dispute($1, 'It was already scratched at pickup; see my handover notes.')`, [dispute]);
    expect((await db.sql<{ status: string }>(`select status from public.disputes where id = $1`, [dispute]))[0]!.status).toBe('under_review');
    expect(await db.errorAsCommit(DEMO.bea, `select public.resolve_dispute($1, 0, 0, 'completed', 'I decide for myself.')`, [dispute])).toMatch(/forbidden.staff_only/);
    expect(await db.errorAsCommit(DEMO.leo, `select public.resolve_dispute($1, 5000, 0, 'completed', 'I decide for myself.')`, [dispute])).toMatch(/forbidden.staff_only/);
  });
  it('a moderator decision withholds part of the deposit through a recorded path, exactly once', async () => {
    const b = await booking(rental);
    expect(await db.errorAsCommit(DEMO.admin, `select public.resolve_dispute($1, $2, 0, 'completed', 'Too much.')`, [dispute, Number(b.deposit) + 1])).toMatch(/validation/);
    const r = await one<{ status: string }>(DEMO.admin, `select public.resolve_dispute($1, 3000, 0, 'completed', 'Photos show new damage; ₱30 of the deposit covers the screen protector.') as r`, [dispute]);
    expect(r.status).toBe('resolved_compensation');
    expect((await one<{ repeated: boolean }>(DEMO.admin, `select public.resolve_dispute($1, 3000, 0, 'completed', 'Photos show new damage again.') as r`, [dispute])).repeated).toBe(true);
    expect(await status(rental)).toBe('completed');
    expect((await refunds(rental)).map((x) => Number(x.amount))).toEqual([Number(b.deposit) - 3000]);
    expect(await net(DEMO.leo, rental, ['damage_compensation'])).toBe(3000);
    expect(await num(`select coalesce(sum(credit), 0) n from public.ledger_entries where booking_id = $1 and category = 'platform_commission' and idempotency_key like 'dispute:%'`, [rental])).toBe(0);
    expect(await balanced(rental)).toBe(true);
    expect(await num(`select count(*) n from public.audit_logs where entity_id = $1 and action = 'dispute.resolved'`, [dispute])).toBe(1);
  });
  it('either party may appeal once within the window; staff review closes it', async () => {
    expect(await db.errorAsCommit(DEMO.bea, `select public.appeal_dispute($1, 'short')`, [dispute])).toMatch(/validation.reason/);
    await db.asCommit(DEMO.bea, `select public.appeal_dispute($1, 'The scratch was there before; please review the handover notes.')`, [dispute]);
    expect((await db.sql<{ status: string }>(`select status from public.disputes where id = $1`, [dispute]))[0]!.status).toBe('appealed');
    expect(await db.errorAsCommit(DEMO.admin, `select public.resolve_dispute($1, 0, 0, 'completed', 'Second decision attempt.')`, [dispute])).toMatch(/conflict.appealed/);
    await db.asCommit(DEMO.admin, `select public.decide_appeal($1, 'Reviewed the handover notes; the decision stands.')`, [dispute]);
    expect((await db.sql<{ status: string }>(`select status from public.disputes where id = $1`, [dispute]))[0]!.status).toBe('closed');
    expect(await db.errorAsCommit(DEMO.leo, `select public.appeal_dispute($1, 'I want to appeal too, it was worse than that.')`, [dispute])).toMatch(/conflict.already_appealed/);
  });
  it('a lender escalates an item that wasn’t returned (never automatic)', async () => {
    const id = await active(DEMO.dana, DEMO.mika, L.ti84, 0, 0);
    expect(await db.errorAsCommit(DEMO.mika, `select public.report_not_returned($1, 'Not back yet, no reply to messages.', 100)`, [id])).toMatch(/conflict.not_overdue/);
    await db.sql(`update public.bookings set due_at = now() - interval '3 days' where id = $1`, [id]);
    await one(DEMO.paolo, `select public.process_due_events() as r`);
    expect(await status(id)).toBe('overdue');
    const d = await one<string>(DEMO.mika, `select public.report_not_returned($1, 'Not back after three days and no reply to messages.', 0) as r`, [id]);
    expect((await db.sql<{ category: string; severity: string }>(`select category, severity from public.disputes where id = $1`, [d]))[0]).toEqual({ category: 'missing_item', severity: 'severe' });
    expect(await status(id)).toBe('disputed');
  });
  it('a borrower reports an item not as described; a rent refund re-bases the lender payable and commission', async () => {
    const id = await active(DEMO.dana, DEMO.leo, L.drafting, 1, 2);
    expect(await db.errorAsCommit(DEMO.dana, `select public.open_dispute($1, 'damage', 'The compass is missing entirely.', 0)`, [id])).toMatch(/validation.category/);
    const d = await one<string>(DEMO.dana, `select public.open_dispute($1, 'not_as_described', 'The compass is missing from the set.', 2000) as r`, [id]);
    expect((await db.sql<{ status: string }>(`select status from public.disputes where id = $1`, [d]))[0]!.status).toBe('awaiting_lender_response');
    expect(await db.errorAsCommit(DEMO.dana, `select public.open_dispute($1, 'other', 'Another problem with this rental.', 0)`, [id])).toMatch(/conflict/);
    const b = await booking(id);
    await one(DEMO.admin, `select public.resolve_dispute($1, 0, 2000, 'cancelled', 'Part of the set was missing; ₱20 of the rent is refunded.') as r`, [d]);
    expect(await status(id)).toBe('cancelled');
    expect((await refunds(id)).map((x) => Number(x.amount))).toEqual([2000 + Number(b.deposit)]);
    const kept = Number(b.subtotal) - 2000;
    const commAfter = Math.floor((kept * b.commission_bps + 5000) / 10000);
    expect(await net(DEMO.leo, id, ['rent_payable', 'cancellation_adjustment'])).toBe(kept - commAfter);
    expect(await balanced(id)).toBe(true);
  });
  it('the seeded case is readable by its parties with the full story', async () => {
    const d = (await db.as<{ r: { my_role: string; status: string; messages: unknown[]; opened_by: string } }>(DEMO.bea, `select public.get_dispute($1) as r`, [SEED.seededDispute]))[0]!.r;
    expect([d.my_role, d.status, d.opened_by]).toEqual(['borrower', 'awaiting_borrower_response', 'lender']);
    expect(d.messages.length).toBeGreaterThanOrEqual(1);
  });
  it('lender earnings include late fees and compensation, net of refunds', async () => {
    const earnings = await one<number>(DEMO.leo, `select public.my_lender_earnings() as r`);
    const expected = await num(`select coalesce(sum(credit - debit), 0) n from public.ledger_entries where party_id = $1 and category in ('rent_payable', 'cancellation_adjustment', 'late_fee', 'damage_compensation')`, [DEMO.leo]);
    expect(Number(earnings)).toBe(expected);
  });
});
