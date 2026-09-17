import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanSession } from '../src/scanner/session';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { Fixture } from './fixtures';

const workerPath = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'scan', 'worker-entry.ts');
const poolOptions = { workers: 2, workerPath, execArgv: ['--import', 'tsx'] };

describe('ScanSession with the worker pool', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('returns the same tree as the legacy path', async () => {
    fixture.file('a.txt', 'aaaaa');
    fixture.file('node_modules/dep/index.js', 'bb');
    fixture.file('package.json', '{}');

    const pooled = await new ScanSession({ root: fixture.root, pool: poolOptions }).start();
    const legacy = await new ScanSession({ root: fixture.root, pool: false }).start();

    expect(pooled.status).toBe('complete');
    expect(pooled.tree.get(fixture.root)).toEqual(legacy.tree.get(fixture.root));
    expect(pooled.filesScanned).toBe(legacy.filesScanned);
    expect(pooled.bytesSeen).toBe(legacy.bytesSeen);
  }, 30_000);

  it('uses the legacy path when an enumerator is injected', async () => {
    fixture.file('a.txt', 'aaaaa');
    const enumerator = new NodeFsEnumerator();
    const result = await new ScanSession({ root: fixture.root, enumerator }).start();
    expect(result.status).toBe('complete');
  });

  it('cancels a pooled scan and keeps partial results', async () => {
    for (let d = 0; d < 40; d += 1) {
      for (let f = 0; f < 40; f += 1) {
        fixture.file(`dir-${d}/file-${f}.txt`, 'x');
      }
    }
    const session = new ScanSession({ root: fixture.root, pool: poolOptions });
    let cancelled = false;
    const result = await session.start();
    expect(result.status).toBe('complete');

    const second = new ScanSession({
      root: fixture.root,
      pool: poolOptions,
      onFolder: () => {
        if (!cancelled) {
          cancelled = true;
          second.cancel();
        }
      },
    });
    const cancelledResult = await second.start();
    expect(cancelledResult.status).toBe('cancelled');
    expect(cancelledResult.tree.get(fixture.root)).toBeDefined();
  }, 30_000);
});
