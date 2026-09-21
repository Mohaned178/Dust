import { basename, isAbsolute, relative, sep } from 'node:path';
import { RULES_VERSION } from '../rules/version';
import { AggregateTree } from '../model/tree';
import type { TreeNode } from '../model/tree';
import type { ProjectRecord } from '../projects/types';
import type { CleanupReport } from '../cleaner/cleaner';
import { normalizeRoot } from '../scanner/session';
import type {
  ScanStatus,
  SnapshotCategory,
  SnapshotData,
  SnapshotDisk,
  SnapshotFolder,
  SnapshotMatch,
} from './schema';
import { SNAPSHOT_SCHEMA_VERSION } from './schema';

export interface SnapshotInput {
  root: string;
  startedAt: number;
  finishedAt: number;
  status: ScanStatus;
  tree: AggregateTree;
  projects: ProjectRecord[];
  categories: SnapshotCategory[];
  matches?: SnapshotMatch[];
  disks: SnapshotDisk[];
  rulesVersion?: string;
  priorCleanedAt?: number | null;
  maxDepth?: number;
  topContributors?: number;
}

export interface FolderMapOptions {
  maxDepth?: number;
  topContributors?: number;
}

export function buildSnapshot(input: SnapshotInput): SnapshotData {
  const root = normalizeRoot(input.root);
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    rulesVersion: input.rulesVersion ?? RULES_VERSION,
    root,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    status: input.status,
    cleanedAt: input.priorCleanedAt ?? null,
    disks: input.disks,
    categories: input.categories,
    matches: input.matches ?? [],
    projects: input.projects,
    folders: buildFolderMap(input.tree, root, {
      maxDepth: input.maxDepth,
      topContributors: input.topContributors,
    }),
  };
}

export function applyCleanupReport(
  snapshot: SnapshotData,
  report: CleanupReport,
  categoriesByRuleId: Record<string, string>,
  nowTs: number,
): SnapshotData {
  const freedByRule = new Map<string, number>();
  for (const item of report.items) {
    freedByRule.set(item.ruleId, (freedByRule.get(item.ruleId) ?? 0) + item.deletedBytes);
  }
  void categoriesByRuleId;
  const categories = snapshot.categories.map((entry) => {
    const freed = freedByRule.get(entry.ruleId) ?? 0;
    return { ...entry, bytes: Math.max(entry.bytes - freed, 0) };
  });
  return { ...snapshot, cleanedAt: nowTs, categories };
}

export function buildFolderMap(tree: AggregateTree, root: string, options: FolderMapOptions = {}): SnapshotFolder[] {
  const maxDepth = options.maxDepth ?? 4;
  const topCount = options.topContributors ?? 50;
  const normalizedRoot = normalizeRoot(root);

  const rootNode = tree.get(normalizedRoot);
  if (!rootNode) return [];

  const all = new Map<string, TreeNode>();
  const queue: TreeNode[] = [rootNode];
  let head = 0;
  while (head < queue.length) {
    const node = queue[head]!;
    head += 1;
    if (all.has(node.path)) continue;
    all.set(node.path, node);
    for (const child of tree.children(node.path)) {
      queue.push(child);
    }
  }

  const included = new Set<string>();
  for (const path of all.keys()) {
    if (depthFrom(normalizedRoot, path) <= maxDepth) included.add(path);
  }
  const byBytes = [...all.values()]
    .filter((node) => !included.has(node.path))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, Math.max(topCount, 0));
  for (const node of byBytes) included.add(node.path);

  return [...included].sort().map((path) => {
    const node = all.get(path)!;
    return {
      path,
      name: basename(node.path),
      bytes: node.bytes,
      allocatedBytes: node.allocatedBytes,
      fileCount: node.fileCount,
      folderCount: node.folderCount,
      newestMtimeMs: node.newestMtimeMs,
      errorCount: node.errorCount,
      partial: node.partial,
      complete: node.complete,
      childCount: tree.children(path).length,
    };
  });
}

function depthFrom(root: string, path: string): number {
  if (path === root) return 0;
  const relativePath = relative(root, path);
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return Number.POSITIVE_INFINITY;
  }
  return relativePath.split(sep).length;
}
