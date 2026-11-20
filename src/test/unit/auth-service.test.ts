import { authService, mapAuthError } from '@/features/auth/auth-service';
import { toAppError } from '@/lib/errors';
import { __setSupabaseForTests, type TigRentClient } from '@/lib/supabase';

const withAuth = (auth: Record<string, jest.Mock>) => __setSupabaseForTests({ auth } as unknown as TigRentClient);
afterEach(() => __setSupabaseForTests(null));

describe('mapAuthError (codes observed on the hosted project)', () => {
  it.each([
    ['invalid_credentials', 'unauthenticated', /incorrect/],
    ['weak_password', 'validation', /stronger password/],
    ['email_address_invalid', 'validation', /real, deliverable/],
    ['over_email_send_rate_limit', 'conflict', /Too many attempts/],
    ['otp_expired', 'validation', /expired/],
    ['refresh_token_not_found', 'unauthenticated', /session has expired/],
  ])('%s → %s', (code, kind, message) => {
    const e = mapAuthError({ code, status: 400, message: 'raw server text' });
    expect(e.kind).toBe(kind);
    expect(e.message).toMatch(message);
  });
  it('treats retryable fetch errors as offline', () => {
    expect(mapAuthError({ name: 'AuthRetryableFetchError' }).kind).toBe('network');
  });
});

describe('authService.signUp', () => {
  it('detects an existing account hidden by email-confirmation obfuscation (identities = [])', async () => {
    withAuth({ signUp: jest.fn(async () => ({ data: { user: { id: 'x', identities: [] }, session: null }, error: null })) });
    const r = await authService.signUp({ email: 'bea@example.com', password: 'Tigers2026', fullName: 'Bea' });
    expect(!r.ok && r.error.code).toBe('user_already_exists');
  });
  it('reports when email confirmation is required', async () => {
    withAuth({ signUp: jest.fn(async () => ({ data: { user: { id: 'x', identities: [{}] }, session: null }, error: null })) });
    expect(await authService.signUp({ email: 'a@example.com', password: 'Tigers2026', fullName: 'A' })).toEqual({ ok: true, data: { needsEmailConfirmation: true } });
  });
  it('stores the full name in user metadata for the profile trigger', async () => {
    const signUp = jest.fn(async () => ({ data: { user: { id: 'x', identities: [{}] }, session: {} }, error: null }));
    withAuth({ signUp });
    await authService.signUp({ email: ' a@example.com ', password: 'Tigers2026', fullName: ' Ana Reyes ' });
    expect(signUp).toHaveBeenCalledWith({ email: 'a@example.com', password: 'Tigers2026', options: { data: { full_name: 'Ana Reyes' } } });
  });
  it('never throws on network failure', async () => {
    withAuth({ signInWithPassword: jest.fn(async () => { throw new TypeError('Network request failed'); }) });
    const r = await authService.signIn('a@example.com', 'x');
    expect(!r.ok && r.error.kind).toBe('network');
  });
});

describe('RPC error convention (P0001 kind.reason + hint)', () => {
  it('uses the hint as the user message and the reason as the code', () => {
    const e = toAppError({ code: 'P0001', message: 'forbidden.not_verified', hint: 'Only verified students can enable borrowing or lending.' });
    expect(e).toMatchObject({ kind: 'forbidden', code: 'not_verified', message: 'Only verified students can enable borrowing or lending.' });
  });
});
