import { useCallback, useEffect, useRef, useState } from 'react';

// Stale-while-revalidate for tool pages: a page unmounts when you leave it, so the
// last data lives here and shows at once on the next visit while a fresh load runs.
const store = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

/** Forget everything. Tests use this between cases. */
export function clearPageCache(): void {
  store.clear();
  inflight.clear();
}

// A shared load joins one already running for the key; an explicit one replaces it
// and the older result is then dropped instead of overwriting the newer data.
function run<T>(key: string, load: () => Promise<T>, join: boolean): Promise<T> {
  const running = inflight.get(key);
  if (join && running !== undefined) return running as Promise<T>;
  const promise: Promise<T> = load()
    .then((value) => {
      if (inflight.get(key) === promise) store.set(key, value);
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

export interface CachedResource<T> {
  data: T | null;
  error: string | null;
  /** True while a load is running, including the first render before it starts. */
  revalidating: boolean;
  /** Load again and cache the result. A custom loader (a forced refresh) is not shared with a running load. */
  reload: (load?: () => Promise<T>) => Promise<void>;
  /** Replace the data in both the component and the cache. */
  mutate: (next: T) => void;
}

export function useCachedResource<T>(key: string, load: () => Promise<T>): CachedResource<T> {
  const [data, setData] = useState<T | null>(() => (store.get(key) as T | undefined) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [revalidating, setRevalidating] = useState(true);
  const mounted = useRef(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(
    async (custom?: () => Promise<T>) => {
      if (mounted.current) {
        setRevalidating(true);
        setError(null);
      }
      try {
        const value = await run(key, custom ?? loadRef.current, custom === undefined);
        // The cache holds the newest data, which a mutate or a later reload may have written meanwhile.
        if (mounted.current) setData((store.get(key) as T | undefined) ?? value);
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (mounted.current) setRevalidating(false);
      }
    },
    [key],
  );

  const mutate = useCallback(
    (next: T) => {
      store.set(key, next);
      inflight.delete(key);
      if (mounted.current) setData(next);
    },
    [key],
  );

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  return { data, error, revalidating, reload, mutate };
}
