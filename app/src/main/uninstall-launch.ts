import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UNINSTALL_PENDING_TTL_MS } from '@dust/core';
import type { RemovalPlan } from '@dust/core';
import type { UninstallExecuteRequest } from '../shared/ipc';

export const PENDING_UNINSTALL_PREFIX = '--dust-uninstall=';

export interface PendingUninstallJob {
  v: 1;
  jobId: string;
  createdAt: number;
  plan: RemovalPlan;
  request: UninstallExecuteRequest;
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
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(job), 'utf8');
    return true;
  } catch {
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
  if (job.v !== 1) return null;
  if (typeof job.jobId !== 'string' || typeof job.createdAt !== 'number') return null;
  if (typeof job.plan !== 'object' || job.plan === null) return null;
  if (typeof job.plan.id !== 'string' || job.plan.id !== job.jobId) return null;
  if (typeof job.request !== 'object' || job.request === null) return null;
  if (job.request.planId !== job.plan.id || job.request.jobId !== job.jobId) return null;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? UNINSTALL_PENDING_TTL_MS;
  if (now() - job.createdAt >= ttlMs) return null;
  return job as PendingUninstallJob;
}

export function clearPendingUninstall(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    /* best effort */
  }
}
