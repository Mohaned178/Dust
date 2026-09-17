import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMtimeTrackedChild, scanDirectory } from '../src/scanner/dir-scan';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { createExclusionPredicate } from '../src/scanner/exclusions';
import type { Entry } from '../src/model/types';

const noneExcluded = createExclusionPredicate();

function mockEnumerator(tree: Record<string, Entry[]>): NodeFsEnumerator {
  return {
    list: (dir: string) => {
      const entries = tree[dir];
      if (!entries) throw new Error(`ENOENT: ${dir}`);
      return { entries, entryErrors: 0 };
    },
  } as unknown as NodeFsEnumerator;
}

describe('scanDirectory', () => {
  const root = 'F:\\synthetic';

  it('separates direct file stats from child dirs and counts entries', () => {
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 },
        { name: 'b.txt', kind: 'file', size: 7, mtimeMs: 2000 },
        { name: 'sub', kind: 'dir', size: 0, mtimeMs: 0 },
        { name: 'link', kind: 'link', size: 0, mtimeMs: 0 },
      ],
    });
    const result = scanDirectory(root, true, { enumerator, isExcluded: noneExcluded });

    expect(result.directBytes).toBe(12);
    expect(result.directFileCount).toBe(2);
    expect(result.linkCount).toBe(1);
    expect(result.linkPaths).toEqual([join(root, 'link')]);
    expect(result.childDirs).toEqual([join(root, 'sub')]);
    expect(result.newestMtimeMs).toBe(2000);
    expect(result.entryCount).toBe(4);
    expect(result.partial).toBe(false);
    expect(result.markers).toEqual([]);
  });

  it('zeroes newestMtimeMs when mtime tracking is off but still counts bytes', () => {
    const enumerator = mockEnumerator({
      [root]: [{ name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 }],
    });
    const result = scanDirectory(root, false, { enumerator, isExcluded: noneExcluded });
    expect(result.directBytes).toBe(5);
    expect(result.newestMtimeMs).toBe(0);
  });

  it('emits markers and suppresses nested package.json and node_modules roots', () => {
    const nested = join(root, 'node_modules', 'a');
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'package.json', kind: 'file', size: 2, mtimeMs: 1000 },
        { name: 'node_modules', kind: 'dir', size: 0, mtimeMs: 0 },
        { name: '.git', kind: 'dir', size: 0, mtimeMs: 0 },
      ],
      [nested]: [
        { name: 'package.json', kind: 'file', size: 2, mtimeMs: 1000 },
        { name: 'node_modules', kind: 'dir', size: 0, mtimeMs: 0 },
      ],
    });
    const outer = scanDirectory(root, true, { enumerator, isExcluded: noneExcluded });
    expect(outer.markers).toEqual([
      { kind: 'package-json', path: join(root, 'package.json') },
      { kind: 'node-modules', path: join(root, 'node_modules') },
      { kind: 'git-dir', path: join(root, '.git') },
    ]);

    const inner = scanDirectory(nested, false, { enumerator, isExcluded: noneExcluded });
    expect(inner.markers).toEqual([]);
  });

  it('skips excluded entries without counting them as files or child dirs', () => {
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'keep.txt', kind: 'file', size: 3, mtimeMs: 1000 },
        { name: 'pagefile.sys', kind: 'file', size: 999, mtimeMs: 1000 },
        { name: '$Recycle.Bin', kind: 'dir', size: 0, mtimeMs: 0 },
      ],
    });
    const result = scanDirectory(root, true, { enumerator, isExcluded: noneExcluded });
    expect(result.directBytes).toBe(3);
    expect(result.directFileCount).toBe(1);
    expect(result.childDirs).toEqual([]);
    expect(result.entryCount).toBe(3);
  });

  it('reports a partial result when the listing throws', () => {
    const enumerator = mockEnumerator({});
    const result = scanDirectory(root, true, { enumerator, isExcluded: noneExcluded });
    expect(result.partial).toBe(true);
    expect(result.errorCount).toBe(1);
    expect(result.childDirs).toEqual([]);
  });

  it('stops on shouldAbort and marks the result partial and aborted', () => {
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 },
        { name: 'b.txt', kind: 'file', size: 5, mtimeMs: 1000 },
      ],
    });
    let seen = 0;
    const result = scanDirectory(root, true, {
      enumerator,
      isExcluded: noneExcluded,
      shouldAbort: () => seen >= 1,
      onEntry: () => {
        seen += 1;
      },
    });
    expect(result.aborted).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.directFileCount).toBe(1);
  });

  it('ticks onEntry with per-entry contributions', () => {
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 },
        { name: 'sub', kind: 'dir', size: 0, mtimeMs: 0 },
        { name: 'link', kind: 'link', size: 0, mtimeMs: 0 },
      ],
    });
    const ticks: Array<{ entries: number; files: number; bytes: number }> = [];
    scanDirectory(root, true, {
      enumerator,
      isExcluded: noneExcluded,
      onEntry: (c) => ticks.push({ entries: c.entries, files: c.files, bytes: c.bytes }),
    });
    expect(ticks).toEqual([
      { entries: 1, files: 1, bytes: 5 },
      { entries: 1, files: 0, bytes: 0 },
      { entries: 1, files: 0, bytes: 0 },
    ]);
  });

  it('knows which child names keep mtime tracking', () => {
    expect(isMtimeTrackedChild('node_modules')).toBe(false);
    expect(isMtimeTrackedChild('NODE_MODULES')).toBe(false);
    expect(isMtimeTrackedChild('.git')).toBe(false);
    expect(isMtimeTrackedChild('src')).toBe(true);
  });
});
