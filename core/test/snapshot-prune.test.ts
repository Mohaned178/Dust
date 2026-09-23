import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CleanupReport } from '../src/cleaner/cleaner';
import type { ItemResult } from '../src/cleaner/executor';
import type { ProjectRecord } from '../src/projects/types';
import { SNAPSHOT_SCHEMA_VERSION } from '../src/snapshot/schema';
import type { SnapshotData, SnapshotFolder } from '../src/snapshot/schema';
import { pruneSnapshotAfterCleanup } from '../src/snapshot/prune';

function folder(
  path: string,
  bytes: number,
  allocatedBytes: number,
  fileCount: number,
  folderCount: number,
  childCount: number,
): SnapshotFolder {
  return {
    path,
    name: path,
    bytes,
    allocatedBytes,
    fileCount,
    folderCount,
    newestMtimeMs: 5,
    errorCount: 0,
    partial: false,
    complete: true,
    childCount,
  };
}

function item(overrides: Partial<ItemResult> & { path: string }): ItemResult {
  return {
    ruleId: 'system-temp',
    action: 'delete-path',
    status: 'done',
    plannedBytes: 0,
    deletedBytes: 0,
    skippedLocked: 0,
    errors: [],
    ...overrides,
  };
}

function report(items: ItemResult[]): CleanupReport {
  return {
    planId: 'plan-1',
    startedAt: 10,
    finishedAt: 20,
    items,
    deletedBytes: items.reduce((sum, entry) => sum + entry.deletedBytes, 0),
    skippedLocked: items.reduce((sum, entry) => sum + entry.skippedLocked, 0),
    itemErrors: items.reduce((sum, entry) => sum + entry.errors.length, 0),
  };
}

function project(path: string, nodeModulesPath: string, bytes: number): ProjectRecord {
  return {
    path,
    name: 'proj',
    kind: 'project',
    packageManager: 'npm',
    pinned: false,
    workspaceCount: 0,
    nodeModules: { paths: [{ path: nodeModulesPath, bytes }], bytes },
    activity: { ms: 100, source: 'files' },
    recency: 'dead',
    restorability: { grade: 'green', reasons: [], restoreCommand: 'npm ci' },
    offered: true,
    evidence: ['npm'],
  };
}

function snapshot(overrides: Partial<SnapshotData> = {}): SnapshotData {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    rulesVersion: '1',
    root: 'C:\\',
    startedAt: 1,
    finishedAt: 2,
    status: 'complete',
    cleanedAt: null,
    disks: [],
    categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 30, items: 2 }],
    matches: [
      { path: 'C:\\Temp', ruleId: 'system-temp', category: 'temp', bytes: 10, grade: 'safe', evidence: 'temp' },
      { path: 'C:\\Temp\\deep', ruleId: 'system-temp', category: 'temp', bytes: 20, grade: 'safe', evidence: 'deep' },
    ],
    projects: [],
    folders: [
      folder('C:\\', 30, 8192, 2, 1, 1),
      folder('C:\\Temp', 30, 8192, 2, 1, 1),
      folder('C:\\Temp\\deep', 20, 4096, 1, 0, 0),
    ],
    ...overrides,
  };
}

describe('pruneSnapshotAfterCleanup', () => {
  it('removes a fully deleted subtree, deducts ancestors and prunes matches', () => {
    const result = pruneSnapshotAfterCleanup(
      snapshot(),
      report([item({ path: 'C:\\Temp', plannedBytes: 30, deletedBytes: 30, status: 'done' })]),
      20,
    );

    expect(result.cleanedAt).toBe(20);
    expect(result.folders.map((entry) => entry.path)).toEqual(['C:\\']);
    expect(result.folders[0]).toMatchObject({ bytes: 0, allocatedBytes: 0, fileCount: 0, folderCount: 0, childCount: 0 });
    expect(result.matches).toEqual([]);
    expect(result.categories).toEqual([{ ruleId: 'system-temp', category: 'temp', bytes: 0, items: 0 }]);
  });

  it('keeps partial items and shrinks their folders and matches', () => {
    const result = pruneSnapshotAfterCleanup(
      snapshot(),
      report([item({ path: 'C:\\Temp\\deep', plannedBytes: 20, deletedBytes: 5, status: 'partial' })]),
      20,
    );

    expect(result.folders.find((entry) => entry.path === 'C:\\Temp')?.bytes).toBe(25);
    expect(result.folders.find((entry) => entry.path === 'C:\\Temp')?.allocatedBytes).toBe(8192);
    expect(result.folders.find((entry) => entry.path === 'C:\\Temp\\deep')?.bytes).toBe(15);
    expect(result.matches.find((match) => match.path === 'C:\\Temp\\deep')?.bytes).toBe(15);
    expect(result.matches.find((match) => match.path === 'C:\\Temp')?.bytes).toBe(10);
    expect(result.categories).toEqual([{ ruleId: 'system-temp', category: 'temp', bytes: 25, items: 2 }]);
  });

  it('deducts planned bytes when the exact folder is outside the depth-limited map', () => {
    const base = snapshot({
      folders: [folder('C:\\', 30, 8192, 2, 1, 1), folder('C:\\Temp', 30, 8192, 2, 1, 0)],
    });
    const result = pruneSnapshotAfterCleanup(
      base,
      report([item({ path: 'C:\\Temp\\deep', plannedBytes: 20, deletedBytes: 0, status: 'already-gone' })]),
      20,
    );

    expect(result.folders.map((entry) => entry.path)).toEqual(['C:\\', 'C:\\Temp']);
    expect(result.folders.find((entry) => entry.path === 'C:\\')?.bytes).toBe(10);
    expect(result.folders.find((entry) => entry.path === 'C:\\Temp')?.bytes).toBe(10);
    expect(result.matches.map((match) => match.path)).toEqual(['C:\\Temp']);
    expect(result.categories).toEqual([{ ruleId: 'system-temp', category: 'temp', bytes: 10, items: 1 }]);
  });

  it('drops fully cleaned projects and shrinks partially cleaned ones', () => {
    const base = snapshot({
      projects: [
        project('C:\\a', 'C:\\a\\node_modules', 15),
        project('C:\\b', 'C:\\b\\node_modules', 25),
      ],
    });
    const result = pruneSnapshotAfterCleanup(
      base,
      report([
        item({ path: 'C:\\a\\node_modules', plannedBytes: 15, deletedBytes: 15, status: 'done' }),
        item({ path: 'C:\\b\\node_modules', plannedBytes: 25, deletedBytes: 5, status: 'partial' }),
      ]),
      20,
    );

    expect(result.projects.map((entry) => entry.path)).toEqual(['C:\\b']);
    expect(result.projects[0]?.nodeModules.bytes).toBe(20);
  });
});
