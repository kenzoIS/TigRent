import path from 'path';
import { renderRouter, screen } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import { __setSessionForTests } from '@/features/auth/session';
import { AppError, fail, ok } from '@/lib/errors';
import { sessionRepository, termsRepository, type SessionContext } from '@/repositories';

jest.mock('@/repositories', () => ({
  termsRepository: { listActive: jest.fn() },
  sessionRepository: { acceptTerms: jest.fn() },
  profilesRepository: { updateMine: jest.fn() },
  // The next onboarding step (verification form) loads these once terms are accepted.
  verificationRepository: { getRules: jest.fn(() => new Promise(() => undefined)), listMine: jest.fn(() => new Promise(() => undefined)) },
  academicYearsRepository: { list: jest.fn(() => new Promise(() => undefined)) },
}));
const terms = jest.mocked(termsRepository);
const session = jest.mocked(sessionRepository);
const APP_DIR = path.resolve(__dirname, '../../app');

const DOCS = [
  { id: 'tos-1', docType: 'tos' as const, version: 1, title: 'TigRent Terms of Service (prototype)', content: 'Terms text', isSample: true },
  { id: 'priv-1', docType: 'privacy' as const, version: 1, title: 'TigRent Privacy Notice (prototype)', content: 'Privacy text', isSample: true },
];
const ctx: SessionContext = {
  userId: 'u1', fullName: 'New Student', accountStatus: 'active', statusReason: null, activeRolePref: null, roles: [],
  verificationStatus: 'not_submitted', pendingTerms: [{ id: 'tos-1', docType: 'tos', version: 1 }, { id: 'priv-1', docType: 'privacy', version: 1 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  terms.listActive.mockResolvedValue(ok(DOCS));
});
afterAll(() => __setSessionForTests(null));

it('requires the checkbox, then records acceptance of the displayed versions', async () => {
  const applyContext = jest.fn();
  __setSessionForTests(
    { kind: 'signed_in', roles: [], verification: 'not_submitted', accountStatus: 'active', termsAccepted: false, activeRole: null },
    { context: ctx, applyContext },
  );
  session.acceptTerms.mockResolvedValue(ok({ ...ctx, pendingTerms: [] }));
  const user = userEvent.setup();
  await renderRouter(APP_DIR, { initialUrl: '/onboarding/terms' });
  expect(await screen.findByText('TigRent Privacy Notice (prototype)')).toBeOnTheScreen();
  expect(screen.getAllByText('Prototype text, not legally reviewed').length).toBe(2);

  await user.press(screen.getByTestId('terms-accept'));
  expect(screen.getByText('Please confirm that you have read and accept both documents.')).toBeOnTheScreen();
  expect(session.acceptTerms).not.toHaveBeenCalled();

  await user.press(screen.getByRole('checkbox'));
  await user.press(screen.getByTestId('terms-accept'));
  expect(session.acceptTerms).toHaveBeenCalledWith(['tos-1', 'priv-1']);
  expect(applyContext).toHaveBeenCalledWith(expect.objectContaining({ pendingTerms: [] }));
  // With terms accepted and no submission yet, the student moves on to verification.
  expect(screen).toHavePathname('/onboarding/verification');
});

it('reloads the documents when the server reports a newer version', async () => {
  __setSessionForTests(
    { kind: 'signed_in', roles: [], verification: 'not_submitted', accountStatus: 'active', termsAccepted: false, activeRole: null },
    { context: ctx },
  );
  session.acceptTerms.mockResolvedValue(fail(new AppError('conflict', 'The Terms or Privacy Notice changed while you were reading.', 'terms_outdated')));
  const user = userEvent.setup();
  await renderRouter(APP_DIR, { initialUrl: '/onboarding/terms' });
  await user.press(await screen.findByRole('checkbox'));
  await user.press(screen.getByTestId('terms-accept'));
  expect(await screen.findByText(/changed while you were reading/)).toBeOnTheScreen();
  expect(terms.listActive).toHaveBeenCalledTimes(2);
});
