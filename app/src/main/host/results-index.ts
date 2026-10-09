import type { CategoryId } from '@dust/core';
import { CATEGORY_ORDER } from '../../shared/categories';
import type {
  FolderChildrenOptions,
  FolderChildrenResult,
  ResultRow,
  ResultsSearchOptions,
  ResultsSearchResult,
} from '../../shared/ipc';
import { pathKey } from './results';

/** Most rows a category contributes to the Clean up summary. */
export const SUMMARY_CONTRIBUTOR_CAP = 200;
export const DEFAULT_CHILDREN_LIMIT = 200;
export const MAX_CHILDREN_LIMIT = 1000;
export const DEFAULT_SEARCH_LIMIT = 500;
export const MAX_SEARCH_LIMIT = 500;

interface ResultsIndex {
  rows: ResultRow[];
  /** Rows that carry a cleanup action, per category, largest first. Cheap, so built eagerly. */
  contributors: Map<CategoryId, ResultRow[]>;
  /** Direct children per parent path, largest first. Built on the first folder request. */
  children: Map<string, ResultRow[]> | null;
  rootKey: string | null;
  /** Every row, largest first, with lowercased paths aligned to it. Built on the first search. */
  search: { bySize: ResultRow[]; lowerPaths: string[] } | null;
}

const indexes = new WeakMap<ResultRow[], ResultsIndex>();

/** Largest first. Ties fall back to a plain string compare: localeCompare is far too slow for 279k rows. */
function bySizeDesc(a: ResultRow, b: ResultRow): number {
  if (a.bytes !== b.bytes) return b.bytes - a.bytes;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function indexFor(rows: ResultRow[]): ResultsIndex {
  const cached = indexes.get(rows);
  if (cached !== undefined) return cached;

  const contributors = new Map<CategoryId, ResultRow[]>();
  for (const row of rows) {
    if (row.action === null) continue;
    const list = contributors.get(row.action.category);
    if (list === undefined) contributors.set(row.action.category, [row]);
    else list.push(row);
  }
  for (const list of contributors.values()) list.sort(bySizeDesc);

  const index: ResultsIndex = { rows, contributors, children: null, rootKey: null, search: null };
  indexes.set(rows, index);
  return index;
}

function childrenOf(index: ResultsIndex): Map<string, ResultRow[]> {
  if (index.children !== null) return index.children;
  const children = new Map<string, ResultRow[]>();
  for (const row of index.rows) {
    if (row.parent === null) {
      index.rootKey ??= pathKey(row.path);
      continue;
    }
    const key = pathKey(row.parent);
    const siblings = children.get(key);
    if (siblings === undefined) children.set(key, [row]);
    else siblings.push(row);
  }
  for (const list of children.values()) list.sort(bySizeDesc);
  index.children = children;
  return children;
}

export function topContributors(rows: ResultRow[]): Record<CategoryId, ResultRow[]> {
  const index = indexFor(rows);
  const out = {} as Record<CategoryId, ResultRow[]>;
  for (const category of CATEGORY_ORDER) {
    out[category] = (index.contributors.get(category) ?? []).slice(0, SUMMARY_CONTRIBUTOR_CAP);
  }
  return out;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function folderChildren(
  rows: ResultRow[],
  path: string,
  options: FolderChildrenOptions = {},
): FolderChildrenResult {
  const index = indexFor(rows);
  const children = childrenOf(index);
  const key = path === '' ? index.rootKey : pathKey(path);
  const all = (key === null ? undefined : children.get(key)) ?? [];
  const visible = options.hideDanger === true ? all.filter((row) => row.grade !== 'danger') : all;
  const sorted = options.sort === 'name' ? [...visible].sort((a, b) => a.name.localeCompare(b.name)) : visible;
  const offset = clampInt(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(options.limit, DEFAULT_CHILDREN_LIMIT, 1, MAX_CHILDREN_LIMIT);
  return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
}

export function searchRows(rows: ResultRow[], query: string, options: ResultsSearchOptions = {}): ResultsSearchResult {
  const needle = query.trim().toLowerCase();
  if (needle === '') return { rows: [], total: 0 };
  const index = indexFor(rows);
  if (index.search === null) {
    const bySize = [...rows].sort(bySizeDesc);
    index.search = { bySize, lowerPaths: bySize.map((row) => row.path.toLowerCase()) };
  }
  const { bySize, lowerPaths } = index.search;
  const limit = clampInt(options.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
  const out: ResultRow[] = [];
  let total = 0;
  for (let i = 0; i < lowerPaths.length; i += 1) {
    if (!lowerPaths[i]!.includes(needle)) continue;
    const row = bySize[i]!;
    if (options.hideDanger === true && row.grade === 'danger') continue;
    total += 1;
    if (out.length < limit) out.push(row);
  }
  return { rows: out, total };
}
