import { describe, expect, it } from 'vitest';
import { defaultWorkersForVolume } from '../src/scan/limits';

describe('defaultWorkersForVolume', () => {
  it('uses two workers for spinning disks', () => {
    expect(defaultWorkersForVolume('hdd')).toBe(2);
  });

  it('falls back to the default count for ssd and unknown media', () => {
    const ssd = defaultWorkersForVolume('ssd');
    const unknown = defaultWorkersForVolume(undefined);
    expect(ssd).toBeGreaterThanOrEqual(4);
    expect(unknown).toBe(ssd);
  });
});
