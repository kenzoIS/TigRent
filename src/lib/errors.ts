/**
 * Consistent error types for repositories/use cases (plan §6.1: "typed input/output contracts and
 * consistent error types"; §10.3: no silent catches, no console-only errors).
 */
export type AppErrorKind =
  | 'network'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'config'
  | 'unknown';

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly code?: string;
  constructor(kind: AppErrorKind, message: string, code?: string) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.code = code;
  }
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };
export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T = never>(error: AppError): Result<T> => ({ ok: false, error });

type PostgrestLike = { code?: string; message?: string; details?: string | null; hint?: string | null; status?: number };

/** Maps Postgres/PostgREST/network errors to an AppError without leaking internals to users. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) {
    return new AppError('network', 'You appear to be offline. Check your connection and try again.');
  }
  const err = (e ?? {}) as PostgrestLike;
  const code = err.code;
  // TigRent RPC convention: MESSAGE '<kind>.<reason>', HINT = user-facing text (see migration 009).
  if (code === 'P0001' && err.message) {
    const [prefix, reason] = err.message.split('.', 2);
    const kinds: Record<string, AppErrorKind> = {
      forbidden: 'forbidden',
      conflict: 'conflict',
      not_found: 'not_found',
      validation: 'validation',
      unauthenticated: 'unauthenticated',
    };
    const kind = kinds[prefix ?? ''];
    if (kind) return new AppError(kind, err.hint || 'This action isn’t allowed right now.', reason ?? prefix);
  }
  switch (code) {
    case '42501':
      return new AppError('forbidden', 'You don’t have permission to do that.', code);
    case 'PGRST301':
    case 'PGRST303':
      return new AppError('unauthenticated', 'Your session has expired. Please sign in again.', code);
    case 'PGRST116':
      return new AppError('not_found', 'We couldn’t find that item.', code);
    case '23505':
      return new AppError('conflict', 'This was already done.', code);
    case '23P01':
      return new AppError('conflict', 'Those dates are no longer available.', code);
    case '23514':
    case '23502':
    case '22P02':
    case '22023':
      return new AppError('validation', 'Some details aren’t valid. Please review and try again.', code);
    default:
      if (err.status === 401) return new AppError('unauthenticated', 'Please sign in again.', code);
      return new AppError('unknown', 'Something went wrong. Please try again.', code);
  }
}
