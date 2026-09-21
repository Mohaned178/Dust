import type { DashboardState, DustApi } from '../../src/shared/ipc';

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
      root: 'C:\\Users\\x',
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
    onScanEvent: () => () => {},
    ...overrides,
  };
}
