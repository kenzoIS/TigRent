import { averageOf, canAppeal, ratingProblem, ruleMet, ruleSentence } from '@/domain/trust';
import { targetFor } from '@/features/notifications/targets';
import { toAccountHealth } from '@/repositories/trust';

const rule = { minReviews: 3, avgBelow: 2.5 };

describe('low-rating rule (sample)', () => {
  it('needs enough ratings AND a low average; one low rating never triggers it', () => {
    expect(ruleMet(1, 1, rule)).toBe(false);
    expect(ruleMet(2, 1, rule)).toBe(false);
    expect(ruleMet(3, averageOf([1, 1, 5]), rule)).toBe(true); // 2.33
    expect(ruleMet(3, averageOf([2, 3, 3]), rule)).toBe(false); // 2.67
    expect(ruleMet(4, 2.5, rule)).toBe(false); // "below" is strict
    expect(ruleMet(0, null, rule)).toBe(false);
  });
  it('is explained as a sample rule', () => {
    expect(ruleSentence(rule, true)).toMatch(/^Sample rule: .*at least 3 ratings averaging below 2.5.*One low rating never pauses/);
  });
});

describe('reviews and appeals', () => {
  it('validates stars and comment length', () => {
    expect(ratingProblem(null, '')).toMatch(/Choose 1 to 5/);
    expect(ratingProblem(6, '')).toMatch(/Choose 1 to 5/);
    expect(ratingProblem(4, 'x'.repeat(1001))).toMatch(/1,000/);
    expect(ratingProblem(5, 'Great')).toBeNull();
  });
  it('offers an appeal only when restricted and none is pending (or more info was asked)', () => {
    expect(canAppeal('active', null)).toBe(false);
    expect(canAppeal('paused_pending_review', null)).toBe(true);
    expect(canAppeal('paused_pending_review', { status: 'open' })).toBe(false);
    expect(canAppeal('restricted', { status: 'needs_info' })).toBe(true);
    expect(canAppeal('restricted', { status: 'upheld' })).toBe(true);
  });
  it('maps the server account-health payload', () => {
    const h = toAccountHealth({
      account_status: 'paused_pending_review', status_reason: 'Automatic review',
      metrics: { review_count: 3, avg_rating: 1.67, rule: { min_reviews: 3, avg_below: 2.5, action: 'paused_pending_review' }, rule_is_sample: true, rule_met: true },
      appeal: { id: 'a1', status: 'needs_info', reason: 'x', moderator_note: 'Send proof', created_at: '2026-11-20T00:00:00Z' },
      history: [{ from: 'active', to: 'paused_pending_review', reason: 'Automatic review', automatic: true, at: '2026-11-19T00:00:00Z' }],
      open_obligations: 1,
    });
    expect([h.metrics.ruleMet, h.metrics.avgRating, h.appeal?.status, h.history[0]?.automatic, h.openObligations]).toEqual([true, 1.67, 'needs_info', true, 1]);
  });
});

describe('notification links', () => {
  it('route account, appeal and review notices to the right screens', () => {
    expect(targetFor({ type: 'account.paused', entityType: 'profile', entityId: 'u1' })).toEqual({ kind: 'route', href: '/restricted' });
    expect(targetFor({ type: 'appeal.needs_info', entityType: 'profile', entityId: 'u1' })).toEqual({ kind: 'route', href: '/restricted' });
    expect(targetFor({ type: 'review.received', entityType: 'profile', entityId: 'u1' })).toEqual({ kind: 'route', href: '/reviews' });
    expect(targetFor({ type: 'account.review', entityType: 'profile', entityId: 'u7' })).toEqual({ kind: 'route', href: '/admin/accounts/u7' });
    expect(targetFor({ type: 'appeal.submitted', entityType: 'appeal', entityId: 'a1' })).toEqual({ kind: 'route', href: '/admin/accounts' });
    expect(targetFor({ type: 'review.reported', entityType: 'review', entityId: 'r1' })).toEqual({ kind: 'route', href: '/admin/reviews' });
  });
});
