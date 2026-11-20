/**
 * Where a notification leads (plan §4.1 "notification detail/deep link"). Pure so it can be tested.
 * Booking notifications open the shared booking screen, which shows each party their own side.
 */
import type { AppNotification } from '@/domain/entities';

export type NotificationTarget = { kind: 'route'; href: string } | { kind: 'none' };

export function targetFor(n: Pick<AppNotification, 'type' | 'entityType' | 'entityId'>): NotificationTarget {
  switch (n.entityType) {
    case 'verification':
      return { kind: 'route', href: '/onboarding/status' };
    case 'profile':
      if (n.type === 'account.review') return n.entityId ? { kind: 'route', href: `/admin/accounts/${n.entityId}` } : { kind: 'none' };
      if (n.type.startsWith('account.') || n.type.startsWith('appeal.')) return { kind: 'route', href: '/restricted' };
      if (n.type.startsWith('review.')) return { kind: 'route', href: '/reviews' };
      return { kind: 'none' };
    case 'appeal':
      return { kind: 'route', href: '/admin/accounts' };
    case 'review':
      return { kind: 'route', href: '/admin/reviews' };
    case 'booking':
      return n.entityId ? { kind: 'route', href: `/booking/${n.entityId}` } : { kind: 'none' };
    case 'conversation':
      return n.entityId ? { kind: 'route', href: `/messages/${n.entityId}` } : { kind: 'none' };
    case 'listing':
      // Lender-side moderation notices open the lender's listing overview.
      return n.entityId ? { kind: 'route', href: `/manage/listings/${n.entityId}` } : { kind: 'none' };
    case 'dispute':
      return n.entityId ? { kind: 'route', href: `/dispute/${n.entityId}` } : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}
