import type { VolumeInfo } from '@dust/core';

export interface VolumeCache {
  get(): Promise<VolumeInfo[]>;
  invalidate(): void;
}

export function createVolumeCache(
  load: () => Promise<VolumeInfo[]>,
  ttlMs: number,
  now: () => number,
): VolumeCache {
  let cached: { at: number; volumes: VolumeInfo[] } | null = null;
  let inflight: Promise<VolumeInfo[]> | null = null;

  return {
    async get() {
      const stamp = now();
      if (cached !== null && stamp - cached.at < ttlMs) return cached.volumes;
      if (inflight !== null) return inflight;
      inflight = load()
        .then((volumes) => {
          cached = { at: now(), volumes };
          return volumes;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };
}
