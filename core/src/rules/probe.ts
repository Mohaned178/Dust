import { lstatSync } from 'node:fs';
import type { FsProbe } from './types';

export function createNodeFsProbe(): FsProbe {
  return {
    exists(path: string): boolean {
      try {
        lstatSync(path);
        return true;
      } catch {
        return false;
      }
    },
    stat(path: string) {
      try {
        return lstatSync(path);
      } catch {
        return null;
      }
    },
  };
}
