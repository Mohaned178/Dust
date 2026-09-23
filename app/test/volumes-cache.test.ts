import type { VolumeInfo } from '@dust/core';
import { describe, expect, it, vi } from 'vitest';
import { createVolumeCache } from '../src/main/host/volumes';

const volumes: VolumeInfo[] = [{ root: 'C:\\', label: 'System', driveType: 'fixed' }];

describe('createVolumeCache', () => {
  it('loads once within the TTL', async () => {
    let clock = 0;
    const load = vi.fn(async () => volumes);
    const cache = createVolumeCache(load, 30_000, () => clock);

    expect(await cache.get()).toEqual(volumes);
    clock = 1_000;
    expect(await cache.get()).toEqual(volumes);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL and after invalidate', async () => {
    let clock = 0;
    const load = vi.fn(async () => volumes);
    const cache = createVolumeCache(load, 30_000, () => clock);

    await cache.get();
    clock = 30_001;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);

    cache.invalidate();
    await cache.get();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('shares an in-flight load', async () => {
    let resolveLoad!: (value: VolumeInfo[]) => void;
    const load = vi.fn(() => new Promise<VolumeInfo[]>((resolve) => (resolveLoad = resolve)));
    const cache = createVolumeCache(load, 30_000, () => 0);

    const first = cache.get();
    const second = cache.get();
    resolveLoad(volumes);

    expect(await first).toEqual(volumes);
    expect(await second).toEqual(volumes);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
