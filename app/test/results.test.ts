import { join } from 'node:path';
import { AggregateTree } from '@dust/core';
import type { FolderRecord, SnapshotData } from '@dust/core';
import { describe, expect, it } from 'vitest';
import {
  buildRowsFromSnapshot,
  buildRowsFromTree,
  sameRoot,
  summarizeCategories,
  toResultRow,
} from '../src/main/host/results';
import type { ResultMatch } from '../src/shared/ipc';

const ENV = { systemRoot: 'C:\\Windows', programData: 'C:\\ProgramData', userProfile: 'C:\\Users\\x' };

function record(path: string, overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    path,
    bytes: 0,
    allocatedBytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    ...overrides,
  };
}

const root = 'C:\\Users\\x';

describe('sameRoot', () => {
  it('compares roots case-insensitively and ignores trailing separators', () => {
    expect(sameRoot('C:\\', 'c:\\')).toBe(true);
    expect(sameRoot('C:\\Users\\x\\', 'c:\\users\\x')).toBe(true);
    expect(sameRoot('C:\\Users\\x', 'C:\\Users\\y')).toBe(false);
  });
});

describe('toResultRow', () => {
  it('grades a volume root as danger and names the scanned root by its full path', () => {
    const row = toResultRow(record('C:\\', { bytes: 5, allocatedBytes: 4096 }), {
      root: 'C:\\',
      complete: true,
      childCount: 2,
      env: ENV,
    });
    expect(row).toMatchObject({ name: 'C:\\', parent: null, grade: 'danger' });
  });

  it('grades temp paths safe and unknown paths review', () => {
    const temp = toResultRow(record('C:\\Users\\x\\AppData\\Local\\Temp', { bytes: 10 }), {
      root,
      complete: true,
      childCount: 0,
      env: ENV,
    });
    const unknown = toResultRow(record('C:\\Users\\x\\mystery', { bytes: 10 }), {
      root,
      complete: true,
      childCount: 0,
      env: ENV,
    });
    expect(temp.grade).toBe('safe');
    expect(unknown.grade).toBe('review');
    expect(temp.parent).toBe('C:\\Users\\x\\AppData\\Local');
    expect(temp.name).toBe('Temp');
  });

  it('keeps an explicit action override', () => {
    const action = { ruleId: 'system-temp', category: 'temp' as const, grade: 'safe' as const, evidence: 'fixture' };
    const row = toResultRow(record('C:\\Users\\x\\AppData\\Local\\Temp'), {
      root,
      complete: true,
      childCount: 0,
      action,
      env: ENV,
    });
    expect(row.action).toEqual(action);
  });
});

describe('buildRowsFromTree', () => {
  it('walks the scanned root breadth-first and attaches matches by path', () => {
    const tree = new AggregateTree();
    tree.addFolder(record(join(root, 'proj', 'node_modules'), { bytes: 100, allocatedBytes: 4096 }));
    tree.addFolder(record(join(root, 'proj'), { bytes: 100, allocatedBytes: 4096 }));
    tree.addFolder(record(root, { bytes: 100, allocatedBytes: 4096, folderCount: 2 }));
    const matches: ResultMatch[] = [
      {
        path: join(root, 'proj', 'node_modules'),
        bytes: 100,
        ruleId: 'npm-project-modules',
        category: 'npm-projects',
        grade: 'safe',
        evidence: 'Project · Dead',
      },
    ];

    const rows = buildRowsFromTree(tree, root, matches, ENV);

    expect(rows.map((row) => row.path)).toEqual([
      root,
      join(root, 'proj'),
      join(root, 'proj', 'node_modules'),
    ]);
    expect(rows[2]!.action).toMatchObject({ ruleId: 'npm-project-modules', category: 'npm-projects' });
    expect(rows[0]!.parent).toBeNull();
    expect(rows[1]!.parent).toBe(root);
  });
});

describe('buildRowsFromSnapshot', () => {
  it('reattaches rows whose parent is outside the depth-limited map', () => {
    const snapshot: SnapshotData = {
      schemaVersion: 2,
      rulesVersion: '1',
      root: 'C:\\',
      startedAt: 1,
      finishedAt: 2,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [],
      projects: [],
      matches: [
        {
          path: 'C:\\deep\\a\\b',
          ruleId: 'system-temp',
          category: 'temp',
          bytes: 5,
          grade: 'safe',
          evidence: 'fixture',
        },
      ],
      folders: [
        { path: 'C:\\', name: 'C:\\', bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 2, newestMtimeMs: 0, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: 'C:\\deep', name: 'deep', bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 1, newestMtimeMs: 0, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: 'C:\\deep\\a\\b', name: 'b', bytes: 5, allocatedBytes: 4096, fileCount: 1, folderCount: 0, newestMtimeMs: 0, errorCount: 0, partial: false, complete: true, childCount: 0 },
      ],
    };

    const rows = buildRowsFromSnapshot(snapshot, ENV);
    const byPath = new Map(rows.map((row) => [row.path, row]));

    expect(byPath.get('C:\\')?.parent).toBeNull();
    expect(byPath.get('C:\\deep\\a\\b')?.parent).toBe('C:\\deep');
    expect(byPath.get('C:\\deep\\a\\b')?.action).toMatchObject({ ruleId: 'system-temp', grade: 'safe' });
    expect(byPath.get('C:\\deep\\a\\b')?.grade).toBe('review');
  });
});

describe('summarizeCategories', () => {
  it('rolls rules up per category in fixed order and keeps empty rows', () => {
    const rows = summarizeCategories([
      { ruleId: 'cache-chrome', category: 'app-caches', bytes: 10, items: 1 },
      { ruleId: 'cache-edge', category: 'app-caches', bytes: 5, items: 2 },
      { ruleId: 'system-temp', category: 'temp', bytes: 7, items: 1 },
      { ruleId: 'mystery', category: 'nonsense', bytes: 99, items: 9 },
    ]);

    expect(rows.map((row) => row.category)).toEqual([
      'temp',
      'recycle-bin',
      'npm-cache',
      'app-caches',
      'npm-projects',
    ]);
    expect(rows[0]).toMatchObject({ label: 'Temp', bytes: 7, items: 1 });
    expect(rows[3]).toMatchObject({ label: 'App caches', bytes: 15, items: 3, ruleIds: ['cache-chrome', 'cache-edge'] });
    expect(rows[1]).toMatchObject({ bytes: 0, items: 0 });
  });
});
