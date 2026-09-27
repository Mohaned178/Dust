import { describe, expect, it } from 'vitest';
import {
  SYSTEM_INFO_SCRIPT,
  mapProcessorArchitecture,
  normalizeOsArch,
  parseSystemInfoJson,
} from '../src/system/system-info';

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
