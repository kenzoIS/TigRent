/**
 * Booking lifecycle rules (plan §2.4). The server (migration 015) is the authority: it validates every
 * transition in `app_private.booking_transition_allowed`, and a db test keeps this table in parity.
 * Screens use these helpers to decide what to offer; they never change a booking themselves.
 */
import type { BookingStatus } from '@/domain/entities';

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending_lender_approval: ['rejected', 'cancelled', 'awaiting_payment'],
  awaiting_payment: ['confirmed', 'payment_expired', 'cancelled'],
  confirmed: ['active', 'cancelled'],
  active: ['return_requested', 'overdue', 'disputed'],
  overdue: ['return_requested', 'disputed'],
  return_requested: ['completed', 'disputed'],
  disputed: ['completed', 'cancelled'],
  rejected: [],
  cancelled: [],
  payment_expired: [],
  completed: [],
};

export const canTransition = (from: BookingStatus, to: BookingStatus): boolean => BOOKING_TRANSITIONS[from].includes(to);

/** Statuses that hold the item's dates (the bookings_no_overlap exclusion constraint). */
export const HOLDING_STATUSES: readonly BookingStatus[] = ['awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed'];

export type BookingRole = 'borrower' | 'lender' | 'staff';

/** Why the lender can't accept a pending request right now (server `request_conflict`). */
export type RequestConflict = 'dates_taken' | 'dates_blocked' | 'pickup_passed' | 'listing_unavailable';

export const CONFLICT_MESSAGE: Record<RequestConflict, { title: string; message: string }> = {
  dates_taken: {
    title: 'Dates no longer available',
    message: 'Another booking already holds some of these dates. Decline this request, or ask the borrower for other dates.',
  },
  dates_blocked: {
    title: 'You blocked these dates',
    message: 'Your availability calendar blocks some of these dates. Remove the block first, or decline.',
  },
  pickup_passed: {
    title: 'Pickup date has passed',
    message: 'This request can’t be accepted any more. Decline it so the borrower can send new dates.',
  },
  listing_unavailable: {
    title: 'Listing removed or hidden',
    message: 'This listing can’t be booked right now. Decline the request.',
  },
};

export function asConflict(value: unknown): RequestConflict | null {
  return value === 'dates_taken' || value === 'dates_blocked' || value === 'pickup_passed' || value === 'listing_unavailable' ? value : null;
}

/**
 * Seconds left on a payment hold, measured on the SERVER clock (plan §10.1: never trust the client clock
 * for expiry). `serverNow` is the server time returned with the booking, `fetchedAtMs` the local time
 * the response arrived; only the elapsed local time since then is added.
 */
export function holdSecondsLeft(holdExpiresAt: string | null, serverNow: string, fetchedAtMs: number, nowMs: number): number {
  if (!holdExpiresAt) return 0;
  const elapsed = Math.max(0, nowMs - fetchedAtMs);
  const left = Date.parse(holdExpiresAt) - (Date.parse(serverNow) + elapsed);
  return Math.max(0, Math.floor(left / 1000));
}

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export type BookingActions = {
  /** Lender: accept is offered but disabled (with the reason) when a conflict exists. */
  accept: { enabled: boolean; reason?: string } | null;
  reject: boolean;
  /** Borrower: demo checkout while the hold is running. */
  pay: boolean;
  receipt: boolean;
};

/** Which actions a party can take, given the server-provided state. */
export function bookingActions(input: {
  role: BookingRole;
  status: BookingStatus;
  conflict: RequestConflict | null;
  holdSeconds: number;
  hasPaymentRecord: boolean;
}): BookingActions {
  const { role, status, conflict, holdSeconds, hasPaymentRecord } = input;
  const lenderPending = role === 'lender' && status === 'pending_lender_approval';
  return {
    accept: lenderPending ? (conflict ? { enabled: false, reason: CONFLICT_MESSAGE[conflict].message } : { enabled: true }) : null,
    reject: lenderPending,
    pay: role === 'borrower' && status === 'awaiting_payment' && holdSeconds > 0,
    receipt: hasPaymentRecord,
  };
}

/** Rejection reasons the lender can pick (they can still type their own). */
export const REJECT_REASONS = [
  'I need the item myself on those dates.',
  'The item isn’t in rentable condition right now.',
  'I can’t meet at the pickup point on those dates.',
] as const;

export function checkRejectReason(reason: string): string | null {
  const r = reason.trim();
  if (r.length < 3) return 'Give the borrower a short reason.';
  if (r.length > 300) return 'Keep the reason under 300 characters.';
  return null;
}

export type RequestRow = { status: BookingStatus };

/** Lender inbox sections. Order inside each comes from the server. */
export function groupRequests<T extends RequestRow>(rows: readonly T[]): { pending: T[]; awaiting: T[]; recent: T[] } {
  return {
    pending: rows.filter((r) => r.status === 'pending_lender_approval'),
    awaiting: rows.filter((r) => r.status === 'awaiting_payment'),
    recent: rows.filter((r) => r.status !== 'pending_lender_approval' && r.status !== 'awaiting_payment'),
  };
}
