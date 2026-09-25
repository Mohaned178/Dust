import type { ProjectRecord } from '../projects/types';

export const SNAPSHOT_SCHEMA_VERSION = 2;

export type ScanStatus = 'complete' | 'cancelled';

export interface SnapshotDisk {
  volume: string;
  totalBytes: number | null;
  freeBytes: number | null;
}

export interface SnapshotCategory {
  ruleId: string;
  category: string;
  bytes: number;
  items: number;
}

export interface SnapshotFolder {
  path: string;
  name: string;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
  newestMtimeMs: number;
  errorCount: number;
  partial: boolean;
  complete: boolean;
  childCount: number;
}

export interface SnapshotMatch {
  path: string;
  ruleId: string;
  category: string;
  bytes: number;
  grade: 'safe' | 'review';
  evidence: string;
  origin?: 'detected';
}

export type SnapshotFindingKind = 'curated-leftover' | 'app-matched' | 'app-leftover' | 'unrecognized';

export interface SnapshotFinding {
  path: string;
  bytes: number;
  kind: SnapshotFindingKind;
  grade: 'safe' | 'review';
  label: string;
  reason: string;
}

export interface SnapshotData {
  schemaVersion: number;
  rulesVersion: string;
  root: string;
  startedAt: number;
  finishedAt: number;
  status: ScanStatus;
  cleanedAt: number | null;
  disks: SnapshotDisk[];
  categories: SnapshotCategory[];
  matches: SnapshotMatch[];
  findings?: SnapshotFinding[];
  projects: ProjectRecord[];
  folders: SnapshotFolder[];
}

export class SnapshotCorruptError extends Error {
  constructor(public readonly reason: string) {
    super(`corrupt snapshot: ${reason}`);
    this.name = 'SnapshotCorruptError';
  }
}

export function parseSnapshot(raw: string): SnapshotData {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SnapshotCorruptError('invalid-json');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotCorruptError('not-an-object');
  }
  const object = value as Record<string, unknown>;

  if (object.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotCorruptError('schema-version');
  }
  if (typeof object.root !== 'string' || !isFiniteNumber(object.startedAt) || !isFiniteNumber(object.finishedAt)) {
    throw new SnapshotCorruptError('scan-metadata');
  }
  if (object.status !== 'complete' && object.status !== 'cancelled') {
    throw new SnapshotCorruptError('scan-status');
  }
  if (object.cleanedAt !== null && !isFiniteNumber(object.cleanedAt)) {
    throw new SnapshotCorruptError('cleaned-at');
  }
  if (typeof object.rulesVersion !== 'string') {
    throw new SnapshotCorruptError('rules-version');
  }
  if (!Array.isArray(object.disks) || !object.disks.every(isSnapshotDisk)) {
    throw new SnapshotCorruptError('disks');
  }
  if (!Array.isArray(object.categories) || !object.categories.every(isSnapshotCategory)) {
    throw new SnapshotCorruptError('categories');
  }
  if (!Array.isArray(object.matches) || !object.matches.every(isSnapshotMatch)) {
    throw new SnapshotCorruptError('matches');
  }
  if (
    object.findings !== undefined &&
    (!Array.isArray(object.findings) || !object.findings.every(isSnapshotFinding))
  ) {
    throw new SnapshotCorruptError('findings');
  }
  if (!Array.isArray(object.projects) || !object.projects.every(isProjectRecord)) {
    throw new SnapshotCorruptError('projects');
  }
  if (!Array.isArray(object.folders) || !object.folders.every(isSnapshotFolder)) {
    throw new SnapshotCorruptError('folders');
  }

  return value as SnapshotData;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSnapshotDisk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.volume === 'string' &&
    (value.totalBytes === null || isFiniteNumber(value.totalBytes)) &&
    (value.freeBytes === null || isFiniteNumber(value.freeBytes))
  );
}

function isSnapshotCategory(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.ruleId === 'string' &&
    typeof value.category === 'string' &&
    isFiniteNumber(value.bytes) &&
    isFiniteNumber(value.items)
  );
}

function isSnapshotMatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    typeof value.ruleId === 'string' &&
    typeof value.category === 'string' &&
    isFiniteNumber(value.bytes) &&
    (value.grade === 'safe' || value.grade === 'review') &&
    typeof value.evidence === 'string' &&
    (value.origin === undefined || value.origin === 'detected')
  );
}

function isSnapshotFinding(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    isFiniteNumber(value.bytes) &&
    (value.kind === 'curated-leftover' ||
      value.kind === 'app-matched' ||
      value.kind === 'app-leftover' ||
      value.kind === 'unrecognized') &&
    (value.grade === 'safe' || value.grade === 'review') &&
    typeof value.label === 'string' &&
    typeof value.reason === 'string'
  );
}

function isProjectRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    typeof value.name === 'string' &&
    (value.kind === 'project' || value.kind === 'monorepo' || value.kind === 'orphaned-node-modules') &&
    (value.packageManager === 'npm' ||
      value.packageManager === 'yarn' ||
      value.packageManager === 'pnpm' ||
      value.packageManager === 'bun' ||
      value.packageManager === 'unknown') &&
    typeof value.pinned === 'boolean' &&
    isFiniteNumber(value.workspaceCount) &&
    isNodeModules(value.nodeModules) &&
    isProjectActivity(value.activity) &&
    (value.recency === 'active' ||
      value.recency === 'occasional' ||
      value.recency === 'dead' ||
      value.recency === 'unknown') &&
    isRestorability(value.restorability) &&
    typeof value.offered === 'boolean' &&
    isStringArray(value.evidence)
  );
}

function isNodeModules(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Array.isArray(value.paths) && value.paths.every(isNodeModulesLocation) && isFiniteNumber(value.bytes);
}

function isNodeModulesLocation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.path === 'string' && isFiniteNumber(value.bytes);
}

function isProjectActivity(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.ms === null || isFiniteNumber(value.ms)) &&
    (value.source === 'files' ||
      value.source === 'git-reflog' ||
      value.source === 'manifest' ||
      value.source === 'unknown')
  );
}

function isRestorability(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.grade === 'green' || value.grade === 'yellow' || value.grade === 'not-offered') &&
    isStringArray(value.reasons) &&
    (value.restoreCommand === null || typeof value.restoreCommand === 'string')
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSnapshotFolder(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    typeof value.name === 'string' &&
    isFiniteNumber(value.bytes) &&
    isFiniteNumber(value.allocatedBytes) &&
    isFiniteNumber(value.fileCount) &&
    isFiniteNumber(value.folderCount) &&
    isFiniteNumber(value.newestMtimeMs) &&
    isFiniteNumber(value.errorCount) &&
    typeof value.partial === 'boolean' &&
    typeof value.complete === 'boolean' &&
    isFiniteNumber(value.childCount)
  );
}
