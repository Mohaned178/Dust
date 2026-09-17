import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AggregateTree } from '../src/model/tree';
import type { FolderRecord } from '../src/model/types';

const base = join(tmpdir(), 'dust-tree-fixture');
const parent = join(base, 'a');
const child = join(parent, 'b');

function record(path: string, overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    path,
    bytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    ...overrides,
  };
}

describe('AggregateTree', () => {
  it('links a child record to a stub parent added later', () => {
    const tree = new AggregateTree();
    tree.addFolder(record(child, { bytes: 5, fileCount: 1 }));

    const stub = tree.get(parent);
    expect(stub).toBeDefined();
    expect(stub?.complete).toBe(false);
    expect(stub?.children).toEqual([child]);
    expect(tree.get(child)?.complete).toBe(true);
  });

  it('merges the real parent record without losing children', () => {
    const tree = new AggregateTree();
    tree.addFolder(record(child, { bytes: 5, fileCount: 1 }));
    tree.addFolder(record(parent, { bytes: 10, fileCount: 2, folderCount: 1 }));

    const merged = tree.get(parent);
    expect(merged?.complete).toBe(true);
    expect(merged?.bytes).toBe(10);
    expect(merged?.children).toEqual([child]);
    expect(tree.children(parent)).toHaveLength(1);
  });

  it('reports a single root node for the drive-ancestor chain', () => {
    const tree = new AggregateTree();
    tree.addFolder(record(child));
    tree.addFolder(record(parent));
    tree.addFolder(record(base));

    const roots = tree.roots();
    expect(roots).toHaveLength(1);
    expect(roots[0]?.path).not.toBe(base);
  });

  it('updates a node on duplicate add without duplicating children', () => {
    const tree = new AggregateTree();
    tree.addFolder(record(child));
    tree.addFolder(record(base, { folderCount: 2 }));
    tree.addFolder(record(base, { folderCount: 3 }));

    expect(tree.get(base)?.folderCount).toBe(3);
    expect(tree.get(base)?.children).toEqual([parent]);
  });
});
