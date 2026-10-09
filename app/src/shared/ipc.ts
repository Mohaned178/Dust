import type {
  ActionGrade,
  BrowseDeleteResult,
  CategoryId,
  DisplayGrade,
  DriveType,
  LeftoverClass,
  RemovalReport,
  RemovalTotals,
  StartupSource,
  SystemInfoLive,
  SystemInfoStatic,
  UninstallHive,
  UninstallKind,
} from '@dust/core';

export const IPC = {
  dashboardGet: 'dust:dashboard:get',
  scanStart: 'dust:scan:start',
  scanCancel: 'dust:scan:cancel',
  scanEvent: 'dust:scan:event',
  resultsGet: 'dust:results:get',
  resultsCategoriesGet: 'dust:results:categories',
  browseStart: 'dust:browse:start',
  browseResultsGet: 'dust:browse:results',
  browseDelete: 'dust:browse:delete',
  revealPath: 'dust:shell:reveal',
  cleanPreview: 'dust:clean:preview',
  cleanExecute: 'dust:clean:execute',
  devCleanupGet: 'dust:dev-cleanup:get',
  pinsSet: 'dust:pins:set',
  startupList: 'dust:startup:list',
  startupDisable: 'dust:startup:disable',
  startupEnable: 'dust:startup:enable',
  startupHint: 'dust:startup:hint',
  startupEvent: 'dust:startup:event',
  systemInfoGet: 'dust:system-info:get',
  systemInfoLive: 'dust:system-info:live',
  relaunchElevated: 'dust:app:relaunch-elevated',
  uninstallList: 'dust:uninstall:list',
  uninstallPreview: 'dust:uninstall:preview',
  uninstallExecute: 'dust:uninstall:execute',
  uninstallRun: 'dust:uninstall:run',
  uninstallSkipWaiting: 'dust:uninstall:skip-waiting',
  uninstallEvent: 'dust:uninstall:event',
  uninstallHint: 'dust:uninstall:hint',
  relaunchElevatedUninstall: 'dust:app:relaunch-elevated-uninstall',
  updatesGet: 'dust:updates:get',
  updatesCheck: 'dust:updates:check',
  updatesInstall: 'dust:updates:install',
  updatesEvent: 'dust:updates:event',
} as const;

export type { BrowseDeleteResult, RemovalReport, StartupSource, SystemInfoLive, SystemInfoStatic };

export type ScanKind = 'analyze' | 'quick-clean' | 'browse' | 'uninstall';

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
  origin?: 'detected';
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
  detected?: boolean;
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

export interface ResultsCategoriesState {
  source: 'live' | 'snapshot' | 'empty';
  root: string;
  finishedAt: number | null;
  status: 'complete' | 'cancelled' | null;
  rulesStale: boolean;
  depthLimited: boolean;
  categories: CategorySummaryRow[];
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
  | { type: 'quick-clean-progress'; progress: ScanProgressPayload }
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
  | { type: 'finalize-progress'; runId: string; step: string }
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
  mediaType?: 'ssd' | 'hdd' | 'unknown';
  role: 'system' | 'browse';
  external: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  lastAnalyzedAt: number | null;
  lastCleanedAt: number | null;
  reclaimableBytes: number | null;
  sessionOnly?: boolean;
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
  installedAppsStale: boolean;
}

export interface DashboardState {
  volumes: DashboardVolumeCard[];
  scan: ScanState | null;
  snapshot: DashboardSnapshotInfo;
}

export type StartupDisabledKind = 'dust' | 'windows';

export interface StartupEntry {
  id: string;
  name: string;
  publisher: string | null;
  command: string;
  source: StartupSource;
  state: 'enabled' | 'disabled';
  disabledKind: StartupDisabledKind | null;
  protected: boolean;
  requiresAdmin: boolean;
  disabledAt: number | null;
  iconDataUrl: string | null;
}

export interface StartupListState {
  entries: StartupEntry[];
  counts: { total: number; enabled: number; disabled: number };
  loadedAt: number;
}

/** Publishers and icons that became known after the entries were listed. */
export interface StartupDetailsEvent {
  details: Array<{ id: string; publisher: string | null; iconDataUrl: string | null }>;
}

export type StartupListResult = { ok: true; state: StartupListState } | { ok: false; message: string };

export type StartupToggleRefusal =
  'not-found' | 'protected' | 'needs-admin' | 'conflict' | 'windows-disabled' | 'failed';

export type StartupToggleResult =
  { ok: true; state: StartupListState } | { ok: false; reason: StartupToggleRefusal; message: string };

export interface StartupNotice {
  entryId: string;
  name: string;
  to: 'enabled' | 'disabled';
  disabledKind?: StartupDisabledKind;
}

export type StartupRelaunchAction = 'enable' | 'disable';

export interface StartupLaunchHint {
  open: boolean;
  notice: StartupNotice | null;
}

export type UninstallCaution = 'hardware' | 'security' | 'runtime';

export interface UninstallAppSummary {
  id: string;
  displayName: string;
  publisher: string;
  version: string;
  installLocation: string;
  estimatedSizeKb: number | null;
  /** Measured size of the install folder, once known (arrives via 'app-size' events). */
  sizeBytes: number | null;
  /** The app's icon as a data URL, once loaded (arrives via 'app-icon' events). */
  iconDataUrl: string | null;
  hive: UninstallHive;
  kind: UninstallKind;
  requiresAdmin: boolean;
  hasUninstaller: boolean;
  /** Removing this can affect hardware, security, or apps that depend on it. */
  caution: UninstallCaution | null;
}

export interface UninstallRunRequest {
  jobId: string;
  appId: string;
  quiet: boolean;
}

export interface UninstallRunOutcome {
  ran: boolean;
  exitCode: number | null;
  /** The app's registration is gone: the uninstaller finished its job. */
  verifiedGone: boolean;
  rebootRequired: boolean;
  skippedWaiting: boolean;
  skippedReason: string | null;
}

export type UninstallRunResult =
  | { ok: true; outcome: UninstallRunOutcome }
  | { ok: false; reason: 'busy'; running: ScanKind }
  | { ok: false; reason: 'not-found' | 'no-uninstaller' | 'failed'; message: string };

export interface UninstallPreviewOptions {
  /** Scan for what is left after the app's own uninstaller ran; no uninstaller step. */
  leftoversOnly?: boolean;
}

export type UninstallListResult =
  | { ok: true; apps: UninstallAppSummary[]; trusted: boolean; elevated: boolean; loadedAt: number }
  | { ok: false; message: string };

export interface UninstallItemPreview {
  id: string;
  kind: 'file' | 'registry' | 'startup';
  target: string;
  label: string;
  bytes: number | null;
  grade: ActionGrade;
  dataClass?: LeftoverClass;
  evidence: string[];
  adminRequired: boolean;
  defaultSelected: boolean;
  syncRoot?: boolean;
}

export interface UninstallUninstallerPreview {
  raw: string;
  argv: string[];
  kind: UninstallKind;
  launchable: boolean;
  requiresAdmin: boolean;
  interactiveOnly: boolean;
  silent: { argv: string[]; wellFormed: boolean } | null;
  blockReason: string | null;
}

export interface UninstallPreview {
  planId: string;
  createdAt: number;
  app: UninstallAppSummary;
  uninstaller: UninstallUninstallerPreview | null;
  items: UninstallItemPreview[];
  kept: Array<{ target: string; reason: string }>;
  totals: RemovalTotals;
}

export type UninstallPreviewResult =
  | { ok: true; preview: UninstallPreview }
  | { ok: false; reason: 'busy'; running: ScanKind }
  | { ok: false; reason: 'not-found' | 'protected' | 'nothing-to-remove' | 'failed'; message: string };

export interface UninstallExecuteRequest {
  jobId: string;
  planId: string;
  selection: string[];
  includeUserData: boolean;
  runUninstaller: boolean;
  quiet: boolean;
  acknowledge: string[];
}

export type UninstallExecuteResult =
  | { ok: true; report: RemovalReport }
  | { ok: false; reason: 'busy'; running: ScanKind }
  | {
      ok: false;
      reason: 'unknown-plan' | 'consumed-plan' | 'unacknowledged-review' | 'no-selection' | 'failed';
      message?: string;
    };

export type UninstallEvent =
  | { type: 'phase'; jobId: string; phase: string; status: 'started' | 'done' | 'failed' | 'skipped'; note?: string }
  | { type: 'uninstaller-started'; jobId: string; pid: number | null; argv: string[] }
  | { type: 'uninstaller-exited'; jobId: string; exitCode: number | null }
  | { type: 'uninstaller-reboot-required'; jobId: string }
  | { type: 'verify'; jobId: string; gone: boolean; attempt: number }
  | { type: 'item'; jobId: string; itemId: string; status: string; bytes: number }
  | { type: 'finished'; jobId: string; report: RemovalReport }
  | { type: 'failed'; jobId: string; message: string }
  | { type: 'app-size'; appId: string; bytes: number }
  | { type: 'app-icon'; appId: string; iconDataUrl: string };

export interface UninstallLaunchHint {
  open: boolean;
  appId: string | null;
  notice: { appName: string; outcome: RemovalReport['outcome'] } | null;
  stalePending: boolean;
  runningJobId: string | null;
}

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

export interface UpdateStatus {
  phase: UpdatePhase;
  version: string | null;
  percent: number | null;
  message: string | null;
}

export interface DustApi {
  getDashboard(): Promise<DashboardState>;
  startAnalyze(volume: string): Promise<StartAnalyzeResult>;
  startBrowse(volume: string): Promise<StartAnalyzeResult>;
  cancelScan(): Promise<void>;
  getResults(root: string): Promise<ResultsState>;
  getResultCategories(root: string): Promise<ResultsCategoriesState>;
  getBrowseResults(root: string): Promise<BrowseState>;
  deleteBrowsePath(path: string): Promise<BrowseDeleteResult>;
  revealPath(path: string): Promise<void>;
  previewClean(request: CleanPreviewRequest): Promise<CleanPreviewResult>;
  executeClean(request: CleanExecuteRequest): Promise<CleanExecuteResult>;
  getDevCleanup(root: string): Promise<DevCleanupState>;
  setPin(path: string, pinned: boolean): Promise<SetPinResult>;
  getStartup(): Promise<StartupListResult>;
  disableStartupEntry(id: string): Promise<StartupToggleResult>;
  enableStartupEntry(id: string): Promise<StartupToggleResult>;
  getStartupLaunchHint(): Promise<StartupLaunchHint | null>;
  getSystemInfo(force?: boolean): Promise<SystemInfoStatic>;
  getSystemInfoLive(): Promise<SystemInfoLive>;
  relaunchElevated(startupToggleId?: string, action?: StartupRelaunchAction): Promise<void>;
  listUninstallApps(force?: boolean): Promise<UninstallListResult>;
  previewUninstall(appId: string, options?: UninstallPreviewOptions): Promise<UninstallPreviewResult>;
  runUninstaller(request: UninstallRunRequest): Promise<UninstallRunResult>;
  executeUninstall(request: UninstallExecuteRequest): Promise<UninstallExecuteResult>;
  skipUninstallWaiting(): Promise<void>;
  getUninstallLaunchHint(): Promise<UninstallLaunchHint | null>;
  relaunchElevatedUninstall(jobId: string): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  onUpdateEvent(handler: (status: UpdateStatus) => void): () => void;
  onUninstallEvent(handler: (event: UninstallEvent) => void): () => void;
  onStartupEvent(handler: (event: StartupDetailsEvent) => void): () => void;
  onScanEvent(handler: (event: ScanEvent) => void): () => void;
}
