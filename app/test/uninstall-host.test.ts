import { describe, expect, it } from 'vitest';
import type { InstalledApp, RemovalPlan, RemovalReport } from '@dust/core';
import { createUninstallService } from '../src/main/host/uninstall';
import type { UninstallServiceDeps } from '../src/main/host/uninstall';
import type { PendingUninstallJob } from '../src/main/uninstall-launch';
import type { UninstallEvent, UninstallExecuteRequest, ScanKind } from '../src/shared/ipc';

function installedApp(overrides: Partial<InstalledApp> & { displayName: string }): InstalledApp {
  const { displayName, ...rest } = overrides;
  return {
    id: 'app-1',
    hive: 'hkcu',
    keyName: '{APP}',
    publisher: '',
    installLocation: '',
    version: '',
    installDate: '',
    estimatedSizeKb: null,
    uninstallString: 'uninstall.exe',
    quietUninstallString: '',
    displayIcon: '',
    windowsInstaller: false,
    systemComponent: false,
    noRemove: false,
    uninstallable: true,
    parentKeyName: '',
    releaseType: '',
    ...rest,
    displayName,
  };
}

function makePlan(appId = 'app-1', overrides: Partial<RemovalPlan> = {}): RemovalPlan {
  return {
    id: 'plan-1',
    appId,
    createdAt: 100,
    app: {
      id: appId,
      displayName: 'Spotify',
      publisher: 'Spotify AB',
      version: '1.2.3',
      hive: 'hkcu',
      installLocation: '',
      estimatedSizeKb: 2048,
    },
    uninstaller: {
      command: {
        raw: 'uninstall.exe /S',
        kind: 'exe',
        executable: 'uninstall.exe',
        args: ['/S'],
        msiProductCode: null,
        exeExists: true,
        launchable: true,
        blockReason: null,
      },
      requiresAdmin: false,
      interactiveOnly: true,
      silent: null,
    },
    leftovers: [],
    registry: [],
    startup: [],
    kept: [],
    totals: {
      bytes: 0,
      items: 0,
      reviewBytes: 0,
      reviewItems: 0,
      userDataBytes: 0,
      userDataItems: 0,
      adminItems: 0,
    },
    ...overrides,
  };
}

function makeReport(): RemovalReport {
  return {
    planId: 'plan-1',
    appId: 'app-1',
    appName: 'Spotify',
    startedAt: 1000,
    finishedAt: 1200,
    outcome: 'complete',
    uninstaller: {
      ran: true,
      command: 'uninstall.exe /S',
      argv: ['/S'],
      exitCode: 0,
      rebootCode: false,
      skippedWaiting: false,
      verifiedGone: true,
      skippedReason: null,
      launchedAt: 1000,
      finishedAt: 1100,
    },
    files: {
      deletedBytes: 0,
      recycledBytes: 0,
      deletedItems: 0,
      recycledItems: 0,
      alreadyGone: 0,
      skippedLocked: 0,
      errors: [],
      kept: [],
    },
    registry: { backupPath: '', restoreCommand: '', deletedKeys: [], failedKeys: [] },
    startup: { disabled: [], purgedEnvelopes: [], failed: [] },
    elevation: 'none',
    degraded: false,
    journalPath: 'C:\\Dust\\history.log',
  };
}

interface LockState {
  acquireOk: boolean;
  acquires: number;
  releases: number;
  current: { kind: ScanKind; root: string; startedAt: number } | null;
}

function makeLock(acquireOk = true): { lock: NonNullable<UninstallServiceDeps['lock']>; state: LockState } {
  const state: LockState = { acquireOk, acquires: 0, releases: 0, current: null };
  return {
    state,
    lock: {
      acquire: (kind: ScanKind, root: string, now = 0) => {
        state.acquires += 1;
        if (!state.acquireOk) {
          return { ok: false as const, holder: { kind: 'analyze' as const } };
        }
        state.current = { kind, root, startedAt: now };
        return { ok: true as const, holder: { kind } };
      },
      release: () => {
        state.releases += 1;
        state.current = null;
      },
      current: () => (state.current === null ? null : { kind: state.current.kind }),
    },
  };
}

const BASE_REQUEST = (planId: string): UninstallExecuteRequest => ({
  jobId: planId,
  planId,
  selection: ['item-1'],
  includeUserData: false,
  runUninstaller: true,
  quiet: false,
  acknowledge: [],
});

function makeService(overrides: Partial<UninstallServiceDeps> = {}): {
  service: ReturnType<typeof createUninstallService>;
  calls: {
    reset: number;
    marked: number[];
    lock: LockState;
    executeRequests: unknown[];
  };
  events: UninstallEvent[];
  lock: { lock: UninstallServiceDeps['lock']; state: LockState };
} {
  const calls = {
    reset: 0,
    marked: [] as number[],
    lock: { acquireOk: true, acquires: 0, releases: 0, current: null } as LockState,
    executeRequests: [] as unknown[],
  };
  const { lock, state } = makeLock();
  calls.lock = state;
  const deps: UninstallServiceDeps = {
    store: {
      markAppsChanged: (at) => {
        calls.marked.push(at ?? 0);
        return { ok: true };
      },
    },
    now: () => 1000,
    journalPath: 'C:\\Dust\\history.log',
    backupDir: 'C:\\Dust\\backups',
    elevated: false,
    listApps: async () => ({ apps: [installedApp({ displayName: 'Spotify' })], trusted: true }),
    buildPlan: async ({ app }) => makePlan(app.id),
    executePlan: async () => ({ ok: true, report: makeReport() }),
    records: async () => [],
    resetAppsCache: () => {
      calls.reset += 1;
    },
    createJournal: () => ({ append: () => true }),
    lock,
    ...overrides,
  };
  const service = createUninstallService(deps);
  const events: UninstallEvent[] = [];
  service.onEvent((event) => events.push(event));
  return { service, calls, events, lock: { lock, state } };
}

const ADMIN_PLAN_OVERRIDES: Partial<RemovalPlan> = {
  uninstaller: null,
  registry: [
    {
      id: 'reg-admin',
      hive: 'hklm',
      path: 'Software\\Spotify',
      scope: 'vendor-root',
      grade: 'safe',
      adminRequired: true,
      excludedReason: null,
    },
  ],
  totals: { bytes: 0, items: 1, reviewBytes: 0, reviewItems: 0, userDataBytes: 0, userDataItems: 0, adminItems: 1 },
};

describe('list', () => {
  it('maps removal apps to summaries and resets the cache when forced', async () => {
    const { service, calls } = makeService({
      listApps: async () => ({
        apps: [
          installedApp({
            id: 'msi',
            displayName: 'Office',
            hive: 'hklm',
            windowsInstaller: true,
            uninstallString: 'MsiExec.exe /X{11111111-2222-3333-4444-555555555555}',
          }),
          installedApp({ id: 'exe', displayName: 'Spotify', uninstallString: 'uninstall.exe /S' }),
        ],
        trusted: true,
      }),
    });

    const result = await service.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trusted).toBe(true);
    expect(result.elevated).toBe(false);
    expect(result.apps.map((app) => [app.id, app.kind, app.requiresAdmin, app.hasUninstaller])).toEqual([
      ['msi', 'msi', true, true],
      ['exe', 'exe', false, false],
    ]);

    await service.list(true);
    expect(calls.reset).toBe(1);
  });

  it('reports an empty list when the registry is untrusted', async () => {
    const { service } = makeService({ listApps: async () => ({ apps: [], trusted: false }) });
    const result = await service.list();
    expect(result).toMatchObject({ ok: true, trusted: false, apps: [] });
  });
});

describe('preview', () => {
  it('builds a plan, stores the token and maps every item kind', async () => {
    const app = installedApp({ id: 'app-1', displayName: 'Spotify', version: '1.2.3' });
    const plan = makePlan('app-1', {
      leftovers: [
        {
          id: 'file-1',
          path: 'C:\\Users\\x\\AppData\\Local\\Spotify',
          bytes: 100,
          class: 'app-data',
          grade: 'safe',
          evidence: ['Folder name matches Spotify'],
          adminRequired: false,
          defaultSelected: true,
          syncRoot: false,
          link: null,
          sharedWith: [],
        },
      ],
      registry: [
        {
          id: 'reg-1',
          hive: 'hkcu',
          path: 'Software\\Spotify',
          scope: 'vendor-root',
          grade: 'safe',
          adminRequired: false,
          excludedReason: null,
        },
      ],
      startup: [
        {
          entryId: 'entry-1',
          name: 'Spotify',
          source: 'hkcu-run',
          state: 'enabled',
          disabledKind: null,
          action: 'disable',
          match: 'path',
          protected: false,
          requiresAdmin: false,
        },
        {
          entryId: 'entry-2',
          name: 'Old Update',
          source: 'hkcu-run',
          state: 'disabled',
          disabledKind: 'windows',
          action: 'none',
          match: 'name',
          protected: false,
          requiresAdmin: false,
        },
      ],
      kept: [{ target: 'C:\\ProgramData\\Spotify', reason: 'needs-admin' }],
      totals: {
        bytes: 100,
        items: 3,
        reviewBytes: 0,
        reviewItems: 0,
        userDataBytes: 0,
        userDataItems: 0,
        adminItems: 0,
      },
    });
    const { service } = makeService({
      listApps: async () => ({ apps: [app], trusted: true }),
      buildPlan: async () => plan,
    });

    const result = await service.preview('app-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.planId).toBe('plan-1');
    expect(result.preview.app).toMatchObject({ id: 'app-1', displayName: 'Spotify', version: '1.2.3' });
    expect(result.preview.uninstaller).toMatchObject({
      raw: 'uninstall.exe /S',
      argv: ['/S'],
      kind: 'exe',
      launchable: true,
      interactiveOnly: true,
      silent: null,
    });
    expect(result.preview.items.map((item) => [item.id, item.kind])).toEqual([
      ['file-1', 'file'],
      ['reg-1', 'registry'],
      ['entry-1', 'startup'],
    ]);
    expect(result.preview.items[0]).toMatchObject({ label: 'Spotify', dataClass: 'app-data', defaultSelected: true });
    expect(result.preview.items[1]).toMatchObject({ target: 'HKCU\\Software\\Spotify', bytes: null });
    expect(result.preview.kept).toEqual([{ target: 'C:\\ProgramData\\Spotify', reason: 'needs-admin' }]);
    expect(result.preview.totals).toMatchObject({ items: 3 });
  });

  it('reports not-found for unknown ids and nothing-to-remove for empty plans', async () => {
    const { service } = makeService();
    expect(await service.preview('ghost')).toMatchObject({ ok: false, reason: 'not-found' });

    const empty = makeService({
      buildPlan: async ({ app }) => makePlan(app.id, { uninstaller: null }),
    });
    expect(await empty.service.preview('app-1')).toMatchObject({ ok: false, reason: 'nothing-to-remove' });
  });
});

describe('execute', () => {
  async function previewed(overrides: Partial<UninstallServiceDeps> = {}) {
    const harness = makeService(overrides);
    const preview = await harness.service.preview('app-1');
    expect(preview.ok).toBe(true);
    return harness;
  }

  it('refuses unknown and consumed plan tokens', async () => {
    const { service } = makeService();
    expect(await service.execute(BASE_REQUEST('ghost'))).toEqual({ ok: false, reason: 'unknown-plan' });

    const harness = await previewed();
    const first = await harness.service.execute(BASE_REQUEST('plan-1'));
    expect(first.ok).toBe(true);
    const second = await harness.service.execute(BASE_REQUEST('plan-1'));
    expect(second).toEqual({ ok: false, reason: 'consumed-plan' });
  });

  it('expires pending plans after the ttl', async () => {
    let clock = 1000;
    const harness = makeService({ now: () => clock });
    await harness.service.preview('app-1');
    clock += 15 * 60_000 + 1;
    expect(await harness.service.execute(BASE_REQUEST('plan-1'))).toEqual({ ok: false, reason: 'unknown-plan' });
  });

  it('runs admin plans non-elevated as a degraded removal', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const harness = await previewed({
      buildPlan: async () => makePlan('app-1', ADMIN_PLAN_OVERRIDES),
      executePlan: async (request) => {
        seen.push(request as unknown as Record<string, unknown>);
        return { ok: true, report: makeReport() };
      },
    });
    const result = await harness.service.execute(BASE_REQUEST('plan-1'));
    expect(result.ok).toBe(true);
    expect(seen[0]).toMatchObject({ degraded: true, elevated: false });
    expect(harness.calls.lock.acquires).toBe(1);
  });

  it('reports busy when another scan holds the lock', async () => {
    const { lock, state } = makeLock(false);
    const harness = await previewed({ lock });
    state.acquireOk = false;
    expect(await harness.service.execute(BASE_REQUEST('plan-1'))).toEqual({
      ok: false,
      reason: 'busy',
      running: 'analyze',
    });
  });

  it('runs the core executor in degraded mode, forwards events, refreshes caches and releases the lock', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const harness = await previewed({
      executePlan: async (request, deps) => {
        seen.push({ request, deps });
        deps.onEvent?.({ type: 'phase', phase: 'prepare', status: 'started' });
        return { ok: true, report: makeReport() };
      },
    });

    const result = await harness.service.execute(BASE_REQUEST('plan-1'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen).toHaveLength(1);
    expect(seen[0]!.request).toMatchObject({ degraded: true, elevated: false, selection: ['item-1'] });
    expect(harness.events.map((event) => event.type)).toEqual(['phase', 'finished']);
    expect(harness.events[0]).toMatchObject({ jobId: 'plan-1', phase: 'prepare', status: 'started' });
    expect(harness.events[1]).toMatchObject({ jobId: 'plan-1' });
    expect(harness.calls.reset).toBe(1);
    expect(harness.calls.marked).toEqual([1000]);
    expect(harness.calls.lock.acquires).toBe(1);
    expect(harness.calls.lock.releases).toBe(1);
  });

  it('exposes skip-waiting to the running job', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const captured: { shouldStop: (() => boolean) | null } = { shouldStop: null };
    const harness = await previewed({
      executePlan: async (_request, deps) => {
        captured.shouldStop = deps.shouldStopWaiting ?? null;
        await gate;
        return { ok: true, report: makeReport() };
      },
    });

    const pending = harness.service.execute(BASE_REQUEST('plan-1'));
    await Promise.resolve();
    expect(captured.shouldStop?.()).toBe(false);
    harness.service.skipWaiting();
    expect(captured.shouldStop?.()).toBe(true);
    release();
    await pending;
  });

  it('hands off only the job and app ids for an elevated relaunch', async () => {
    const harness = await previewed();
    expect(harness.service.elevatedHandoff('plan-1')).toEqual({ jobId: 'plan-1', appId: 'app-1' });
    expect(harness.service.elevatedHandoff('ghost')).toBeNull();

    await harness.service.execute(BASE_REQUEST('plan-1'));
    expect(harness.service.elevatedHandoff('plan-1')).toBeNull();
  });

  it('runs a previewed plan elevated without degradation', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const elevated = makeService({
      elevated: true,
      executePlan: async (request) => {
        seen.push(request as unknown as Record<string, unknown>);
        return { ok: true, report: makeReport() };
      },
    });
    const preview = await elevated.service.preview('app-1');
    expect(preview.ok).toBe(true);
    const result = await elevated.service.execute(BASE_REQUEST('plan-1'));
    expect(result.ok).toBe(true);
    expect(seen[0]).toMatchObject({ degraded: false, elevated: true });
  });
});
