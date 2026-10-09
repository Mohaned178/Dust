/**
 * Stale-while-revalidate for store-backed data: the last value shows at once and a fresh load runs behind it.
 * A store holds a `Resource<T>` and calls `loadResource` with its own get/set.
 */
export interface Resource<T> {
  data: T | null;
  error: string | null;
  /** True while a load is running. `data` may still hold the previous value. */
  loading: boolean;
  loadedAt: number | null;
}

export function emptyResource<T>(): Resource<T> {
  return { data: null, error: null, loading: false, loadedAt: null };
}

interface ResourceAccess<T> {
  get: () => Resource<T>;
  set: (next: Resource<T>) => void;
}

const inflight = new WeakMap<object, { token: symbol; promise: Promise<unknown> }>();

/**
 * Loads into the resource. A plain call joins a load already running for the same resource; `force` starts a new
 * one, and the older result is then dropped instead of overwriting the newer data.
 */
export function loadResource<T>(
  key: object,
  access: ResourceAccess<T>,
  load: () => Promise<T>,
  options: { force?: boolean } = {},
): Promise<void> {
  const running = inflight.get(key);
  if (running !== undefined && options.force !== true) return running.promise as Promise<void>;
  const token = Symbol('load');
  access.set({ ...access.get(), loading: true, error: null });
  const promise = load().then(
    (data) => {
      if (inflight.get(key)?.token !== token) return;
      inflight.delete(key);
      access.set({ data, error: null, loading: false, loadedAt: Date.now() });
    },
    (cause: unknown) => {
      if (inflight.get(key)?.token !== token) return;
      inflight.delete(key);
      access.set({ ...access.get(), error: cause instanceof Error ? cause.message : String(cause), loading: false });
    },
  );
  inflight.set(key, { token, promise });
  return promise;
}
