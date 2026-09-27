import { createCpuUsageSampler, getSystemInfoStatic, readMemoryInfo } from '@dust/core';
import type { MemoryInfo, SystemInfoLive, SystemInfoStatic } from '@dust/core';

export const SYSTEM_INFO_TTL_MS = 5 * 60_000;

export interface SystemInfoService {
  get(force?: boolean): Promise<SystemInfoStatic>;
  live(): SystemInfoLive;
  invalidate(): void;
}

export interface SystemInfoServiceOptions {
  load?: () => Promise<SystemInfoStatic>;
  sampleCpu?: () => number | null;
  readMemory?: () => MemoryInfo;
  ttlMs?: number;
  now?: () => number;
}

export function createSystemInfoService(options: SystemInfoServiceOptions = {}): SystemInfoService {
  const load = options.load ?? (() => getSystemInfoStatic());
  const sampleCpu = options.sampleCpu ?? createCpuUsageSampler();
  const readMemory = options.readMemory ?? readMemoryInfo;
  const ttlMs = options.ttlMs ?? SYSTEM_INFO_TTL_MS;
  const now = options.now ?? Date.now;

  let cached: { at: number; snapshot: SystemInfoStatic } | null = null;
  let inflight: Promise<SystemInfoStatic> | null = null;

  return {
    async get(force = false) {
      const stamp = now();
      if (!force && cached !== null && stamp - cached.at < ttlMs) return cached.snapshot;
      if (inflight !== null) return inflight;
      const pending = load().then((snapshot) => {
        cached = { at: now(), snapshot };
        return snapshot;
      });
      inflight = pending;
      try {
        return await pending;
      } finally {
        inflight = null;
      }
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
      cached = null;
    },
  };
}
