import { join } from 'node:path';
import type { StorePaths } from '@dust/core';

export function createStorePaths(userDataDir: string): StorePaths {
  return {
    snapshotPath: join(userDataDir, 'snapshot.json'),
    userPath: join(userDataDir, 'user.json'),
  };
}

export function resolveWorkerPath(mainDir: string): string {
  return join(mainDir, 'worker.cjs');
}
