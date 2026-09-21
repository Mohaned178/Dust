import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScanSession } from '@dust/core';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TempTree } from './fixtures';

const workerEntry = fileURLToPath(new URL('../../core/src/scan/worker-entry.ts', import.meta.url));

describe('bundled scan worker', () => {
  let bundleDir: string;
  let workerPath: string;
  let tree: TempTree;

  beforeAll(async () => {
    bundleDir = mkdtempSync(join(tmpdir(), 'dust-worker-bundle-'));
    workerPath = join(bundleDir, 'worker.cjs');
    await build({
      entryPoints: [workerEntry],
      outfile: workerPath,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      logLevel: 'silent',
    });
    tree = new TempTree();
    tree.file('a/one.bin', '0123456789');
    tree.file('b/two.bin', '12345');
  });

  afterAll(() => {
    rmSync(bundleDir, { recursive: true, force: true });
    tree.cleanup();
  });

  it('runs a pooled scan through the production bundle', async () => {
    const session = new ScanSession({ root: tree.root, pool: { workerPath, workers: 2 } });
    const result = await session.start();

    expect(result.status).toBe('complete');
    expect(result.filesScanned).toBe(2);
    expect(result.bytesSeen).toBe(15);
    expect(result.tree.get(tree.root)?.bytes).toBe(15);
  });
});
