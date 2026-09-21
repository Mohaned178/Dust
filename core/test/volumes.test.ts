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
