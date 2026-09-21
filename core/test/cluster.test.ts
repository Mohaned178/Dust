import { describe, expect, it } from 'vitest';
import { roundUpToCluster, volumeClusterSize } from '../src/system/cluster';

describe('roundUpToCluster', () => {
  it('rounds file sizes up to whole clusters', () => {
    expect(roundUpToCluster(0, 4096)).toBe(0);
    expect(roundUpToCluster(1, 4096)).toBe(4096);
    expect(roundUpToCluster(4096, 4096)).toBe(4096);
    expect(roundUpToCluster(4097, 4096)).toBe(8192);
  });

  it('falls back to 4096 for invalid cluster sizes', () => {
    expect(roundUpToCluster(1, 0)).toBe(4096);
    expect(roundUpToCluster(5000, Number.NaN)).toBe(8192);
  });
});

describe('volumeClusterSize', () => {
  it('falls back to 4096 when the volume cannot be queried', () => {
    expect(volumeClusterSize('Q:\\definitely-not-a-volume')).toBe(4096);
  });

  it('returns a positive cluster size for the current drive', () => {
    expect(volumeClusterSize(process.cwd())).toBeGreaterThan(0);
  });
});
