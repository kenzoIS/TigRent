import { validateEnv } from '@/lib/env';
import { AppError, toAppError } from '@/lib/errors';
import { formatPeso, parsePesoInput } from '@/lib/money';

const base64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

describe('validateEnv (Phase 2: fail clearly on missing/unsafe config)', () => {
  const good = { supabaseUrl: 'https://abc.supabase.co', supabasePublishableKey: 'sb_publishable_abcdefghijklmnop' };

  it('accepts a URL + publishable key', () => {
    expect(validateEnv(good)).toEqual({ ok: true, env: good });
  });
  it('reports missing values', () => {
    const r = validateEnv({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/SUPABASE_URL is missing.*PUBLISHABLE_KEY is missing/);
  });
  it('rejects non-https URLs', () => {
    expect(validateEnv({ ...good, supabaseUrl: 'http://abc.supabase.co' }).ok).toBe(false);
  });
  it('refuses secret and service-role keys so they can never ship in the app', () => {
    expect(validateEnv({ ...good, supabasePublishableKey: 'sb_secret_abcdefghijklmnopqrstuv' }).ok).toBe(false);
    const serviceJwt = `${base64url({ alg: 'HS256' })}.${base64url({ role: 'service_role', iss: 'supabase' })}.signature`;
    expect(validateEnv({ ...good, supabasePublishableKey: serviceJwt }).ok).toBe(false);
    const anonJwt = `${base64url({ alg: 'HS256' })}.${base64url({ role: 'anon', iss: 'supabase' })}.signature`;
    expect(validateEnv({ ...good, supabasePublishableKey: anonJwt }).ok).toBe(true);
  });
});

describe('money (integer centavos)', () => {
  it('formats pesos without floating-point error', () => {
    expect(formatPeso(0)).toBe('₱0');
    expect(formatPeso(4000)).toBe('₱40');
    expect(formatPeso(123450)).toBe('₱1,234.50');
    expect(formatPeso(9900)).toBe('₱99');
    expect(formatPeso(10, { showCentavos: 'always' })).toBe('₱0.10');
    expect(formatPeso(-2500)).toBe('−₱25');
  });
  it('refuses non-integer centavos', () => {
    expect(() => formatPeso(10.5)).toThrow(RangeError);
  });
  it('parses peso input into centavos', () => {
    expect(parsePesoInput('1,250.5')).toBe(125050);
    expect(parsePesoInput('₱40')).toBe(4000);
    expect(parsePesoInput('0.07')).toBe(7);
    expect(parsePesoInput('-5')).toBeNull();
    expect(parsePesoInput('1.234')).toBeNull();
    expect(parsePesoInput('abc')).toBeNull();
  });
});

describe('toAppError', () => {
  it.each([
    ['42501', 'forbidden'],
    ['PGRST116', 'not_found'],
    ['23505', 'conflict'],
    ['23P01', 'conflict'],
    ['23514', 'validation'],
    ['PGRST301', 'unauthenticated'],
    ['XX000', 'unknown'],
  ])('maps %s to %s with a user-safe message', (code, kind) => {
    const e = toAppError({ code, message: 'internal detail: relation public.secret' });
    expect(e.kind).toBe(kind);
    expect(e.message).not.toMatch(/relation|public\./);
  });
  it('maps network failures to an offline message', () => {
    expect(toAppError(new TypeError('Network request failed')).kind).toBe('network');
  });
  it('passes AppErrors through', () => {
    const e = new AppError('config', 'x');
    expect(toAppError(e)).toBe(e);
  });
});
