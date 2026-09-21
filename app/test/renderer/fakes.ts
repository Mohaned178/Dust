import type { CategorySummaryRow, DashboardState, DustApi, ResultRow, ResultsState } from '../../src/shared/ipc';

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
      childCount: 2,
      grade: 'danger',
      gradeReason: 'System-critical — read-only',
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
      gradeReason: 'Unrecognized folder — review before deleting',
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
      gradeReason: 'Unrecognized folder — review before deleting',
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
      gradeReason: 'Temporary files — apps recreate them as needed',
      action: {
        ruleId: 'system-temp',
        category: 'temp',
        grade: 'safe',
        evidence: 'User TEMP directory — junk by definition',
      },
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
    getResults: async () => makeResultsState(),
    revealPath: async () => {},
    onScanEvent: () => () => {},
    ...overrides,
  };
}
