import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStorePaths, resolveWorkerPath } from '../src/main/paths';

describe('main paths', () => {
  it('places store files under the data directory', () => {
    const dataDir = join('dust-test', 'user-data');
    expect(createStorePaths(dataDir)).toEqual({
      snapshotPath: join(dataDir, 'snapshot.json'),
      userPath: join(dataDir, 'user.json'),
    });
  });

  it('resolves the worker bundle next to the main bundle', () => {
    const mainDir = join('dust-test', 'dist', 'main');
    expect(resolveWorkerPath(mainDir)).toBe(join(mainDir, 'worker.cjs'));
  });
});
