import { lstatSync } from 'node:fs';
import { AggregateTree, NodeFsEnumerator, scanTree } from '@dust/core';
import type { FolderRecord } from '@dust/core';

export function measurePath(path: string): FolderRecord | null {
  try {
    if (!lstatSync(path).isDirectory()) return null;
  } catch {
    return null;
  }
  try {
    return scanTree({ root: path, enumerator: new NodeFsEnumerator(), isExcluded: () => false }).rootRecord;
  } catch {
    return null;
  }
}

export async function measureDirectories(
  paths: readonly string[],
  measure: (path: string) => Promise<FolderRecord | null> | FolderRecord | null,
): Promise<AggregateTree> {
  const tree = new AggregateTree();
  const seen = new Set<string>();
  for (const path of paths) {
    const key = path.replace(/[\\/]+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const record = await measure(path);
    if (record !== null) tree.addFolder(record);
  }
  return tree;
}
