import type { BookingSummary, ListingSummary } from '@/domain/entities';
import { dueLabel, sumCentavos, summarizeBorrower, summarizeLender } from '@/domain/rules/dashboard';
import { borrowerTip, lenderTip } from '@/features/mascot/dialogue';

const ME = 'me';
const OTHER = 'other';
const TODAY = '2026-11-18';
let n = 0;
const b = (o: Partial<BookingSummary>): BookingSummary => ({
  id: `b${++n}`, listingId: 'l1', borrowerId: ME, lenderId: OTHER, listingTitle: 'Item', pickupDate: TODAY, returnDate: TODAY,
  rentalDays: 1, dueAt: `${o.returnDate ?? TODAY}T15:59:00Z`, status: 'confirmed', total: 1000, deposit: 0, subtotal: 1000, lenderNet: 900, holdExpiresAt: null, ...o,
});
const l = (o: Partial<ListingSummary>): ListingSummary => ({
  id: `l${++n}`, lenderId: ME, title: 'x', category: 'other', condition: 'good', dailyRate: 100, deposit: 0, lateFeePerDay: 0, status: 'active', isFeatured: false, ...o,
});

describe('summarizeBorrower', () => {
  const data = [
    b({ status: 'active', returnDate: '2026-11-19', listingTitle: 'Projector' }),
    b({ status: 'overdue', returnDate: '2026-11-16' }),
    b({ status: 'confirmed', pickupDate: '2026-11-21' }),
    b({ status: 'pending_lender_approval', pickupDate: '2026-11-25' }),
    b({ status: 'awaiting_payment', pickupDate: '2026-11-22' }),
    b({ status: 'completed' }),
    b({ status: 'cancelled' }),
    b({ status: 'active', borrowerId: OTHER, lenderId: ME }), // I'm the lender here: excluded
  ];
  const d = summarizeBorrower(data, ME, TODAY);
  it('groups only my borrowings by status', () => {
    expect(d.totalCount).toBe(7);
    expect(d.inProgress.map((x) => x.status)).toEqual(['overdue', 'active']); // soonest due first
    expect(d.upcoming).toHaveLength(1);
    expect(d.requests.map((x) => x.status)).toEqual(['awaiting_payment', 'pending_lender_approval']);
    expect(d.overdue).toHaveLength(1);
    expect(d.completedCount).toBe(1);
    expect(d.nextDue?.status).toBe('overdue');
  });
  it('Tiggy prioritises an overdue item', () => {
    expect(borrowerTip(d, TODAY)).toMatch(/overdue/);
  });
  it('Tiggy reminds about a return due tomorrow (state-driven, no false claims)', () => {
    const d2 = summarizeBorrower([b({ status: 'active', returnDate: '2026-11-19', listingTitle: 'Projector' })], ME, TODAY);
    expect(borrowerTip(d2, TODAY)).toBe('Check the return date: Projector is due tomorrow.');
    expect(borrowerTip(summarizeBorrower([], ME, TODAY), TODAY)).toMatch(/will appear here/);
    expect(borrowerTip(summarizeBorrower([b({ status: 'completed' })], ME, TODAY), TODAY)).toBeNull();
  });
});

describe('summarizeLender', () => {
  const bookings = [
    b({ status: 'pending_lender_approval', borrowerId: OTHER, lenderId: ME }),
    b({ status: 'pending_lender_approval', borrowerId: OTHER, lenderId: ME }),
    b({ status: 'confirmed', borrowerId: OTHER, lenderId: ME, pickupDate: '2026-11-20' }),
    b({ status: 'confirmed', borrowerId: OTHER, lenderId: ME, pickupDate: '2026-12-20' }), // beyond 7-day horizon
    b({ status: 'return_requested', borrowerId: OTHER, lenderId: ME }),
    b({ status: 'completed', borrowerId: OTHER, lenderId: ME }),
    b({ status: 'pending_lender_approval' }), // I'm the borrower here: excluded
  ];
  const listings = [l({}), l({}), l({ status: 'draft' }), l({ status: 'paused' }), l({ lenderId: OTHER })];
  const d = summarizeLender(bookings, listings, [8100, 3600, 900], ME, TODAY);
  it('groups my lending activity and listing statuses', () => {
    expect(d.pendingRequests).toHaveLength(2);
    expect(d.upcomingHandovers).toHaveLength(1);
    expect(d.awaitingInspection).toHaveLength(1);
    expect(d.completedCount).toBe(1);
    expect(d.listingCounts).toEqual({ active: 2, draft: 1, paused: 1, unavailable: 0, removed: 0 });
  });
  it('sums simulated earnings in integer centavos', () => {
    expect(d.estimatedEarnings).toBe(12600);
    expect(() => sumCentavos([1.5])).toThrow(RangeError);
  });
  it('Tiggy announces new requests with the real count', () => {
    expect(lenderTip(d)).toBe('You have 2 new booking requests.');
    const empty = summarizeLender([], [], [], ME, TODAY);
    expect(lenderTip(empty)).toMatch(/List an item/);
  });
});

it('due labels use Manila business dates', () => {
  expect(dueLabel('2026-11-18', TODAY)).toBe('Due today');
  expect(dueLabel('2026-11-19', TODAY)).toBe('Due tomorrow');
  expect(dueLabel('2026-11-21', TODAY)).toBe('Due in 3 days');
  expect(dueLabel('2026-11-17', TODAY)).toBe('1 day overdue');
  expect(dueLabel('2026-11-15', TODAY)).toBe('3 days overdue');
});
