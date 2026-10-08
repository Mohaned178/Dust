import { describe, expect, it, vi } from 'vitest';
import {
  composeSystemInfo,
  querySystemHardware,
  readSystemInfoBase,
  getSystemInfoStatic,
} from '../src/system/system-info';
import type { NativeSystemInfo, SystemHardware, SystemInfoBase, SystemInfoOsInfo } from '../src/system/system-info';

function osInfo(overrides: Partial<SystemInfoOsInfo> = {}): SystemInfoOsInfo {
  return {
    hostname: () => 'dev-machine',
    uptimeSeconds: () => 3600,
    version: () => 'Windows 11 Pro',
    release: () => '10.0.26200',
    arch: () => 'x64',
    cpus: () => [{ model: 'Node CPU   ' }, { model: 'Node CPU' }, { model: 'Node CPU' }],
    ...overrides,
  };
}

const NATIVE: NativeSystemInfo = {
  displayVersion: '25H2',
  build: '26200.9457',
  architecture: 12,
  cpuModel: 'Native CPU',
  physicalCores: 4,
  logicalThreads: 8,
  board: { manufacturer: 'ASUS', product: 'ROG' },
  bios: { version: '2803', date: '2023-04-12' },
};

const HARDWARE: SystemHardware = {
  physicalCores: 6,
  logicalThreads: 12,
  gpus: [{ name: 'RTX 4070', driverVersion: '560.94', vramBytes: 8 * 1024 ** 3, vramUncertain: false }],
};

function base(overrides: Partial<SystemInfoBase> = {}): SystemInfoBase {
  return {
    detailsAvailable: true,
    os: { name: 'Windows 11 Pro', version: '25H2', build: '26200.9457', arch: 'x64' },
    hostname: 'dev-machine',
    uptimeMs: 1000,
    cpu: { model: 'CPU', physicalCores: null, logicalThreads: null },
    board: null,
    bios: null,
    ...overrides,
  };
}

describe('readSystemInfoBase', () => {
  it('uses the native values when win32 reads them', () => {
    const readNative = vi.fn(() => NATIVE);

    const result = readSystemInfoBase({ osInfo: osInfo(), platform: 'win32', readNative });

    expect(readNative).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      detailsAvailable: true,
      os: { name: 'Windows 11 Pro', version: '25H2', build: '26200.9457', arch: 'ARM64' },
      hostname: 'dev-machine',
      uptimeMs: 3_600_000,
      cpu: { model: 'Native CPU', physicalCores: 4, logicalThreads: 8 },
      board: { manufacturer: 'ASUS', product: 'ROG' },
      bios: { version: '2803', date: '2023-04-12' },
    });
  });

  it('falls back to os-module values when native reading returns null', () => {
    const result = readSystemInfoBase({ osInfo: osInfo(), platform: 'win32', readNative: () => null });

    expect(result.detailsAvailable).toBe(false);
    expect(result.os).toEqual({ name: 'Windows 11 Pro', version: null, build: '10.0.26200', arch: 'x64' });
    expect(result.cpu).toEqual({ model: 'Node CPU', physicalCores: null, logicalThreads: 3 });
    expect(result.board).toBeNull();
    expect(result.bios).toBeNull();
  });

  it('never calls the native reader off win32', () => {
    const readNative = vi.fn(() => NATIVE);

    const result = readSystemInfoBase({ osInfo: osInfo(), platform: 'linux', readNative });

    expect(readNative).not.toHaveBeenCalled();
    expect(result.detailsAvailable).toBe(false);
  });

  it('has no cpu when neither source names one', () => {
    const result = readSystemInfoBase({
      osInfo: osInfo({ cpus: () => [] }),
      platform: 'win32',
      readNative: () => ({ ...NATIVE, cpuModel: null, physicalCores: null, logicalThreads: null }),
    });

    expect(result.cpu).toBeNull();
  });

  it('keeps native cores over the thread count of the os module', () => {
    const result = readSystemInfoBase({
      osInfo: osInfo(),
      platform: 'win32',
      readNative: () => ({ ...NATIVE, logicalThreads: null }),
    });

    expect(result.cpu).toEqual({ model: 'Native CPU', physicalCores: 4, logicalThreads: 3 });
  });

  it('survives a non-finite uptime', () => {
    const result = readSystemInfoBase({
      osInfo: osInfo({ uptimeSeconds: () => Number.NaN }),
      platform: 'linux',
    });

    expect(result.uptimeMs).toBeNull();
  });
});

describe('composeSystemInfo', () => {
  it('is pending while hardware is missing and details are available', () => {
    const result = composeSystemInfo(base(), null, { pending: true, now: () => 7 });

    expect(result).toMatchObject({
      capturedAt: 7,
      hardwarePending: true,
      hardwareAvailable: true,
      gpus: [],
    });
  });

  it('is not available when pending but the base had no native details', () => {
    const result = composeSystemInfo(base({ detailsAvailable: false }), null, { pending: true });

    expect(result).toMatchObject({ hardwarePending: true, hardwareAvailable: false });
  });

  it('is failed when hardware is missing and nothing is pending', () => {
    const result = composeSystemInfo(base(), null, { pending: false });

    expect(result).toMatchObject({ hardwarePending: false, hardwareAvailable: false, gpus: [] });
  });

  it('is loaded when hardware is known, even if pending was asked for', () => {
    const result = composeSystemInfo(base(), HARDWARE, { pending: true });

    expect(result.hardwarePending).toBe(false);
    expect(result.hardwareAvailable).toBe(true);
    expect(result.gpus).toEqual(HARDWARE.gpus);
  });

  it('fills missing core counts from the hardware but keeps the base ones', () => {
    const filled = composeSystemInfo(base(), HARDWARE, { pending: false });
    expect(filled.cpu).toEqual({ model: 'CPU', physicalCores: 6, logicalThreads: 12 });

    const kept = composeSystemInfo(base({ cpu: { model: 'CPU', physicalCores: 2, logicalThreads: 4 } }), HARDWARE, {
      pending: false,
    });
    expect(kept.cpu).toEqual({ model: 'CPU', physicalCores: 2, logicalThreads: 4 });
  });

  it('leaves cpu null when the base has none, and passes the other base fields through', () => {
    const result = composeSystemInfo(
      base({ cpu: null, board: { manufacturer: 'A', product: 'B' }, bios: { version: '1', date: null } }),
      HARDWARE,
      { pending: false },
    );

    expect(result.cpu).toBeNull();
    expect(result.board).toEqual({ manufacturer: 'A', product: 'B' });
    expect(result.bios).toEqual({ version: '1', date: null });
    expect(result.hostname).toBe('dev-machine');
  });

  it('uses Date.now when no clock is given', () => {
    const before = Date.now();
    const result = composeSystemInfo(base(), null, { pending: false });
    expect(result.capturedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('querySystemHardware', () => {
  const output = JSON.stringify({
    cpu: [{ Name: 'CPU', NumberOfCores: 6, NumberOfLogicalProcessors: 12, Architecture: 9 }],
    gpus: [
      {
        Name: 'NVIDIA GeForce RTX 4060',
        DriverVersion: '32.0.16.1714',
        PNPDeviceID: 'PCI\\VEN_10DE&DEV_2504&REV_A1\\4&2283f625&0&0019',
        AdapterRAM: 4293918720,
      },
      { Name: 'Basic Display Adapter', AdapterRAM: 1048576 },
    ],
    vram: [{ matchingDeviceId: 'PCI\\VEN_10DE&DEV_2504', qwMemorySize: 8589934592 }],
  });

  it('parses GPUs and core counts from the query output', async () => {
    const result = await querySystemHardware({ query: async () => output });

    expect(result.physicalCores).toBe(6);
    expect(result.logicalThreads).toBe(12);
    expect(result.gpus).toEqual([
      { name: 'NVIDIA GeForce RTX 4060', driverVersion: '32.0.16.1714', vramBytes: 8589934592, vramUncertain: false },
      { name: 'Basic Display Adapter', driverVersion: null, vramBytes: 1048576, vramUncertain: true },
    ]);
  });

  it('throws when the output is empty or not JSON', async () => {
    await expect(querySystemHardware({ query: async () => '   ' })).rejects.toThrow('Could not read hardware details');
    await expect(querySystemHardware({ query: async () => 'not json' })).rejects.toThrow(
      'Could not read hardware details',
    );
  });

  it('throws when the output is JSON but not an object', async () => {
    await expect(querySystemHardware({ query: async () => '[1,2]' })).rejects.toThrow();
  });

  it('propagates a failing query', async () => {
    await expect(
      querySystemHardware({
        query: async () => {
          throw new Error('powershell failed');
        },
      }),
    ).rejects.toThrow('powershell failed');
  });
});

describe('getSystemInfoStatic without a query', () => {
  it('composes the base only off win32', async () => {
    const result = await getSystemInfoStatic({ platform: 'linux', osInfo: osInfo(), now: () => 5 });

    expect(result).toMatchObject({ capturedAt: 5, hardwareAvailable: false, hardwarePending: false, gpus: [] });
  });
});
