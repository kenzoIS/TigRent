import { canEnterArea, resolveHome, type SessionState } from '@/features/auth/route-resolver';

const base: Extract<SessionState, { kind: 'signed_in' }> = {
  kind: 'signed_in',
  roles: ['borrower'],
  verification: 'verified',
  accountStatus: 'active',
  termsAccepted: true,
  activeRole: null,
};

describe('resolveHome', () => {
  it('routes non-signed-in states', () => {
    expect(resolveHome({ kind: 'loading' })).toBe('/loading');
    expect(resolveHome({ kind: 'signed_out' })).toBe('/welcome');
    expect(resolveHome({ kind: 'email_unconfirmed' })).toBe('/check-email');
  });

  it('requires current terms before anything else for students', () => {
    expect(resolveHome({ ...base, termsAccepted: false })).toBe('/onboarding/terms');
  });

  it('routes every verification status (plan §2.2)', () => {
    expect(resolveHome({ ...base, verification: 'not_submitted' })).toBe('/onboarding/verification');
    for (const v of ['pending_review', 'rejected', 'needs_resubmission', 'expired'] as const) {
      expect(resolveHome({ ...base, verification: v })).toBe('/onboarding/status');
    }
  });

  it('sends restricted/paused/suspended accounts to the restricted screen (plan §2.9)', () => {
    for (const a of ['paused_pending_review', 'restricted', 'suspended'] as const) {
      expect(resolveHome({ ...base, accountStatus: a })).toBe('/restricted');
    }
  });

  it('routes by enabled role; active role only chooses between enabled roles (plan §2.1)', () => {
    expect(resolveHome({ ...base, roles: ['borrower'], activeRole: 'lender' })).toBe('/borrower');
    expect(resolveHome({ ...base, roles: ['lender'] })).toBe('/lender');
    expect(resolveHome({ ...base, roles: ['borrower', 'lender'], activeRole: 'lender' })).toBe('/lender');
    expect(resolveHome({ ...base, roles: ['borrower', 'lender'], activeRole: null })).toBe('/borrower');
    expect(resolveHome({ ...base, roles: [] })).toBe('/onboarding/status');
  });

  it('routes admins/moderators to the admin area', () => {
    expect(resolveHome({ ...base, roles: ['admin'], verification: 'not_submitted' })).toBe('/admin');
    expect(resolveHome({ ...base, roles: ['moderator'] })).toBe('/admin');
  });
});

describe('canEnterArea (deep-link guard)', () => {
  it('blocks role areas that are not enabled, regardless of the UI preference', () => {
    expect(canEnterArea({ ...base, roles: ['borrower'], activeRole: 'lender' }, 'lender')).toBe(false);
    expect(canEnterArea({ ...base, roles: ['borrower'] }, 'borrower')).toBe(true);
  });

  it('blocks unverified students and non-admins', () => {
    expect(canEnterArea({ ...base, verification: 'pending_review' }, 'borrower')).toBe(false);
    expect(canEnterArea(base, 'admin')).toBe(false);
    expect(canEnterArea({ kind: 'signed_out' }, 'borrower')).toBe(false);
  });
});
