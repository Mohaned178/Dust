import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPersistentCache, removePersistentCache, writePersistentCache } from '../src/system/persistent-cache';

describe('persistent cache', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function cacheFile(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dust-cache-'));
    dirs.push(dir);
    return join(dir, 'cache.json');
  }

  it('round-trips values with timestamps', () => {
    const path = cacheFile();
    writePersistentCache(path, { hello: 'world' }, () => 1000);
    expect(readPersistentCache(path, 500, () => 1400)).toEqual({ hello: 'world' });
  });

  it('treats expired entries as missing', () => {
    const path = cacheFile();
    writePersistentCache(path, [1, 2, 3], () => 1000);
    expect(readPersistentCache(path, 100, () => 1200)).toBeNull();
  });

  it('returns null for corrupt or missing files', () => {
    const path = cacheFile();
    writeFileSync(path, 'not json');
    expect(readPersistentCache(path, 500)).toBeNull();
    expect(readPersistentCache(cacheFile(), 500)).toBeNull();
  });

  it('removes cached files', () => {
    const path = cacheFile();
    writePersistentCache(path, { a: 1 });
    removePersistentCache(path);
    expect(readPersistentCache(path, 500)).toBeNull();
  });
});
