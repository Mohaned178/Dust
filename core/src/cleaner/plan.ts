import { randomUUID } from 'node:crypto';
import { normalize, sep } from 'node:path';
import type { Action, ActionGrade, CategoryId, Recovery, Rule, RuleContext } from '../rules/types';
import { validateRules } from '../rules/validate';
import { checkDeletable } from './guard';
import type { GuardDenial, GuardOptions } from './guard';

export type RefusedReason = GuardDenial | 'duplicate' | 'nested' | 'invalid-recovery';

export interface PlanItem {
  ruleId: string;
  category: CategoryId;
  path: string;
  bytes: number;
  grade: ActionGrade;
  recovery: Recovery;
  evidence: string;
  action: Action;
}

export interface RefusedMatch {
  ruleId: string;
  path: string;
  reason: RefusedReason;
}

export interface PlanTotals {
  bytes: number;
  items: number;
  bytesByGrade: Record<ActionGrade, number>;
  itemsByGrade: Record<ActionGrade, number>;
}

export interface CleanupPlan {
  id: string;
  createdAt: number;
  items: PlanItem[];
  totals: PlanTotals;
  refused: RefusedMatch[];
}

export interface BuildPlanOptions {
  guard?: GuardOptions;
  now?: () => number;
  makeId?: () => string;
}

export async function buildPlan(
  rules: Rule[],
  ctx: RuleContext,
  options: BuildPlanOptions = {},
): Promise<CleanupPlan> {
  validateRules(rules);

  const items: PlanItem[] = [];
  const refused: RefusedMatch[] = [];
  const acceptedPaths: string[] = [];
  const childSep = sep.toLowerCase();

  for (const rule of rules) {
    const matches = await rule.match(ctx);
    for (const match of matches) {
      if (!isValidRecovery(match.recovery)) {
        refused.push({ ruleId: rule.id, path: match.path, reason: 'invalid-recovery' });
        continue;
      }

      const normalized = normalize(match.path);
      const lower = normalized.toLowerCase();

      if (acceptedPaths.includes(lower)) {
        refused.push({ ruleId: rule.id, path: match.path, reason: 'duplicate' });
        continue;
      }
      const overlaps = acceptedPaths.some((accepted) => lower.startsWith(accepted + childSep));
      if (overlaps) {
        refused.push({ ruleId: rule.id, path: match.path, reason: 'nested' });
        continue;
      }

      const guardResult = checkDeletable(match.path, {
        ...(options.guard ?? {}),
        exemptExact: [match.path],
      });
      if (!guardResult.allowed) {
        refused.push({ ruleId: rule.id, path: match.path, reason: guardResult.reason ?? 'protected-root' });
        continue;
      }

      acceptedPaths.push(lower);
      items.push({
        ruleId: rule.id,
        category: rule.category,
        path: normalized,
        bytes: match.bytes,
        grade: match.grade,
        recovery: match.recovery,
        evidence: match.evidence,
        action: rule.action,
      });
    }
  }

  items.sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    id: (options.makeId ?? randomUUID)(),
    createdAt: (options.now ?? Date.now)(),
    items,
    totals: buildTotals(items),
    refused,
  };
}

function isValidRecovery(recovery: Recovery): boolean {
  return recovery.kind === 'regenerate' ? recovery.command.trim().length > 0 : recovery.reason.trim().length > 0;
}

function buildTotals(items: PlanItem[]): PlanTotals {
  const totals: PlanTotals = {
    bytes: 0,
    items: items.length,
    bytesByGrade: { safe: 0, review: 0 },
    itemsByGrade: { safe: 0, review: 0 },
  };
  for (const item of items) {
    totals.bytes += item.bytes;
    totals.bytesByGrade[item.grade] += item.bytes;
    totals.itemsByGrade[item.grade] += 1;
  }
  return totals;
}
