import { lstatSync, readdirSync, readFileSync } from 'node:fs';
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
    listDirectory(path: string) {
      return readdirSync(path, { withFileTypes: true });
    },
    readFile(path: string) {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
  };
}
