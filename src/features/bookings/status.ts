import type { Tone } from '@/components/design-system';
import type { BookingStatus } from '@/domain/entities';

/** Borrower-facing wording for each booking status (plan §2.4 lifecycle). */
export const BOOKING_STATUS_LABEL: Record<BookingStatus, { label: string; tone: Tone }> = {
  pending_lender_approval: { label: 'Waiting for lender', tone: 'warning' },
  awaiting_payment: { label: 'Payment needed', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  active: { label: 'Active', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'danger' },
  return_requested: { label: 'Return submitted', tone: 'info' },
  completed: { label: 'Completed', tone: 'neutral' },
  rejected: { label: 'Declined', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  payment_expired: { label: 'Hold expired', tone: 'neutral' },
  disputed: { label: 'Disputed', tone: 'danger' },
};


/** Lender-facing wording where it differs (plan §4.3). */
export const LENDER_STATUS_LABEL: Partial<Record<BookingStatus, { label: string; tone: Tone }>> = {
  pending_lender_approval: { label: 'Needs your decision', tone: 'warning' },
  awaiting_payment: { label: 'Waiting for payment', tone: 'info' },
  rejected: { label: 'You declined', tone: 'neutral' },
};

export function statusLabelFor(role: 'borrower' | 'lender' | 'staff', status: BookingStatus): { label: string; tone: Tone } {
  return (role === 'lender' ? LENDER_STATUS_LABEL[status] : undefined) ?? BOOKING_STATUS_LABEL[status];
}

/** One plain sentence on what happens next, per side (no internal state names shown to users). */
export function statusExplainer(role: 'borrower' | 'lender' | 'staff', status: BookingStatus, opts: { cancelReason?: string | null } = {}): string {
  const lender = role === 'lender';
  switch (status) {
    case 'pending_lender_approval':
      return lender
        ? 'Accept to hold these dates while the borrower completes the demo payment, or decline with a reason.'
        : 'The lender is reviewing your request. Nothing is charged until they accept.';
    case 'awaiting_payment':
      return lender
        ? 'You accepted. The dates are held until the borrower pays; if the window closes, they’re released automatically.'
        : 'The lender accepted. Complete the demo payment before the timer runs out, or the dates are released.';
    case 'confirmed':
      return lender
        ? 'Paid (simulated). Hand the item over at the agreed pickup point on the pickup date.'
        : 'Paid (simulated). Pick the item up at the agreed point on your pickup date.';
    case 'rejected':
      return lender ? 'You declined this request. Nothing was charged.' : 'The lender declined this request. Nothing was charged.';
    case 'payment_expired':
      return lender
        ? 'The payment window closed, so the dates were released. Nothing was charged.'
        : 'The payment window closed before checkout, so the dates were released. Nothing was charged. You can send a new request.';
    case 'cancelled':
      return opts.cancelReason ? `${opts.cancelReason} Nothing was charged.` : 'This booking was cancelled.';
    case 'active':
      return 'The item is out on rent.';
    case 'overdue':
      return 'The return is overdue.';
    case 'return_requested':
      return 'The borrower submitted the return; the lender inspects it next.';
    case 'disputed':
      return 'A dispute is open for this rental.';
    case 'completed':
      return 'This rental is complete.';
  }
}
