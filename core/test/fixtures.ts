import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export class Fixture {
  readonly root: string;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'dust-fixture-'));
  }

  dir(rel: string): string {
    const path = join(this.root, rel);
    mkdirSync(path, { recursive: true });
    return path;
  }

  file(rel: string, content = '', mtimeMs?: number): string {
    const path = join(this.root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    if (mtimeMs !== undefined) {
      const seconds = mtimeMs / 1000;
      utimesSync(path, seconds, seconds);
    }
    return path;
  }

  link(rel: string, target: string): string {
    const path = join(this.root, rel);
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
    return path;
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
