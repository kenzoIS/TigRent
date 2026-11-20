import { targetFor } from '@/features/notifications/targets';

describe('notification deep links', () => {
  it('maps entity types to destinations', () => {
    expect(targetFor({ type: 'verification.approved', entityType: 'verification', entityId: 'v1' })).toEqual({ kind: 'route', href: '/onboarding/status' });
    expect(targetFor({ type: 'account.paused', entityType: 'profile', entityId: 'u1' })).toEqual({ kind: 'route', href: '/restricted' });
    expect(targetFor({ type: 'misc', entityType: null, entityId: null })).toEqual({ kind: 'none' });
  });
  it('opens the shared booking screen for every booking notification (either side)', () => {
    expect(targetFor({ type: 'booking.requested', entityType: 'booking', entityId: 'b1' })).toEqual({ kind: 'route', href: '/booking/b1' });
    expect(targetFor({ type: 'booking.paid', entityType: 'booking', entityId: 'b2' })).toEqual({ kind: 'route', href: '/booking/b2' });
    expect(targetFor({ type: 'booking.paid', entityType: 'booking', entityId: null })).toEqual({ kind: 'none' });
  });
});
