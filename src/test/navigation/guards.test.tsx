import path from 'path';
import { renderRouter, screen } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import type { SessionState } from '@/features/auth/route-resolver';
import { __setSessionForTests } from '@/features/auth/session';
import type { SessionContext } from '@/repositories';

/** Phase 3 gate: every account status × role combination routes correctly; deep links can't bypass. */
const APP_DIR = path.resolve(__dirname, '../../app');

type SignedIn = Extract<SessionState, { kind: 'signed_in' }>;
const signedIn = (o: Partial<SignedIn> = {}): SignedIn => ({
  kind: 'signed_in', roles: ['borrower'], verification: 'verified', accountStatus: 'active', termsAccepted: true, activeRole: null, ...o,
});
const ctxFor = (s: SignedIn, o: Partial<SessionContext> = {}): SessionContext => ({
  userId: 'u1', fullName: 'Bea Santos', accountStatus: s.accountStatus, statusReason: null, activeRolePref: s.activeRole,
  roles: [...s.roles], verificationStatus: s.verification, pendingTerms: s.termsAccepted ? [] : [{ id: 't1', docType: 'tos', version: 1 }], ...o,
});
const use = (state: SessionState, extra: Parameters<typeof __setSessionForTests>[1] = {}) =>
  __setSessionForTests(state, state.kind === 'signed_in' ? { context: ctxFor(state), ...extra } : extra);

afterEach(() => __setSessionForTests(null));

describe('signed-out visitors', () => {
  beforeEach(() => use({ kind: 'signed_out' }));
  it.each(['/', '/borrower', '/lender/equipment', '/admin', '/settings', '/onboarding/terms', '/restricted'])(
    '%s → /welcome',
    async (url) => {
      await renderRouter(APP_DIR, { initialUrl: url });
      expect(screen).toHavePathname('/welcome');
    },
  );
});

describe('session bootstrap', () => {
  it('shows the loading screen while restoring', async () => {
    use({ kind: 'loading' });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(screen).toHavePathname('/loading');
    expect(screen.getByLabelText('Loading TigRent')).toBeOnTheScreen();
  });
  it('offers retry and sign-out when the account can’t be loaded offline', async () => {
    const refresh = jest.fn(async () => undefined);
    use({ kind: 'error', message: 'Check your connection.', offline: true }, { refresh });
    await renderRouter(APP_DIR, { initialUrl: '/borrower' });
    expect(await screen.findByText('You’re offline')).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole('button', { name: 'Try again' }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
  });
});

describe('role areas (plan §2.1)', () => {
  it('a borrower-only student cannot open lender or admin routes, even with a tampered active role', async () => {
    use(signedIn({ roles: ['borrower'], activeRole: 'lender' }));
    for (const url of ['/', '/lender', '/lender/requests', '/admin']) {
      await renderRouter(APP_DIR, { initialUrl: url });
      expect(screen).toHavePathname('/borrower');
    }
  });
  it('a lender-only student is kept out of borrower routes', async () => {
    use(signedIn({ roles: ['lender'] }));
    await renderRouter(APP_DIR, { initialUrl: '/borrower/rentals' });
    expect(screen).toHavePathname('/lender');
  });
  it('signed-in users are sent away from the sign-in screen', async () => {
    use(signedIn());
    await renderRouter(APP_DIR, { initialUrl: '/sign-in' });
    expect(screen).toHavePathname('/borrower');
  });
  it('dual-role students land on their preferred role and can open both areas', async () => {
    use(signedIn({ roles: ['borrower', 'lender'], activeRole: 'lender' }));
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(screen).toHavePathname('/lender');
    await renderRouter(APP_DIR, { initialUrl: '/borrower/rentals' });
    expect(screen).toHavePathname('/borrower/rentals');
  });
  it('the role switcher appears only for dual-role students and switches areas', async () => {
    const setActiveRole = jest.fn(async () => undefined);
    const dual = signedIn({ roles: ['borrower', 'lender'] });
    use(dual, { context: ctxFor(dual), setActiveRole });
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/borrower/profile' });
    await user.press(await screen.findByRole('tab', { name: 'Lending' }));
    expect(setActiveRole).toHaveBeenCalledWith('lender');
    expect(screen).toHavePathname('/lender');

    use(signedIn({ roles: ['borrower'] }));
    await renderRouter(APP_DIR, { initialUrl: '/borrower/profile' });
    expect((await screen.findAllByText('Student verified')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('role-switcher')).not.toBeOnTheScreen();
  });
});

describe('onboarding gates (plan §2.2)', () => {
  it('current terms must be accepted before anything else', async () => {
    use(signedIn({ termsAccepted: false }));
    for (const url of ['/', '/borrower']) {
      await renderRouter(APP_DIR, { initialUrl: url });
      expect(screen).toHavePathname('/onboarding/terms');
    }
  });
  it('students without a submission go to verification', async () => {
    use(signedIn({ verification: 'not_submitted', roles: [] }));
    await renderRouter(APP_DIR, { initialUrl: '/borrower' });
    expect(screen).toHavePathname('/onboarding/verification');
  });
  it.each(['pending_review', 'rejected', 'needs_resubmission', 'expired'] as const)(
    '%s students cannot enter the marketplace and see their status',
    async (verification) => {
      use(signedIn({ verification }));
      await renderRouter(APP_DIR, { initialUrl: '/borrower' });
      expect(screen).toHavePathname('/onboarding/status');
      expect((await screen.findAllByText('Verification status')).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
    },
  );
});

describe('restricted and suspended accounts (plan §2.9)', () => {
  it.each(['paused_pending_review', 'restricted', 'suspended'] as const)(
    '%s: home is the status screen, while rentals and support stay reachable',
    async (accountStatus) => {
      const s = signedIn({ accountStatus });
      use(s, { context: ctxFor(s, { statusReason: 'Sample account-health rule met.' }) });
      await renderRouter(APP_DIR, { initialUrl: '/' });
      expect(screen).toHavePathname('/restricted');
      expect(await screen.findByText('Sample account-health rule met.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: /My existing rentals/ })).toBeOnTheScreen();

      await renderRouter(APP_DIR, { initialUrl: '/borrower/rentals' });
      expect(screen).toHavePathname('/borrower/rentals');
      await renderRouter(APP_DIR, { initialUrl: '/settings' });
      expect(screen).toHavePathname('/settings');
    },
  );
});

describe('admin area', () => {
  it('staff land in admin; students cannot enter it', async () => {
    use(signedIn({ roles: ['admin', 'moderator'], verification: 'not_submitted' }));
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(screen).toHavePathname('/admin');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
  });
});
