import { describe, expect, it } from 'vitest';
import {
  formatBios,
  formatCapturedAt,
  formatMemory,
  formatSystemInfoText,
  formatUptime,
  joinBoard,
} from '../../renderer/src/system-info';
import { makeSystemInfo, makeSystemInfoLive } from './fakes';

describe('formatMemory', () => {
  it('shows one decimal for fractional gigabytes and drops .0', () => {
    expect(formatMemory(32 * 1024 ** 3)).toBe('32 GB');
    expect(formatMemory(19_757_772_800)).toBe('18.4 GB');
    expect(formatMemory(8 * 1024 ** 3)).toBe('8 GB');
    expect(formatMemory(Number.NaN)).toBe('—');
  });
});

describe('formatUptime', () => {
  it('formats days, hours, minutes and the under-a-minute case', () => {
    expect(formatUptime((2 * 24 + 4) * 3_600_000)).toBe('2d 4h');
    expect(formatUptime(2 * 24 * 3_600_000)).toBe('2d');
    expect(formatUptime((4 * 60 + 12) * 60_000)).toBe('4h 12m');
    expect(formatUptime(4 * 3_600_000)).toBe('4h');
    expect(formatUptime(12 * 60_000)).toBe('12m');
    expect(formatUptime(30_000)).toBe('under a minute');
  });

  it('returns null for invalid input', () => {
    expect(formatUptime(Number.NaN)).toBeNull();
    expect(formatUptime(-1)).toBeNull();
  });
});

describe('formatCapturedAt', () => {
  it('renders local time as YYYY-MM-DD HH:MM', () => {
    expect(formatCapturedAt(new Date(2026, 8, 27, 14, 32).getTime())).toBe('2026-09-27 14:32');
    expect(formatCapturedAt(new Date(2026, 0, 5, 9, 7).getTime())).toBe('2026-01-05 09:07');
  });
});

describe('joinBoard and formatBios', () => {
  it('joins manufacturer and product without duplicating shared text', () => {
    expect(joinBoard('ASUS', 'ROG STRIX B550-F')).toBe('ASUS ROG STRIX B550-F');
    expect(joinBoard('ASUSTeK COMPUTER INC.', 'ASUSTeK COMPUTER INC. ROG STRIX B550-F')).toBe(
      'ASUSTeK COMPUTER INC. ROG STRIX B550-F',
    );
    expect(joinBoard(null, 'B450M-A PRO MAX II')).toBe('B450M-A PRO MAX II');
    expect(joinBoard('ASUS', null)).toBe('ASUS');
    expect(joinBoard(null, null)).toBeNull();
  });

  it('formats BIOS version and date independently', () => {
    expect(formatBios({ version: '2803', date: '2023-04-12' })).toBe('2803 (2023-04-12)');
    expect(formatBios({ version: '2803', date: null })).toBe('2803');
    expect(formatBios({ version: null, date: '2023-04-12' })).toBe('2023-04-12');
    expect(formatBios({ version: null, date: null })).toBeNull();
  });
});

describe('formatSystemInfoText', () => {
  it('builds the exact report block', () => {
    expect(formatSystemInfoText(makeSystemInfo(), makeSystemInfoLive())).toBe(
      [
        'Dust System Info',
        'Captured: 2026-09-27 14:32',
        '',
        'OS: Windows 11 Pro 25H2 (Build 26200.9457)',
        'Arch: x64',
        'Hostname: dev-machine',
        'Uptime: 2d 4h',
        '',
        'CPU: AMD Ryzen 7 5800X (8 cores / 16 threads)',
        'RAM: 32 GB total · 18.4 GB used',
        '',
        'GPU: NVIDIA GeForce RTX 4070 (Driver 560.94)',
        '',
        'Motherboard: ASUSTeK COMPUTER INC. ROG STRIX B550-F GAMING',
        'BIOS: 2803 (2023-04-12)',
      ].join('\n'),
    );
  });

  it('omits missing sections instead of printing placeholders', () => {
    const text = formatSystemInfoText(
      makeSystemInfo({
        hardwareAvailable: false,
        os: { name: null, version: null, build: null, arch: null },
        hostname: null,
        uptimeMs: null,
        cpu: null,
        gpus: [],
        board: null,
        bios: null,
      }),
      null,
    );
    expect(text).toBe('Dust System Info\nCaptured: 2026-09-27 14:32');
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });

  it('formats GPUs without a driver version as a bare name', () => {
    const text = formatSystemInfoText(
      makeSystemInfo({ gpus: [{ name: 'Microsoft Basic Display Adapter', driverVersion: null }] }),
      null,
    );
    expect(text).toContain('GPU: Microsoft Basic Display Adapter');
    expect(text).not.toContain('(Driver');
  });
});
