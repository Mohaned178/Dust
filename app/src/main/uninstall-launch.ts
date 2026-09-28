import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UNINSTALL_PENDING_TTL_MS } from '@dust/core';

export const PENDING_UNINSTALL_PREFIX = '--dust-uninstall=';
const FUTURE_SKEW_MS = 5 * 60_000;
const ID_PATTERN = /^[a-z0-9-]{16,64}$/i;

export interface PendingUninstallJob {
  v: 2;
  jobId: string;
  appId: string;
  createdAt: number;
}

export function pendingUninstallPath(userDataDir: string): string {
  return join(userDataDir, 'pending-removal.json');
}

export function parsePendingUninstallArg(argv: readonly string[]): string | null {
  const prefix = argv.find((entry) => entry.startsWith(PENDING_UNINSTALL_PREFIX));
  if (prefix === undefined) return null;
  const id = prefix.slice(PENDING_UNINSTALL_PREFIX.length);
  return /^[a-z0-9-]{16,64}$/i.test(id) ? id : null;
}

export function writePendingUninstall(path: string, job: PendingUninstallJob): boolean {
  const tempPath = `${path}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tempPath, JSON.stringify(job), 'utf8');
    renameSync(tempPath, path);
    return true;
  } catch {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      /* best effort */
    }
    return false;
  }
}

export function readPendingUninstall(
  path: string,
  options: { now?: () => number; ttlMs?: number } = {},
): PendingUninstallJob | null {
  if (!existsSync(path)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const job = value as Partial<PendingUninstallJob>;
  if (job.v !== 2) return null;
  if (typeof job.jobId !== 'string' || !ID_PATTERN.test(job.jobId)) return null;
  if (typeof job.appId !== 'string' || !ID_PATTERN.test(job.appId)) return null;
  if (typeof job.createdAt !== 'number') return null;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? UNINSTALL_PENDING_TTL_MS;
  const age = now() - job.createdAt;
  if (age < -FUTURE_SKEW_MS || age >= ttlMs) return null;
  return job as PendingUninstallJob;
}

export function clearPendingUninstall(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    /* best effort */
  }
}
