import type { ActionGrade, CategoryId, DisplayGrade, DriveType } from '@dust/core';

export const IPC = {
  dashboardGet: 'dust:dashboard:get',
  scanStart: 'dust:scan:start',
  scanCancel: 'dust:scan:cancel',
  scanEvent: 'dust:scan:event',
  resultsGet: 'dust:results:get',
  revealPath: 'dust:shell:reveal',
  cleanPreview: 'dust:clean:preview',
  cleanExecute: 'dust:clean:execute',
  devCleanupGet: 'dust:dev-cleanup:get',
  pinsSet: 'dust:pins:set',
  relaunchElevated: 'dust:app:relaunch-elevated',
} as const;

export type ScanKind = 'analyze' | 'quick-clean' | 'browse';

export interface ScanState {
  kind: ScanKind;
  root: string;
  startedAt: number;
}

export interface ScanProgressPayload {
  filesScanned: number;
  bytesSeen: number;
  currentPath: string;
  dirsCompleted: number;
  errors: number;
  elapsedMs: number;
}

export interface ResultAction {
  ruleId: string;
  category: CategoryId;
  grade: ActionGrade;
  evidence: string;
}

export interface ResultMatch extends ResultAction {
  path: string;
  bytes: number;
}

export interface ResultRow {
  path: string;
  name: string;
  parent: string | null;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
  linkCount: number;
  newestMtimeMs: number;
  errorCount: number;
  partial: boolean;
  complete: boolean;
  childCount: number;
  grade: DisplayGrade;
  gradeReason: string;
  action: ResultAction | null;
}

export interface BrowseRow {
  path: string;
  name: string;
  parent: string | null;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
  linkCount: number;
  newestMtimeMs: number;
  errorCount: number;
  partial: boolean;
  complete: boolean;
  childCount: number;
}

export interface BrowseState {
  source: 'live' | 'empty';
  root: string;
  finishedAt: number | null;
  status: 'complete' | 'cancelled' | null;
  rows: BrowseRow[];
}

export interface CategorySummaryRow {
  category: CategoryId;
  label: string;
  bytes: number;
  items: number;
  ruleIds: string[];
}

export interface ResultsState {
  source: 'live' | 'snapshot' | 'empty';
  root: string;
  finishedAt: number | null;
  status: 'complete' | 'cancelled' | null;
  rulesStale: boolean;
  depthLimited: boolean;
  categories: CategorySummaryRow[];
  rows: ResultRow[];
}

export type CleanScope = 'quick' | 'dev' | 'row';

export type CleanPreviewRequest =
  | { scope: 'quick' }
  | { scope: 'dev'; root: string; paths: string[] }
  | { scope: 'row'; root: string; paths: string[] };

export interface CleanRecovery {
  kind: 'regenerate' | 'junk';
  text: string;
}

export interface CleanItemPreview {
  ruleId: string;
  category: CategoryId;
  path: string;
  name: string;
  bytes: number;
  grade: ActionGrade;
  recovery: CleanRecovery;
  evidence: string;
  action: 'delete-path' | 'empty-recycle-bin';
  adminRequired: boolean;
}

export interface CleanPlanTotals {
  bytes: number;
  items: number;
  reviewBytes: number;
  reviewItems: number;
}

export interface CleanPreview {
  planId: string;
  createdAt: number;
  root: string;
  source: 'live' | 'snapshot' | 'targeted';
  scanAgeMs: number | null;
  items: CleanItemPreview[];
  totals: CleanPlanTotals;
  refused: Array<{ ruleId: string; path: string; reason: string }>;
}

export type CleanPreviewResult =
  | { ok: true; preview: CleanPreview }
  | { ok: false; reason: 'busy'; running: ScanKind }
  | { ok: false; reason: 'empty-selection' | 'invalid-root'; message: string }
  | { ok: false; reason: 'failed'; message: string };

export interface CleanExecuteRequest {
  cleanId: string;
  planId: string;
  acknowledge?: string[];
}

export interface CleanItemResult {
  ruleId: string;
  path: string;
  category: CategoryId;
  action: 'delete-path' | 'empty-recycle-bin';
  status: 'done' | 'partial' | 'failed' | 'already-gone';
  plannedBytes: number;
  deletedBytes: number;
  skippedLocked: number;
  errorCount: number;
  restoreCommand: string | null;
}

export interface CleanReport {
  planId: string;
  scope: CleanScope;
  root: string;
  startedAt: number;
  finishedAt: number;
  items: CleanItemResult[];
  deletedBytes: number;
  skippedLocked: number;
  itemErrors: number;
  remainingReclaimableBytes: number;
  cleanedAt: number;
}

export type CleanExecuteResult =
  | { ok: true; report: CleanReport }
  | { ok: false; reason: 'busy'; running: ScanKind }
  | {
      ok: false;
      reason: 'unknown-plan' | 'consumed-plan' | 'unacknowledged-review' | 'rule-not-in-plan';
    }
  | { ok: false; reason: 'failed'; message: string };

export interface DevProject {
  path: string;
  name: string;
  kind: 'project' | 'monorepo' | 'orphaned-node-modules';
  packageManager: string;
  recency: 'active' | 'occasional' | 'dead' | 'unknown';
  pinned: boolean;
  offered: boolean;
  nodeModulesBytes: number;
  nodeModulesPaths: string[];
  activityMs: number | null;
  activitySource: 'files' | 'git-reflog' | 'manifest' | 'unknown';
  grade: 'green' | 'yellow' | 'not-offered';
  reasons: string[];
  restoreCommand: string | null;
  workspaceCount: number;
}

export interface DevGroup {
  id: 'dead' | 'occasional' | 'active' | 'orphaned' | 'pinned';
  label: string;
  projects: DevProject[];
}

export interface RecentlyCleanedProject {
  root: string;
  path: string;
  name: string;
  bytes: number;
  restoreCommand: string | null;
  cleanedAt: number;
}

export interface DevCleanupState {
  source: 'live' | 'snapshot' | 'empty';
  root: string;
  finishedAt: number | null;
  groups: DevGroup[];
  recentlyCleaned: RecentlyCleanedProject[];
}

export type SetPinResult = { ok: true; pins: string[] } | { ok: false; message: string };

export type ScanEvent =
  | { type: 'started'; runId: string; root: string; startedAt: number }
  | { type: 'progress'; runId: string; progress: ScanProgressPayload }
  | { type: 'folders'; runId: string; folders: ResultRow[] }
  | { type: 'browse-folders'; runId: string; folders: BrowseRow[] }
  | {
      type: 'browse-finished';
      runId: string;
      status: 'complete' | 'cancelled';
      startedAt: number;
      finishedAt: number;
      filesScanned: number;
      bytesSeen: number;
      errors: number;
    }
  | { type: 'categories'; runId: string; categories: CategorySummaryRow[] }
  | { type: 'matches'; runId: string; matches: ResultMatch[] }
  | { type: 'finalizing'; runId: string }
  | {
      type: 'finished';
      runId: string;
      status: 'complete' | 'cancelled';
      startedAt: number;
      finishedAt: number;
      filesScanned: number;
      bytesSeen: number;
      errors: number;
      projects: number;
      reclaimableBytes: number;
      saved: boolean;
    }
  | { type: 'failed'; runId: string; message: string }
  | { type: 'clean-item'; cleanId: string; item: CleanItemResult }
  | { type: 'cleaned'; cleanId: string; root: string };

export type StartAnalyzeResult =
  | { ok: true; runId: string }
  | { ok: false; reason: 'busy'; running: ScanKind }
  | { ok: false; reason: 'invalid-volume'; message: string }
  | { ok: false; reason: 'not-system-drive'; message: string }
  | { ok: false; reason: 'start-failed'; message: string };

export interface DashboardVolumeCard {
  root: string;
  label: string | null;
  driveType: DriveType;
  external: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  lastAnalyzedAt: number | null;
  lastCleanedAt: number | null;
  reclaimableBytes: number | null;
}

export interface DashboardSnapshotInfo {
  status: 'missing' | 'corrupt' | 'ok';
  reason?: string;
  root: string | null;
  finishedAt: number | null;
  scanStatus: 'complete' | 'cancelled' | null;
  reclaimableBytes: number | null;
  cleanedAt: number | null;
  rulesStale: boolean;
}

export interface DashboardState {
  volumes: DashboardVolumeCard[];
  scan: ScanState | null;
  snapshot: DashboardSnapshotInfo;
}

export interface DustApi {
  getDashboard(): Promise<DashboardState>;
  startAnalyze(volume: string): Promise<StartAnalyzeResult>;
  cancelScan(): Promise<void>;
  getResults(root: string): Promise<ResultsState>;
  revealPath(path: string): Promise<void>;
  previewClean(request: CleanPreviewRequest): Promise<CleanPreviewResult>;
  executeClean(request: CleanExecuteRequest): Promise<CleanExecuteResult>;
  getDevCleanup(root: string): Promise<DevCleanupState>;
  setPin(path: string, pinned: boolean): Promise<SetPinResult>;
  relaunchElevated(): Promise<void>;
  onScanEvent(handler: (event: ScanEvent) => void): () => void;
}
