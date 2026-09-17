import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import type { Enumerator } from '../src/scanner/enumerator';
import { createExclusionPredicate } from '../src/scanner/exclusions';
import { scanTree } from '../src/scanner/scanner';
import type { FolderRecord, Marker, ProgressUpdate } from '../src/model/types';
import { Fixture } from './fixtures';

function run(root: string, overrides: Partial<Parameters<typeof scanTree>[0]> = {}) {
  return scanTree({
    root,
    enumerator: new NodeFsEnumerator(),
    isExcluded: createExclusionPredicate(),
    ...overrides,
  });
}

describe('scanTree', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('aggregates sizes and counts post-order', () => {
    fixture.file('a.txt', 'aaaaa');
    fixture.file('sub/b.txt', 'bbbbbbb');
    fixture.file('sub/deep/c.txt', 'ccccccccccc');

    const records: FolderRecord[] = [];
    const stats = run(fixture.root, { onFolder: (r) => records.push(r) });

    const order = records.map((r) => r.path);
    expect(order.indexOf(join(fixture.root, 'sub', 'deep'))).toBeLessThan(
      order.indexOf(join(fixture.root, 'sub')),
    );

    const sub = records.find((r) => r.path === join(fixture.root, 'sub'));
    expect(sub).toMatchObject({ bytes: 18, fileCount: 2, folderCount: 1 });
    expect(stats.rootRecord).toMatchObject({ bytes: 23, fileCount: 3, folderCount: 2 });
  });

  it('tracks the newest file mtime excluding node_modules and .git', () => {
    fixture.file('src/main.ts', 'x', 1_700_000_000_000);
    fixture.file('node_modules/pkg/index.js', 'yy', 1_800_000_000_000);
    fixture.file('.git/objects/aa', 'z', 1_900_000_000_000);

    const stats = run(fixture.root);
    expect(stats.rootRecord.newestMtimeMs).toBe(1_700_000_000_000);
    expect(stats.rootRecord.bytes).toBe(1 + 2 + 1);
  });

  it('emits package-json, node-modules and git-dir markers, suppressing nested manifests', () => {
    fixture.file('package.json', '{}');
    fixture.file('src/package.json', '{}');
    fixture.file('node_modules/dep/package.json', '{}');
    fixture.dir('node_modules');
    fixture.dir('.git');

    const markers: Marker[] = [];
    run(fixture.root, { onMarker: (m) => markers.push(m) });

    const manifestPaths = markers.filter((m) => m.kind === 'package-json').map((m) => m.path);
    expect(manifestPaths).toContain(join(fixture.root, 'package.json'));
    expect(manifestPaths).toContain(join(fixture.root, 'src', 'package.json'));
    expect(manifestPaths).not.toContain(join(fixture.root, 'node_modules', 'dep', 'package.json'));

    const kinds = markers.map((m) => m.kind);
    expect(kinds).toContain('node-modules');
    expect(kinds).toContain('git-dir');
  });

  it('emits a single node-modules marker for nested node_modules directories', () => {
    fixture.file('node_modules/a/node_modules/dep/index.js', 'x');

    const markers: Marker[] = [];
    run(fixture.root, { onMarker: (m) => markers.push(m) });

    const nodeModules = markers.filter((m) => m.kind === 'node-modules');
    expect(nodeModules).toHaveLength(1);
    expect(nodeModules[0].path).toBe(join(fixture.root, 'node_modules'));
  });

  it('skips hard-excluded files and directories entirely', () => {
    fixture.file('keep.txt', 'abc');
    fixture.file('pagefile.sys', 'should-not-count');
    fixture.file('$Recycle.Bin/old.txt', 'should-not-count');

    const records: FolderRecord[] = [];
    const stats = run(fixture.root, { onFolder: (r) => records.push(r) });

    expect(stats.rootRecord.bytes).toBe(3);
    expect(records.every((r) => !r.path.toLowerCase().includes('$recycle.bin'))).toBe(true);
  });

  it('counts per-entry errors from the enumerator', () => {
    const enumerator: Enumerator = {
      list: () => ({
        entries: [{ name: 'ok.txt', kind: 'file', size: 3, mtimeMs: 1000 }],
        entryErrors: 2,
      }),
    };
    const stats = run('F:\\synthetic', { enumerator });
    expect(stats.rootRecord.errorCount).toBe(2);
    expect(stats.errors).toBe(2);
  });

  it('marks a directory partial when listing throws and keeps scanning siblings', () => {
    const enumerator: Enumerator = {
      list: (dir) => {
        if (dir.endsWith('broken')) throw new Error('EACCES');
        return { entries: [{ name: 'broken', kind: 'dir', size: 0, mtimeMs: 0 }], entryErrors: 0 };
      },
    };
    const records: FolderRecord[] = [];
    const stats = run('F:\\synthetic', { enumerator, onFolder: (r) => records.push(r) });

    const broken = records.find((r) => r.path.endsWith('broken'));
    expect(broken?.partial).toBe(true);
    expect(broken?.errorCount).toBe(1);
    expect(stats.rootRecord.errorCount).toBe(1);
    expect(stats.errors).toBe(1);
  });

  it('stops when the signal is already aborted', () => {
    fixture.file('a.txt', 'aaaaa');
    const controller = new AbortController();
    controller.abort();

    const records: FolderRecord[] = [];
    const stats = run(fixture.root, { signal: controller.signal, onFolder: (r) => records.push(r) });

    expect(stats.aborted).toBe(true);
    expect(records).toHaveLength(0);
    expect(stats.rootRecord.partial).toBe(true);
  });

  it('emits progress updates every N entries', () => {
    fixture.file('a.txt', 'aa');
    fixture.file('b.txt', 'bbb');
    const updates: ProgressUpdate[] = [];
    run(fixture.root, { progressEvery: 1, onProgress: (u) => updates.push(u) });

    expect(updates.length).toBe(2);
    expect(updates[1]).toMatchObject({ filesScanned: 2, bytesSeen: 5 });
  });
});
