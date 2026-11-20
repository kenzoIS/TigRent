/**
 * Cancellation, late-fee and dispute rules (plan §2.6, §2.7, Phase 10). The server (migration 017) is the
 * authority and computes every amount; these helpers mirror its rules for previews, labels and tests.
 */
import type { BookingStatus } from '@/domain/entities';
import type { Centavos } from '@/lib/money';

export type DisputeStatus =
  | 'open'
  | 'awaiting_borrower_response'
  | 'awaiting_lender_response'
  | 'under_review'
  | 'resolved_refund'
  | 'resolved_compensation'
  | 'closed'
  | 'appealed';
export type DisputeCategory = 'damage' | 'missing_item' | 'incomplete_return' | 'late_return' | 'not_as_described' | 'payment' | 'other';

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, { label: string; tone: 'warning' | 'info' | 'success' | 'neutral' | 'danger' }> = {
  open: { label: 'Open', tone: 'warning' },
  awaiting_borrower_response: { label: 'Waiting for borrower', tone: 'warning' },
  awaiting_lender_response: { label: 'Waiting for lender', tone: 'warning' },
  under_review: { label: 'Moderator reviewing', tone: 'info' },
  resolved_refund: { label: 'Decided: refund', tone: 'success' },
  resolved_compensation: { label: 'Decided: compensation', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
  appealed: { label: 'Appeal under review', tone: 'info' },
};

export const DISPUTE_CATEGORY_LABEL: Record<DisputeCategory, string> = {
  damage: 'Damage',
  missing_item: 'Item not returned',
  incomplete_return: 'Missing parts',
  late_return: 'Late return',
  not_as_described: 'Not as described',
  payment: 'Payment',
  other: 'Other',
};

export const DECIDED: readonly DisputeStatus[] = ['resolved_refund', 'resolved_compensation', 'closed'];

/** Statuses from which each party may cancel (server: `cancellation_quote`). */
export function canOfferCancel(role: 'borrower' | 'lender' | 'staff', status: BookingStatus): boolean {
  if (status === 'pending_lender_approval') return role !== 'lender'; // lenders decline instead
  return status === 'awaiting_payment' || status === 'confirmed';
}

/** Late fee settled at return: the agreed fee per started late day, withheld from the deposit (capped). */
export function lateFeeSettlement(lateDays: number, lateFeePerDay: Centavos, deposit: Centavos) {
  const fee = Math.max(0, lateDays) * lateFeePerDay;
  const withheld = Math.min(fee, deposit);
  return { fee, withheld, uncollected: fee - withheld, released: deposit - withheld };
}

/** Claims are limited to what TigRent actually holds (deposit) or what was paid (rent). */
export function checkClaimAmount(amount: Centavos | null, max: Centavos): string | null {
  if (amount === null || !Number.isInteger(amount) || amount < 0) return 'Enter an amount in pesos (₱0 or more).';
  if (amount > max) return 'That’s more than TigRent holds for this booking.';
  return null;
}

export function checkDescription(text: string): string | null {
  const t = text.trim();
  if (t.length < 10) return 'Describe what happened (at least 10 characters).';
  if (t.length > 2000) return 'Keep it under 2,000 characters.';
  return null;
}

/** Moderator decision preview: who receives what (mirrors `settle_booking_money`). */
export function decisionPreview(input: { deposit: Centavos; rentPaid: Centavos; depositToLender: Centavos; rentRefund: Centavos }) {
  const problems: string[] = [];
  if (input.depositToLender < 0 || input.depositToLender > input.deposit) problems.push('Deposit to lender must be between ₱0 and the deposit.');
  if (input.rentRefund < 0 || input.rentRefund > input.rentPaid) problems.push('Rent refund must be between ₱0 and the rent paid.');
  return {
    borrowerGets: input.rentRefund + (input.deposit - input.depositToLender),
    lenderGets: input.depositToLender,
    problems,
  };
}
