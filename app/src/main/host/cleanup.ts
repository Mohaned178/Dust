import { basename } from 'node:path';
import type {
  CategoryId,
  CleanupPlan,
  CleanupReport,
  ItemResult,
  PlanItem,
  ProjectRecord,
  Recovery,
  Rule,
  SnapshotCategory,
  SnapshotData,
  SnapshotMatch,
} from '@dust/core';
import { isCategoryId } from '../../shared/categories';
import type {
  CleanItemPreview,
  CleanItemResult,
  CleanPlanTotals,
  CleanPreview,
  CleanReport,
  CleanScope,
} from '../../shared/ipc';

export interface CleanupEnv {
  windowsDir?: string;
}

export function canonicalKey(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return canonicalKey(a) === canonicalKey(b);
}

export function isUnderAny(path: string, roots: readonly string[]): boolean {
  const key = canonicalKey(path);
  return roots.some((root) => {
    const base = canonicalKey(root);
    if (key === base) return true;
    const prefix = base.endsWith('\\') ? base : `${base}\\`;
    return key.startsWith(prefix) || key.startsWith(`${base}/`);
  });
}

export function needsElevation(path: string, env: CleanupEnv): boolean {
  return env.windowsDir !== undefined && env.windowsDir.length > 0 && isUnderAny(path, [env.windowsDir]);
}

export function filterRuleMatches(rule: Rule, predicate: ((path: string) => boolean) | null): Rule {
  if (predicate === null) return rule;
  return {
    ...rule,
    match: async (ctx) => (await rule.match(ctx)).filter((entry) => predicate(entry.path)),
  };
}

export function scopeRules(rules: Rule[], scope: CleanScope, paths: readonly string[]): Rule[] {
  if (scope === 'quick') return rules.filter((rule) => rule.category !== 'npm-projects');
  if (paths.length === 0) return [];
  if (scope === 'row') {
    const target = paths[0]!;
    return rules.map((rule) => filterRuleMatches(rule, (path) => samePath(path, target)));
  }
  const roots = [...paths];
  return rules.map((rule) => filterRuleMatches(rule, (path) => isUnderAny(path, roots)));
}

export function defaultRecovery(ruleId: string): Recovery {
  switch (ruleId) {
    case 'system-temp':
      return { kind: 'junk', reason: 'Temporary files are recreated by the apps that need them' };
    case 'recycle-bin':
      return { kind: 'junk', reason: 'Emptied items are permanently gone' };
    case 'npm-cache':
      return { kind: 'junk', reason: 'Download cache; npm re-downloads packages on demand' };
    case 'npm-project-modules':
      return { kind: 'junk', reason: 'No manifest found - node_modules cannot be recreated' };
    default:
      return ruleId.startsWith('cache-')
        ? { kind: 'junk', reason: 'Cache is re-downloaded on next use' }
        : { kind: 'junk', reason: `Matched by rule ${ruleId}` };
  }
}

function recoveryForMatch(match: SnapshotMatch, projects: ProjectRecord[]): Recovery {
  if (match.ruleId === 'npm-project-modules') {
    const entry = projects.find((candidate) => isUnderAny(match.path, [candidate.path]));
    if (entry?.restorability.restoreCommand) {
      return { kind: 'regenerate', command: entry.restorability.restoreCommand };
    }
  }
  return defaultRecovery(match.ruleId);
}

export function snapshotRules(snapshot: SnapshotData, pins: readonly string[]): Rule[] {
  const pinned = new Set(pins.map(canonicalKey));
  const offered = snapshot.projects.filter(
    (entry) => entry.offered && !pinned.has(canonicalKey(entry.path)),
  );

  const byRuleId = new Map<string, SnapshotMatch[]>();
  for (const match of snapshot.matches) {
    if (
      match.ruleId === 'npm-project-modules' &&
      !offered.some((entry) => isUnderAny(match.path, [entry.path]))
    ) {
      continue;
    }
    const entries = byRuleId.get(match.ruleId) ?? [];
    entries.push(match);
    byRuleId.set(match.ruleId, entries);
  }

  const rules: Rule[] = [];
  for (const [ruleId, matches] of [...byRuleId.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const raw = matches[0]!.category;
    const category: CategoryId = isCategoryId(raw) ? raw : 'temp';
    rules.push({
      id: ruleId,
      category,
      title: ruleId,
      action: ruleId === 'recycle-bin' ? { kind: 'empty-recycle-bin' } : { kind: 'delete-path' },
      match: () =>
        matches.map((entry) => ({
          path: entry.path,
          bytes: entry.bytes,
          grade: entry.grade,
          recovery: recoveryForMatch(entry, offered),
          evidence: entry.evidence,
        })),
    });
  }
  return rules;
}

export function toCleanItem(item: PlanItem, env: CleanupEnv): CleanItemPreview {
  return {
    ruleId: item.ruleId,
    category: item.category,
    path: item.path,
    name: basename(item.path),
    bytes: item.bytes,
    grade: item.grade,
    recovery:
      item.recovery.kind === 'regenerate'
        ? { kind: 'regenerate', text: item.recovery.command }
        : { kind: 'junk', text: item.recovery.reason },
    evidence: item.evidence,
    action: item.action.kind,
    adminRequired: item.action.kind === 'delete-path' && needsElevation(item.path, env),
  };
}

export function toCleanPreview(
  plan: CleanupPlan,
  source: CleanPreview['source'],
  root: string,
  scanAgeMs: number | null,
  env: CleanupEnv,
): CleanPreview {
  const totals: CleanPlanTotals = {
    bytes: plan.totals.bytes,
    items: plan.totals.items,
    reviewBytes: plan.totals.bytesByGrade.review,
    reviewItems: plan.totals.itemsByGrade.review,
  };
  return {
    planId: plan.id,
    createdAt: plan.createdAt,
    root,
    source,
    scanAgeMs,
    items: plan.items.map((item) => toCleanItem(item, env)),
    totals,
    refused: plan.refused.map((entry) => ({ ruleId: entry.ruleId, path: entry.path, reason: entry.reason })),
  };
}

export function toCleanItemResult(plan: CleanupPlan, result: ItemResult): CleanItemResult {
  const source = plan.items.find((item) => item.path === result.path && item.ruleId === result.ruleId);
  return {
    ruleId: result.ruleId,
    path: result.path,
    category: source?.category ?? 'temp',
    action: result.action,
    status: result.status,
    plannedBytes: result.plannedBytes,
    deletedBytes: result.deletedBytes,
    skippedLocked: result.skippedLocked,
    errorCount: result.errors.length,
    restoreCommand: source?.recovery.kind === 'regenerate' ? source.recovery.command : null,
  };
}

export function toCleanReport(
  plan: CleanupPlan,
  scope: CleanScope,
  root: string,
  report: CleanupReport,
  remainingReclaimableBytes: number,
): CleanReport {
  return {
    planId: report.planId,
    scope,
    root,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    items: report.items.map((item) => toCleanItemResult(plan, item)),
    deletedBytes: report.deletedBytes,
    skippedLocked: report.skippedLocked,
    itemErrors: report.itemErrors,
    remainingReclaimableBytes,
    cleanedAt: report.finishedAt,
  };
}

export function subtractCategories(categories: SnapshotCategory[], report: CleanReport): SnapshotCategory[] {
  const bytesByRule = new Map<string, number>();
  const itemsByRule = new Map<string, number>();
  for (const item of report.items) {
    const freedBytes = item.status === 'already-gone' ? item.plannedBytes : item.deletedBytes;
    bytesByRule.set(item.ruleId, (bytesByRule.get(item.ruleId) ?? 0) + freedBytes);
    if (item.status === 'done' || item.status === 'already-gone') {
      itemsByRule.set(item.ruleId, (itemsByRule.get(item.ruleId) ?? 0) + 1);
    }
  }
  return categories.map((entry) => ({
    ...entry,
    bytes: Math.max(entry.bytes - (bytesByRule.get(entry.ruleId) ?? 0), 0),
    items: Math.max(entry.items - (itemsByRule.get(entry.ruleId) ?? 0), 0),
  }));
}
