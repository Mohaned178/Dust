import type { CategoryId, DisplayGrade } from '@dust/core';
import type { ResultMatch, ResultRow } from '../../src/shared/ipc';

export function pathKey(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}

export function sameRoot(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function pathParent(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (index < 0) return null;
  if (index === 2 && trimmed[1] === ':') return trimmed.slice(0, 3);
  if (index === 0) return null;
  return trimmed.slice(0, index);
}

export function pathName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

export type SortKey = 'name' | 'size' | 'allocated' | 'items' | 'percent' | 'grade' | 'modified';

export interface SortState {
  key: SortKey;
  desc: boolean;
}

export interface RowNode extends ResultRow {
  children: string[];
  childSet: Set<string>;
}

export interface RowStore {
  root: string;
  nodes: Map<string, RowNode>;
}

export interface FlatRow {
  row: ResultRow;
  depth: number;
  hasChildren: boolean;
}

export function createRowStore(root: string): RowStore {
  return { root, nodes: new Map() };
}

export function upsertRows(store: RowStore, rows: ResultRow[]): void {
  for (const row of rows) upsertRow(store, row);
}

export function mergeMatches(store: RowStore, matches: ResultMatch[]): void {
  for (const match of matches) {
    const node = store.nodes.get(pathKey(match.path));
    if (!node) continue;
    node.action = {
      ruleId: match.ruleId,
      category: match.category,
      grade: match.grade,
      evidence: match.evidence,
    };
  }
}

export function flattenVisible(
  store: RowStore,
  expanded: ReadonlySet<string>,
  sort: SortState,
  filter: ReadonlySet<string> | null,
): FlatRow[] {
  const root = store.nodes.get(pathKey(store.root));
  if (!root) return [];

  const out: FlatRow[] = [];
  const visit = (node: RowNode, depth: number): void => {
    for (const child of sortedChildren(store, node, sort)) {
      const key = pathKey(child.path);
      if (filter !== null && !filter.has(key)) continue;
      out.push({ row: child, depth, hasChildren: child.children.length > 0 });
      if (filter !== null || expanded.has(key)) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

export function filterPaths(store: RowStore, category: CategoryId | null): Set<string> | null {
  if (category === null) return null;
  const included = new Set<string>();
  for (const node of store.nodes.values()) {
    if (node.action?.category !== category) continue;
    let key: string | null = pathKey(node.path);
    while (key !== null && !included.has(key)) {
      included.add(key);
      const parent: string | null | undefined = store.nodes.get(key)?.parent;
      key = parent === null || parent === undefined ? null : pathKey(parent);
    }
  }
  return included;
}

export function isRowVisible(parent: string | null, root: string, expanded: ReadonlySet<string>): boolean {
  if (parent === null || sameRoot(parent, root)) return true;
  let current: string | null = parent;
  while (current !== null && !sameRoot(current, root)) {
    if (expanded.has(pathKey(current))) return true;
    current = pathParent(current);
  }
  return false;
}

const GRADE_RANK: Record<DisplayGrade, number> = { safe: 0, review: 1, danger: 2 };

export function compareRows(a: ResultRow, b: ResultRow, key: SortKey): number {
  let result = 0;
  switch (key) {
    case 'name':
      result = a.name.localeCompare(b.name);
      break;
    case 'size':
    case 'percent':
      result = a.bytes - b.bytes;
      break;
    case 'allocated':
      result = a.allocatedBytes - b.allocatedBytes;
      break;
    case 'items':
      result = a.fileCount + a.folderCount - (b.fileCount + b.folderCount);
      break;
    case 'grade':
      result = GRADE_RANK[a.grade] - GRADE_RANK[b.grade];
      break;
    case 'modified':
      result = a.newestMtimeMs - b.newestMtimeMs;
      break;
  }
  if (result !== 0) return result;
  return a.path.localeCompare(b.path);
}

function sortedChildren(store: RowStore, node: RowNode, sort: SortState): RowNode[] {
  const children: RowNode[] = [];
  for (const key of node.children) {
    const child = store.nodes.get(key);
    if (child) children.push(child);
  }
  children.sort((a, b) => {
    const result = compareRows(a, b, sort.key);
    return sort.desc ? -result : result;
  });
  return children;
}

function upsertRow(store: RowStore, row: ResultRow): void {
  const key = pathKey(row.path);
  const existing = store.nodes.get(key);
  if (existing) {
    existing.name = row.name;
    existing.parent = row.parent;
    existing.bytes = row.bytes;
    existing.allocatedBytes = row.allocatedBytes;
    existing.fileCount = row.fileCount;
    existing.folderCount = row.folderCount;
    existing.linkCount = row.linkCount;
    existing.newestMtimeMs = row.newestMtimeMs;
    existing.errorCount = row.errorCount;
    existing.partial = row.partial;
    existing.complete = row.complete;
    existing.childCount = row.childCount;
    existing.grade = row.grade;
    existing.gradeReason = row.gradeReason;
    existing.action = row.action;
    return;
  }

  const node: RowNode = { ...row, children: [], childSet: new Set() };
  store.nodes.set(key, node);
  ensureAncestors(store, node);
  const parentKey = row.parent !== null ? pathKey(row.parent) : null;
  if (parentKey !== null && parentKey !== key) {
    const parent = store.nodes.get(parentKey);
    if (parent && !parent.childSet.has(key)) {
      parent.childSet.add(key);
      parent.children.push(key);
    }
  }
}

function ensureAncestors(store: RowStore, node: RowNode): void {
  if (node.parent === null) return;
  const parentKey = pathKey(node.parent);
  if (store.nodes.has(parentKey)) return;

  const stub: RowNode = {
    path: node.parent,
    name: pathName(node.parent),
    parent: sameRoot(node.parent, store.root) ? null : pathParent(node.parent),
    bytes: 0,
    allocatedBytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    complete: false,
    childCount: 0,
    grade: 'review',
    gradeReason: 'Not scanned yet',
    action: null,
    children: [],
    childSet: new Set(),
  };
  store.nodes.set(parentKey, stub);
  ensureAncestors(store, stub);
  if (stub.parent !== null) {
    const grandParent = store.nodes.get(pathKey(stub.parent));
    if (grandParent && !grandParent.childSet.has(parentKey)) {
      grandParent.childSet.add(parentKey);
      grandParent.children.push(parentKey);
    }
  }
}
