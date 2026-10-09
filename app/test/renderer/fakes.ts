import type {
  CategorySummaryRow,
  CleanPreview,
  CleanReport,
  DashboardState,
  DevCleanupState,
  DevProject,
  DustApi,
  RemovalReport,
  ResultRow,
  ResultsState,
  ScanEvent,
  StartupEntry,
  StartupListState,
  SystemInfoLive,
  SystemInfoStatic,
  UninstallAppSummary,
  UninstallItemPreview,
  UninstallPreview,
} from '../../src/shared/ipc';
import { folderChildren, searchRows, topContributors } from '../../src/main/host/results-index';

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
        role: 'system',
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
        role: 'browse',
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
      installedAppsStale: false,
    },
    ...overrides,
  };
}

export function makeStartupEntry(overrides: Partial<StartupEntry> = {}): StartupEntry {
  return {
    id: 'a1b2c3d4e5f60718',
    name: 'Discord',
    publisher: 'Discord Inc.',
    command: '"C:\\Apps\\Discord\\Update.exe" --processStart Discord.exe',
    source: 'hkcu-run',
    state: 'enabled',
    disabledKind: null,
    protected: false,
    requiresAdmin: false,
    disabledAt: null,
    iconDataUrl: null,
    ...overrides,
  };
}

export function makeStartupState(overrides: Partial<StartupListState> = {}): StartupListState {
  const entries = overrides.entries ?? [
    makeStartupEntry(),
    makeStartupEntry({
      id: 'b2c3d4e5f6071829',
      name: 'Steam',
      publisher: 'Valve Corporation',
      command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent',
    }),
    makeStartupEntry({
      id: 'c3d4e5f607182930',
      name: 'Slack',
      publisher: 'Salesforce, Inc.',
      state: 'disabled',
      disabledKind: 'dust',
      disabledAt: Date.UTC(2026, 0, 4),
    }),
    makeStartupEntry({
      id: 'd4e5f607182930a1',
      name: 'OneDrive',
      publisher: 'Microsoft Corporation',
      state: 'disabled',
      disabledKind: 'windows',
    }),
    makeStartupEntry({
      id: 'e5f607182930a1b2',
      name: 'SecurityHealth',
      publisher: 'Microsoft Corporation',
      command: '"C:\\Windows\\System32\\SecurityHealthSystray.exe"',
      protected: true,
    }),
  ];
  const base: StartupListState = {
    entries,
    counts: {
      total: entries.length,
      enabled: entries.filter((entry) => entry.state === 'enabled').length,
      disabled: entries.filter((entry) => entry.state === 'disabled').length,
    },
    loadedAt: Date.UTC(2026, 0, 5),
  };
  return { ...base, ...overrides };
}

export function makeSystemInfo(overrides: Partial<SystemInfoStatic> = {}): SystemInfoStatic {
  return {
    capturedAt: new Date(2026, 8, 27, 14, 32).getTime(),
    hardwareAvailable: true,
    hardwarePending: false,
    os: { name: 'Windows 11 Pro', version: '25H2', build: '26200.9457', arch: 'x64' },
    hostname: 'dev-machine',
    uptimeMs: (2 * 24 + 4) * 3_600_000,
    cpu: { model: 'AMD Ryzen 7 5800X', physicalCores: 8, logicalThreads: 16 },
    gpus: [
      {
        name: 'NVIDIA GeForce RTX 4070',
        driverVersion: '560.94',
        vramBytes: 8 * 1024 ** 3,
        vramUncertain: false,
      },
    ],
    board: { manufacturer: 'ASUSTeK COMPUTER INC.', product: 'ROG STRIX B550-F GAMING' },
    bios: { version: '2803', date: '2023-04-12' },
    ...overrides,
  };
}

export function makeSystemInfoLive(overrides: Partial<SystemInfoLive> = {}): SystemInfoLive {
  return {
    cpuPercent: 12,
    memTotalBytes: 32 * 1024 ** 3,
    memUsedBytes: 19_757_772_800,
    memAvailableBytes: 32 * 1024 ** 3 - 19_757_772_800,
    ...overrides,
  };
}

export function makeUninstallApp(overrides: Partial<UninstallAppSummary> = {}): UninstallAppSummary {
  return {
    id: 'app-1',
    displayName: 'Spotify',
    publisher: 'Spotify AB',
    version: '1.2.3',
    installLocation: 'C:\\Users\\x\\AppData\\Roaming\\Spotify',
    estimatedSizeKb: 2048,
    sizeBytes: null,
    iconDataUrl: null,
    hive: 'hkcu',
    kind: 'exe',
    requiresAdmin: false,
    hasUninstaller: true,
    caution: null,
    ...overrides,
  };
}

export function makeUninstallItem(
  overrides: Partial<UninstallItemPreview> & { id: string; kind: UninstallItemPreview['kind'] },
): UninstallItemPreview {
  return {
    target: `C:\\Leftovers\\${overrides.id}`,
    label: overrides.id,
    bytes: null,
    grade: 'safe',
    evidence: ['Folder name matches Spotify'],
    adminRequired: false,
    defaultSelected: false,
    ...overrides,
  };
}

export function makeUninstallPreview(overrides: Partial<UninstallPreview> = {}): UninstallPreview {
  const items = overrides.items ?? [
    makeUninstallItem({
      id: 'file-local',
      kind: 'file',
      dataClass: 'app-data',
      bytes: 1024,
      defaultSelected: true,
      target: 'C:\\Users\\x\\AppData\\Local\\Spotify',
      label: 'Spotify',
    }),
    makeUninstallItem({
      id: 'file-roaming',
      kind: 'file',
      dataClass: 'user-data',
      bytes: 2048,
      target: 'C:\\Users\\x\\AppData\\Roaming\\Spotify',
      label: 'Spotify',
    }),
    makeUninstallItem({
      id: 'reg-vendor',
      kind: 'registry',
      grade: 'review',
      defaultSelected: false,
      target: 'HKCU\\Software\\Spotify',
      label: 'HKCU\\Software\\Spotify',
    }),
    makeUninstallItem({
      id: 'reg-uninstall',
      kind: 'registry',
      grade: 'safe',
      defaultSelected: true,
      target: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Spotify',
      label: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Spotify',
    }),
  ];
  return {
    planId: 'plan-1',
    createdAt: 1,
    app: makeUninstallApp(),
    uninstaller: {
      raw: '"C:\\Spotify\\uninstall.exe" /S',
      argv: ['/S'],
      kind: 'exe',
      launchable: true,
      requiresAdmin: false,
      interactiveOnly: true,
      silent: null,
      blockReason: null,
    },
    items,
    kept: [{ target: 'C:\\ProgramData\\Spotify', reason: 'needs-admin' }],
    totals: {
      bytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      items: items.length,
      reviewBytes: 0,
      reviewItems: items.filter((item) => item.grade === 'review').length,
      userDataBytes: 2048,
      userDataItems: 1,
      adminItems: items.filter((item) => item.adminRequired).length,
    },
    ...overrides,
  };
}

export function makeRemovalReport(overrides: Partial<RemovalReport> = {}): RemovalReport {
  return {
    planId: 'plan-1',
    appId: 'app-1',
    appName: 'Spotify',
    startedAt: 1000,
    finishedAt: 2000,
    outcome: 'complete',
    uninstaller: {
      ran: true,
      command: '"C:\\Spotify\\uninstall.exe" /S',
      argv: ['/S'],
      exitCode: 0,
      rebootCode: false,
      skippedWaiting: false,
      verifiedGone: true,
      skippedReason: null,
      launchedAt: 1000,
      finishedAt: 1500,
    },
    files: {
      deletedBytes: 1024,
      recycledBytes: 0,
      deletedItems: 1,
      recycledItems: 0,
      alreadyGone: 0,
      skippedLocked: 0,
      errors: [],
      kept: [],
    },
    registry: {
      backupPath: 'C:\\Users\\x\\AppData\\Roaming\\Dust\\uninstall-backups\\app-1-20260101-000000.reg',
      restoreCommand: 'reg import "C:\\Users\\x\\AppData\\Roaming\\Dust\\uninstall-backups\\app-1-20260101-000000.reg"',
      deletedKeys: ['HKCU\\Software\\Spotify'],
      failedKeys: [],
    },
    startup: { disabled: [], purgedEnvelopes: [], failed: [] },
    elevation: 'none',
    degraded: false,
    journalPath: 'C:\\Users\\x\\AppData\\Roaming\\Dust\\uninstall-history.log',
    ...overrides,
  };
}

export function makeApi(overrides: Partial<DustApi> = {}): DustApi {
  return {
    getDashboard: async () => makeDashboardState(),
    startAnalyze: async () => ({ ok: true, runId: 'run-1' }),
    cancelScan: async () => {},
    getResultCategories: async (root) => {
      const state = makeResultsState({ root });
      return {
        source: state.source,
        root: state.root,
        finishedAt: state.finishedAt,
        status: state.status,
        rulesStale: state.rulesStale,
        depthLimited: state.depthLimited,
        categories: state.categories,
      };
    },
    getResultsSummary: async (root) => {
      const state = makeResultsState({ root });
      return {
        source: state.source,
        root: state.root,
        finishedAt: state.finishedAt,
        status: state.status,
        rulesStale: state.rulesStale,
        depthLimited: state.depthLimited,
        categories: state.categories,
        contributors: topContributors(state.rows),
      };
    },
    getFolderChildren: async (root, path, options) => folderChildren(makeResultsState({ root }).rows, path, options),
    searchResults: async (root, query, options) => searchRows(makeResultsState({ root }).rows, query, options),
    revealPath: async () => {},
    previewClean: async () => ({ ok: true, preview: makeCleanPreview() }),
    executeClean: async () => ({ ok: true, report: makeCleanReport() }),
    getDevCleanup: async (root) => makeDevCleanupState({ root }),
    setPin: async () => ({ ok: true, pins: [] }),
    getStartup: async () => ({ ok: true, state: makeStartupState() }),
    disableStartupEntry: async () => ({ ok: true, state: makeStartupState() }),
    enableStartupEntry: async () => ({ ok: true, state: makeStartupState() }),
    getStartupLaunchHint: async () => null,
    getSystemInfo: async () => makeSystemInfo(),
    getSystemInfoLive: async () => makeSystemInfoLive(),
    relaunchElevated: async () => {},
    listUninstallApps: async () => ({ ok: true, apps: [], trusted: true, elevated: false, loadedAt: 0 }),
    previewUninstall: async () => ({ ok: false, reason: 'not-found', message: 'not found' }),
    executeUninstall: async () => ({ ok: false, reason: 'unknown-plan' }),
    runUninstaller: async () => ({ ok: false, reason: 'not-found', message: 'not found' }),
    skipUninstallWaiting: async () => {},
    getUninstallLaunchHint: async () => null,
    relaunchElevatedUninstall: async () => {},
    getUpdateStatus: async () => ({ phase: 'idle', version: null, percent: null, message: null }),
    checkForUpdates: async () => ({ phase: 'idle', version: null, percent: null, message: null }),
    installUpdate: async () => {},
    onUpdateEvent: () => () => {},
    onUninstallEvent: () => () => {},
    onStartupEvent: () => () => {},
    onScanEvent: () => () => {},
    ...overrides,
  };
}

/** A scan-event bus: pass `onScanEvent` to makeApi and call `emit` to deliver to every live subscriber. */
export function makeScanBus() {
  const handlers = new Set<(event: ScanEvent) => void>();
  return {
    onScanEvent: (handler: (event: ScanEvent) => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    emit: (event: ScanEvent) => {
      for (const handler of [...handlers]) handler(event);
    },
  };
}

export function finishedEvent(runId: string, status: 'complete' | 'cancelled' = 'complete'): ScanEvent {
  return {
    type: 'finished',
    runId,
    status,
    startedAt: 0,
    finishedAt: 2000,
    filesScanned: 10,
    bytesSeen: 2048,
    errors: 0,
    projects: 0,
    reclaimableBytes: 0,
    saved: true,
  };
}
