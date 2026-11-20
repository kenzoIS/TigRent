/**
 * Ratings and account-health rules (plan §2.9, Phase 11). The server (migration 018) decides; these mirror
 * its rules for explanations, validation and tests.
 */
import type { AccountStatus } from '@/domain/entities';

export type AppealStatus = 'open' | 'under_review' | 'needs_info' | 'upheld' | 'lifted';

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  active: { label: 'Good standing', tone: 'success' },
  paused_pending_review: { label: 'Paused for review', tone: 'warning' },
  restricted: { label: 'Restricted', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

export const APPEAL_STATUS_LABEL: Record<AppealStatus, { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' }> = {
  open: { label: 'Appeal with a moderator', tone: 'info' },
  under_review: { label: 'Appeal under review', tone: 'info' },
  needs_info: { label: 'More information needed', tone: 'warning' },
  upheld: { label: 'Decision upheld', tone: 'neutral' },
  lifted: { label: 'Restriction lifted', tone: 'success' },
};

export const RATING_LABEL = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const;

export function ratingProblem(rating: number | null, comment: string): string | null {
  if (rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5) return 'Choose 1 to 5 stars.';
  if (comment.trim().length > 1000) return 'Keep the comment under 1,000 characters.';
  return null;
}

/** Same rule as the server's `account_health_metrics`: enough ratings AND a low average (never one rating). */
export function ruleMet(reviewCount: number, avg: number | null, rule: { minReviews: number; avgBelow: number }): boolean {
  return reviewCount >= rule.minReviews && avg !== null && avg < rule.avgBelow;
}

export function ruleSentence(rule: { minReviews: number; avgBelow: number }, isSample: boolean): string {
  return `${isSample ? 'Sample rule' : 'Rule'}: an account is paused for review when it has at least ${rule.minReviews} ratings averaging below ${rule.avgBelow} out of 5. One low rating never pauses an account.`;
}

/** Can the member send (or add to) an appeal right now? */
export function canAppeal(status: AccountStatus, appeal: { status: AppealStatus } | null): boolean {
  if (status === 'active') return false;
  return !appeal || appeal.status === 'needs_info' || appeal.status === 'upheld' || appeal.status === 'lifted';
}

export function averageOf(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100;
}
