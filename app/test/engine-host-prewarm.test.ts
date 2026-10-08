import { join } from 'node:path';
import { SnapshotStore, volumeRootOf } from '@dust/core';
import type { SystemInfoStatic, VolumeInfo } from '@dust/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineHost } from '../src/main/host/engine-host';
import type { EngineHostDeps } from '../src/main/host/engine-host';
import type { StartupService } from '../src/main/host/startup';
import type { SystemInfoService } from '../src/main/host/system-info';
import { TempTree } from './fixtures';

type Gate = { promise: Promise<void>; resolve: () => void };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function gate(): Gate {
  return deferred<void>();
}

const SNAPSHOT: SystemInfoStatic = {
  capturedAt: 1,
  hardwareAvailable: true,
  hardwarePending: false,
  os: { name: 'Windows 11 Pro', version: null, build: null, arch: 'x64' },
  hostname: null,
  uptimeMs: null,
  cpu: null,
  gpus: [],
  board: null,
  bios: null,
};

describe('engine host prewarm', () => {
  let tree: TempTree;
  let storeTree: TempTree;
  let store: SnapshotStore;
  const hosts: Array<{ dispose(): void }> = [];

  beforeEach(() => {
    tree = new TempTree();
    storeTree = new TempTree();
    store = new SnapshotStore({
      snapshotPath: join(storeTree.root, 'snapshot.json'),
      userPath: join(storeTree.root, 'user.json'),
    });
  });

  afterEach(() => {
    for (const host of hosts.splice(0)) host.dispose();
    vi.useRealTimers();
    tree.cleanup();
    storeTree.cleanup();
  });

  function setup(overrides: Partial<EngineHostDeps> = {}) {
    const log: string[] = [];
    const gates: Record<'usage' | 'systemInfo' | 'startup', Gate> = {
      usage: gate(),
      systemInfo: gate(),
      startup: gate(),
    };
    const root = volumeRootOf(tree.root)!;
    const listVolumes = vi.fn((): VolumeInfo[] => {
      log.push('volumes');
      return [{ root, label: 'Fixtures', driveType: 'fixed', mediaType: 'unknown' }];
    });
    const getVolumeUsage = vi.fn(async () => {
      log.push('usage:start');
      await gates.usage.promise;
      log.push('usage:end');
      return [{ volume: root, label: 'Fixtures', totalBytes: 1000, freeBytes: 400 }];
    });
    const systemInfo: SystemInfoService = {
      get: vi.fn(async () => {
        log.push('systemInfo:start');
        await gates.systemInfo.promise;
        log.push('systemInfo:end');
        return SNAPSHOT;
      }),
      live: vi.fn(() => ({ cpuPercent: null, memTotalBytes: 1, memUsedBytes: 0, memAvailableBytes: 1 })),
      invalidate: vi.fn(),
    };
    const startup: StartupService = {
      list: vi.fn(async () => {
        log.push('startup:start');
        await gates.startup.promise;
        log.push('startup:end');
        return { ok: false as const, message: 'unused' };
      }),
      disable: vi.fn(),
      enable: vi.fn(),
      removeBackup: vi.fn(),
      records: vi.fn(async () => []),
      onDetails: vi.fn(() => () => {}),
    };
    const host = createEngineHost({
      store,
      pool: false,
      systemRoot: root,
      listVolumes,
      getVolumeUsage,
      createRules: () => [],
      systemInfo,
      startup,
      ...overrides,
    });
    hosts.push(host);
    return { host, log, gates, listVolumes, getVolumeUsage, systemInfo, startup };
  }

  const tick = () => new Promise((resolve) => setImmediate(resolve));

  it('runs volumes and usage, then system info, then startup, each after the previous finished', async () => {
    const { host, log, gates } = setup();

    const run = host.prewarm();
    await tick();
    expect(log).toEqual(['volumes', 'usage:start']);

    gates.usage.resolve();
    await tick();
    expect(log.slice(-1)).toEqual(['systemInfo:start']);
    expect(log).not.toContain('startup:start');

    gates.systemInfo.resolve();
    await tick();
    expect(log.slice(-1)).toEqual(['startup:start']);

    gates.startup.resolve();
    await run;
    expect(log).toEqual([
      'volumes',
      'usage:start',
      'usage:end',
      'systemInfo:start',
      'systemInfo:end',
      'startup:start',
      'startup:end',
    ]);
  });

  it('returns the same promise on a second call and runs each step once', async () => {
    const { host, gates, listVolumes, systemInfo, startup } = setup();
    for (const gate of Object.values(gates)) gate.resolve();

    const first = host.prewarm();
    const second = host.prewarm();
    expect(second).toBe(first);
    await first;
    await host.prewarm();

    expect(listVolumes).toHaveBeenCalledTimes(1);
    expect(systemInfo.get).toHaveBeenCalledTimes(1);
    expect(startup.list).toHaveBeenCalledTimes(1);
  });

  it('swallows errors and still runs the later steps', async () => {
    const { host, gates, systemInfo, startup } = setup({
      listVolumes: () => {
        throw new Error('volumes failed');
      },
    });
    vi.mocked(systemInfo.get).mockRejectedValueOnce(new Error('system info failed'));
    for (const gate of Object.values(gates)) gate.resolve();

    await expect(host.prewarm()).resolves.toBeUndefined();

    expect(systemInfo.get).toHaveBeenCalledTimes(1);
    expect(startup.list).toHaveBeenCalledTimes(1);
  });

  it('is a no-op after dispose', async () => {
    const { host, gates, listVolumes, systemInfo, startup } = setup();
    for (const gate of Object.values(gates)) gate.resolve();
    host.dispose();

    await expect(host.prewarm()).resolves.toBeUndefined();

    expect(listVolumes).not.toHaveBeenCalled();
    expect(systemInfo.get).not.toHaveBeenCalled();
    expect(startup.list).not.toHaveBeenCalled();
  });

  it('stops between steps when disposed during a run', async () => {
    const { host, gates, systemInfo, startup } = setup();
    gates.usage.resolve();

    const run = host.prewarm();
    await tick();
    host.dispose();
    gates.systemInfo.resolve();
    await run;

    expect(startup.list).not.toHaveBeenCalled();
    expect(systemInfo.get).toHaveBeenCalledTimes(1);
  });

  it('schedules one prewarm 300 ms after the first dashboard when enabled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { host, gates, systemInfo, startup } = setup({ prewarmAfterFirstDashboard: true });
    for (const gate of Object.values(gates)) gate.resolve();

    await host.getDashboard();
    await host.getDashboard();
    expect(systemInfo.get).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(299);
    expect(systemInfo.get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(startup.list).toHaveBeenCalledTimes(1));
    expect(systemInfo.get).toHaveBeenCalledTimes(1);

    await host.getDashboard();
    await vi.advanceTimersByTimeAsync(1000);
    expect(systemInfo.get).toHaveBeenCalledTimes(1);
    expect(startup.list).toHaveBeenCalledTimes(1);
  });

  it('never schedules a prewarm when the flag is off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { host, gates, systemInfo, startup } = setup();
    for (const gate of Object.values(gates)) gate.resolve();

    await host.getDashboard();
    await vi.advanceTimersByTimeAsync(5000);

    expect(systemInfo.get).not.toHaveBeenCalled();
    expect(startup.list).not.toHaveBeenCalled();
  });

  it('cancels a scheduled prewarm on dispose', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { host, gates, systemInfo } = setup({ prewarmAfterFirstDashboard: true });
    for (const gate of Object.values(gates)) gate.resolve();

    await host.getDashboard();
    host.dispose();
    await vi.advanceTimersByTimeAsync(5000);

    expect(systemInfo.get).not.toHaveBeenCalled();
  });

  it('forwards startup detail events from the startup service', () => {
    const listeners = new Set<(event: unknown) => void>();
    const { host, startup } = setup();
    (startup.onDetails as ReturnType<typeof vi.fn>).mockImplementation((listener: (event: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const received: unknown[] = [];

    const off = host.onStartupEvent((event) => received.push(event));
    for (const listener of listeners) listener({ details: [] });
    off();

    expect(received).toEqual([{ details: [] }]);
    expect(listeners.size).toBe(0);
  });
});
