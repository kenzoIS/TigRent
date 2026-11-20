/**
 * Tiggy's authored dialogue (plan §5.4): small, state-driven, never random or speculative.
 * Each rule reads real app state and returns at most one tip. Phase 13 extends the library.
 */
import type { BorrowerDashboard, LenderDashboard } from '@/domain/rules/dashboard';
import { dueLabel } from '@/domain/rules/dashboard';
import type { DateOnly } from '@/lib/dates';

export function borrowerTip(d: BorrowerDashboard, today: DateOnly): string | null {
  if (d.overdue.length > 0) return 'An item you borrowed is overdue. Please arrange the return with the lender as soon as you can.';
  if (d.nextDue) {
    const label = dueLabel(d.nextDue.returnDate, today);
    if (label === 'Due today' || label === 'Due tomorrow') return `Check the return date: ${d.nextDue.listingTitle} is ${label.toLowerCase()}.`;
  }
  if (d.requests.some((r) => r.status === 'awaiting_payment')) return 'A lender accepted your request. Complete the demo payment before the hold expires.';
  if (d.totalCount === 0) return 'Your rentals will appear here once you book an item.';
  return null;
}

export function lenderTip(d: LenderDashboard): string | null {
  const n = d.pendingRequests.length;
  if (d.overdue.length > 0) return 'One of your items is overdue. Message the borrower to arrange the return.';
  if (n > 0) return `You have ${n} new booking request${n === 1 ? '' : 's'}.`;
  if (d.awaitingInspection.length > 0) return 'A borrower returned an item. Inspect it and confirm the return.';
  if (d.upcomingHandovers.length > 0) return 'You have a handover coming up. Check the pickup details.';
  if (d.listingCounts.active === 0) return 'List an item you aren’t using to start earning from fellow students.';
  return null;
}
