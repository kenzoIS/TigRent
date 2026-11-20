import { checkRentalDates, commissionAmount, dueLabelFor, quoteRental, rentalDays } from '@/domain/pricing';

const CALC = { dailyRate: 4000, deposit: 30000, lateFeePerDay: 2000, commissionBps: 1000 };

describe('rentalDays (inclusive, minimum one day, Asia/Manila dates)', () => {
  it.each([
    ['same day', '2026-11-18', '2026-11-18', 1],
    ['multi-day', '2026-11-25', '2026-11-27', 3],
    ['month boundary', '2026-11-30', '2026-12-02', 3],
    ['year boundary', '2026-12-31', '2027-01-01', 2],
    ['leap February', '2028-02-28', '2028-03-01', 3],
    ['non-leap February', '2027-02-28', '2027-03-01', 2],
  ])('%s', (_l, a, b, n) => expect(rentalDays(a, b)).toBe(n));
});

describe('quoteRental', () => {
  it('builds the full PHP breakdown in integer centavos', () => {
    expect(quoteRental(CALC, '2026-11-25', '2026-11-27')).toEqual({
      pickupDate: '2026-11-25', returnDate: '2026-11-27', rentalDays: 3, dailyRate: 4000, subtotal: 12000,
      deposit: 30000, total: 42000, lateFeePerDay: 2000, commission: 1200, lenderNet: 10800,
    });
  });
  it('never charges commission on the deposit', () => {
    expect(quoteRental({ ...CALC, deposit: 999_900 }, '2026-11-25', '2026-11-25').commission).toBe(400);
  });
  it('rounds commission half-up to the centavo', () => {
    expect(commissionAmount(12345, 1000)).toBe(1235); // 1234.5 → 1235
    expect(commissionAmount(12344, 1000)).toBe(1234);
    expect(commissionAmount(0, 1000)).toBe(0);
    expect(() => commissionAmount(100, 10001)).toThrow(RangeError);
  });
  it('rejects inverted dates and non-integer money', () => {
    expect(() => quoteRental(CALC, '2026-11-27', '2026-11-25')).toThrow(RangeError);
    expect(() => quoteRental({ ...CALC, dailyRate: 40.5 }, '2026-11-25', '2026-11-25')).toThrow(RangeError);
  });
});

describe('checkRentalDates', () => {
  const opts = { today: '2026-11-18', maxRentalDays: 30, maxAdvanceDays: 90 };
  it.each([
    [null, null, 'missing'],
    ['2026-11-17', '2026-11-18', 'pickup_past'],
    ['2026-11-20', '2026-11-19', 'return_before_pickup'],
    ['2026-11-20', '2026-12-25', 'too_long'],
    ['2027-03-01', '2027-03-02', 'too_far'],
    ['2026-11-18', '2026-11-18', null],
  ])('%s → %s = %s', (a, b, expected) => expect(checkRentalDates(a, b, opts)).toBe(expected));
  it('flags any unavailable day inside the range, including across months', () => {
    const blocked = new Set(['2026-12-01']);
    expect(checkRentalDates('2026-11-29', '2026-12-02', { ...opts, isUnavailable: (d) => blocked.has(d) })).toBe('unavailable');
    expect(checkRentalDates('2026-12-02', '2026-12-04', { ...opts, isUnavailable: (d) => blocked.has(d) })).toBeNull();
  });
});

it('formats the due time from the configured local time', () => {
  expect(dueLabelFor('2026-11-27', '23:59')).toBe('Fri, 27 Nov 2026, 11:59 PM');
  expect(dueLabelFor('2026-11-27', '09:00')).toBe('Fri, 27 Nov 2026, 9:00 AM');
});
