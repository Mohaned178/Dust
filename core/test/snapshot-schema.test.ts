import { describe, expect, it } from 'vitest';
import { SNAPSHOT_SCHEMA_VERSION, SnapshotCorruptError, parseSnapshot } from '../src/snapshot/schema';
import type { SnapshotData } from '../src/snapshot/schema';

function validSnapshot(): SnapshotData {
  return {
    schemaVersion: 1,
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
        fileCount: 2,
        folderCount: 0,
        newestMtimeMs: 3000,
        errorCount: 0,
        partial: false,
        complete: true,
        childCount: 0,
      },
    ],
  };
}

describe('parseSnapshot', () => {
  it('accepts a complete valid snapshot', () => {
    expect(parseSnapshot(JSON.stringify(validSnapshot()))).toEqual(validSnapshot());
  });

  it('rejects garbage, wrong shapes and the wrong schema version', () => {
    for (const raw of ['{oops', '5', 'null', '[]', '{}', '{"schemaVersion": 2}']) {
      expect(() => parseSnapshot(raw), raw).toThrow(SnapshotCorruptError);
    }
    const wrongVersion = { ...validSnapshot(), schemaVersion: 2 };
    expect(() => parseSnapshot(JSON.stringify(wrongVersion))).toThrow(SnapshotCorruptError);
  });

  it('rejects entries with bad field types', () => {
    const badDisks = { ...validSnapshot(), disks: [{ volume: 'F:\\', totalBytes: 'lots', freeBytes: 1 }] };
    expect(() => parseSnapshot(JSON.stringify(badDisks))).toThrow(SnapshotCorruptError);
    const badStatus = { ...validSnapshot(), status: 'running' };
    expect(() => parseSnapshot(JSON.stringify(badStatus))).toThrow(SnapshotCorruptError);
    const badFolders = { ...validSnapshot(), folders: [{ path: 'F:\\x' }] };
    expect(() => parseSnapshot(JSON.stringify(badFolders))).toThrow(SnapshotCorruptError);
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
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
});
