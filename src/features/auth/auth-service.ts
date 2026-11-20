/**
 * Authentication use cases over Supabase Auth (plan Phase 3). Returns typed Results with
 * user-facing messages; never throws. Authentication ≠ student verification (plan §2.2).
 */
import { AppError, fail, ok, type Result } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';

type AuthLikeError = { code?: string; status?: number; name?: string; message?: string };

export function mapAuthError(e: unknown): AppError {
  const err = (e ?? {}) as AuthLikeError;
  if (err.name === 'AuthRetryableFetchError' || (e instanceof TypeError && /fetch|network/i.test(e.message))) {
    return new AppError('network', 'You appear to be offline. Check your connection and try again.');
  }
  switch (err.code) {
    case 'invalid_credentials':
      return new AppError('unauthenticated', 'Email or password is incorrect. If you just signed up, confirm your email first.', err.code);
    case 'email_not_confirmed':
      return new AppError('unauthenticated', 'Confirm your email address before signing in.', err.code);
    case 'user_already_exists':
    case 'email_exists':
      return new AppError('conflict', 'An account with this email already exists. Sign in instead.', err.code);
    case 'weak_password':
      return new AppError('validation', 'Choose a stronger password: at least 8 characters with a letter and a number.', err.code);
    case 'email_address_invalid':
      return new AppError('validation', 'This email address can’t be used. Enter a real, deliverable email address.', err.code);
    case 'email_address_not_authorized':
      return new AppError('forbidden', 'TigRent can’t send email to this address yet. Ask the TigRent team to enable sign-ups for it.', err.code);
    case 'signup_disabled':
      return new AppError('forbidden', 'New sign-ups are currently closed.', err.code);
    case 'otp_expired':
      return new AppError('validation', 'That code is incorrect or has expired. Request a new one.', err.code);
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return new AppError('conflict', 'Too many attempts. Please wait a few minutes and try again.', err.code);
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'session_expired':
      return new AppError('unauthenticated', 'Your session has expired. Please sign in again.', err.code);
    case 'same_password':
      return new AppError('validation', 'Choose a password different from your current one.', err.code);
    default:
      return new AppError('unknown', 'Something went wrong. Please try again.', err.code);
  }
}

async function attempt<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (e) {
    return fail(mapAuthError(e));
  }
}

export type SignUpOutcome = { needsEmailConfirmation: boolean };

export const authService = {
  signIn: (email: string, password: string) =>
    attempt(async () => {
      const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
      return error ? fail<void>(mapAuthError(error)) : ok(undefined);
    }),

  signUp: (input: { email: string; password: string; fullName: string }) =>
    attempt<SignUpOutcome>(async () => {
      const { data, error } = await getSupabase().auth.signUp({
        email: input.email.trim(),
        password: input.password,
        options: { data: { full_name: input.fullName.trim() } },
      });
      if (error) return fail(mapAuthError(error));
      // With email confirmation on, Supabase hides existing accounts by returning a user with no identities.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        return fail(new AppError('conflict', 'An account with this email already exists. Sign in instead.', 'user_already_exists'));
      }
      return ok({ needsEmailConfirmation: !data.session });
    }),

  /** Confirms a sign-up with the numeric code from the confirmation email (works in Expo Go; no deep link needed). */
  confirmSignUpCode: (email: string, token: string) =>
    attempt(async () => {
      const { error } = await getSupabase().auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'signup' });
      return error ? fail<void>(mapAuthError(error)) : ok(undefined);
    }),

  resendConfirmation: (email: string) =>
    attempt(async () => {
      const { error } = await getSupabase().auth.resend({ type: 'signup', email: email.trim() });
      return error ? fail<void>(mapAuthError(error)) : ok(undefined);
    }),

  requestPasswordReset: (email: string) =>
    attempt(async () => {
      const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim());
      return error ? fail<void>(mapAuthError(error)) : ok(undefined);
    }),

  /** Exchanges the recovery code for a short-lived session that may set a new password. */
  verifyRecoveryCode: (email: string, token: string) =>
    attempt(async () => {
      const { error } = await getSupabase().auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'recovery' });
      return error ? fail<void>(mapAuthError(error)) : ok(undefined);
    }),

  updatePassword: (password: string) =>
    attempt(async () => {
      const { error } = await getSupabase().auth.updateUser({ password });
      return error ? fail<void>(mapAuthError(error)) : ok(undefined);
    }),

  signOut: () =>
    attempt(async () => {
      const { error } = await getSupabase().auth.signOut();
      return error ? fail<void>(mapAuthError(error)) : ok(undefined);
    }),
};
