import type {
  CategorySummaryRow,
  CleanPreview,
  CleanReport,
  DashboardState,
  DevCleanupState,
  DevProject,
  DustApi,
  ResultRow,
  ResultsState,
} from '../../src/shared/ipc';

export function makeResultsRows(): ResultRow[] {
  const root = 'C:\\';
  return [
    {
      path: root,
      name: root,
      parent: null,
      bytes: 1024 * 1024,
      allocatedBytes: 2 * 1024 * 1024,
      fileCount: 10,
      folderCount: 2,
      linkCount: 0,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: false,
      complete: true,
      childCount: 3,
      grade: 'danger',
      gradeReason: 'System-critical - read-only',
      action: null,
    },
    {
      path: 'C:\\Users',
      name: 'Users',
      parent: root,
      bytes: 512 * 1024,
      allocatedBytes: 1024 * 1024,
      fileCount: 6,
      folderCount: 1,
      linkCount: 0,
      newestMtimeMs: Date.UTC(2026, 0, 1),
      errorCount: 0,
      partial: false,
      complete: true,
      childCount: 1,
      grade: 'review',
      gradeReason: 'Unrecognized folder - review before deleting',
      action: null,
    },
    {
      path: 'C:\\Users\\x',
      name: 'x',
      parent: 'C:\\Users',
      bytes: 128 * 1024,
      allocatedBytes: 256 * 1024,
      fileCount: 2,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: Date.UTC(2026, 0, 1),
      errorCount: 0,
      partial: false,
      complete: true,
      childCount: 0,
      grade: 'review',
      gradeReason: 'Unrecognized folder - review before deleting',
      action: null,
    },
    {
      path: 'C:\\Temp',
      name: 'Temp',
      parent: root,
      bytes: 256 * 1024,
      allocatedBytes: 512 * 1024,
      fileCount: 4,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: Date.UTC(2026, 0, 2),
      errorCount: 0,
      partial: false,
      complete: true,
      childCount: 0,
      grade: 'safe',
      gradeReason: 'Temporary files - apps recreate them as needed',
      action: {
        ruleId: 'system-temp',
        category: 'temp',
        grade: 'safe',
        evidence: 'User TEMP directory - junk by definition',
      },
    },
    {
      path: 'C:\\Windows',
      name: 'Windows',
      parent: root,
      bytes: 768 * 1024,
      allocatedBytes: 1024 * 1024,
      fileCount: 12,
      folderCount: 3,
      linkCount: 0,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: false,
      complete: true,
      childCount: 0,
      grade: 'danger',
      gradeReason: 'System-critical - read-only',
      action: null,
    },
  ];
}

export function makeCategories(): CategorySummaryRow[] {
  return [
    { category: 'temp', label: 'Temp', bytes: 256 * 1024, items: 1, ruleIds: ['system-temp'] },
    { category: 'recycle-bin', label: 'Recycle Bin', bytes: 0, items: 0, ruleIds: [] },
    { category: 'npm-cache', label: 'npm cache', bytes: 0, items: 0, ruleIds: [] },
    { category: 'app-caches', label: 'App caches', bytes: 0, items: 0, ruleIds: [] },
    { category: 'npm-projects', label: 'npm projects', bytes: 0, items: 0, ruleIds: [] },
  ];
}

export function makeResultsState(overrides: Partial<ResultsState> = {}): ResultsState {
  return {
    source: 'snapshot',
    root: 'C:\\',
    finishedAt: Date.UTC(2026, 0, 2),
    status: 'complete',
    rulesStale: false,
    depthLimited: true,
    categories: makeCategories(),
    rows: makeResultsRows(),
    ...overrides,
  };
}

export function makeCleanPreview(overrides: Partial<CleanPreview> = {}): CleanPreview {
  return {
    planId: 'plan-1',
    createdAt: 1,
    root: 'C:\\',
    source: 'live',
    scanAgeMs: 60_000,
    items: [
      {
        ruleId: 'system-temp',
        category: 'temp',
        path: 'C:\\Users\\x\\AppData\\Local\\Temp',
        name: 'Temp',
        bytes: 10_000,
        grade: 'safe',
        recovery: { kind: 'junk', text: 'Temporary files are recreated by the apps that need them' },
        evidence: 'User TEMP directory - junk by definition',
        action: 'delete-path',
        adminRequired: false,
      },
    ],
    totals: { bytes: 10_000, items: 1, reviewBytes: 0, reviewItems: 0 },
    refused: [],
    ...overrides,
  };
}

export function makeCleanReport(overrides: Partial<CleanReport> = {}): CleanReport {
  return {
    planId: 'plan-1',
    scope: 'quick',
    root: 'C:\\',
    startedAt: 1,
    finishedAt: 2,
    items: [
      {
        ruleId: 'system-temp',
        path: 'C:\\Users\\x\\AppData\\Local\\Temp',
        category: 'temp',
        action: 'delete-path',
        status: 'done',
        plannedBytes: 10_000,
        deletedBytes: 10_000,
        skippedLocked: 0,
        errorCount: 0,
        restoreCommand: null,
      },
    ],
    deletedBytes: 10_000,
    skippedLocked: 0,
    itemErrors: 0,
    remainingReclaimableBytes: 0,
    cleanedAt: 2,
    ...overrides,
  };
}

export function makeDevProject(overrides: Partial<DevProject> = {}): DevProject {
  return {
    path: 'C:\\dev\\dead-app',
    name: 'dead-app',
    kind: 'project',
    packageManager: 'npm',
    recency: 'dead',
    pinned: false,
    offered: true,
    nodeModulesBytes: 512 * 1024,
    nodeModulesPaths: ['C:\\dev\\dead-app\\node_modules'],
    activityMs: Date.UTC(2025, 0, 1),
    activitySource: 'git-reflog',
    grade: 'green',
    reasons: [],
    restoreCommand: 'npm ci',
    workspaceCount: 0,
    ...overrides,
  };
}

export function makeDevCleanupState(overrides: Partial<DevCleanupState> = {}): DevCleanupState {
  const project = makeDevProject();
  return {
    source: 'snapshot',
    root: 'C:\\',
    finishedAt: Date.UTC(2026, 0, 2),
    groups: [
      { id: 'dead', label: 'Dead (more than 180 days)', projects: [project] },
      { id: 'occasional', label: 'Occasional (31-180 days)', projects: [] },
      { id: 'active', label: 'Active (30 days or less)', projects: [] },
      { id: 'orphaned', label: 'Orphaned node_modules', projects: [] },
      { id: 'pinned', label: 'Pinned', projects: [] },
    ],
    recentlyCleaned: [],
    ...overrides,
  };
}

export function makeDashboardState(overrides: Partial<DashboardState> = {}): DashboardState {
  const finishedAt = Date.UTC(2026, 0, 2);
  return {
    volumes: [
      {
        root: 'C:\\',
        label: 'System',
        driveType: 'fixed',
        external: false,
        totalBytes: 1024 ** 3,
        freeBytes: 512 * 1024 ** 2,
        lastAnalyzedAt: finishedAt,
        lastCleanedAt: null,
        reclaimableBytes: 512 * 1024 ** 2,
      },
      {
        root: 'E:\\',
        label: null,
        driveType: 'removable',
        external: true,
        totalBytes: 64 * 1024 ** 3,
        freeBytes: 60 * 1024 ** 3,
        lastAnalyzedAt: null,
        lastCleanedAt: null,
        reclaimableBytes: null,
      },
    ],
    scan: null,
    snapshot: {
      status: 'ok',
      root: 'C:\\',
      finishedAt,
      scanStatus: 'complete',
      reclaimableBytes: 512 * 1024 ** 2,
      cleanedAt: null,
      rulesStale: false,
    },
    ...overrides,
  };
}

export function makeApi(overrides: Partial<DustApi> = {}): DustApi {
  return {
    getDashboard: async () => makeDashboardState(),
    startAnalyze: async () => ({ ok: true, runId: 'run-1' }),
    cancelScan: async () => {},
    getResults: async (root) => makeResultsState({ root }),
    revealPath: async () => {},
    previewClean: async () => ({ ok: true, preview: makeCleanPreview() }),
    executeClean: async () => ({ ok: true, report: makeCleanReport() }),
    getDevCleanup: async (root) => makeDevCleanupState({ root }),
    setPin: async () => ({ ok: true, pins: [] }),
    relaunchElevated: async () => {},
    onScanEvent: () => () => {},
    ...overrides,
  };
}
