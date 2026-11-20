import type { ListingSummary, ProfileSummary } from '@/domain/entities';
import { AppError, fail, ok, toAppError, type Result } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import { run } from './base';
import { toListingSummary } from './marketplace';

export type FeaturedListing = ListingSummary & { coverPath: string | null };

type RawSummary = {
  user_id: string;
  full_name: string;
  avatar_path: string | null;
  member_since: string;
  is_student_verified: boolean;
  completed_lendings: number;
  completed_borrowings: number;
  lender_rating: { avg: number | string | null; count: number };
  borrower_rating: { avg: number | string | null; count: number };
  badges: { code: 'student_verified' | 'trusted_lender'; label: string }[];
  trusted_lender: {
    earned: boolean;
    rule_is_sample: boolean;
    rule: { min_completed_lendings?: number; min_avg_rating?: number; no_unresolved_severe_disputes?: boolean };
    progress: { student_verified: boolean; account_in_good_standing: boolean; completed_lendings: number; avg_rating: number | string | null; unresolved_severe_disputes: number };
  };
};

const num = (v: number | string | null) => (v === null ? null : Number(v));

export const toProfileSummary = (json: Json): ProfileSummary => {
  const r = json as unknown as RawSummary;
  return {
    userId: r.user_id,
    fullName: r.full_name,
    avatarPath: r.avatar_path,
    memberSince: r.member_since,
    isStudentVerified: r.is_student_verified,
    completedLendings: r.completed_lendings,
    completedBorrowings: r.completed_borrowings,
    lenderRating: { avg: num(r.lender_rating.avg), count: r.lender_rating.count },
    borrowerRating: { avg: num(r.borrower_rating.avg), count: r.borrower_rating.count },
    badges: r.badges,
    trustedLender: {
      earned: r.trusted_lender.earned,
      ruleIsSample: r.trusted_lender.rule_is_sample,
      rule: {
        minCompletedLendings: r.trusted_lender.rule.min_completed_lendings ?? 5,
        minAvgRating: r.trusted_lender.rule.min_avg_rating ?? 4.5,
        noUnresolvedSevereDisputes: r.trusted_lender.rule.no_unresolved_severe_disputes ?? true,
      },
      progress: {
        studentVerified: r.trusted_lender.progress.student_verified,
        accountInGoodStanding: r.trusted_lender.progress.account_in_good_standing,
        completedLendings: r.trusted_lender.progress.completed_lendings,
        avgRating: num(r.trusted_lender.progress.avg_rating),
        unresolvedSevereDisputes: r.trusted_lender.progress.unresolved_severe_disputes,
      },
    },
  };
};

export const profileSummaryRepository = {
  /** Omit userId for the signed-in member. */
  get: (userId?: string) => run(getSupabase().rpc('get_profile_summary', { p_user_id: userId ?? null }), toProfileSummary),
};

export const ledgerRepository = {
  /**
   * My simulated lender earnings, net: rent payable after commission, minus cancellation/dispute refunds,
   * plus late fees and damage compensation (server `my_lender_earnings`). Returned as one entry so the
   * dashboard can sum it like before.
   */
  myPayables: (_userId: string) => run(getSupabase().rpc('my_lender_earnings'), (n) => [Number(n)]),
};

export const discoverRepository = {
  /** Featured active listings from other students (RLS: verified viewers only). */
  featured: (excludeLenderId: string, limit = 6) =>
    run(
      getSupabase()
        .from('listings')
        .select('id, lender_id, title, category, condition, daily_rate, deposit, late_fee_per_day, status, is_featured, listing_images(path, sort_order)')
        .eq('status', 'active')
        .eq('is_featured', true)
        .neq('lender_id', excludeLenderId)
        .order('published_at', { ascending: false })
        .limit(limit),
      (rows): FeaturedListing[] =>
        rows.map((row) => ({
          ...toListingSummary(row),
          coverPath: [...(row.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]?.path ?? null,
        })),
    ),
};

export const notificationInboxRepository = {
  unreadCount: async (): Promise<Result<number>> => {
    try {
      const { count, error } = await getSupabase().from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
      return error ? fail(toAppError(error)) : ok(count ?? 0);
    } catch (e) {
      return fail(toAppError(e));
    }
  },
  markAllRead: async (): Promise<Result<number>> => {
    try {
      const { data, error } = await getSupabase().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).select('id');
      return error ? fail(toAppError(error)) : ok(data?.length ?? 0);
    } catch (e) {
      return fail(e instanceof AppError ? e : toAppError(e));
    }
  },
};
