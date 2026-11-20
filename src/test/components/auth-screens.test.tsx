import path from 'path';
import { renderRouter, screen } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import { authService } from '@/features/auth/auth-service';
import { __setSessionForTests } from '@/features/auth/session';
import { AppError, fail, ok } from '@/lib/errors';

jest.mock('@/features/auth/auth-service', () => ({
  authService: {
    signIn: jest.fn(),
    signUp: jest.fn(),
    confirmSignUpCode: jest.fn(),
    resendConfirmation: jest.fn(),
    requestPasswordReset: jest.fn(),
    verifyRecoveryCode: jest.fn(),
    updatePassword: jest.fn(),
    signOut: jest.fn(),
  },
}));
const auth = jest.mocked(authService);
const APP_DIR = path.resolve(__dirname, '../../app');

beforeEach(() => {
  jest.clearAllMocks();
  __setSessionForTests({ kind: 'signed_out' });
});
afterAll(() => __setSessionForTests(null));

describe('sign in', () => {
  it('validates fields before calling the server', async () => {
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/sign-in' });
    await user.press(screen.getByTestId('sign-in-submit'));
    expect(await screen.findByText('Enter your email address.')).toBeOnTheScreen();
    expect(screen.getByText('Enter your password.')).toBeOnTheScreen();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('shows the server’s user-facing error for bad credentials', async () => {
    auth.signIn.mockResolvedValue(fail(new AppError('unauthenticated', 'Email or password is incorrect. If you just signed up, confirm your email first.')));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/sign-in' });
    await user.type(screen.getByLabelText('Email'), 'bea.borrower@tigrent.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.press(screen.getByTestId('sign-in-submit'));
    expect(auth.signIn).toHaveBeenCalledWith('bea.borrower@tigrent.test', 'wrong-password');
    expect(await screen.findByText(/Email or password is incorrect/)).toBeOnTheScreen();
  });

  it('shows the session-expired notice', async () => {
    __setSessionForTests({ kind: 'signed_out' }, { notice: 'Your session has expired. Please sign in again.' });
    await renderRouter(APP_DIR, { initialUrl: '/sign-in' });
    expect(screen.getByText('Your session has expired. Please sign in again.')).toBeOnTheScreen();
  });
});

describe('sign up', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, password = 'Tigers2026') => {
    await user.type(screen.getByLabelText('Full name'), 'Juan Dela Cruz');
    await user.type(screen.getByLabelText('Email'), 'juan@example.com');
    await user.type(screen.getByLabelText('Password'), password);
    await user.type(screen.getByLabelText('Confirm password'), password);
    await user.press(screen.getByTestId('sign-up-submit'));
  };

  it('rejects weak passwords on the device', async () => {
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/sign-up' });
    await fill(user, 'password');
    expect(await screen.findByText('Include at least one letter and one number.')).toBeOnTheScreen();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('goes to the confirm-email step when confirmation is required', async () => {
    auth.signUp.mockResolvedValue(ok({ needsEmailConfirmation: true }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/sign-up' });
    await fill(user);
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'juan@example.com', password: 'Tigers2026', fullName: 'Juan Dela Cruz' });
    expect(screen).toHavePathname('/check-email');
    expect(await screen.findByText(/to juan@example.com/)).toBeOnTheScreen();
  });

  it('explains a duplicate email and offers sign-in', async () => {
    auth.signUp.mockResolvedValue(fail(new AppError('conflict', 'An account with this email already exists. Sign in instead.', 'user_already_exists')));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/sign-up' });
    await fill(user);
    expect(await screen.findByText(/already exists/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Go to sign in' }));
    expect(screen).toHavePathname('/sign-in');
  });
});

describe('confirm email and reset password', () => {
  it('confirms a sign-up with the emailed code', async () => {
    auth.confirmSignUpCode.mockResolvedValue(ok(undefined));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/check-email?email=juan%40example.com' });
    await user.type(screen.getByLabelText('Confirmation code'), '123456');
    await user.press(screen.getByTestId('confirm-submit'));
    expect(auth.confirmSignUpCode).toHaveBeenCalledWith('juan@example.com', '123456');
  });

  it('walks through request → code → new password', async () => {
    const setPasswordRecovery = jest.fn();
    __setSessionForTests({ kind: 'signed_out' }, { setPasswordRecovery });
    auth.requestPasswordReset.mockResolvedValue(ok(undefined));
    auth.verifyRecoveryCode.mockResolvedValue(ok(undefined));
    auth.updatePassword.mockResolvedValue(ok(undefined));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/forgot-password' });
    await user.type(screen.getByLabelText('Email'), 'juan@example.com');
    await user.press(screen.getByRole('button', { name: 'Send reset email' }));
    await user.type(await screen.findByLabelText('Reset code'), '654321');
    await user.press(screen.getByRole('button', { name: 'Verify code' }));
    expect(auth.verifyRecoveryCode).toHaveBeenCalledWith('juan@example.com', '654321');
    expect(setPasswordRecovery).toHaveBeenCalledWith(true);
    await user.type(await screen.findByLabelText('New password'), 'NewPass2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPass2026');
    await user.press(screen.getByRole('button', { name: 'Save new password' }));
    expect(auth.updatePassword).toHaveBeenCalledWith('NewPass2026');
    expect(setPasswordRecovery).toHaveBeenLastCalledWith(false);
  });
});
