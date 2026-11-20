import type { AccountStatus } from '@/domain/entities';
import type { AppealStatus } from '@/domain/trust';
import { getSupabase } from '@/lib/supabase';
import { run, runMaybe } from './base';

export type ReviewDirection = 'borrower_to_lender' | 'lender_to_borrower';
export type ReviewItem = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  direction: ReviewDirection;
  reviewerFirstName: string;
  listingTitle: string;
  isMine: boolean;
  canReport: boolean;
  isReported: boolean;
  moderationStatus: 'visible' | 'under_review' | 'hidden';
};
export type ReviewPrompt = { bookingId: string; listingTitle: string; counterpartName: string; myRole: 'borrower' | 'lender'; completedAt: string; reviewUntil: string };
export type OwnReview = { id: string; rating: number; comment: string | null; createdAt: string; moderationStatus: string; isReported?: boolean };
export type BookingReviews = { canReview: boolean; reviewUntil: string | null; mine: OwnReview | null; theirs: OwnReview | null };

export type HealthMetrics = {
  reviewCount: number;
  avgRating: number | null;
  rule: { minReviews: number; avgBelow: number; action: string };
  ruleIsSample: boolean;
  ruleMet: boolean;
};
export type StatusEvent = { from: AccountStatus; to: AccountStatus; reason: string; automatic: boolean; at: string };
export type AppealInfo = { id: string; status: AppealStatus; reason: string; moderatorNote: string | null; createdAt: string; decidedAt: string | null };
export type AccountHealth = {
  accountStatus: AccountStatus;
  statusReason: string | null;
  metrics: HealthMetrics;
  appeal: AppealInfo | null;
  history: StatusEvent[];
  openObligations: number;
};
export type AccountQueueRow = {
  userId: string;
  fullName: string;
  accountStatus: AccountStatus;
  statusReason: string | null;
  reviewCount: number;
  avgRating: number | null;
  ruleMet: boolean;
  appealStatus: AppealStatus | null;
  openObligations: number;
};
export type AccountReview = AccountHealth & {
  userId: string;
  fullName: string;
  memberSince: string;
  reviews: { id: string; rating: number; comment: string | null; direction: ReviewDirection; createdAt: string; moderationStatus: string; isReported: boolean; reportReason: string | null }[];
};
export type ReportedReview = { id: string; rating: number; comment: string | null; direction: ReviewDirection; reportReason: string | null; reportedAt: string; reviewerName: string; targetId: string; targetName: string; listingTitle: string };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function toMetrics(json: unknown): HealthMetrics {
  const m = (json ?? {}) as Record<string, unknown>;
  const rule = (m.rule ?? {}) as Record<string, unknown>;
  return {
    reviewCount: num(m.review_count),
    avgRating: numOrNull(m.avg_rating),
    rule: { minReviews: num(rule.min_reviews ?? 3), avgBelow: num(rule.avg_below ?? 2.5), action: String(rule.action ?? 'paused_pending_review') },
    ruleIsSample: m.rule_is_sample !== false,
    ruleMet: m.rule_met === true,
  };
}

export function toAccountHealth(json: unknown): AccountHealth {
  const r = (json ?? {}) as Record<string, unknown>;
  const a = r.appeal as Record<string, unknown> | null | undefined;
  return {
    accountStatus: (r.account_status as AccountStatus) ?? 'active',
    statusReason: str(r.status_reason),
    metrics: toMetrics(r.metrics),
    appeal: a ? { id: String(a.id), status: a.status as AppealStatus, reason: String(a.reason ?? ''), moderatorNote: str(a.moderator_note), createdAt: String(a.created_at), decidedAt: str(a.decided_at) } : null,
    history: ((r.history as Record<string, unknown>[]) ?? []).map((e) => ({ from: e.from as AccountStatus, to: e.to as AccountStatus, reason: String(e.reason ?? ''), automatic: e.automatic === true, at: String(e.at) })),
    openObligations: num(r.open_obligations),
  };
}

const ownReview = (v: unknown): OwnReview | null => {
  if (!v) return null;
  const r = v as Record<string, unknown>;
  return { id: String(r.id), rating: num(r.rating), comment: str(r.comment), createdAt: String(r.created_at), moderationStatus: String(r.moderation_status ?? 'visible'), isReported: r.is_reported === true };
};

/** Reviews, account health, appeals and their moderation (plan §2.9, Phase 11). Every change is an RPC. */
export const trustRepository = {
  submitReview: (bookingId: string, rating: number, comment?: string) =>
    run(getSupabase().rpc('submit_review', { p_booking_id: bookingId, p_rating: rating, p_comment: comment?.trim() || null }), (id) => id as string),
  bookingReviews: (bookingId: string) =>
    run(getSupabase().rpc('get_booking_reviews', { p_booking_id: bookingId }), (json): BookingReviews => {
      const r = (json ?? {}) as Record<string, unknown>;
      return { canReview: r.can_review === true, reviewUntil: str(r.review_until), mine: ownReview(r.mine), theirs: ownReview(r.theirs) };
    }),
  prompts: () =>
    run(getSupabase().rpc('list_review_prompts'), (rows) =>
      rows.map((r): ReviewPrompt => ({
        bookingId: r.booking_id ?? '',
        listingTitle: r.listing_title ?? '',
        counterpartName: r.counterpart_name ?? 'TigRent member',
        myRole: r.my_role === 'lender' ? 'lender' : 'borrower',
        completedAt: r.completed_at ?? '',
        reviewUntil: r.review_until ?? '',
      })),
    ),
  listReviews: (userId: string, direction?: ReviewDirection) =>
    run(getSupabase().rpc('list_reviews', { p_user_id: userId, p_direction: direction ?? null }), (rows) =>
      rows.map((r): ReviewItem => ({
        id: r.id ?? '',
        rating: r.rating ?? 0,
        comment: r.comment,
        createdAt: r.created_at ?? '',
        direction: (r.direction ?? 'borrower_to_lender') as ReviewDirection,
        reviewerFirstName: r.reviewer_first_name ?? 'A student',
        listingTitle: r.listing_title ?? '',
        isMine: r.is_mine ?? false,
        canReport: r.can_report ?? false,
        isReported: r.is_reported ?? false,
        moderationStatus: (r.moderation_status ?? 'visible') as ReviewItem['moderationStatus'],
      })),
    ),
  reportReview: (reviewId: string, reason: string) => runMaybe(getSupabase().rpc('report_review', { p_review_id: reviewId, p_reason: reason.trim() }), () => true),
  myAccountHealth: () => run(getSupabase().rpc('get_my_account_health'), toAccountHealth),
  submitAppeal: (reason: string) => run(getSupabase().rpc('submit_account_appeal', { p_reason: reason.trim() }), (id) => id as string),

  // Staff
  accountQueue: () =>
    run(getSupabase().rpc('list_account_reviews'), (rows) =>
      rows.map((r): AccountQueueRow => ({
        userId: r.user_id ?? '',
        fullName: r.full_name ?? '',
        accountStatus: (r.account_status ?? 'active') as AccountStatus,
        statusReason: r.status_reason,
        reviewCount: r.review_count ?? 0,
        avgRating: r.avg_rating === null ? null : Number(r.avg_rating),
        ruleMet: r.rule_met ?? false,
        appealStatus: (r.appeal_status as AppealStatus | null) ?? null,
        openObligations: r.open_obligations ?? 0,
      })),
    ),
  accountReview: (userId: string) =>
    run(getSupabase().rpc('get_account_review', { p_user_id: userId }), (json): AccountReview => {
      const r = (json ?? {}) as Record<string, unknown>;
      return {
        ...toAccountHealth(json),
        userId: String(r.user_id),
        fullName: String(r.full_name ?? ''),
        memberSince: String(r.member_since ?? ''),
        reviews: ((r.reviews as Record<string, unknown>[]) ?? []).map((v) => ({
          id: String(v.id),
          rating: num(v.rating),
          comment: str(v.comment),
          direction: v.direction as ReviewDirection,
          createdAt: String(v.created_at),
          moderationStatus: String(v.moderation_status ?? 'visible'),
          isReported: v.is_reported === true,
          reportReason: str(v.report_reason),
        })),
      };
    }),
  moderateAccount: (userId: string, decision: 'lift' | 'restrict' | 'suspend' | 'request_info', note: string) =>
    run(getSupabase().rpc('moderate_account', { p_user_id: userId, p_decision: decision, p_note: note.trim() }), (json) => {
      const r = (json ?? {}) as Record<string, unknown>;
      return { accountStatus: r.account_status as AccountStatus, appealStatus: (r.appeal_status as AppealStatus | null) ?? null };
    }),
  reportedReviews: () =>
    run(getSupabase().rpc('list_reported_reviews'), (rows) =>
      rows.map((r): ReportedReview => ({
        id: r.id ?? '',
        rating: r.rating ?? 0,
        comment: r.comment,
        direction: (r.direction ?? 'borrower_to_lender') as ReviewDirection,
        reportReason: r.report_reason,
        reportedAt: r.reported_at ?? '',
        reviewerName: r.reviewer_name ?? '',
        targetId: r.target_id ?? '',
        targetName: r.target_name ?? '',
        listingTitle: r.listing_title ?? '',
      })),
    ),
  moderateReview: (reviewId: string, action: 'keep' | 'hide' | 'restore', note: string) =>
    runMaybe(getSupabase().rpc('moderate_review', { p_review_id: reviewId, p_action: action, p_note: note.trim() }), () => true),
};
