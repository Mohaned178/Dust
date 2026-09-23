import { availableParallelism } from 'node:os';
import type { PoolLimits } from './protocol';

export const DEFAULT_POOL_LIMITS: PoolLimits = {
  splitAfterEntries: 20_000,
  batchIntervalMs: 200,
  batchMaxItems: 500,
};

export function defaultWorkerCount(): number {
  const parallelism = availableParallelism();
  return Math.min(8, Math.max(4, parallelism - 1));
}

export const HDD_WORKERS = 2;

export function defaultWorkersForVolume(mediaType: 'ssd' | 'hdd' | 'unknown' | undefined): number {
  return mediaType === 'hdd' ? HDD_WORKERS : defaultWorkerCount();
}
