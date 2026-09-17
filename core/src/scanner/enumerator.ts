import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Entry } from '../model/types';

export interface ListResult {
  entries: Entry[];
  entryErrors: number;
}

export interface Enumerator {
  list(dir: string): ListResult;
}

export class NodeFsEnumerator implements Enumerator {
  list(dir: string): ListResult {
    const entries: Entry[] = [];
    let entryErrors = 0;
    const dirents = readdirSync(dir, { withFileTypes: true });

    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        entries.push({ name: dirent.name, kind: 'dir', size: 0, mtimeMs: 0 });
      } else if (dirent.isSymbolicLink()) {
        entries.push({ name: dirent.name, kind: 'link', size: 0, mtimeMs: 0 });
      } else {
        try {
          const stats = lstatSync(join(dir, dirent.name));
          entries.push({ name: dirent.name, kind: 'file', size: stats.size, mtimeMs: stats.mtimeMs });
        } catch {
          entryErrors += 1;
        }
      }
    }

    return { entries, entryErrors };
  }
}
