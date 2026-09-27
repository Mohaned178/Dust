import { describe, expect, it } from 'vitest';
import {
  SYSTEM_INFO_SCRIPT,
  createCpuUsageSampler,
  getSystemInfoStatic,
  mapProcessorArchitecture,
  normalizeOsArch,
  parseSystemInfoJson,
  readMemoryInfo,
} from '../src/system/system-info';
import type { CpuTimesSample, SystemInfoOsInfo } from '../src/system/system-info';

const FULL_FIXTURE = JSON.stringify({
  os: { displayVersion: '25H2', currentBuild: '26200', ubr: 9457 },
  cpu: [
    {
      Name: 'AMD Ryzen 5 5500                               ',
      NumberOfCores: 6,
      NumberOfLogicalProcessors: 12,
      Architecture: 9,
    },
  ],
  gpus: [{ Name: 'NVIDIA GeForce RTX 4060', DriverVersion: '32.0.16.1714' }],
  board: {
    Manufacturer: 'Micro-Star International Co., Ltd.',
    Product: 'B450M-A PRO MAX II (MS-7C52)',
  },
  bios: { SMBIOSBIOSVersion: 'A.10', ReleaseDate: '2023-10-26' },
});

describe('parseSystemInfoJson', () => {
  it('maps a full batch, trims values and joins the build', () => {
    expect(parseSystemInfoJson(FULL_FIXTURE)).toEqual({
      displayVersion: '25H2',
      build: '26200.9457',
      architecture: 9,
      cpuModel: 'AMD Ryzen 5 5500',
      physicalCores: 6,
      logicalThreads: 12,
      gpus: [{ name: 'NVIDIA GeForce RTX 4060', driverVersion: '32.0.16.1714' }],
      board: {
        manufacturer: 'Micro-Star International Co., Ltd.',
        product: 'B450M-A PRO MAX II (MS-7C52)',
      },
      bios: { version: 'A.10', date: '2023-10-26' },
    });
  });

  it('accepts single objects where arrays are expected', () => {
    const parsed = parseSystemInfoJson(
      JSON.stringify({
        cpu: { Name: 'CPU', NumberOfCores: 2, NumberOfLogicalProcessors: 4, Architecture: 0 },
        gpus: { Name: 'Adapter', DriverVersion: null },
      }),
    );
    expect(parsed?.cpuModel).toBe('CPU');
    expect(parsed?.architecture).toBe(0);
    expect(parsed?.gpus).toEqual([{ name: 'Adapter', driverVersion: null }]);
  });

  it('sums cores across sockets and drops empty GPU entries', () => {
    const parsed = parseSystemInfoJson(
      JSON.stringify({
        cpu: [
          { Name: 'Xeon', NumberOfCores: 8, NumberOfLogicalProcessors: 16 },
          { Name: 'Xeon', NumberOfCores: 8, NumberOfLogicalProcessors: 16 },
        ],
        gpus: [{ Name: '  ' }, { Name: 'Real GPU', DriverVersion: '' }],
      }),
    );
    expect(parsed?.physicalCores).toBe(16);
    expect(parsed?.logicalThreads).toBe(32);
    expect(parsed?.gpus).toEqual([{ name: 'Real GPU', driverVersion: null }]);
  });

  it('returns nulls for missing sections instead of inventing values', () => {
    expect(parseSystemInfoJson('{}')).toEqual({
      displayVersion: null,
      build: null,
      architecture: null,
      cpuModel: null,
      physicalCores: null,
      logicalThreads: null,
      gpus: [],
      board: null,
      bios: null,
    });
  });

  it('returns null for malformed or empty output', () => {
    expect(parseSystemInfoJson('')).toBeNull();
    expect(parseSystemInfoJson('not json')).toBeNull();
    expect(parseSystemInfoJson('[]')).toBeNull();
    expect(parseSystemInfoJson('null')).toBeNull();
  });
});

describe('architecture mapping', () => {
  it('maps CIM processor architecture codes and tolerates unknown codes', () => {
    expect(mapProcessorArchitecture(0)).toBe('x86');
    expect(mapProcessorArchitecture(5)).toBe('ARM');
    expect(mapProcessorArchitecture(9)).toBe('x64');
    expect(mapProcessorArchitecture(12)).toBe('ARM64');
    expect(mapProcessorArchitecture(1)).toBeNull();
    expect(mapProcessorArchitecture(null)).toBeNull();
  });

  it('normalizes Node arch strings for the fallback path', () => {
    expect(normalizeOsArch('ia32')).toBe('x86');
    expect(normalizeOsArch('x64')).toBe('x64');
    expect(normalizeOsArch('arm64')).toBe('ARM64');
    expect(normalizeOsArch('  ')).toBeNull();
  });
});

describe('SYSTEM_INFO_SCRIPT', () => {
  it('reads only the agreed sources and never touches identifiers', () => {
    expect(SYSTEM_INFO_SCRIPT).toContain('Win32_Processor');
    expect(SYSTEM_INFO_SCRIPT).toContain('Win32_VideoController');
    expect(SYSTEM_INFO_SCRIPT).toContain('Win32_BaseBoard');
    expect(SYSTEM_INFO_SCRIPT).toContain('Win32_BIOS');
    expect(SYSTEM_INFO_SCRIPT).not.toContain('Win32_PhysicalMemory');
    expect(SYSTEM_INFO_SCRIPT).not.toContain('AdapterRAM');
    expect(SYSTEM_INFO_SCRIPT).not.toContain('SerialNumber');
    expect(SYSTEM_INFO_SCRIPT).not.toContain('ProductName');
  });
});

function fakeOsInfo(overrides: Partial<SystemInfoOsInfo> = {}): SystemInfoOsInfo {
  return {
    hostname: () => 'dev-machine',
    uptimeSeconds: () => (2 * 24 + 4) * 3600,
    version: () => 'Windows 11 Pro',
    release: () => '10.0.26200',
    arch: () => 'x64',
    cpus: () => [{ model: 'AMD Ryzen 5 5500                               ' }, { model: 'AMD Ryzen 5 5500' }],
    ...overrides,
  };
}

describe('getSystemInfoStatic', () => {
  it('merges the queried batch with Node data', async () => {
    const snapshot = await getSystemInfoStatic({
      query: async () => FULL_FIXTURE,
      now: () => 1234,
      osInfo: fakeOsInfo(),
    });
    expect(snapshot).toEqual({
      capturedAt: 1234,
      hardwareAvailable: true,
      os: { name: 'Windows 11 Pro', version: '25H2', build: '26200.9457', arch: 'x64' },
      hostname: 'dev-machine',
      uptimeMs: ((2 * 24 + 4) * 3600) * 1000,
      cpu: { model: 'AMD Ryzen 5 5500', physicalCores: 6, logicalThreads: 12 },
      gpus: [{ name: 'NVIDIA GeForce RTX 4060', driverVersion: '32.0.16.1714' }],
      board: {
        manufacturer: 'Micro-Star International Co., Ltd.',
        product: 'B450M-A PRO MAX II (MS-7C52)',
      },
      bios: { version: 'A.10', date: '2023-10-26' },
    });
  });

  it('falls back to Node values when the query fails', async () => {
    const snapshot = await getSystemInfoStatic({
      query: async () => {
        throw new Error('powershell missing');
      },
      now: () => 1,
      osInfo: fakeOsInfo(),
    });
    expect(snapshot.hardwareAvailable).toBe(false);
    expect(snapshot.os).toEqual({ name: 'Windows 11 Pro', version: null, build: '10.0.26200', arch: 'x64' });
    expect(snapshot.cpu).toEqual({ model: 'AMD Ryzen 5 5500', physicalCores: null, logicalThreads: 2 });
    expect(snapshot.gpus).toEqual([]);
    expect(snapshot.board).toBeNull();
    expect(snapshot.bios).toBeNull();
  });

  it('falls back to the Node arch when the batch has no processor architecture', async () => {
    const snapshot = await getSystemInfoStatic({
      query: async () => JSON.stringify({ cpu: { Name: 'CPU' } }),
      osInfo: fakeOsInfo({ arch: () => 'arm64' }),
    });
    expect(snapshot.os.arch).toBe('ARM64');
  });

  it('returns Node data and no hardware when no query is available off Windows', async () => {
    const snapshot = await getSystemInfoStatic({ osInfo: fakeOsInfo(), platform: 'linux' });
    expect(snapshot.hardwareAvailable).toBe(false);
    expect(snapshot.hostname).toBe('dev-machine');
    expect(snapshot.cpu?.model).toBe('AMD Ryzen 5 5500');
  });
});

describe('createCpuUsageSampler', () => {
  it('returns null on the first sample and a rounded percent on the next', () => {
    const samples: CpuTimesSample[] = [
      { idle: 100, total: 200 },
      { idle: 170, total: 300 },
    ];
    const sample = createCpuUsageSampler(() => samples.shift() as CpuTimesSample);
    expect(sample()).toBeNull();
    expect(sample()).toBe(30);
  });

  it('returns null when no time elapsed or counters go backwards', () => {
    const samples: CpuTimesSample[] = [
      { idle: 100, total: 200 },
      { idle: 100, total: 200 },
      { idle: 90, total: 200 },
      { idle: 100, total: 300 },
    ];
    const sample = createCpuUsageSampler(() => samples.shift() as CpuTimesSample);
    expect(sample()).toBeNull();
    expect(sample()).toBeNull();
    expect(sample()).toBeNull();
    expect(sample()).toBe(90);
  });

  it('clamps a fully busy delta to 100', () => {
    const samples: CpuTimesSample[] = [
      { idle: 0, total: 1000 },
      { idle: 0, total: 2000 },
    ];
    const sample = createCpuUsageSampler(() => samples.shift() as CpuTimesSample);
    expect(sample()).toBeNull();
    expect(sample()).toBe(100);
  });
});

describe('readMemoryInfo', () => {
  it('reports consistent totals from Node', () => {
    const info = readMemoryInfo();
    expect(info.totalBytes).toBeGreaterThan(0);
    expect(info.availableBytes).toBeGreaterThan(0);
    expect(info.usedBytes).toBe(info.totalBytes - info.availableBytes);
  });
});
