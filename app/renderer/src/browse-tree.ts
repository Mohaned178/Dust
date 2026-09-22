import type { BrowseRow } from '../../src/shared/ipc';
import type { SortKey, SortState } from './tree';
import { pathKey, pathName, pathParent, sameRoot } from './tree';

export interface BrowseNode extends BrowseRow {
  children: string[];
  childSet: Set<string>;
}

export interface BrowseStore {
  root: string;
  nodes: Map<string, BrowseNode>;
}

export interface BrowseFlatRow {
  row: BrowseRow;
  depth: number;
  hasChildren: boolean;
}

export function createBrowseStore(root: string): BrowseStore {
  return { root, nodes: new Map() };
}

export function upsertBrowseRows(store: BrowseStore, rows: BrowseRow[]): void {
  for (const row of rows) upsertBrowseRow(store, row);
}

export function flattenBrowse(
  store: BrowseStore,
  expanded: ReadonlySet<string>,
  sort: SortState,
): BrowseFlatRow[] {
  const root = store.nodes.get(pathKey(store.root));
  if (!root) return [];

  const out: BrowseFlatRow[] = [];
  const visit = (node: BrowseNode, depth: number): void => {
    for (const child of sortedChildren(store, node, sort)) {
      const key = pathKey(child.path);
      out.push({ row: child, depth, hasChildren: child.children.length > 0 });
      if (expanded.has(key)) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

export function browseRootBytes(store: BrowseStore): number {
  return store.nodes.get(pathKey(store.root))?.bytes ?? 0;
}

export function applyBrowseDelete(store: BrowseStore, path: string, deletedBytes: number, removed: boolean): void {
  if (deletedBytes <= 0 && !removed) return;

  const key = pathKey(path);
  for (const node of store.nodes.values()) {
    const nodeKey = pathKey(node.path);
    if (nodeKey === key) {
      if (!removed) node.bytes = Math.max(node.bytes - deletedBytes, 0);
      continue;
    }
    if (isUnderPath(path, node.path)) node.bytes = Math.max(node.bytes - deletedBytes, 0);
  }

  if (!removed) return;

  const doomed: string[] = [];
  for (const [nodeKey, node] of store.nodes) {
    if (nodeKey === key || isUnderPath(node.path, path)) doomed.push(nodeKey);
  }
  for (const nodeKey of doomed) {
    const node = store.nodes.get(nodeKey);
    if (node?.parent) {
      const parent = store.nodes.get(pathKey(node.parent));
      if (parent) {
        parent.childSet.delete(nodeKey);
        parent.children = parent.children.filter((child) => child !== nodeKey);
      }
    }
    store.nodes.delete(nodeKey);
  }
}

function isUnderPath(path: string, base: string): boolean {
  const key = pathKey(path);
  const baseKey = pathKey(base);
  if (key === baseKey) return true;
  const prefix = baseKey.endsWith('\\') ? baseKey : `${baseKey}\\`;
  return key.startsWith(prefix) || key.startsWith(`${baseKey}/`);
}

function compareRows(a: BrowseRow, b: BrowseRow, key: SortKey): number {
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
    case 'modified':
      result = a.newestMtimeMs - b.newestMtimeMs;
      break;
    case 'grade':
      result = 0;
      break;
  }
  if (result !== 0) return result;
  return a.path.localeCompare(b.path);
}

function sortedChildren(store: BrowseStore, node: BrowseNode, sort: SortState): BrowseNode[] {
  const children: BrowseNode[] = [];
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

function upsertBrowseRow(store: BrowseStore, row: BrowseRow): void {
  const key = pathKey(row.path);
  const existing = store.nodes.get(key);
  if (existing) {
    Object.assign(existing, row);
    return;
  }

  const node: BrowseNode = { ...row, children: [], childSet: new Set() };
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

function ensureAncestors(store: BrowseStore, node: BrowseNode): void {
  if (node.parent === null) return;
  const parentKey = pathKey(node.parent);
  if (store.nodes.has(parentKey)) return;

  const stub: BrowseNode = {
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
