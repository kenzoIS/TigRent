import path from 'path';
import { renderRouter, screen } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import { __setSessionForTests } from '@/features/auth/session';
import { ok } from '@/lib/errors';
import { bookingsRepository, ledgerRepository, listingsRepository, notificationInboxRepository } from '@/repositories';

jest.mock('@/repositories', () => ({
  trustRepository: { prompts: jest.fn(async () => ({ ok: true, data: [] })) },
  bookingsRepository: { listMine: jest.fn() },
  listingsRepository: { listByLender: jest.fn() },
  ledgerRepository: { myPayables: jest.fn() },
  notificationInboxRepository: { unreadCount: jest.fn() },
  profilesRepository: { updateMine: jest.fn() },
}));

const APP_DIR = path.resolve(__dirname, '../../app');

beforeEach(() => {
  __setSessionForTests(
    { kind: 'signed_in', roles: ['lender'], verification: 'verified', accountStatus: 'active', termsAccepted: true, activeRole: null },
    { context: { userId: 'u1', fullName: 'Leo Reyes', accountStatus: 'active', statusReason: null, activeRolePref: null, roles: ['lender'], verificationStatus: 'verified', pendingTerms: [] } },
  );
  jest.mocked(bookingsRepository.listMine).mockResolvedValue(ok([]));
  jest.mocked(listingsRepository.listByLender).mockResolvedValue(ok([]));
  jest.mocked(ledgerRepository.myPayables).mockResolvedValue(ok([]));
  jest.mocked(notificationInboxRepository.unreadCount).mockResolvedValue(ok(0));
});
afterAll(() => __setSessionForTests(null));

it('shows Tiggy beside the greeting with a tip hint that opens and closes in place', async () => {
  const user = userEvent.setup();
  await renderRouter(APP_DIR, { initialUrl: '/lender' });
  expect(await screen.findByText('Hi, Leo')).toBeOnTheScreen();
  expect(screen.queryByTestId('tiggy-bubble')).not.toBeOnTheScreen();
  await user.press(await screen.findByRole('button', { name: 'Show Tiggy’s tip' }));
  expect(screen.getByText(/List an item you aren’t using/)).toBeOnTheScreen();
  // The toggle row stays (relabelled) so the greeting column keeps its height and doesn't shift.
  expect(screen.getByTestId('tiggy-hint')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Hide Tiggy’s tip' }));
  expect(screen.queryByTestId('tiggy-bubble')).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Show Tiggy’s tip' }));
  await user.press(screen.getByRole('button', { name: "Dismiss Tiggy's tip" }));
  expect(screen.queryByTestId('tiggy-bubble')).not.toBeOnTheScreen();
  // Tapping Tiggy himself also toggles the tip; the hint row is still there.
  await user.press(screen.getByRole('button', { name: /Tiggy, the TigRent tiger/ }));
  expect(screen.getByTestId('tiggy-bubble')).toBeOnTheScreen();
  expect(screen.getByTestId('tiggy-hint')).toBeOnTheScreen();
});
