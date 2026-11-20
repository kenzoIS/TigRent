import { useCallback, useEffect, useState } from 'react';
import type { AppError, Result } from './errors';

export type AsyncState<T> = { data: T | null; error: AppError | null; loading: boolean; reload: () => Promise<void> };

/**
 * Loads a Result-returning query with loading / error / retry states (plan §10.3: meaningful loading,
 * error and retry states). State is only set from the async callback, and is ignored after unmount.
 */
export function useAsync<T>(loader: () => Promise<Result<T>>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);

  // Callers list the loader's inputs in `deps`; the serialized key keeps `load`/`reload` stable between renders.
  const key = JSON.stringify(deps);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the loader's inputs
  const load = useCallback(() => loader(), [key]);

  const apply = useCallback((r: Result<T>) => {
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else {
      setError(r.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    load().then((r) => active && apply(r));
    return () => {
      active = false;
    };
  }, [load, apply]);

  const reload = useCallback(async () => {
    setLoading(true);
    apply(await load());
  }, [load, apply]);

  return { data, error, loading, reload };
}
