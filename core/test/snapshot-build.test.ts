import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFolderMap, buildSnapshot, applyCleanupReport } from '../src/snapshot/build';
import { AggregateTree } from '../src/model/tree';
import { ScanSession } from '../src/scanner/session';
import { Fixture } from './fixtures';

describe('buildFolderMap', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  async function scannedTree(): Promise<AggregateTree> {
    fixture.file('a/f1.txt', '0123456789');
    fixture.file('b/f1.txt', '01234');
    fixture.file('c/d/f1.txt', '01234567890123456789');
    fixture.file('e/f1.txt', '0');
    const result = await new ScanSession({ root: fixture.root, pool: false }).start();
    return result.tree;
  }

  it('includes all folders to maxDepth plus top contributors, with child counts', async () => {
    const tree = await scannedTree();
    const folders = buildFolderMap(tree, fixture.root, { maxDepth: 1, topContributors: 1 });
    const byPath = new Map(folders.map((folder) => [folder.path, folder]));

    for (const name of ['a', 'b', 'c', 'e']) {
      expect(byPath.has(join(fixture.root, name))).toBe(true);
    }
    expect(byPath.has(join(fixture.root, 'c', 'd'))).toBe(true);
    expect(byPath.get(fixture.root)).toMatchObject({ childCount: 4, complete: true });
    expect(byPath.get(join(fixture.root, 'c'))!.childCount).toBe(1);
    expect(folders.every((folder) => typeof folder.name === 'string' && folder.name.length > 0)).toBe(true);
  });

  it('cuts the map exactly at maxDepth when no top contributors are allowed', async () => {
    const tree = await scannedTree();
    const folders = buildFolderMap(tree, fixture.root, { maxDepth: 1, topContributors: 0 });
    const byPath = new Map(folders.map((folder) => [folder.path, folder]));
    expect(byPath.has(join(fixture.root, 'c', 'd'))).toBe(false);
    expect(folders).toHaveLength(5);
  });

  it('returns an empty map for an unscanned root', async () => {
    const tree = new AggregateTree();
    expect(buildFolderMap(tree, fixture.root)).toEqual([]);
  });
});

describe('buildSnapshot', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('assembles the full schema from scan artifacts and preserves priorCleanedAt', async () => {
    fixture.file('a/f1.txt', '0123456789');
    const result = await new ScanSession({ root: fixture.root, pool: false }).start();
    const snapshot = buildSnapshot({
      root: fixture.root,
      startedAt: 1000,
      finishedAt: 2000,
      status: 'complete',
      tree: result.tree,
      projects: [],
      categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 10, items: 1 }],
      disks: [{ volume: 'F:\\', totalBytes: 100, freeBytes: 40 }],
      priorCleanedAt: 1500,
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      rulesVersion: '1',
      root: fixture.root,
      status: 'complete',
      cleanedAt: 1500,
    });
    expect(snapshot.folders.some((folder) => folder.path === fixture.root)).toBe(true);
    expect(snapshot.folders.some((folder) => folder.path === join(fixture.root, 'a'))).toBe(true);
  });
});

describe('applyCleanupReport', () => {
  it('stamps cleanedAt, decrements the matching categories and clamps at zero', async () => {
    const fixture = new Fixture();
    try {
      const base = buildSnapshot({
        root: fixture.root,
        startedAt: 1,
        finishedAt: 2,
        status: 'complete',
        tree: new AggregateTree(),
        projects: [],
        categories: [
          { ruleId: 'system-temp', category: 'temp', bytes: 10, items: 1 },
          { ruleId: 'npm-cache', category: 'npm-cache', bytes: 3, items: 1 },
        ],
        disks: [],
      });
      const report = {
        planId: 'plan-1',
        startedAt: 3,
        finishedAt: 4,
        items: [
          {
            ruleId: 'system-temp',
            path: 'F:\\junk',
            action: 'delete-path' as const,
            status: 'done' as const,
            deletedBytes: 10,
            skippedLocked: 0,
            errors: [],
          },
          {
            ruleId: 'npm-cache',
            path: 'F:\\cache',
            action: 'delete-path' as const,
            status: 'done' as const,
            deletedBytes: 99,
            skippedLocked: 0,
            errors: [],
          },
        ],
        deletedBytes: 109,
        skippedLocked: 0,
        itemErrors: 0,
      };
      const updated = applyCleanupReport(base, report, { 'system-temp': 'temp', 'npm-cache': 'npm-cache' }, 7777);
      expect(updated.cleanedAt).toBe(7777);
      expect(updated.categories.find((entry) => entry.ruleId === 'system-temp')!.bytes).toBe(0);
      expect(updated.categories.find((entry) => entry.ruleId === 'npm-cache')!.bytes).toBe(0);
      expect(base.categories.find((entry) => entry.ruleId === 'system-temp')!.bytes).toBe(10);
    } finally {
      fixture.cleanup();
    }
  });
});
