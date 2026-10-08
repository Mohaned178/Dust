import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SystemHardware, SystemInfoBase } from '@dust/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HARDWARE_CACHE_TTL_MS, HARDWARE_RETRY_MS, createSystemInfoService } from '../src/main/host/system-info';

function base(cores: number | null = 8): SystemInfoBase {
  return {
    detailsAvailable: true,
    os: { name: 'Windows 11 Pro', version: '25H2', build: '26200.9457', arch: 'x64' },
    hostname: 'dev-machine',
    uptimeMs: 1000,
    cpu: { model: 'AMD Ryzen 7', physicalCores: cores, logicalThreads: 16 },
    board: null,
    bios: null,
  };
}

function hardware(name = 'RTX 4070'): SystemHardware {
  return {
    physicalCores: 8,
    logicalThreads: 16,
    gpus: [{ name, driverVersion: '560.94', vramBytes: 8 * 1024 ** 3, vramUncertain: false }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('createSystemInfoService', () => {
  let dir: string;
  let cacheFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dust-sysinfo-'));
    cacheFile = join(dir, 'hardware.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers pending on the first call and starts exactly one query', async () => {
    const query = deferred<SystemHardware>();
    const loadHardware = vi.fn(() => query.promise);
    const service = createSystemInfoService({ loadBase: () => base(), loadHardware, hardwareCacheFile: cacheFile });

    const first = await service.get();
    const second = await service.get();

    expect(first).toMatchObject({ hardwarePending: true, hardwareAvailable: true, gpus: [] });
    expect(second.hardwarePending).toBe(true);
    expect(loadHardware).toHaveBeenCalledTimes(1);

    query.resolve(hardware());
    await vi.waitFor(async () => expect((await service.get()).hardwarePending).toBe(false));
    const done = await service.get();
    expect(done.gpus.map((gpu) => gpu.name)).toEqual(['RTX 4070']);
    expect(loadHardware).toHaveBeenCalledTimes(1);
  });

  it('serves a disk cache at once and refreshes it exactly once', async () => {
    const seed = createSystemInfoService({
      loadBase: () => base(),
      loadHardware: async () => hardware('Old GPU'),
      hardwareCacheFile: cacheFile,
    });
    await seed.get();
    await vi.waitFor(async () => expect((await seed.get()).gpus).toHaveLength(1));

    const refreshed = deferred<SystemHardware>();
    const loadHardware = vi.fn(() => refreshed.promise);
    const service = createSystemInfoService({ loadBase: () => base(), loadHardware, hardwareCacheFile: cacheFile });

    const first = await service.get();
    expect(first.hardwarePending).toBe(false);
    expect(first.gpus[0]?.name).toBe('Old GPU');
    await service.get();
    expect(loadHardware).toHaveBeenCalledTimes(1);

    refreshed.resolve(hardware('New GPU'));
    await vi.waitFor(async () => expect((await service.get()).gpus[0]?.name).toBe('New GPU'));
    await service.get();
    expect(loadHardware).toHaveBeenCalledTimes(1);
  });

  it('ignores a disk cache older than the TTL', async () => {
    let clock = 1_000;
    const seed = createSystemInfoService({
      loadBase: () => base(),
      loadHardware: async () => hardware('Old GPU'),
      hardwareCacheFile: cacheFile,
      now: () => clock,
    });
    await seed.get();
    await vi.waitFor(async () => expect((await seed.get()).gpus).toHaveLength(1));

    clock += HARDWARE_CACHE_TTL_MS + 1;
    const loadHardware = vi.fn(() => new Promise<SystemHardware>(() => {}));
    const service = createSystemInfoService({
      loadBase: () => base(),
      loadHardware,
      hardwareCacheFile: cacheFile,
      now: () => clock,
    });

    expect(await service.get()).toMatchObject({ hardwarePending: true, gpus: [] });
    expect(loadHardware).toHaveBeenCalledTimes(1);
  });

  it('does not retry before retryMs after a failure and retries once after it', async () => {
    let clock = 0;
    const loadHardware = vi.fn<() => Promise<SystemHardware>>(async () => {
      throw new Error('powershell failed');
    });
    const service = createSystemInfoService({
      loadBase: () => base(),
      loadHardware,
      now: () => clock,
      retryMs: HARDWARE_RETRY_MS,
    });

    expect((await service.get()).hardwarePending).toBe(true);
    await vi.waitFor(() => expect(loadHardware).toHaveBeenCalledTimes(1));
    await tick();

    clock = HARDWARE_RETRY_MS - 1;
    const early = await service.get();
    expect(early).toMatchObject({ hardwarePending: false, gpus: [] });
    expect(loadHardware).toHaveBeenCalledTimes(1);

    clock = HARDWARE_RETRY_MS;
    expect((await service.get()).hardwarePending).toBe(true);
    expect(loadHardware).toHaveBeenCalledTimes(2);
  });

  it('awaits a fresh query when forced', async () => {
    const query = deferred<SystemHardware>();
    const service = createSystemInfoService({ loadBase: () => base(), loadHardware: () => query.promise });
    let settled = false;

    const forced = service.get(true).then((value) => {
      settled = true;
      return value;
    });
    await tick();
    expect(settled).toBe(false);

    query.resolve(hardware('Forced GPU'));
    const result = await forced;
    expect(result.hardwarePending).toBe(false);
    expect(result.gpus[0]?.name).toBe('Forced GPU');
  });

  it('keeps the cached hardware when a forced query fails', async () => {
    const calls: Array<() => Promise<SystemHardware>> = [
      async () => hardware('Cached GPU'),
      async () => {
        throw new Error('boom');
      },
    ];
    const service = createSystemInfoService({
      loadBase: () => base(),
      loadHardware: () => calls.shift()!(),
    });
    await service.get();
    await vi.waitFor(async () => expect((await service.get()).gpus).toHaveLength(1));

    const forced = await service.get(true);

    expect(forced.hardwarePending).toBe(false);
    expect(forced.gpus[0]?.name).toBe('Cached GPU');
    expect(calls).toHaveLength(0);
  });

  it('never queries on a platform other than win32', async () => {
    const loadBase = vi.fn(() => base());
    const service = createSystemInfoService({ loadBase, platform: 'linux', hardwareCacheFile: cacheFile });

    const result = await service.get();
    const forced = await service.get(true);

    expect(result).toMatchObject({ hardwarePending: false, gpus: [] });
    expect(forced).toMatchObject({ hardwarePending: false, gpus: [] });
    expect(loadBase).toHaveBeenCalledTimes(2);
  });

  it('never caches live values', () => {
    let cpu = 10;
    let used = 40;
    const sampleCpu = vi.fn(() => cpu);
    const readMemory = vi.fn(() => ({ totalBytes: 100, usedBytes: used, availableBytes: 100 - used }));
    const service = createSystemInfoService({ sampleCpu, readMemory });

    expect(service.live()).toEqual({
      cpuPercent: 10,
      memTotalBytes: 100,
      memUsedBytes: 40,
      memAvailableBytes: 60,
    });
    cpu = 90;
    used = 80;
    expect(service.live()).toEqual({
      cpuPercent: 90,
      memTotalBytes: 100,
      memUsedBytes: 80,
      memAvailableBytes: 20,
    });
    expect(sampleCpu).toHaveBeenCalledTimes(2);
    expect(readMemory).toHaveBeenCalledTimes(2);
  });
});
