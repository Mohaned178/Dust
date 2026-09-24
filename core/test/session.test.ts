import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AggregateTree } from '../src/model/tree';
import type { Enumerator } from '../src/scanner/enumerator';
import { ScanSession } from '../src/scanner/session';
import { Fixture } from './fixtures';

describe('ScanSession', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('returns a complete result with an aggregated tree', async () => {
    fixture.file('a.txt', 'aaaaa');
    fixture.file('node_modules/dep/index.js', 'bb');
    fixture.file('package.json', '{}');

    const result = await new ScanSession({ root: fixture.root, pool: false, clusterSize: 4096 }).start();

    expect(result.status).toBe('complete');
    expect(result.tree.get(fixture.root)?.bytes).toBe(9);
    expect(result.tree.get(fixture.root)?.allocatedBytes).toBe(3 * 4096);
    expect(result.tree.get(fixture.root)?.complete).toBe(true);
    expect(result.markers.some((m) => m.kind === 'package-json')).toBe(true);
    expect(result.markers.some((m) => m.kind === 'node-modules')).toBe(true);
    expect(result.finishedAt).toBeGreaterThanOrEqual(result.startedAt);
  });

  it('cancels mid-scan and returns a cancelled result with partial data', async () => {
    let session!: ScanSession;
    let calls = 0;
    const enumerator: Enumerator = {
      list: () => {
        calls += 1;
        if (calls === 2) session.cancel();
        return calls === 1
          ? { entries: [{ name: 'a', kind: 'dir', size: 0, mtimeMs: 0 }], entryErrors: 0 }
          : { entries: [{ name: 'x.txt', kind: 'file', size: 1, mtimeMs: 1000 }], entryErrors: 0 };
      },
    };
    session = new ScanSession({ root: 'F:\\synthetic', enumerator });

    const result = await session.start();

    expect(result.status).toBe('cancelled');
    expect(result.tree.get(join(result.root, 'a'))).toBeDefined();
  });

  it('normalizes a root with a trailing separator into one connected tree', async () => {
    fixture.file('a.txt', 'aa');
    fixture.dir('sub');

    const requestedRoot = fixture.root + sep;
    const result = await new ScanSession({ root: requestedRoot, pool: false }).start();

    expect(result.root).toBe(fixture.root);
    expect(result.tree.get(fixture.root)?.children.length).toBeGreaterThan(0);
    expect(result.tree.roots()).toHaveLength(1);
  });

  it('forwards progress updates', async () => {
    fixture.file('a.txt', 'aa');
    const updates: string[] = [];
    await new ScanSession({
      root: fixture.root,
      pool: false,
      progressEvery: 1,
      onProgress: (u) => updates.push(u.currentPath),
    }).start();
    expect(updates.length).toBeGreaterThan(0);
  });

  it('fills a caller-provided tree and returns it', async () => {
    fixture.file('a.txt', 'aa');
    const tree = new AggregateTree();

    const result = await new ScanSession({ root: fixture.root, pool: false, tree }).start();

    expect(result.tree).toBe(tree);
    expect(tree.get(fixture.root)?.bytes).toBe(2);
  });
});
