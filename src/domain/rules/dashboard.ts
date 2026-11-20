/**
 * Dashboard summaries (plan Phase 5, §4.2/§4.3). Pure and deterministic: screens render these
 * results and never compute status groupings or money themselves (plan §6.1).
 */
import type { BookingStatus, BookingSummary, ListingStatus, ListingSummary } from '@/domain/entities';
import { compareDateOnly, calendarDaysBetween, type DateOnly } from '@/lib/dates';
import type { Centavos } from '@/lib/money';

const IN_PROGRESS: BookingStatus[] = ['active', 'overdue', 'return_requested', 'disputed'];
const REQUESTED: BookingStatus[] = ['pending_lender_approval', 'awaiting_payment'];

const byPickup = (a: BookingSummary, b: BookingSummary) => compareDateOnly(a.pickupDate, b.pickupDate);
const byDue = (a: BookingSummary, b: BookingSummary) => a.dueAt.localeCompare(b.dueAt);

export type BorrowerDashboard = {
  inProgress: BookingSummary[];
  upcoming: BookingSummary[];
  requests: BookingSummary[];
  overdue: BookingSummary[];
  /** The rental that must be returned soonest (active/overdue only). */
  nextDue: BookingSummary | null;
  completedCount: number;
  totalCount: number;
};

export function summarizeBorrower(bookings: BookingSummary[], userId: string, today: DateOnly): BorrowerDashboard {
  const mine = bookings.filter((b) => b.borrowerId === userId);
  const inProgress = mine.filter((b) => IN_PROGRESS.includes(b.status)).sort(byDue);
  return {
    inProgress,
    upcoming: mine.filter((b) => b.status === 'confirmed' && compareDateOnly(b.pickupDate, today) >= 0).sort(byPickup),
    requests: mine.filter((b) => REQUESTED.includes(b.status)).sort(byPickup),
    overdue: mine.filter((b) => b.status === 'overdue'),
    nextDue: inProgress.find((b) => b.status === 'active' || b.status === 'overdue') ?? null,
    completedCount: mine.filter((b) => b.status === 'completed').length,
    totalCount: mine.length,
  };
}

export type LenderDashboard = {
  pendingRequests: BookingSummary[];
  awaitingPayment: BookingSummary[];
  /** Confirmed bookings with pickup within `horizonDays` (including today). */
  upcomingHandovers: BookingSummary[];
  inProgress: BookingSummary[];
  awaitingInspection: BookingSummary[];
  overdue: BookingSummary[];
  completedCount: number;
  listingCounts: Record<ListingStatus, number>;
  /** Simulated lender payable from the ledger (rent after commission); never a real payout. */
  estimatedEarnings: Centavos;
};

export function summarizeLender(
  bookings: BookingSummary[],
  listings: ListingSummary[],
  payableEntries: Centavos[],
  userId: string,
  today: DateOnly,
  horizonDays = 7,
): LenderDashboard {
  const mine = bookings.filter((b) => b.lenderId === userId);
  const listingCounts: Record<ListingStatus, number> = { draft: 0, active: 0, paused: 0, unavailable: 0, removed: 0 };
  for (const l of listings) if (l.lenderId === userId) listingCounts[l.status] += 1;
  return {
    pendingRequests: mine.filter((b) => b.status === 'pending_lender_approval').sort(byPickup),
    awaitingPayment: mine.filter((b) => b.status === 'awaiting_payment').sort(byPickup),
    upcomingHandovers: mine
      .filter((b) => {
        if (b.status !== 'confirmed') return false;
        const d = calendarDaysBetween(today, b.pickupDate);
        return d >= 0 && d <= horizonDays;
      })
      .sort(byPickup),
    inProgress: mine.filter((b) => IN_PROGRESS.includes(b.status)).sort(byDue),
    awaitingInspection: mine.filter((b) => b.status === 'return_requested'),
    overdue: mine.filter((b) => b.status === 'overdue'),
    completedCount: mine.filter((b) => b.status === 'completed').length,
    listingCounts,
    estimatedEarnings: sumCentavos(payableEntries),
  };
}

/** Integer-only sum; rejects non-integer inputs rather than rounding silently. */
export function sumCentavos(values: Centavos[]): Centavos {
  return values.reduce((acc, v) => {
    if (!Number.isSafeInteger(v)) throw new RangeError(`Not an integer centavo amount: ${v}`);
    return acc + v;
  }, 0);
}

/** "Due today", "Due tomorrow", "Due in 3 days", "2 days overdue" from the business date. */
export function dueLabel(returnDate: DateOnly, today: DateOnly): string {
  const d = calendarDaysBetween(today, returnDate);
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d > 1) return `Due in ${d} days`;
  return `${-d} day${d === -1 ? '' : 's'} overdue`;
}
