import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export class TempTree {
  readonly root: string;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'dust-app-fixture-'));
  }

  dir(rel: string): string {
    const path = join(this.root, rel);
    mkdirSync(path, { recursive: true });
    return path;
  }

  file(rel: string, content = ''): string {
    const path = join(this.root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
