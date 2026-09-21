import type { ActionGrade, CategoryId, DisplayGrade, DriveType } from '@dust/core';

export const IPC = {
  dashboardGet: 'dust:dashboard:get',
  scanStart: 'dust:scan:start',
  scanCancel: 'dust:scan:cancel',
  scanEvent: 'dust:scan:event',
  resultsGet: 'dust:results:get',
  revealPath: 'dust:shell:reveal',
} as const;

export type ScanKind = 'analyze' | 'quick-clean';

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

export type ScanEvent =
  | { type: 'started'; runId: string; root: string; startedAt: number }
  | { type: 'progress'; runId: string; progress: ScanProgressPayload }
  | { type: 'folders'; runId: string; folders: ResultRow[] }
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
  | { type: 'failed'; runId: string; message: string };

export type StartAnalyzeResult =
  | { ok: true; runId: string }
  | { ok: false; reason: 'busy'; running: ScanKind }
  | { ok: false; reason: 'invalid-volume'; message: string }
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
  onScanEvent(handler: (event: ScanEvent) => void): () => void;
}
