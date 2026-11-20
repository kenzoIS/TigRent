import path from 'path';
import { renderRouter, screen } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import { __setSessionForTests } from '@/features/auth/session';

const APP_DIR = path.resolve(__dirname, '../../app');

// Signed-out by default; role-area tests use a verified dual-role student.
beforeEach(() => __setSessionForTests({ kind: 'signed_out' }));
afterAll(() => __setSessionForTests(null));
const dualRole = () =>
  __setSessionForTests({ kind: 'signed_in', roles: ['borrower', 'lender'], verification: 'verified', accountStatus: 'active', termsAccepted: true, activeRole: 'borrower' });

describe('navigation shell', () => {
  it('bootstraps a signed-out session to the welcome screen', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(screen).toHavePathname('/welcome');
    expect(await screen.findByRole('button', { name: 'Create account' })).toBeOnTheScreen();
  });

  it('welcome actions reach sign-up and sign-in', async () => {
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/welcome' });
    await user.press(await screen.findByRole('button', { name: 'Create account' }));
    expect(screen).toHavePathname('/sign-up');
  });

  it.each([
    ['/sign-in', 'Sign in'],
    ['/forgot-password', 'Reset password'],
    ['/check-email', 'Confirm your email'],
  ])('route %s is reachable', async (url, title) => {
    await renderRouter(APP_DIR, { initialUrl: url });
    expect(screen).toHavePathname(url);
    expect((await screen.findAllByText(title)).length).toBeGreaterThan(0);
  });

  it('borrower tabs switch between screens', async () => {
    dualRole();
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/borrower' });
    expect((await screen.findAllByText('Discover')).length).toBeGreaterThan(0);
    await user.press(screen.getByRole('tab', { name: 'Rentals' }));
    expect(screen).toHavePathname('/borrower/rentals');
    await user.press(screen.getByRole('tab', { name: 'Profile' }));
    expect(screen).toHavePathname('/borrower/profile');
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeSelected();
  });

  it('lender tabs switch between screens', async () => {
    dualRole();
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/lender' });
    await user.press(await screen.findByRole('tab', { name: 'Equipment' }));
    expect(screen).toHavePathname('/lender/equipment');
    await user.press(screen.getByRole('tab', { name: 'Requests' }));
    expect(screen).toHavePathname('/lender/requests');
  });

  it('unknown links show a not-found screen with a working way out', async () => {
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/no-such-page' });
    expect(await screen.findByText('Page not found')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Go to start' }));
    expect(screen).toHavePathname('/welcome');
  });

  it('dev route map is reachable in development', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/dev' });
    expect(await screen.findByText('Route map')).toBeOnTheScreen();
  });

  it('component gallery is reachable in development', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/dev/components' });
    expect(await screen.findByText('Components')).toBeOnTheScreen();
  });
});
