import { dirname } from 'node:path';
import type { CleanupReport } from '../cleaner/cleaner';
import type { ItemResult } from '../cleaner/executor';
import type { ProjectRecord } from '../projects/types';
import { applyCleanupReport } from './build';
import type { SnapshotData, SnapshotFolder, SnapshotMatch } from './schema';

interface Deduction {
  key: string;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
}

export function pruneSnapshotAfterCleanup(
  snapshot: SnapshotData,
  report: CleanupReport,
  nowTs: number,
): SnapshotData {
  const folderByKey = new Map(snapshot.folders.map((entry) => [pathKey(entry.path), entry]));
  const gonePaths: string[] = [];
  const removedKeys: string[] = [];
  const partialFreed = new Map<string, number>();
  const deductions: Deduction[] = [];
  const categoryItems: ItemResult[] = [];

  for (const item of report.items) {
    const key = pathKey(item.path);
    if (item.status === 'done' || item.status === 'already-gone') {
      const entry = folderByKey.get(key);
      const bytes = entry?.bytes ?? item.plannedBytes;
      gonePaths.push(item.path);
      removedKeys.push(key);
      deductions.push({
        key,
        bytes,
        allocatedBytes: entry?.allocatedBytes ?? item.plannedBytes,
        fileCount: entry?.fileCount ?? 0,
        folderCount: entry?.folderCount ?? 0,
      });
      categoryItems.push({ ...item, deletedBytes: bytes });
    } else if (item.status === 'partial') {
      partialFreed.set(key, (partialFreed.get(key) ?? 0) + item.deletedBytes);
      deductions.push({
        key,
        bytes: item.deletedBytes,
        allocatedBytes: 0,
        fileCount: 0,
        folderCount: 0,
      });
      categoryItems.push(item);
    } else {
      categoryItems.push(item);
    }
  }

  const isGone = (path: string): boolean => {
    const key = pathKey(path);
    return removedKeys.some((removed) => isSameOrUnder(key, removed));
  };

  const removedChildren = new Map<string, number>();
  for (const path of gonePaths) {
    const parentKey = pathKey(dirname(path));
    removedChildren.set(parentKey, (removedChildren.get(parentKey) ?? 0) + 1);
  }

  const folders: SnapshotFolder[] = snapshot.folders
    .filter((entry) => !isGone(entry.path))
    .map((entry) => {
      const key = pathKey(entry.path);
      let next = entry;
      for (const deduction of deductions) {
        if (!isSameOrUnder(deduction.key, key)) continue;
        next = {
          ...next,
          bytes: Math.max(next.bytes - deduction.bytes, 0),
          allocatedBytes: Math.max(next.allocatedBytes - deduction.allocatedBytes, 0),
          fileCount: Math.max(next.fileCount - deduction.fileCount, 0),
          folderCount: Math.max(next.folderCount - deduction.folderCount, 0),
        };
      }
      const removed = removedChildren.get(key) ?? 0;
      if (removed > 0) next = { ...next, childCount: Math.max(next.childCount - removed, 0) };
      return next;
    });

  const matches: SnapshotMatch[] = [];
  for (const match of snapshot.matches) {
    if (isGone(match.path)) continue;
    const freed = partialFreed.get(pathKey(match.path));
    matches.push(freed === undefined ? match : { ...match, bytes: Math.max(match.bytes - freed, 0) });
  }

  const projects: ProjectRecord[] = [];
  for (const entry of snapshot.projects) {
    const locations = entry.nodeModules.paths;
    if (locations.length > 0 && locations.every((location) => isGone(location.path))) continue;
    let bytes = entry.nodeModules.bytes;
    let changed = false;
    for (const location of locations) {
      const freed = partialFreed.get(pathKey(location.path));
      if (freed !== undefined) {
        bytes -= freed;
        changed = true;
      }
    }
    projects.push(
      changed ? { ...entry, nodeModules: { ...entry.nodeModules, bytes: Math.max(bytes, 0) } } : entry,
    );
  }

  const categoryMap: Record<string, string> = {};
  for (const entry of snapshot.categories) categoryMap[entry.ruleId] = entry.category;
  const withCategories = applyCleanupReport(snapshot, { ...report, items: categoryItems }, categoryMap, nowTs);
  const categories = withCategories.categories.map((entry) => ({
    ...entry,
    items: matches.filter((match) => match.ruleId === entry.ruleId).length,
  }));

  return { ...withCategories, categories, folders, matches, projects };
}

function isSameOrUnder(key: string, rootKey: string): boolean {
  if (key === rootKey) return true;
  const base = rootKey.endsWith('\\') ? rootKey : `${rootKey}\\`;
  return key.startsWith(base) || key.startsWith(`${rootKey}/`);
}

function pathKey(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}
