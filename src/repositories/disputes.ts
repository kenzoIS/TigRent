import type { BookingStatus } from '@/domain/entities';
import type { DisputeCategory, DisputeStatus } from '@/domain/exceptions';
import type { DateOnly } from '@/lib/dates';
import type { Centavos } from '@/lib/money';
import { getSupabase } from '@/lib/supabase';
import { run, runMaybe } from './base';

export type DisputeRole = 'borrower' | 'lender' | 'staff';

export type DisputeDetail = {
  id: string;
  bookingId: string;
  myRole: DisputeRole;
  category: DisputeCategory;
  severity: 'minor' | 'major' | 'severe';
  status: DisputeStatus;
  description: string;
  requestedAmount: Centavos;
  decision: string | null;
  resolutionAmount: Centavos | null;
  decidedAt: string | null;
  createdAt: string;
  openedBy: DisputeRole;
  appealDeadline: string | null;
  canAppeal: boolean;
  booking: {
    status: BookingStatus;
    listingTitle: string;
    pickupDate: DateOnly;
    returnDate: DateOnly;
    dueAt: string;
    subtotal: Centavos;
    deposit: Centavos;
    lateFeePerDay: Centavos;
    lateDays: number;
    lateFee: Centavos;
    paid: Centavos;
    returnOutcome: string | null;
  };
  borrower: { id: string; fullName: string };
  lender: { id: string; fullName: string };
  messages: { id: string; body: string; at: string; byMe: boolean; senderRole: DisputeRole }[];
  evidence: { path: string; note: string | null; byRole: DisputeRole }[];
};

export type DisputeSummary = {
  id: string;
  bookingId: string;
  listingTitle: string;
  category: DisputeCategory;
  severity: 'minor' | 'major' | 'severe';
  status: DisputeStatus;
  requestedAmount: Centavos;
  borrowerName: string;
  lenderName: string;
  createdAt: string;
};

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const role = (v: unknown): DisputeRole => (v === 'lender' ? 'lender' : v === 'staff' ? 'staff' : 'borrower');

export function toDisputeDetail(json: unknown): DisputeDetail {
  const r = (json ?? {}) as Record<string, unknown>;
  const b = (r.booking ?? {}) as Record<string, unknown>;
  const person = (v: unknown) => {
    const p = (v ?? {}) as Record<string, unknown>;
    return { id: String(p.id ?? ''), fullName: str(p.full_name) ?? 'TigRent member' };
  };
  return {
    id: String(r.id),
    bookingId: String(r.booking_id),
    myRole: role(r.my_role),
    category: r.category as DisputeCategory,
    severity: (r.severity as DisputeDetail['severity']) ?? 'major',
    status: r.status as DisputeStatus,
    description: String(r.description ?? ''),
    requestedAmount: num(r.requested_amount),
    decision: str(r.decision),
    resolutionAmount: r.resolution_amount === null || r.resolution_amount === undefined ? null : num(r.resolution_amount),
    decidedAt: str(r.decided_at),
    createdAt: String(r.created_at),
    openedBy: role(r.opened_by),
    appealDeadline: str(r.appeal_deadline),
    canAppeal: r.can_appeal === true,
    booking: {
      status: b.status as BookingStatus,
      listingTitle: String(b.listing_title ?? ''),
      pickupDate: String(b.pickup_date ?? ''),
      returnDate: String(b.return_date ?? ''),
      dueAt: String(b.due_at ?? ''),
      subtotal: num(b.subtotal),
      deposit: num(b.deposit),
      lateFeePerDay: num(b.late_fee_per_day),
      lateDays: num(b.late_days),
      lateFee: num(b.late_fee),
      paid: num(b.paid),
      returnOutcome: str(b.return_outcome),
    },
    borrower: person(r.borrower),
    lender: person(r.lender),
    messages: ((r.messages as Record<string, unknown>[]) ?? []).map((m) => ({
      id: String(m.id),
      body: String(m.body ?? ''),
      at: String(m.at),
      byMe: m.by_me === true,
      senderRole: role(m.sender_role),
    })),
    evidence: ((r.evidence as Record<string, unknown>[]) ?? []).map((e) => ({ path: String(e.path), note: str(e.note), byRole: role(e.by_role) })),
  };
}

/** Disputes (plan §2.7): parties and staff only; every change is a server RPC. */
export const disputesRepository = {
  get: (id: string) => run(getSupabase().rpc('get_dispute', { p_dispute_id: id }), toDisputeDetail),
  list: (openOnly = true) =>
    run(getSupabase().rpc('list_disputes', { p_open_only: openOnly }), (rows) =>
      rows.map(
        (r): DisputeSummary => ({
          id: r.id ?? '',
          bookingId: r.booking_id ?? '',
          listingTitle: r.listing_title ?? '',
          category: (r.category ?? 'other') as DisputeCategory,
          severity: (r.severity ?? 'major') as DisputeSummary['severity'],
          status: (r.status ?? 'open') as DisputeStatus,
          requestedAmount: r.requested_amount ?? 0,
          borrowerName: r.borrower_name ?? '',
          lenderName: r.lender_name ?? '',
          createdAt: r.created_at ?? '',
        }),
      ),
    ),
  respond: (id: string, body: string, photoPaths: string[] = [], requestFrom: 'borrower' | 'lender' | null = null) =>
    runMaybe(getSupabase().rpc('respond_to_dispute', { p_dispute_id: id, p_body: body.trim(), p_photo_paths: photoPaths, p_request_from: requestFrom }), () => true),
  resolve: (id: string, depositToLender: Centavos, rentRefund: Centavos, bookingOutcome: 'completed' | 'cancelled', decision: string) =>
    run(getSupabase().rpc('resolve_dispute', { p_dispute_id: id, p_deposit_to_lender: depositToLender, p_rent_refund: rentRefund, p_booking_outcome: bookingOutcome, p_decision: decision.trim() }), (json) => {
      const r = json as Record<string, unknown>;
      return { status: r.status as DisputeStatus, repeated: r.repeated === true };
    }),
  appeal: (id: string, reason: string) => runMaybe(getSupabase().rpc('appeal_dispute', { p_dispute_id: id, p_reason: reason.trim() }), () => true),
  decideAppeal: (id: string, note: string) => runMaybe(getSupabase().rpc('decide_appeal', { p_dispute_id: id, p_note: note.trim() }), () => true),
};
