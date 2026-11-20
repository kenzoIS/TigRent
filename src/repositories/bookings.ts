import type { BookingStatus } from '@/domain/entities';
import { asConflict, type BookingRole, type RequestConflict } from '@/domain/bookings';
import type { DisputeCategory, DisputeStatus } from '@/domain/exceptions';
import type { ExtensionStatus } from '@/domain/rental';
import type { DateOnly } from '@/lib/dates';
import type { Centavos } from '@/lib/money';
import { getSupabase } from '@/lib/supabase';
import { AppError, fail, ok, toAppError, type Result } from '@/lib/errors';
import { run } from './base';

export type BookingEvent = {
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  /** Non-status history entries (handover steps, extensions…); null for status changes. */
  kind: string | null;
  meta: Record<string, unknown>;
  reason: string | null;
  byMe: boolean;
  at: string;
};
export type BookingPayment = {
  id: string;
  purpose: 'booking' | 'extension';
  status: 'pending' | 'succeeded' | 'failed' | 'expired';
  amount: Centavos;
  provider: string;
  providerRef: string | null;
  failureReason: string | null;
  processedAt: string | null;
  createdAt: string;
};

export type ExtensionItem = {
  id: string;
  status: ExtensionStatus;
  oldReturnDate: DateOnly;
  newReturnDate: DateOnly;
  extraDays: number;
  extraAmount: Centavos;
  extraCommission: Centavos;
  holdExpiresAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  /** Lender/staff only: why approval is blocked right now. */
  conflict: 'dates_taken' | 'dates_blocked' | null;
};

export type HandoverInfo = {
  lenderConfirmedAt: string | null;
  lenderNotes: string | null;
  borrowerConfirmedAt: string | null;
  borrowerNotes: string | null;
  photoPaths: string[];
};

export type ReturnInfo = {
  requestedAt: string | null;
  borrowerNotes: string | null;
  borrowerPhotoPaths: string[];
  inspectedAt: string | null;
  outcome: string | null;
  lenderNotes: string | null;
  lenderPhotoPaths: string[];
  lateDays: number;
  lateFee: Centavos;
};

/** One booking as its party sees it (server `get_booking_detail`). */
export type BookingDetail = {
  id: string;
  myRole: BookingRole;
  status: BookingStatus;
  listingId: string;
  listingStatus: string | null;
  pickupDate: DateOnly;
  returnDate: DateOnly;
  rentalDays: number;
  dueAt: string;
  pickupArrangement: string | null;
  snapshot: {
    listingTitle: string;
    categoryLabel: string | null;
    condition: string | null;
    pickupPoint: string | null;
    pickupNotes: string | null;
    coverPath: string | null;
    returnDueTimeLocal: string;
    policyLabel: string | null;
    policyIsSample: boolean;
  };
  dailyRate: Centavos;
  subtotal: Centavos;
  deposit: Centavos;
  total: Centavos;
  lateFeePerDay: Centavos;
  commissionBps: number;
  commission: Centavos;
  lenderNet: Centavos;
  holdExpiresAt: string | null;
  /** Server clock at read time; countdowns are measured against it (plan §10.1). */
  serverNow: string;
  /** Local clock when the response arrived. */
  fetchedAtMs: number;
  decisionReason: string | null;
  cancelReason: string | null;
  createdAt: string;
  conflict: RequestConflict | null;
  counterpart: { id: string; role: 'borrower' | 'lender'; fullName: string; isStudentVerified: boolean; ratingAvg: number | null; ratingCount: number };
  terms: { title: string; version: number; isSample: boolean; acceptedAt: string } | null;
  events: BookingEvent[];
  payments: BookingPayment[];
  activatedAt: string | null;
  returnedAt: string | null;
  completedAt: string | null;
  handoverOpensOn: DateOnly;
  /** Started late days so far (active/overdue) or at the submitted return. */
  lateDaysNow: number;
  conversationId: string | null;
  handover: HandoverInfo | null;
  returnInfo: ReturnInfo | null;
  extensions: ExtensionItem[];
  refunds: { id: string; amount: Centavos; reason: string; status: string; processedAt: string | null }[];
  /** Agreed late fee for the started late days so far (or at the return). */
  lateFeeNow: Centavos;
  /** Latest dispute on this booking, if any. */
  dispute: { id: string; status: DisputeStatus; category: DisputeCategory } | null;
};

/** Server cancellation preview (policy version stored on the booking). */
export type CancellationQuote = {
  allowed: boolean;
  reason: string | null;
  rule: string | null;
  policyLabel: string | null;
  policyIsSample: boolean;
  paid: Centavos;
  rentPaid: Centavos;
  depositPaid: Centavos;
  rentRefundPct: number | null;
  depositRefundPct: number | null;
  rentRefund: Centavos;
  depositRefund: Centavos;
  refundTotal: Centavos;
  rentKept: Centavos;
  lenderNetAfter: Centavos;
  explanation: string;
};

export type RequestInboxRow = {
  id: string;
  listingId: string;
  listingTitle: string;
  coverPath: string | null;
  borrowerName: string;
  pickupDate: DateOnly;
  returnDate: DateOnly;
  rentalDays: number;
  subtotal: Centavos;
  lenderNet: Centavos;
  status: BookingStatus;
  holdExpiresAt: string | null;
  createdAt: string;
  conflict: RequestConflict | null;
};

export type ExtensionInboxRow = {
  id: string;
  bookingId: string;
  listingTitle: string;
  borrowerName: string;
  oldReturnDate: DateOnly;
  newReturnDate: DateOnly;
  extraDays: number;
  extraAmount: Centavos;
  status: ExtensionStatus;
  holdExpiresAt: string | null;
  conflict: 'dates_taken' | 'dates_blocked' | null;
};

export type BookingRequestInput = {
  listingId: string;
  pickup: DateOnly;
  ret: DateOnly;
  termsVersionId: string;
  /** The total the borrower saw; the server refuses if the price changed meanwhile. */
  expectedTotal: Centavos;
  pickupArrangement?: string;
};

export type DecisionResult = { status: BookingStatus; holdExpiresAt: string | null; repeated: boolean };
export type StepResult = { status: BookingStatus; repeated: boolean };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const toStep = (json: unknown): StepResult => {
  const r = (json ?? {}) as Record<string, unknown>;
  return { status: r.status as BookingStatus, repeated: r.repeated === true };
};
const extensionConflict = (v: unknown) => (v === 'dates_taken' || v === 'dates_blocked' ? v : null);

export function toBookingDetail(json: unknown, fetchedAtMs: number): BookingDetail {
  const r = (json ?? {}) as Record<string, unknown>;
  const s = (r.snapshot ?? {}) as Record<string, unknown>;
  const c = (r.counterpart ?? {}) as Record<string, unknown>;
  const t = r.terms as Record<string, unknown> | null | undefined;
  const h = r.handover as Record<string, unknown> | null | undefined;
  const ret = r.return as Record<string, unknown> | null | undefined;
  return {
    id: String(r.id),
    myRole: (r.my_role as BookingRole) ?? 'borrower',
    status: r.status as BookingStatus,
    listingId: String(r.listing_id),
    listingStatus: str(r.listing_status),
    pickupDate: String(r.pickup_date),
    returnDate: String(r.return_date),
    rentalDays: num(r.rental_days),
    dueAt: String(r.due_at),
    pickupArrangement: str(r.pickup_arrangement),
    snapshot: {
      listingTitle: str(s.listing_title) ?? '',
      categoryLabel: str(s.category_label),
      condition: str(s.condition),
      pickupPoint: str(s.pickup_point),
      pickupNotes: str(s.pickup_notes),
      coverPath: str(s.cover_path),
      // Older (seeded) snapshots store "23:59:00".
      returnDueTimeLocal: (str(s.return_due_time_local) ?? '23:59').slice(0, 5),
      policyLabel: str(s.policy_label),
      policyIsSample: s.policy_is_sample !== false,
    },
    dailyRate: num(r.daily_rate),
    subtotal: num(r.subtotal),
    deposit: num(r.deposit),
    total: num(r.total),
    lateFeePerDay: num(r.late_fee_per_day),
    commissionBps: num(r.commission_bps),
    commission: num(r.commission),
    lenderNet: num(r.lender_net),
    holdExpiresAt: str(r.hold_expires_at),
    serverNow: str(r.server_now) ?? new Date(fetchedAtMs).toISOString(),
    fetchedAtMs,
    decisionReason: str(r.decision_reason),
    cancelReason: str(r.cancel_reason),
    createdAt: String(r.created_at),
    conflict: asConflict(r.conflict),
    counterpart: {
      id: String(c.id ?? ''),
      role: c.role === 'borrower' ? 'borrower' : 'lender',
      fullName: str(c.full_name) ?? 'TigRent member',
      isStudentVerified: c.is_student_verified === true,
      ratingAvg: c.rating_avg === null || c.rating_avg === undefined ? null : Number(c.rating_avg),
      ratingCount: num(c.rating_count),
    },
    terms: t ? { title: String(t.title ?? ''), version: num(t.version), isSample: t.is_sample !== false, acceptedAt: String(t.accepted_at ?? '') } : null,
    events: ((r.events as Record<string, unknown>[]) ?? []).map((e) => ({
      fromStatus: (e.from_status as BookingStatus | null) ?? null,
      toStatus: e.to_status as BookingStatus,
      kind: str(e.kind),
      meta: (e.meta as Record<string, unknown>) ?? {},
      reason: str(e.reason),
      byMe: e.by_me === true,
      at: String(e.at),
    })),
    payments: ((r.payments as Record<string, unknown>[]) ?? []).map((p) => ({
      id: String(p.id),
      purpose: p.purpose === 'extension' ? ('extension' as const) : ('booking' as const),
      status: p.status as BookingPayment['status'],
      amount: num(p.amount),
      provider: String(p.provider ?? 'mock'),
      providerRef: str(p.provider_ref),
      failureReason: str(p.failure_reason),
      processedAt: str(p.processed_at),
      createdAt: String(p.created_at),
    })),
    activatedAt: str(r.activated_at),
    returnedAt: str(r.returned_at),
    completedAt: str(r.completed_at),
    handoverOpensOn: str(r.handover_opens_on) ?? String(r.pickup_date),
    lateDaysNow: num(r.late_days_now),
    lateFeeNow: num(r.late_fee_now),
    dispute: r.dispute ? { id: String((r.dispute as Record<string, unknown>).id), status: (r.dispute as Record<string, unknown>).status as DisputeStatus, category: (r.dispute as Record<string, unknown>).category as DisputeCategory } : null,
    conversationId: str(r.conversation_id),
    handover: h
      ? {
          lenderConfirmedAt: str(h.lender_confirmed_at),
          lenderNotes: str(h.lender_notes),
          borrowerConfirmedAt: str(h.borrower_confirmed_at),
          borrowerNotes: str(h.borrower_notes),
          photoPaths: strs(h.photo_paths),
        }
      : null,
    returnInfo: ret
      ? {
          requestedAt: str(ret.requested_at),
          borrowerNotes: str(ret.borrower_notes),
          borrowerPhotoPaths: strs(ret.borrower_photo_paths),
          inspectedAt: str(ret.inspected_at),
          outcome: str(ret.outcome),
          lenderNotes: str(ret.lender_notes),
          lenderPhotoPaths: strs(ret.lender_photo_paths),
          lateDays: num(ret.late_days),
          lateFee: num(ret.late_fee),
        }
      : null,
    extensions: ((r.extensions as Record<string, unknown>[]) ?? []).map((e) => ({
      id: String(e.id),
      status: e.status as ExtensionStatus,
      oldReturnDate: String(e.old_return_date),
      newReturnDate: String(e.new_return_date),
      extraDays: num(e.extra_days),
      extraAmount: num(e.extra_amount),
      extraCommission: num(e.extra_commission),
      holdExpiresAt: str(e.hold_expires_at),
      decisionReason: str(e.decision_reason),
      createdAt: String(e.created_at),
      conflict: extensionConflict(e.conflict),
    })),
    refunds: ((r.refunds as Record<string, unknown>[]) ?? []).map((f) => ({
      id: String(f.id),
      amount: num(f.amount),
      reason: String(f.reason ?? ''),
      status: String(f.status ?? ''),
      processedAt: str(f.processed_at),
    })),
  };
}

export function toCancellationQuote(json: unknown): CancellationQuote {
  const r = (json ?? {}) as Record<string, unknown>;
  return {
    allowed: r.allowed === true,
    reason: str(r.reason),
    rule: str(r.rule),
    policyLabel: str(r.policy_label),
    policyIsSample: r.policy_is_sample !== false,
    paid: num(r.paid),
    rentPaid: num(r.rent_paid),
    depositPaid: num(r.deposit_paid),
    rentRefundPct: r.rent_refund_pct === null || r.rent_refund_pct === undefined ? null : num(r.rent_refund_pct),
    depositRefundPct: r.deposit_refund_pct === null || r.deposit_refund_pct === undefined ? null : num(r.deposit_refund_pct),
    rentRefund: num(r.rent_refund),
    depositRefund: num(r.deposit_refund),
    refundTotal: num(r.refund_total),
    rentKept: num(r.rent_kept),
    lenderNetAfter: num(r.lender_net_after),
    explanation: str(r.explanation) ?? '',
  };
}

/**
 * Time-based work runs lazily on server time (decisions D57, D64): `process_due_events` releases lapsed
 * holds, marks overdue rentals and sends due reminders, all idempotently. Its outcome only refreshes
 * statuses, so a failed run never blocks reading: the read itself reports errors.
 */
async function sweep(): Promise<void> {
  // Built inside the promise so even a synchronous client error becomes a (deliberately ignored) failed Result.
  await run(Promise.resolve().then(() => getSupabase().rpc('process_due_events')), (n) => n);
}

export const bookingFlowRepository = {
  sweep,

  request: (input: BookingRequestInput) =>
    run(
      getSupabase().rpc('request_booking', {
        p_listing_id: input.listingId,
        p_pickup: input.pickup,
        p_return: input.ret,
        p_terms_version_id: input.termsVersionId,
        p_expected_total: input.expectedTotal,
        p_pickup_arrangement: input.pickupArrangement?.trim() || null,
      }),
      (id) => id as string,
    ),

  decide: (bookingId: string, decision: 'accept' | 'reject', reason?: string) =>
    run(getSupabase().rpc('decide_booking_request', { p_booking_id: bookingId, p_decision: decision, p_reason: reason?.trim() || null }), (json): DecisionResult => {
      const r = json as Record<string, unknown>;
      return { status: r.status as BookingStatus, holdExpiresAt: str(r.hold_expires_at), repeated: r.repeated === true };
    }),

  detail: async (bookingId: string) => {
    await sweep();
    return run(getSupabase().rpc('get_booking_detail', { p_booking_id: bookingId }), (json) => toBookingDetail(json, Date.now()));
  },

  confirmHandover: (bookingId: string, notes?: string, photoPaths: string[] = []) =>
    run(getSupabase().rpc('confirm_handover', { p_booking_id: bookingId, p_notes: notes?.trim() || null, p_photo_paths: photoPaths }), toStep),

  submitReturn: (bookingId: string, notes?: string, photoPaths: string[] = []) =>
    run(getSupabase().rpc('submit_return', { p_booking_id: bookingId, p_notes: notes?.trim() || null, p_photo_paths: photoPaths }), toStep),

  confirmCleanReturn: (bookingId: string, notes?: string, photoPaths: string[] = []) =>
    run(getSupabase().rpc('confirm_clean_return', { p_booking_id: bookingId, p_notes: notes?.trim() || null, p_photo_paths: photoPaths }), toStep),

  requestExtension: (bookingId: string, newReturn: DateOnly) =>
    run(getSupabase().rpc('request_extension', { p_booking_id: bookingId, p_new_return: newReturn }), (id) => id as string),

  decideExtension: (extensionId: string, decision: 'approve' | 'reject', reason?: string) =>
    run(getSupabase().rpc('decide_extension', { p_extension_id: extensionId, p_decision: decision, p_reason: reason?.trim() || null }), (json) => {
      const r = json as Record<string, unknown>;
      return { status: r.status as ExtensionStatus, holdExpiresAt: str(r.hold_expires_at), repeated: r.repeated === true };
    }),

  previewCancellation: (bookingId: string) =>
    run(getSupabase().rpc('preview_cancellation', { p_booking_id: bookingId }), toCancellationQuote),

  /** `expectedRefund` is the previewed total: the server refuses if the policy window moved meanwhile. */
  cancel: (bookingId: string, reason: string | undefined, expectedRefund: Centavos) =>
    run(getSupabase().rpc('cancel_booking', { p_booking_id: bookingId, p_reason: reason?.trim() || null, p_expected_refund: expectedRefund }), toCancellationQuote),

  reportReturnProblem: (bookingId: string, outcome: 'damaged' | 'incomplete', description: string, requested: Centavos, photoPaths: string[] = []) =>
    run(getSupabase().rpc('report_return_problem', { p_booking_id: bookingId, p_outcome: outcome, p_description: description.trim(), p_requested_amount: requested, p_photo_paths: photoPaths }), (id) => id as string),

  reportNotReturned: (bookingId: string, description: string, requested: Centavos) =>
    run(getSupabase().rpc('report_not_returned', { p_booking_id: bookingId, p_description: description.trim(), p_requested_amount: requested }), (id) => id as string),

  openDispute: (bookingId: string, category: 'not_as_described' | 'payment' | 'other', description: string, requested: Centavos, photoPaths: string[] = []) =>
    run(getSupabase().rpc('open_dispute', { p_booking_id: bookingId, p_category: category, p_description: description.trim(), p_requested_amount: requested, p_photo_paths: photoPaths }), (id) => id as string),

  extensionInbox: () =>
    run(getSupabase().rpc('list_extension_requests'), (rows) =>
      rows.map(
        (r): ExtensionInboxRow => ({
          id: r.id ?? '',
          bookingId: r.booking_id ?? '',
          listingTitle: r.listing_title ?? '',
          borrowerName: r.borrower_name ?? 'A student',
          oldReturnDate: r.old_return_date ?? '',
          newReturnDate: r.new_return_date ?? '',
          extraDays: r.extra_days ?? 0,
          extraAmount: r.extra_amount ?? 0,
          status: (r.status ?? 'pending') as ExtensionStatus,
          holdExpiresAt: r.hold_expires_at,
          conflict: extensionConflict(r.conflict),
        }),
      ),
    ),

  inbox: async () => {
    await sweep();
    return run(getSupabase().rpc('list_booking_requests'), (rows) =>
      rows.map(
        (r): RequestInboxRow => ({
          id: r.id ?? '',
          listingId: r.listing_id ?? '',
          listingTitle: r.listing_title ?? '',
          coverPath: r.cover_path,
          borrowerName: r.borrower_name ?? 'A student',
          pickupDate: r.pickup_date ?? '',
          returnDate: r.return_date ?? '',
          rentalDays: r.rental_days ?? 1,
          subtotal: r.subtotal ?? 0,
          lenderNet: r.lender_net ?? 0,
          status: (r.status ?? 'pending_lender_approval') as BookingStatus,
          holdExpiresAt: r.hold_expires_at,
          createdAt: r.created_at ?? '',
          conflict: asConflict(r.conflict),
        }),
      ),
    );
  },
};

/** Short-lived signed URLs for private handover/return photos (parties and staff only, via storage RLS). */
export async function signedEvidenceUrls(paths: string[]): Promise<Result<Record<string, string>>> {
  if (paths.length === 0) return ok({});
  try {
    const { data, error } = await getSupabase().storage.from('evidence').createSignedUrls(paths, 600);
    if (error) return fail(new AppError('forbidden', 'Photos couldn’t be loaded.'));
    const out: Record<string, string> = {};
    for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
    return ok(out);
  } catch (e) {
    return fail(toAppError(e));
  }
}
