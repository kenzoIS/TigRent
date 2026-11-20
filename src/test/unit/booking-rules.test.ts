import {
  BOOKING_TRANSITIONS,
  bookingActions,
  canTransition,
  checkRejectReason,
  formatCountdown,
  groupRequests,
  holdSecondsLeft,
  HOLDING_STATUSES,
} from '@/domain/bookings';
import { hasPhoneNumber } from '@/domain/listings';
import { newIdempotencyKey, toPaymentResult } from '@/providers/payments/mock';
import { toBookingDetail } from '@/repositories/bookings';

describe('booking transitions', () => {
  it('follow the plan lifecycle and never leave terminal states', () => {
    expect(canTransition('pending_lender_approval', 'awaiting_payment')).toBe(true);
    expect(canTransition('awaiting_payment', 'confirmed')).toBe(true);
    expect(canTransition('pending_lender_approval', 'confirmed')).toBe(false); // no paying without acceptance
    expect(canTransition('awaiting_payment', 'active')).toBe(false);
    for (const terminal of ['rejected', 'cancelled', 'payment_expired', 'completed'] as const) {
      expect(BOOKING_TRANSITIONS[terminal]).toEqual([]);
    }
    expect(HOLDING_STATUSES).not.toContain('pending_lender_approval'); // many requests may share dates
  });
});

describe('payment hold countdown', () => {
  const server = '2026-11-19T02:00:00.000Z';
  const hold = '2026-11-19T02:15:00.000Z';
  it('uses the server clock, adding only locally elapsed time', () => {
    const fetched = 1_000_000;
    expect(holdSecondsLeft(hold, server, fetched, fetched)).toBe(900);
    expect(holdSecondsLeft(hold, server, fetched, fetched + 60_500)).toBe(839);
    // A wrong phone clock doesn't matter: only the delta since fetch is used.
    expect(holdSecondsLeft(hold, server, Date.parse('2030-01-01'), Date.parse('2030-01-01') + 1000)).toBe(899);
    expect(holdSecondsLeft(hold, server, fetched, fetched + 999_999)).toBe(0);
    expect(holdSecondsLeft(null, server, fetched, fetched)).toBe(0);
  });
  it('formats m:ss', () => {
    expect(formatCountdown(900)).toBe('15:00');
    expect(formatCountdown(61)).toBe('1:01');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('available actions', () => {
  const base = { conflict: null, holdSeconds: 0, hasPaymentRecord: false } as const;
  it('lender decides pending requests; a conflict disables accept with the reason', () => {
    expect(bookingActions({ ...base, role: 'lender', status: 'pending_lender_approval' })).toMatchObject({ accept: { enabled: true }, reject: true, pay: false });
    const blocked = bookingActions({ ...base, role: 'lender', status: 'pending_lender_approval', conflict: 'dates_taken' });
    expect(blocked.accept).toEqual({ enabled: false, reason: expect.stringMatching(/Another booking already holds/) });
    expect(blocked.reject).toBe(true);
    expect(bookingActions({ ...base, role: 'borrower', status: 'pending_lender_approval' })).toMatchObject({ accept: null, reject: false });
  });
  it('borrower pays only while the hold is running', () => {
    expect(bookingActions({ ...base, role: 'borrower', status: 'awaiting_payment', holdSeconds: 30 }).pay).toBe(true);
    expect(bookingActions({ ...base, role: 'borrower', status: 'awaiting_payment', holdSeconds: 0 }).pay).toBe(false);
    expect(bookingActions({ ...base, role: 'lender', status: 'awaiting_payment', holdSeconds: 30 }).pay).toBe(false);
  });
  it('a receipt is offered once a payment record exists', () => {
    expect(bookingActions({ ...base, role: 'borrower', status: 'confirmed', hasPaymentRecord: true }).receipt).toBe(true);
  });
});

describe('lender inbox helpers', () => {
  it('requires a short reason to decline', () => {
    expect(checkRejectReason('  ')).toMatch(/short reason/);
    expect(checkRejectReason('x'.repeat(301))).toMatch(/300/);
    expect(checkRejectReason('Busy that week')).toBeNull();
  });
  it('groups requests by what the lender has to do', () => {
    const g = groupRequests([{ status: 'pending_lender_approval' }, { status: 'awaiting_payment' }, { status: 'rejected' }, { status: 'confirmed' }] as const);
    expect([g.pending.length, g.awaiting.length, g.recent.length]).toEqual([1, 1, 2]);
  });
  it('flags phone numbers in notes, like the server does', () => {
    expect(hasPhoneNumber('Call 0917 123 4567')).toBe(true);
    expect(hasPhoneNumber('+639171234567')).toBe(true);
    expect(hasPhoneNumber('After my 1 PM class, Room 302')).toBe(false);
  });
});

describe('payment adapter mapping', () => {
  it('keys are unique per attempt', () => {
    const a = newIdempotencyKey('bbbbbbbb-0000', 1, () => 0.1);
    const b = newIdempotencyKey('bbbbbbbb-0000', 1, () => 0.2);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(128);
  });
  it('maps server results, treating anything unknown as not paid', () => {
    expect(toPaymentResult({ payment_id: 'p1', outcome: 'success', amount: 42000, provider_ref: 'MOCK-1', replayed: true, booking_status: 'confirmed' }))
      .toMatchObject({ paymentId: 'p1', outcome: 'success', amount: 42000, replayed: true, bookingStatus: 'confirmed' });
    expect(toPaymentResult({ outcome: 'weird' }).outcome).toBe('expired');
  });
});

describe('booking detail mapping', () => {
  it('normalises seeded snapshots and missing fields', () => {
    const d = toBookingDetail(
      {
        id: 'b1', my_role: 'lender', status: 'pending_lender_approval', listing_id: 'l1', pickup_date: '2026-11-26', return_date: '2026-11-28', rental_days: 3,
        snapshot: { listing_title: 'Casio', return_due_time_local: '23:59:00' }, total: 42000, conflict: 'dates_taken',
        counterpart: { id: 'u2', role: 'borrower', full_name: 'Bea Santos', is_student_verified: true, rating_avg: null, rating_count: 0 },
        events: [], payments: [], server_now: '2026-11-19T02:00:00Z',
      },
      5,
    );
    expect(d.snapshot.returnDueTimeLocal).toBe('23:59');
    expect(d.conflict).toBe('dates_taken');
    expect(d.counterpart.ratingAvg).toBeNull();
    expect(d.fetchedAtMs).toBe(5);
    expect(d.terms).toBeNull();
  });
});
