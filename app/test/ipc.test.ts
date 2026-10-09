import { SnapshotStore } from '@dust/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngineHost } from '../src/main/host/engine-host';
import type { EngineHostDeps } from '../src/main/host/engine-host';
import {
  registerIpcHandlers,
  parseCleanPreviewRequest,
  parseFolderChildrenOptions,
  parseResultsSearchOptions,
} from '../src/main/ipc';
import type { IpcRegistrar } from '../src/main/ipc';
import { IPC } from '../src/shared/ipc';
import type {
  DashboardState,
  ScanEvent,
  StartAnalyzeResult,
  StartupDetailsEvent,
  SystemInfoStatic,
  UninstallExecuteRequest,
  UninstallLaunchHint,
} from '../src/shared/ipc';
import { FakeSession, emptyScanResult, nextEvent } from './fakes';
import { TempTree } from './fixtures';

class FakeRegistrar implements IpcRegistrar {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler registered for ${channel}`);
    return handler({}, ...args);
  }
}

describe('registerIpcHandlers', () => {
  const trees: TempTree[] = [];

  afterEach(() => {
    for (const tree of trees.splice(0)) tree.cleanup();
  });

  function makeHost(session: FakeSession, overrides: Partial<EngineHostDeps> = {}) {
    const tree = new TempTree();
    trees.push(tree);
    const store = new SnapshotStore({
      snapshotPath: `${tree.root}\\snapshot.json`,
      userPath: `${tree.root}\\user.json`,
    });
    const host = createEngineHost({
      store,
      pool: false,
      systemRoot: 'T:\\',
      listVolumes: () => [{ root: 'T:\\', label: 'Test', driveType: 'fixed', mediaType: 'unknown' }],
      getVolumeUsage: () => [{ volume: 'T:\\', label: 'Test', totalBytes: 1000, freeBytes: 400 }],
      createRules: () => [],
      createSession: () => session,
      ...overrides,
    });
    return { host };
  }

  it('routes dashboard, start, cancel and events through the host', async () => {
    const session = new FakeSession({ root: 'T:\\' });
    const { host } = makeHost(session);
    const registrar = new FakeRegistrar();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const revealed: string[] = [];
    const relaunched: number[] = [];
    const unsubscribe = registerIpcHandlers(
      registrar,
      host,
      {
        send: (channel, payload) => sent.push({ channel, payload }),
      },
      {
        revealPath: async (path) => {
          revealed.push(path);
        },
        relaunchElevated: async () => {
          relaunched.push(1);
        },
      },
    );

    const dashboard = (await registrar.invoke(IPC.dashboardGet)) as DashboardState;
    expect(dashboard.volumes.map((volume) => volume.root)).toEqual(['T:\\']);

    const invalid = (await registrar.invoke(IPC.scanStart, 'Z:\\')) as StartAnalyzeResult;
    expect(invalid).toEqual({ ok: false, reason: 'invalid-volume', message: 'unknown volume: Z:\\' });

    const finishedEvent = nextEvent(host, 'finished');
    const started = (await registrar.invoke(IPC.scanStart, 't:\\')) as StartAnalyzeResult;
    expect(started.ok).toBe(true);

    const cancelled = registrar.invoke(IPC.scanCancel);
    expect(session.cancelled).toBe(true);

    session.finish(emptyScanResult('T:\\', 'cancelled'));
    await finishedEvent;
    expect(await cancelled).toBe(true);
    await Promise.resolve();

    const forwarded = sent
      .filter((entry) => entry.channel === IPC.scanEvent)
      .map((entry) => entry.payload as ScanEvent);
    expect(forwarded.some((event) => event.type === 'started')).toBe(true);
    expect(forwarded.some((event) => event.type === 'finished')).toBe(true);

    const summary = (await registrar.invoke(IPC.resultsSummaryGet, 'Z:\\')) as {
      source: string;
      contributors: Record<string, unknown[]>;
    };
    expect(summary.source).toBe('empty');
    expect(summary.contributors.temp).toEqual([]);
    await expect(registrar.invoke(IPC.resultsChildrenGet, 'Z:\\', 'Z:\\', { limit: 'x' })).resolves.toEqual({
      rows: [],
      total: 0,
    });
    await expect(registrar.invoke(IPC.resultsSearch, 'Z:\\', 42)).resolves.toEqual({ rows: [], total: 0 });

    await registrar.invoke(IPC.revealPath, 'T:\\Temp');
    expect(revealed).toEqual(['T:\\Temp']);

    await registrar.invoke(IPC.relaunchElevated);
    expect(relaunched).toEqual([1]);

    unsubscribe();
    host.dispose();
  });

  it('routes preview, execute, dev cleanup and pins through the host', async () => {
    const { host } = makeHost(new FakeSession({ root: 'T:\\' }));
    const registrar = new FakeRegistrar();
    const unsubscribe = registerIpcHandlers(
      registrar,
      host,
      {
        send: () => {},
      },
      {
        revealPath: async () => {},
        relaunchElevated: async () => {},
      },
    );

    expect(await registrar.invoke(IPC.cleanPreview, { scope: 'quick' })).toEqual({
      ok: false,
      reason: 'empty-selection',
      message: 'Nothing to clean here',
    });
    expect(await registrar.invoke(IPC.cleanPreview, { scope: 'row', root: 'T:\\', paths: ['T:\\Temp'] })).toEqual({
      ok: false,
      reason: 'invalid-root',
      message: 'No scan data for T:\\ - run an Analyze first',
    });
    expect(await registrar.invoke(IPC.cleanPreview, 'not-a-request')).toEqual({
      ok: false,
      reason: 'failed',
      message: 'Invalid cleanup request',
    });
    expect(await registrar.invoke(IPC.cleanExecute, { cleanId: 'c1', planId: 'nope' })).toEqual({
      ok: false,
      reason: 'unknown-plan',
    });
    expect((await registrar.invoke(IPC.devCleanupGet, 'T:\\')) as { source: string }).toMatchObject({
      source: 'empty',
    });
    expect(await registrar.invoke(IPC.pinsSet, 'T:\\dev\\app', true)).toEqual({
      ok: true,
      pins: ['T:\\dev\\app'],
    });

    unsubscribe();
    host.dispose();
  });

  it('routes startup list, disable, enable and the launch hint through the host', async () => {
    const startup = {
      list: vi.fn(async () => ({
        ok: true as const,
        state: {
          entries: [],
          counts: { total: 0, enabled: 0, disabled: 0 },
          loadedAt: 1,
        },
      })),
      disable: vi.fn(async () => ({
        ok: false as const,
        reason: 'protected' as const,
        message: 'Protected by Dust. This entry cannot be disabled.',
      })),
      enable: vi.fn(async () => ({
        ok: false as const,
        reason: 'not-found' as const,
        message: 'This startup entry no longer exists.',
      })),
      removeBackup: vi.fn(async () => ({
        ok: false as const,
        reason: 'not-found' as const,
        message: 'This startup entry no longer exists.',
      })),
      records: vi.fn(async () => []),
      onDetails: vi.fn(() => () => {}),
    };
    const { host } = makeHost(new FakeSession({ root: 'T:\\' }), { startup });
    const registrar = new FakeRegistrar();
    const hint = { open: true, notice: { entryId: 'a1b2c3d4e5f60718', name: 'Discord', to: 'disabled' as const } };
    const unsubscribe = registerIpcHandlers(
      registrar,
      host,
      { send: () => {} },
      { revealPath: async () => {}, relaunchElevated: async () => {} },
      () => hint,
    );

    expect(await registrar.invoke(IPC.startupList)).toMatchObject({ ok: true });
    expect(await registrar.invoke(IPC.startupDisable, 'a1b2c3d4e5f60718')).toEqual({
      ok: false,
      reason: 'protected',
      message: 'Protected by Dust. This entry cannot be disabled.',
    });
    expect(await registrar.invoke(IPC.startupEnable, 'a1b2c3d4e5f60718')).toEqual({
      ok: false,
      reason: 'not-found',
      message: 'This startup entry no longer exists.',
    });
    expect(await registrar.invoke(IPC.startupHint)).toEqual(hint);

    unsubscribe();
    host.dispose();
  });

  it('forwards startup details events and stops forwarding after the disposer', () => {
    const listeners = new Set<(event: StartupDetailsEvent) => void>();
    const startup = {
      list: vi.fn(),
      disable: vi.fn(),
      enable: vi.fn(),
      removeBackup: vi.fn(),
      records: vi.fn(async () => []),
      onDetails: vi.fn((listener: (event: StartupDetailsEvent) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
    };
    const { host } = makeHost(new FakeSession({ root: 'T:\\' }), { startup });
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const dispose = registerIpcHandlers(
      new FakeRegistrar(),
      host,
      { send: (channel, payload) => sent.push({ channel, payload }) },
      { revealPath: async () => {}, relaunchElevated: async () => {} },
    );
    const event: StartupDetailsEvent = { details: [{ id: 'a1', publisher: 'Acme', iconDataUrl: null }] };

    expect(listeners.size).toBe(1);
    for (const listener of listeners) listener(event);
    expect(sent).toEqual([{ channel: IPC.startupEvent, payload: event }]);

    dispose();
    expect(listeners.size).toBe(0);
    host.dispose();
  });

  it('routes uninstall list, preview, execute, skip and hint through the host', async () => {
    const calls: string[] = [];
    const uninstall = {
      list: async (force?: boolean) => {
        calls.push(`list:${force === true}`);
        return { ok: true as const, apps: [], trusted: true, elevated: true, loadedAt: 5 };
      },
      preview: async (appId: string) => {
        calls.push(`preview:${appId}`);
        return { ok: false as const, reason: 'not-found' as const, message: 'gone' };
      },
      execute: async (request: UninstallExecuteRequest) => {
        calls.push(`execute:${request.planId}`);
        return { ok: false as const, reason: 'unknown-plan' as const };
      },
      skipWaiting: () => {
        calls.push('skip');
      },
      elevatedHandoff: () => null,
      onEvent: () => () => {},
      runUninstaller: async () => ({ ok: false as const, reason: 'not-found' as const, message: 'gone' }),
    };
    const { host } = makeHost(new FakeSession({ root: 'T:\\' }), { uninstall });
    const registrar = new FakeRegistrar();
    const hint: UninstallLaunchHint = {
      open: true,
      appId: null,
      notice: null,
      stalePending: false,
      runningJobId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    };
    const unsubscribe = registerIpcHandlers(
      registrar,
      host,
      { send: () => {} },
      { revealPath: async () => {}, relaunchElevated: async () => {} },
      () => null,
      () => hint,
    );

    expect(await registrar.invoke(IPC.uninstallList, true)).toMatchObject({ ok: true });
    expect(await registrar.invoke(IPC.uninstallPreview, 'app-1')).toMatchObject({ reason: 'not-found' });
    expect(
      await registrar.invoke(IPC.uninstallExecute, {
        jobId: 'plan-9',
        planId: 'plan-9',
        selection: ['a', 5],
      }),
    ).toMatchObject({ reason: 'unknown-plan' });
    await registrar.invoke(IPC.uninstallSkipWaiting);
    expect(await registrar.invoke(IPC.uninstallHint)).toEqual(hint);
    expect(calls).toEqual(['list:true', 'preview:app-1', 'execute:plan-9', 'skip']);

    unsubscribe();
    host.dispose();
  });

  it('routes system info and live samples through the host', async () => {
    const snapshot: SystemInfoStatic = {
      capturedAt: 5,
      hardwareAvailable: true,
      hardwarePending: false,
      os: { name: 'Windows 11 Pro', version: null, build: '26200.9457', arch: 'x64' },
      hostname: 'dev-machine',
      uptimeMs: 1000,
      cpu: null,
      gpus: [],
      board: null,
      bios: null,
    };
    const systemInfo = {
      get: vi.fn(async () => snapshot),
      live: vi.fn(() => ({ cpuPercent: 7, memTotalBytes: 100, memUsedBytes: 40, memAvailableBytes: 60 })),
      invalidate: vi.fn(),
    };
    const { host } = makeHost(new FakeSession({ root: 'T:\\' }), { systemInfo });
    const registrar = new FakeRegistrar();
    const unsubscribe = registerIpcHandlers(
      registrar,
      host,
      { send: () => {} },
      { revealPath: async () => {}, relaunchElevated: async () => {} },
    );

    await expect(registrar.invoke(IPC.systemInfoGet, true)).resolves.toEqual(snapshot);
    expect(systemInfo.get).toHaveBeenCalledWith(true);
    await expect(registrar.invoke(IPC.systemInfoGet, 'not-a-boolean')).resolves.toEqual(snapshot);
    expect(systemInfo.get).toHaveBeenLastCalledWith(false);
    await expect(registrar.invoke(IPC.systemInfoLive)).resolves.toEqual({
      cpuPercent: 7,
      memTotalBytes: 100,
      memUsedBytes: 40,
      memAvailableBytes: 60,
    });

    unsubscribe();
    host.dispose();
  });
});

describe('parseCleanPreviewRequest', () => {
  it('returns null for malformed payloads', () => {
    expect(parseCleanPreviewRequest(null)).toBeNull();
    expect(parseCleanPreviewRequest('x')).toBeNull();
    expect(parseCleanPreviewRequest([])).toBeNull();
    expect(parseCleanPreviewRequest({ scope: 'nope' })).toBeNull();
    expect(parseCleanPreviewRequest({ scope: 'row' })).toBeNull();
    expect(parseCleanPreviewRequest({ scope: 'row', root: '' })).toBeNull();
  });

  it('parses valid requests and filters paths to strings', () => {
    expect(parseCleanPreviewRequest({ scope: 'quick' })).toEqual({ scope: 'quick' });
    expect(parseCleanPreviewRequest({ scope: 'row', root: 'T:\\' })).toEqual({
      scope: 'row',
      root: 'T:\\',
      paths: [],
    });
    expect(parseCleanPreviewRequest({ scope: 'dev', root: 'T:\\', paths: ['T:\\a', 5] })).toEqual({
      scope: 'dev',
      root: 'T:\\',
      paths: ['T:\\a'],
    });
  });
});

describe('results option parsers', () => {
  it('keeps only well-typed paging values', () => {
    expect(parseFolderChildrenOptions({ limit: 50, offset: 'x', sort: 'name', hideDanger: true })).toEqual({
      limit: 50,
      offset: undefined,
      sort: 'name',
      hideDanger: true,
    });
    expect(parseFolderChildrenOptions(null)).toEqual({
      limit: undefined,
      offset: undefined,
      sort: 'size',
      hideDanger: false,
    });
    expect(parseResultsSearchOptions({ limit: Infinity, hideDanger: 'yes' })).toEqual({
      limit: undefined,
      hideDanger: false,
    });
  });
});
