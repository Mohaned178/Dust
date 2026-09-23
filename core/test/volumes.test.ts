import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getVolumeUsage, listFixedVolumes } from '../src/system/volumes';

describe('getVolumeUsage', () => {
  it('reports real numbers for the system drive', (ctx) => {
    if (process.platform !== 'win32') {
      ctx.skip();
      return;
    }
    const [usage] = getVolumeUsage(['C:\\']);
    expect(usage).toBeDefined();
    expect(typeof usage!.totalBytes).toBe('number');
    expect(typeof usage!.freeBytes).toBe('number');
    expect(usage!.totalBytes!).toBeGreaterThanOrEqual(usage!.freeBytes!);
  });

  it('returns nulls for a volume that cannot exist', (ctx) => {
    if (process.platform !== 'win32') {
      ctx.skip();
      return;
    }
    const [usage] = getVolumeUsage(['\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\']);
    expect(usage).toEqual({ volume: '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\', label: null, totalBytes: null, freeBytes: null });
  });

  it('falls through to nulls for an unmounted drive letter on every platform', () => {
    let letter = '';
    for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
      const candidate = String.fromCharCode(code);
      if (!existsSync(`${candidate}:\\`)) {
        letter = candidate;
        break;
      }
    }
    expect(letter).not.toBe('');

    const [usage] = getVolumeUsage([`${letter}:\\`]);
    expect(usage).toEqual({ volume: `${letter}:\\`, label: null, totalBytes: null, freeBytes: null });
  });
});

describe('listFixedVolumes', () => {
  it('lists fixed drive roots in drive-letter form', (ctx) => {
    if (process.platform !== 'win32') {
      ctx.skip();
      return;
    }
    const volumes = listFixedVolumes();
    expect(volumes.length).toBeGreaterThan(0);
    for (const volume of volumes) {
      expect(volume).toMatch(/^[A-Za-z]:\\$/);
    }
  });
});
