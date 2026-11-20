import { extensionQuote, lateDays, rentalActions, rentalMilestones } from '@/domain/rental';
import { targetFor } from '@/features/notifications/targets';

describe('late days (never before the due time)', () => {
  const due = '2026-11-20T15:59:00.000Z';
  it('counts each started 24 h after the due time', () => {
    expect(lateDays(due, '2026-11-20T15:58:00.000Z')).toBe(0);
    expect(lateDays(due, due)).toBe(0);
    expect(lateDays(due, '2026-11-20T16:00:00.000Z')).toBe(1);
    expect(lateDays(due, '2026-11-21T15:59:00.000Z')).toBe(1);
    expect(lateDays(due, '2026-11-21T16:00:00.000Z')).toBe(2);
    expect(lateDays(due, null)).toBe(0);
  });
});

describe('extension price', () => {
  it('uses the agreed daily rate and the same half-up commission as rent', () => {
    expect(extensionQuote({ dailyRate: 4000, commissionBps: 1000, oldReturn: '2026-11-20', newReturn: '2026-11-22' })).toEqual({
      extraDays: 2, extraAmount: 8000, extraCommission: 800, lenderExtra: 7200,
    });
    expect(extensionQuote({ dailyRate: 1555, commissionBps: 1000, oldReturn: '2026-12-31', newReturn: '2027-01-01' }).extraCommission).toBe(156);
  });
});

describe('rental actions per side', () => {
  const base = {
    today: '2026-11-20', handoverOpensOn: '2026-11-20', returnDate: '2026-11-22', handover: null,
    dueAt: '2026-11-22T15:59:00.000Z', nowMs: Date.parse('2026-11-20T02:00:00.000Z'), hasOpenExtension: false, lateDaysNow: 0,
  } as const;
  it('handover: lender first, inside the window; then the borrower', () => {
    expect(rentalActions({ ...base, role: 'lender', status: 'confirmed', today: '2026-11-18' }).handover).toEqual({ enabled: false, reason: expect.stringMatching(/opens/) });
    expect(rentalActions({ ...base, role: 'lender', status: 'confirmed' }).handover).toEqual({ enabled: true });
    expect(rentalActions({ ...base, role: 'borrower', status: 'confirmed' }).handover).toEqual({ enabled: false, reason: 'The lender confirms the handover first.' });
    const lenderDone = { lenderConfirmedAt: '2026-11-20T01:00:00Z', borrowerConfirmedAt: null };
    expect(rentalActions({ ...base, role: 'borrower', status: 'confirmed', handover: lenderDone }).handover).toEqual({ enabled: true });
    expect(rentalActions({ ...base, role: 'lender', status: 'confirmed', handover: lenderDone }).handover).toBeNull();
  });
  it('only the borrower extends (before due) and returns; only the lender inspects', () => {
    const active = rentalActions({ ...base, role: 'borrower', status: 'active' });
    expect(active.extend).toEqual({ enabled: true });
    expect(active.returnItem).toBe(true);
    expect(rentalActions({ ...base, role: 'lender', status: 'active' })).toMatchObject({ extend: null, returnItem: false });
    expect(rentalActions({ ...base, role: 'borrower', status: 'overdue' }).extend).toEqual({ enabled: false, reason: expect.stringMatching(/before the due time/) });
    expect(rentalActions({ ...base, role: 'borrower', status: 'active', nowMs: Date.parse('2026-11-23T00:00:00Z') }).extend?.enabled).toBe(false);
    expect(rentalActions({ ...base, role: 'lender', status: 'return_requested' }).inspect).toEqual({ enabled: true });
    // Phase 10: late returns are confirmed too; the agreed late fee comes out of the deposit.
    expect(rentalActions({ ...base, role: 'lender', status: 'return_requested', lateDaysNow: 2 })).toMatchObject({ inspect: { enabled: true }, reportReturnProblem: true });
    expect(rentalActions({ ...base, role: 'lender', status: 'overdue' }).reportNotReturned).toBe(true);
    expect(rentalActions({ ...base, role: 'borrower', status: 'active' }).reportProblem).toBe(true);
    expect(rentalActions({ ...base, role: 'borrower', status: 'return_requested' }).reportProblem).toBe(true);
    expect(rentalActions({ ...base, role: 'lender', status: 'active' }).reportNotReturned).toBe(false);
    expect(rentalActions({ ...base, role: 'borrower', status: 'return_requested' }).inspect).toBeNull();
  });
});

describe('rental timeline', () => {
  const events = [
    { toStatus: 'pending_lender_approval' as const, kind: null, at: '2026-11-18T01:00:00Z' },
    { toStatus: 'awaiting_payment' as const, kind: null, at: '2026-11-18T02:00:00Z' },
    { toStatus: 'confirmed' as const, kind: null, at: '2026-11-18T02:05:00Z' },
  ];
  const input = { createdAt: '2026-11-18T01:00:00Z', events, pickupDate: '2026-11-20', dueAt: '2026-11-22T15:59:00Z', extendedTimes: 0 };
  const states = (s: Parameters<typeof rentalMilestones>[0]) => rentalMilestones(s).map((m) => `${m.key}:${m.state}`);
  it('marks the next step as current for each status', () => {
    expect(states({ ...input, status: 'confirmed' })).toEqual(['requested:done', 'accepted:done', 'paid:done', 'pickup:current', 'due:upcoming', 'returned:upcoming', 'completed:upcoming']);
    expect(states({ ...input, status: 'active' })).toContain('due:current');
    expect(states({ ...input, status: 'return_requested' })).toContain('completed:current');
    expect(states({ ...input, status: 'completed' }).every((s) => s.endsWith(':done'))).toBe(true);
    expect(rentalMilestones({ ...input, status: 'overdue' }).find((m) => m.key === 'due')?.label).toBe('Overdue');
    expect(rentalMilestones({ ...input, status: 'active', extendedTimes: 1 }).find((m) => m.key === 'due')?.detail).toBe('Extended once');
  });
  it('shows how an early-ended booking finished', () => {
    expect(states({ ...input, status: 'rejected', events: [events[0]!, { toStatus: 'rejected', kind: null, at: '2026-11-18T03:00:00Z' }] })).toEqual(['requested:done', 'ended:current']);
    expect(rentalMilestones({ ...input, status: 'cancelled' }).at(-1)?.label).toBe('Cancelled');
  });
});

describe('message notifications', () => {
  it('open the conversation', () => {
    expect(targetFor({ type: 'message.new', entityType: 'conversation', entityId: 'c1' })).toEqual({ kind: 'route', href: '/messages/c1' });
  });
});
