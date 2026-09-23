import { describe, expect, it } from 'vitest';
import { SNAPSHOT_SCHEMA_VERSION, SnapshotCorruptError, parseSnapshot } from '../src/snapshot/schema';
import type { SnapshotData } from '../src/snapshot/schema';
import type { ProjectRecord } from '../src/projects/types';

function validSnapshot(): SnapshotData {
  return {
    schemaVersion: 2,
    rulesVersion: '1',
    root: 'F:\\synthetic',
    startedAt: 1000,
    finishedAt: 2000,
    status: 'complete',
    cleanedAt: null,
    disks: [{ volume: 'F:\\', totalBytes: 100, freeBytes: 40 }],
    categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 10, items: 2 }],
    projects: [],
    folders: [
      {
        path: 'F:\\synthetic',
        name: 'synthetic',
        bytes: 10,
        allocatedBytes: 4096,
        fileCount: 2,
        folderCount: 0,
        newestMtimeMs: 3000,
        errorCount: 0,
        partial: false,
        complete: true,
        childCount: 0,
      },
    ],
    matches: [
      {
        path: 'F:\\synthetic\\Temp',
        ruleId: 'system-temp',
        category: 'temp',
        bytes: 10,
        grade: 'safe',
        evidence: 'User TEMP directory — junk by definition',
      },
    ],
  };
}

describe('parseSnapshot', () => {
  it('accepts a complete valid snapshot', () => {
    expect(parseSnapshot(JSON.stringify(validSnapshot()))).toEqual(validSnapshot());
  });

  it('rejects garbage, wrong shapes and the wrong schema version', () => {
    for (const raw of ['{oops', '5', 'null', '[]', '{}', '{"schemaVersion": 3}']) {
      expect(() => parseSnapshot(raw), raw).toThrow(SnapshotCorruptError);
    }
    const wrongVersion = { ...validSnapshot(), schemaVersion: 3 };
    expect(() => parseSnapshot(JSON.stringify(wrongVersion))).toThrow(SnapshotCorruptError);
  });

  it('rejects a malformed persisted match', () => {
    const bad = {
      ...validSnapshot(),
      matches: [{ path: 'F:\\x', ruleId: 'system-temp', category: 'temp', bytes: 1, grade: 'maybe', evidence: 'x' }],
    };
    expect(() => parseSnapshot(JSON.stringify(bad))).toThrow(SnapshotCorruptError);
    const missing = { ...validSnapshot(), matches: undefined };
    expect(() => parseSnapshot(JSON.stringify(missing))).toThrow(SnapshotCorruptError);
  });

  it('rejects entries with bad field types', () => {
    const badDisks = { ...validSnapshot(), disks: [{ volume: 'F:\\', totalBytes: 'lots', freeBytes: 1 }] };
    expect(() => parseSnapshot(JSON.stringify(badDisks))).toThrow(SnapshotCorruptError);
    const badStatus = { ...validSnapshot(), status: 'running' };
    expect(() => parseSnapshot(JSON.stringify(badStatus))).toThrow(SnapshotCorruptError);
    const badFolders = { ...validSnapshot(), folders: [{ path: 'F:\\x' }] };
    expect(() => parseSnapshot(JSON.stringify(badFolders))).toThrow(SnapshotCorruptError);
    const badAllocated = { ...validSnapshot(), folders: [{ ...validSnapshot().folders[0]!, allocatedBytes: 'lots' }] };
    expect(() => parseSnapshot(JSON.stringify(badAllocated))).toThrow(SnapshotCorruptError);
  });

  it('accepts a full project record', () => {
    const project: ProjectRecord = {
      path: 'F:\\p',
      name: 'p',
      kind: 'project',
      packageManager: 'npm',
      pinned: false,
      workspaceCount: 0,
      nodeModules: { paths: [{ path: 'F:\\p\\node_modules', bytes: 5 }], bytes: 5 },
      activity: { ms: 1234, source: 'git-reflog' },
      recency: 'active',
      restorability: { grade: 'green', reasons: ['lockfile'], restoreCommand: 'npm install' },
      offered: true,
      evidence: ['package.json'],
    };
    const snapshot = { ...validSnapshot(), projects: [project] };
    expect(parseSnapshot(JSON.stringify(snapshot)).projects).toEqual([project]);
  });

  it('rejects a truncated project record', () => {
    const truncated = { ...validSnapshot(), projects: [{ path: 'F:\\p', name: 'p' }] };
    expect(() => parseSnapshot(JSON.stringify(truncated))).toThrow(SnapshotCorruptError);
  });

  it('rejects a project record with bad nested field types', () => {
    const full = {
      ...validSnapshot(),
      projects: [
        {
          path: 'F:\\p',
          name: 'p',
          kind: 'project',
          packageManager: 'npm',
          pinned: false,
          workspaceCount: 0,
          nodeModules: { paths: [{ path: 'F:\\p\\node_modules', bytes: 5 }], bytes: 5 },
          activity: { ms: 1234, source: 'git-reflog' },
          recency: 'active',
          restorability: { grade: 'green', reasons: ['lockfile'], restoreCommand: 'npm install' },
          offered: true,
          evidence: ['package.json'],
        },
      ],
    };
    const badGrade = structuredClone(full);
    badGrade.projects[0].restorability.grade = 'red';
    expect(() => parseSnapshot(JSON.stringify(badGrade))).toThrow(SnapshotCorruptError);
    const badSource = structuredClone(full);
    badSource.projects[0].activity.source = 'telepathy';
    expect(() => parseSnapshot(JSON.stringify(badSource))).toThrow(SnapshotCorruptError);
  });

  it('accepts a foreign rulesVersion — the loader does not pin rules', () => {
    const foreign = { ...validSnapshot(), rulesVersion: '999' };
    expect(parseSnapshot(JSON.stringify(foreign)).rulesVersion).toBe('999');
  });

  it('accepts a cancelled scan snapshot with no folders', () => {
    const cancelled = { ...validSnapshot(), status: 'cancelled' as const, folders: [], cleanedAt: 1500 };
    expect(parseSnapshot(JSON.stringify(cancelled)).status).toBe('cancelled');
  });

  it('exposes the current schema version constant', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(2);
  });
});
