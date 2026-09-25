import { basename, dirname } from 'node:path';
import { createDisplayGrader } from '@dust/core';
import type {
  AggregateTree,
  CacheFinding,
  CategoryId,
  DisplayGradeReason,
  SnapshotData,
  SnapshotFolder,
} from '@dust/core';
import { CATEGORY_LABELS, CATEGORY_ORDER, isCategoryId } from '../../shared/categories';
import type { BrowseRow, CategorySummaryRow, ResultAction, ResultMatch, ResultRow } from '../../shared/ipc';

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
  finding?: CacheFinding | null;
  parent?: string | null;
  env?: ResultsEnv;
}

export function sameRoot(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

const EMPTY_ENV: ResultsEnv = {};
const graders = new WeakMap<ResultsEnv, (path: string) => DisplayGradeReason>();

function graderFor(env: ResultsEnv | undefined): (path: string) => DisplayGradeReason {
  const key = env ?? EMPTY_ENV;
  let grader = graders.get(key);
  if (grader === undefined) {
    grader = createDisplayGrader({ env: key });
    graders.set(key, grader);
  }
  return grader;
}

export function toResultRow(record: RowInput, options: RowOptions): ResultRow {
  const isRoot = sameRoot(record.path, options.root);
  const display = graderFor(options.env)(record.path);
  const parent = options.parent !== undefined ? options.parent : isRoot ? null : dirname(record.path);
  const finding = options.finding ?? null;
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
    grade: finding?.grade ?? display.grade,
    gradeReason: finding?.reason ?? display.reason,
    action: options.action ?? null,
    detected: finding !== null ? true : undefined,
  };
}

export function toBrowseRow(
  record: RowInput,
  options: { root: string; complete: boolean; childCount: number },
): BrowseRow {
  const isRoot = sameRoot(record.path, options.root);
  return {
    path: record.path,
    name: isRoot ? record.path : basename(record.path),
    parent: isRoot ? null : dirname(record.path),
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
      origin: match.origin,
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

export function applyMatchesToRows(rows: ResultRow[], matches: ResultMatch[]): ResultRow[] {
  if (matches.length === 0) return rows;
  const actions = new Map<string, ResultAction>();
  for (const match of matches) {
    actions.set(pathKey(match.path), {
      ruleId: match.ruleId,
      category: match.category,
      grade: match.grade,
      evidence: match.evidence,
      origin: match.origin,
    });
  }
  for (const row of rows) {
    const action = actions.get(pathKey(row.path));
    if (action) row.action = action;
  }
  return rows;
}

export function applyFindingsToRows(
  rows: ResultRow[],
  findings: ReadonlyArray<CacheFinding>,
): ResultRow[] {
  if (findings.length === 0) return rows;
  const byKey = new Map<string, CacheFinding>();
  for (const finding of findings) byKey.set(pathKey(finding.path), finding);
  for (const row of rows) {
    if (row.action !== null) continue;
    const finding = byKey.get(pathKey(row.path));
    if (finding === undefined) continue;
    row.grade = finding.grade;
    row.gradeReason = finding.reason;
    row.detected = true;
  }
  return rows;
}

export function buildRowsFromSnapshot(snapshot: SnapshotData, env?: ResultsEnv): ResultRow[] {
  const folderByKey = new Map<string, SnapshotFolder>();
  for (const folder of snapshot.folders) folderByKey.set(pathKey(folder.path), folder);
  const actions = new Map<string, ResultAction>();
  for (const match of snapshot.matches) {
    if (!isCategoryId(match.category)) continue;
    actions.set(pathKey(match.path), {
      ruleId: match.ruleId,
      category: match.category,
      grade: match.grade,
      evidence: match.evidence,
      origin: match.origin,
    });
  }
  const findings = new Map<string, CacheFinding>();
  for (const finding of snapshot.findings ?? []) {
    const key = pathKey(finding.path);
    if (!findings.has(key)) findings.set(key, finding);
  }

  const rootKey = pathKey(snapshot.root);
  const parentCache = new Map<string, string | null>();
  const nearestParent = (path: string): string | null => {
    const key = pathKey(path);
    const memo = parentCache.get(key);
    if (memo !== undefined) return memo;
    let current = dirname(path);
    let result: string | null = null;
    while (current.length > 0) {
      const currentKey = pathKey(current);
      const folder = folderByKey.get(currentKey);
      if (folder !== undefined) {
        result = folder.path;
        break;
      }
      const cachedAncestor = parentCache.get(currentKey);
      if (cachedAncestor !== undefined) {
        result = cachedAncestor;
        break;
      }
      if (currentKey === rootKey) break;
      const next = dirname(current);
      if (next === current) break;
      current = next;
    }
    parentCache.set(key, result);
    return result;
  };

  return snapshot.folders.map((folder) => {
    const key = pathKey(folder.path);
    const isRoot = key === rootKey;
    return toResultRow(
      { ...folder, linkCount: 0 },
      {
        root: snapshot.root,
        complete: folder.complete,
        childCount: folder.childCount,
        action: actions.get(key) ?? null,
        finding: findings.get(key) ?? null,
        parent: isRoot ? null : nearestParent(folder.path),
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

export function pathKey(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}
