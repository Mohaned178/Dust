import type { SystemInfoStatic } from '@dust/core';
import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_INFO_TTL_MS, createSystemInfoService } from '../src/main/host/system-info';

function snapshot(capturedAt: number): SystemInfoStatic {
  return {
    capturedAt,
    hardwareAvailable: true,
    os: { name: 'Windows 11 Pro', version: '25H2', build: '26200.9457', arch: 'x64' },
    hostname: 'dev-machine',
    uptimeMs: 1000,
    cpu: null,
    gpus: [],
    board: null,
    bios: null,
  };
}

describe('createSystemInfoService', () => {
  it('serves the cached snapshot within the TTL', async () => {
    let clock = 0;
    const load = vi.fn(async () => snapshot(clock));
    const service = createSystemInfoService({ load, now: () => clock });

    const first = await service.get();
    clock = SYSTEM_INFO_TTL_MS - 1;
    const second = await service.get();

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL, when forced, and after invalidate', async () => {
    let clock = 0;
    const load = vi.fn(async () => snapshot(clock));
    const service = createSystemInfoService({ load, now: () => clock });

    await service.get();
    clock = SYSTEM_INFO_TTL_MS;
    await service.get();
    expect(load).toHaveBeenCalledTimes(2);

    await service.get(true);
    expect(load).toHaveBeenCalledTimes(3);

    service.invalidate();
    await service.get();
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('shares an in-flight load', async () => {
    let release!: (value: SystemInfoStatic) => void;
    const load = vi.fn(() => new Promise<SystemInfoStatic>((resolve) => (release = resolve)));
    const service = createSystemInfoService({ load });

    const first = service.get();
    const second = service.get();
    release(snapshot(1));

    await expect(first).resolves.toMatchObject({ capturedAt: 1 });
    await expect(second).resolves.toMatchObject({ capturedAt: 1 });
    expect(load).toHaveBeenCalledTimes(1);
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
