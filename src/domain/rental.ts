/**
 * Rental lifecycle rules after checkout (plan §2.7, §2.8, Phase 9). The server (migration 016) decides;
 * these helpers mirror its rules so screens can explain what happens next and offer only valid actions.
 */
import type { BookingStatus } from '@/domain/entities';
import { commissionAmount } from '@/domain/pricing';
import { calendarDaysBetween, compareDateOnly, type DateOnly } from '@/lib/dates';
import type { Centavos } from '@/lib/money';

/** Each started 24 h after the agreed due time is a late day; never before it (same as SQL `late_days`). */
export function lateDays(dueAt: string, returnedAt: string | null): number {
  if (!returnedAt) return 0;
  const ms = Date.parse(returnedAt) - Date.parse(dueAt);
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** Extra rent for an extension: the booking's agreed daily rate × extra days; commission on it like rent. */
export function extensionQuote(input: { dailyRate: Centavos; commissionBps: number; oldReturn: DateOnly; newReturn: DateOnly }) {
  const extraDays = Math.max(0, calendarDaysBetween(input.oldReturn, input.newReturn));
  const extraAmount = input.dailyRate * extraDays;
  const extraCommission = commissionAmount(extraAmount, input.commissionBps);
  return { extraDays, extraAmount, extraCommission, lenderExtra: extraAmount - extraCommission };
}

export type ExtensionStatus = 'pending' | 'rejected' | 'approved_awaiting_payment' | 'paid' | 'payment_failed' | 'expired' | 'cancelled';
export const OPEN_EXTENSION: readonly ExtensionStatus[] = ['pending', 'approved_awaiting_payment'];

export const EXTENSION_LABEL: Record<ExtensionStatus, { label: string; tone: 'warning' | 'info' | 'success' | 'neutral' | 'danger' }> = {
  pending: { label: 'Waiting for lender', tone: 'warning' },
  approved_awaiting_payment: { label: 'Approved: payment needed', tone: 'info' },
  paid: { label: 'Extended', tone: 'success' },
  rejected: { label: 'Declined', tone: 'neutral' },
  payment_failed: { label: 'Payment failed', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
};

export type HandoverState = { lenderConfirmedAt: string | null; borrowerConfirmedAt: string | null };

export type RentalActions = {
  /** Lender: confirm handing the item over. Borrower: confirm receipt (after the lender). */
  handover: { enabled: boolean; reason?: string } | null;
  extend: { enabled: boolean; reason?: string } | null;
  returnItem: boolean;
  /** Lender: confirm the return (late fees are settled from the deposit automatically). */
  inspect: { enabled: boolean; reason?: string } | null;
  /** Lender at inspection: damaged / missing parts → dispute. */
  reportReturnProblem: boolean;
  /** Lender, after the due time: escalate an item that wasn't returned (never automatic). */
  reportNotReturned: boolean;
  /** Borrower while the item is out or being returned: not as described / other → dispute. */
  reportProblem: boolean;
};

/** What each side can do on a paid booking (server re-checks everything). */
export function rentalActions(input: {
  role: 'borrower' | 'lender' | 'staff';
  status: BookingStatus;
  today: DateOnly;
  handoverOpensOn: DateOnly;
  returnDate: DateOnly;
  handover: HandoverState | null;
  dueAt: string;
  nowMs: number;
  hasOpenExtension: boolean;
  lateDaysNow: number;
}): RentalActions {
  const { role, status } = input;
  const none: RentalActions = { handover: null, extend: null, returnItem: false, inspect: null, reportReturnProblem: false, reportNotReturned: false, reportProblem: false };
  if (role === 'staff') return none;

  if (status === 'confirmed') {
    const mine = role === 'lender' ? input.handover?.lenderConfirmedAt : input.handover?.borrowerConfirmedAt;
    if (mine) return none;
    if (compareDateOnly(input.today, input.handoverOpensOn) < 0) {
      return { ...none, handover: { enabled: false, reason: 'Handover opens the day before pickup.' } };
    }
    if (compareDateOnly(input.today, input.returnDate) > 0) {
      return { ...none, handover: { enabled: false, reason: 'The rental period has ended.' } };
    }
    if (role === 'borrower' && !input.handover?.lenderConfirmedAt) {
      return { ...none, handover: { enabled: false, reason: 'The lender confirms the handover first.' } };
    }
    return { ...none, handover: { enabled: true } };
  }

  if (role === 'borrower' && (status === 'active' || status === 'overdue')) {
    const beforeDue = input.nowMs < Date.parse(input.dueAt);
    // An open request stays reachable (to pay or check on it) even if the due time passes meanwhile.
    const extend =
      (status === 'active' && beforeDue) || input.hasOpenExtension
        ? { enabled: true }
        : { enabled: false, reason: 'Extensions must be requested before the due time.' };
    return { ...none, extend, returnItem: true, reportProblem: true };
  }

  if (role === 'lender' && status === 'overdue') return { ...none, reportNotReturned: true };
  if (role === 'borrower' && status === 'return_requested') return { ...none, reportProblem: true };

  if (role === 'lender' && status === 'return_requested') {
    return { ...none, inspect: { enabled: true }, reportReturnProblem: true };
  }
  return none;
}

export type Milestone = { key: string; label: string; state: 'done' | 'current' | 'upcoming'; at?: string | null; detail?: string };

/** How many timeline steps are complete for each live status (steps listed in `rentalMilestones`). */
const STAGE: Partial<Record<BookingStatus, number>> = {
  pending_lender_approval: 1,
  awaiting_payment: 2,
  confirmed: 3,
  active: 4,
  overdue: 4,
  return_requested: 6,
  disputed: 6,
  completed: 7,
};

/**
 * The rental timeline both parties see (plan Phase 9): requested → accepted → paid → picked up → due back →
 * returned → completed. A booking that ended early (declined / cancelled / not paid) shows the steps it
 * reached, then how it ended.
 */
export function rentalMilestones(input: {
  status: BookingStatus;
  createdAt: string;
  events: { toStatus: BookingStatus; kind: string | null; at: string }[];
  pickupDate: DateOnly;
  dueAt: string;
  extendedTimes: number;
}): Milestone[] {
  const at = (s: BookingStatus) => input.events.find((e) => e.toStatus === s && !e.kind)?.at ?? null;
  const steps: Omit<Milestone, 'state'>[] = [
    { key: 'requested', label: 'Requested', at: input.createdAt },
    { key: 'accepted', label: 'Accepted by lender', at: at('awaiting_payment') },
    { key: 'paid', label: 'Paid (demo)', at: at('confirmed') },
    { key: 'pickup', label: 'Picked up', at: at('active') },
    {
      key: 'due',
      label: input.status === 'overdue' ? 'Overdue' : 'Due back',
      at: input.dueAt,
      detail: input.extendedTimes > 0 ? `Extended ${input.extendedTimes === 1 ? 'once' : `${input.extendedTimes} times`}` : undefined,
    },
    { key: 'returned', label: 'Returned', at: at('return_requested') },
    { key: 'completed', label: 'Completed', at: at('completed') },
  ];
  const stage = STAGE[input.status];
  if (stage === undefined) {
    const reached = 1 + (at('awaiting_payment') ? 1 : 0) + (at('confirmed') ? 1 : 0);
    const ending = input.status === 'rejected' ? 'Declined' : input.status === 'payment_expired' ? 'Payment window closed' : 'Cancelled';
    return [
      ...steps.slice(0, reached).map((s) => ({ ...s, state: 'done' as const })),
      { key: 'ended', label: ending, state: 'current', at: at(input.status) },
    ];
  }
  return steps.map((s, i) => ({ ...s, state: i < stage ? 'done' : i === stage ? 'current' : 'upcoming' }));
}
