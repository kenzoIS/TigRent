/**
 * THE rental pricing/date rule for the app (plan §2.3, §10.1). One definition, used for every preview.
 * The server computes the same numbers (app_private.rental_days / commission_amount / price_quote),
 * and a parity test keeps them identical. Money is integer centavos; dates are Asia/Manila date-only.
 *
 *   rentalDays    = max(1, returnDate − pickupDate + 1)      (both days included)
 *   rentalSubtotal = dailyRate × rentalDays
 *   checkoutTotal = rentalSubtotal + refundableDeposit
 *   commission    = round_half_up(rentalSubtotal × bps / 10000)   (never on the deposit)
 */
import { calendarDaysBetween, compareDateOnly, formatDateOnly, type DateOnly } from '@/lib/dates';
import { assertCentavos, type Centavos } from '@/lib/money';

export function rentalDays(pickup: DateOnly, ret: DateOnly): number {
  return Math.max(1, calendarDaysBetween(pickup, ret) + 1);
}

/** Half-up on basis points, integer-only (matches app_private.commission_amount). */
export function commissionAmount(rent: Centavos, bps: number): Centavos {
  assertCentavos(rent);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new RangeError(`Invalid commission bps: ${bps}`);
  return Math.floor((rent * bps + 5000) / 10000);
}

export type PriceInput = { dailyRate: Centavos; deposit: Centavos; lateFeePerDay: Centavos; commissionBps: number };

export type PriceQuote = {
  pickupDate: DateOnly;
  returnDate: DateOnly;
  rentalDays: number;
  dailyRate: Centavos;
  subtotal: Centavos;
  deposit: Centavos;
  total: Centavos;
  lateFeePerDay: Centavos;
  commission: Centavos;
  lenderNet: Centavos;
};

export function quoteRental(input: PriceInput, pickup: DateOnly, ret: DateOnly): PriceQuote {
  if (compareDateOnly(ret, pickup) < 0) throw new RangeError('Return date is before pickup date');
  [input.dailyRate, input.deposit, input.lateFeePerDay].forEach(assertCentavos);
  const days = rentalDays(pickup, ret);
  const subtotal = input.dailyRate * days;
  const commission = commissionAmount(subtotal, input.commissionBps);
  return {
    pickupDate: pickup,
    returnDate: ret,
    rentalDays: days,
    dailyRate: input.dailyRate,
    subtotal,
    deposit: input.deposit,
    total: subtotal + input.deposit,
    lateFeePerDay: input.lateFeePerDay,
    commission,
    lenderNet: subtotal - commission,
  };
}

export type DateProblem = 'missing' | 'pickup_past' | 'return_before_pickup' | 'too_long' | 'too_far' | 'unavailable';

/** Client-side date checks mirroring quote_booking (server remains authoritative). */
export function checkRentalDates(
  pickup: DateOnly | null,
  ret: DateOnly | null,
  opts: { today: DateOnly; maxRentalDays: number; maxAdvanceDays: number; isUnavailable?: (d: DateOnly) => boolean },
): DateProblem | null {
  if (!pickup || !ret) return 'missing';
  if (compareDateOnly(pickup, opts.today) < 0) return 'pickup_past';
  if (compareDateOnly(ret, pickup) < 0) return 'return_before_pickup';
  if (calendarDaysBetween(opts.today, pickup) > opts.maxAdvanceDays) return 'too_far';
  if (rentalDays(pickup, ret) > opts.maxRentalDays) return 'too_long';
  if (opts.isUnavailable) {
    for (let i = 0; i < rentalDays(pickup, ret); i++) {
      const [y, m, d] = pickup.split('-').map(Number) as [number, number, number];
      const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
      if (opts.isUnavailable(day)) return 'unavailable';
    }
  }
  return null;
}

export const DATE_PROBLEM_MESSAGE: Record<DateProblem, string> = {
  missing: 'Choose a pickup and a return date.',
  pickup_past: 'Choose a pickup date from today onwards.',
  return_before_pickup: 'The return date must be on or after the pickup date.',
  too_long: 'That’s longer than the maximum rental length.',
  too_far: 'That pickup date is too far ahead.',
  unavailable: 'Some of those dates are already booked or unavailable.',
};

/** "Return by Fri, 27 Nov 2026, 11:59 PM" from the date and the configured local due time ("HH:MM"). */
export function dueLabelFor(ret: DateOnly, dueTimeLocal: string): string {
  const [h = 23, m = 59] = dueTimeLocal.split(':').map(Number);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${formatDateOnly(ret)}, ${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
