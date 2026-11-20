import { fail, ok, toAppError, type Result } from '@/lib/errors';

type Response<R> = { data: R | null; error: unknown };

/** Runs a Supabase query, maps rows, and converts every failure (including thrown network errors) to a typed AppError. */
export async function run<R, T>(query: PromiseLike<Response<R>>, map: (data: NonNullable<R>) => T): Promise<Result<T>> {
  try {
    const { data, error } = await query;
    if (error) return fail(toAppError(error));
    if (data === null) return fail(toAppError({ code: 'PGRST116' }));
    return ok(map(data as NonNullable<R>));
  } catch (e) {
    return fail(toAppError(e));
  }
}

/** Like `run`, but a missing single row is a valid `null` result rather than an error. */
export async function runMaybe<R, T>(query: PromiseLike<Response<R>>, map: (data: NonNullable<R>) => T): Promise<Result<T | null>> {
  try {
    const { data, error } = await query;
    if (error) return fail(toAppError(error));
    return ok(data === null || data === undefined ? null : map(data as NonNullable<R>));
  } catch (e) {
    return fail(toAppError(e));
  }
}
