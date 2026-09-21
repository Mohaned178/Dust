import { basename, dirname } from 'node:path';
import { classifyDisplayGrade } from '@dust/core';
import type { AggregateTree, CategoryId, SnapshotData } from '@dust/core';
import { CATEGORY_LABELS, CATEGORY_ORDER, isCategoryId } from '../../shared/categories';
import type { CategorySummaryRow, ResultAction, ResultMatch, ResultRow } from '../../shared/ipc';

export interface ResultsEnv {
  systemRoot?: string;
  programData?: string;
  userProfile?: string;
}

export interface RowInput {
  path: string;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
  linkCount: number;
  newestMtimeMs: number;
  errorCount: number;
  partial: boolean;
}

export interface RowOptions {
  root: string;
  complete: boolean;
  childCount: number;
  action?: ResultAction | null;
  parent?: string | null;
  env?: ResultsEnv;
}

export function sameRoot(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function toResultRow(record: RowInput, options: RowOptions): ResultRow {
  const isRoot = sameRoot(record.path, options.root);
  const display = classifyDisplayGrade(record.path, { env: options.env ?? {} });
  const parent = options.parent !== undefined ? options.parent : isRoot ? null : dirname(record.path);
  return {
    path: record.path,
    name: isRoot ? record.path : basename(record.path),
    parent,
    bytes: record.bytes,
    allocatedBytes: record.allocatedBytes,
    fileCount: record.fileCount,
    folderCount: record.folderCount,
    linkCount: record.linkCount,
    newestMtimeMs: record.newestMtimeMs,
    errorCount: record.errorCount,
    partial: record.partial,
    complete: options.complete,
    childCount: options.childCount,
    grade: display.grade,
    gradeReason: display.reason,
    action: options.action ?? null,
  };
}

export function buildRowsFromTree(
  tree: AggregateTree,
  root: string,
  matches: ResultMatch[],
  env?: ResultsEnv,
): ResultRow[] {
  const actions = new Map<string, ResultAction>();
  for (const match of matches) {
    actions.set(pathKey(match.path), {
      ruleId: match.ruleId,
      category: match.category,
      grade: match.grade,
      evidence: match.evidence,
    });
  }

  const rows: ResultRow[] = [];
  const queue: string[] = [root];
  let head = 0;
  while (head < queue.length) {
    const path = queue[head]!;
    head += 1;
    const node = tree.get(path);
    if (!node) continue;
    rows.push(
      toResultRow(node, {
        root,
        complete: node.complete,
        childCount: tree.children(path).length,
        action: actions.get(pathKey(path)) ?? null,
        env,
      }),
    );
    for (const child of tree.children(path)) queue.push(child.path);
  }
  return rows;
}

export function buildRowsFromSnapshot(snapshot: SnapshotData, env?: ResultsEnv): ResultRow[] {
  const foldersByPath = new Set(snapshot.folders.map((folder) => pathKey(folder.path)));
  const actions = new Map<string, ResultAction>();
  for (const match of snapshot.matches) {
    if (!isCategoryId(match.category)) continue;
    actions.set(pathKey(match.path), {
      ruleId: match.ruleId,
      category: match.category,
      grade: match.grade,
      evidence: match.evidence,
    });
  }

  return snapshot.folders.map((folder) => {
    const isRoot = sameRoot(folder.path, snapshot.root);
    return toResultRow(
      { ...folder, linkCount: 0 },
      {
        root: snapshot.root,
        complete: folder.complete,
        childCount: folder.childCount,
        action: actions.get(pathKey(folder.path)) ?? null,
        parent: isRoot ? null : nearestIncludedParent(folder.path, snapshot.root, foldersByPath),
        env,
      },
    );
  });
}

export function summarizeCategories(
  categories: ReadonlyArray<{ ruleId: string; category: string; bytes: number; items: number }>,
): CategorySummaryRow[] {
  const byCategory = new Map<CategoryId, CategorySummaryRow>();
  for (const entry of categories) {
    if (!isCategoryId(entry.category)) continue;
    const existing = byCategory.get(entry.category);
    if (existing) {
      existing.bytes += entry.bytes;
      existing.items += entry.items;
      if (!existing.ruleIds.includes(entry.ruleId)) existing.ruleIds.push(entry.ruleId);
    } else {
      byCategory.set(entry.category, {
        category: entry.category,
        label: CATEGORY_LABELS[entry.category],
        bytes: entry.bytes,
        items: entry.items,
        ruleIds: [entry.ruleId],
      });
    }
  }
  return CATEGORY_ORDER.map(
    (category) =>
      byCategory.get(category) ?? { category, label: CATEGORY_LABELS[category], bytes: 0, items: 0, ruleIds: [] },
  );
}

function nearestIncludedParent(path: string, root: string, folders: Set<string>): string | null {
  let current = dirname(path);
  while (current.length > 0) {
    if (folders.has(pathKey(current))) return current;
    if (sameRoot(current, root)) return null;
    const next = dirname(current);
    if (next === current) return null;
    current = next;
  }
  return null;
}

function pathKey(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}
