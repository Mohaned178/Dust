import {
  composeSystemInfo,
  createCpuUsageSampler,
  querySystemHardware,
  readMemoryInfo,
  readPersistentCache,
  readSystemInfoBase,
  writePersistentCache,
} from '@dust/core';
import type { MemoryInfo, SystemHardware, SystemInfoBase, SystemInfoLive, SystemInfoStatic } from '@dust/core';

export const HARDWARE_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
export const HARDWARE_RETRY_MS = 5 * 60_000;

export interface SystemInfoService {
  get(force?: boolean): Promise<SystemInfoStatic>;
  live(): SystemInfoLive;
  invalidate(): void;
}

export interface SystemInfoServiceOptions {
  loadBase?: () => SystemInfoBase;
  loadHardware?: () => Promise<SystemHardware>;
  sampleCpu?: () => number | null;
  readMemory?: () => MemoryInfo;
  hardwareCacheFile?: string;
  hardwareTtlMs?: number;
  retryMs?: number;
  platform?: NodeJS.Platform;
  now?: () => number;
}

function isHardware(value: unknown): value is SystemHardware {
  return typeof value === 'object' && value !== null && Array.isArray((value as SystemHardware).gpus);
}

export function createSystemInfoService(options: SystemInfoServiceOptions = {}): SystemInfoService {
  const loadBase = options.loadBase ?? (() => readSystemInfoBase());
  const loadHardware = options.loadHardware ?? (() => querySystemHardware());
  const sampleCpu = options.sampleCpu ?? createCpuUsageSampler();
  const readMemory = options.readMemory ?? readMemoryInfo;
  const cacheFile = options.hardwareCacheFile;
  const ttlMs = options.hardwareTtlMs ?? HARDWARE_CACHE_TTL_MS;
  const retryMs = options.retryMs ?? HARDWARE_RETRY_MS;
  const now = options.now ?? Date.now;
  const canQuery = options.loadHardware !== undefined || (options.platform ?? process.platform) === 'win32';

  let hardware: SystemHardware | null = null;
  let diskRead = false;
  // Hardware read from disk may be old (driver versions), so it is refreshed once per process.
  let refreshPending = false;
  let inflight: Promise<SystemHardware | null> | null = null;
  let failedAt: number | null = null;

  function readDisk(): void {
    if (diskRead) return;
    diskRead = true;
    if (hardware !== null || cacheFile === undefined) return;
    const stored = readPersistentCache<SystemHardware>(cacheFile, ttlMs, now);
    if (isHardware(stored)) {
      hardware = stored;
      refreshPending = true;
    }
  }

  // Never rejects: a failed query leaves whatever hardware is already known.
  function query(): Promise<SystemHardware | null> {
    if (inflight !== null) return inflight;
    const run: Promise<SystemHardware | null> = Promise.resolve()
      .then(() => loadHardware())
      .then(
        (fresh) => {
          hardware = fresh;
          failedAt = null;
          refreshPending = false;
          if (cacheFile !== undefined) writePersistentCache(cacheFile, fresh, now);
          return fresh;
        },
        () => {
          failedAt = now();
          return null;
        },
      )
      .finally(() => {
        inflight = null;
      });
    inflight = run;
    return run;
  }

  return {
    async get(force = false) {
      const base = loadBase();
      const compose = (known: SystemHardware | null, pending: boolean) =>
        composeSystemInfo(base, known, { pending, now });
      readDisk();
      if (force) {
        if (canQuery) await query();
        return compose(hardware, false);
      }
      if (hardware !== null) {
        if (refreshPending && canQuery) {
          refreshPending = false;
          void query();
        }
        return compose(hardware, false);
      }
      if (!canQuery) return compose(null, false);
      if (inflight !== null) return compose(null, true);
      if (failedAt !== null && now() - failedAt < retryMs) return compose(null, false);
      void query();
      return compose(null, true);
    },
    live() {
      const memory = readMemory();
      return {
        cpuPercent: sampleCpu(),
        memTotalBytes: memory.totalBytes,
        memUsedBytes: memory.usedBytes,
        memAvailableBytes: memory.availableBytes,
      };
    },
    invalidate() {
      hardware = null;
      diskRead = false;
      refreshPending = false;
      failedAt = null;
    },
  };
}
