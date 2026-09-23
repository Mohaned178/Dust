import type { Rule, RuleContext } from '../rules/types';
import { buildPlan } from './plan';
import type { BuildPlanOptions, CleanupPlan } from './plan';
import { canonicalizePath } from './guard';
import { executeItem } from './executor';
import type { ItemResult } from './executor';

export type PlanTokenErrorCode =
  | 'unknown-plan'
  | 'consumed-plan'
  | 'unacknowledged-review'
  | 'rule-not-in-plan';

export class PlanTokenError extends Error {
  constructor(
    public readonly code: PlanTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlanTokenError';
  }
}

export interface CleanerOptions extends BuildPlanOptions {}

export interface ExecuteOptions {
  acknowledge?: string[];
  onItem?: (result: ItemResult) => void;
}

export interface CleanupReport {
  planId: string;
  startedAt: number;
  finishedAt: number;
  items: ItemResult[];
  deletedBytes: number;
  skippedLocked: number;
  itemErrors: number;
}

interface PlanEntry {
  plan: CleanupPlan;
  ruleIds: Set<string>;
  consumed: boolean;
}

export class Cleaner {
  private readonly plans = new Map<string, PlanEntry>();

  constructor(private readonly options: CleanerOptions = {}) {}

  async preview(rules: Rule[], ctx: RuleContext): Promise<CleanupPlan> {
    const plan = await buildPlan(rules, ctx, this.options);
    this.plans.set(plan.id, { plan, ruleIds: new Set(rules.map((rule) => rule.id)), consumed: false });
    return plan;
  }

  async execute(planId: string, options: ExecuteOptions = {}): Promise<CleanupReport> {
    const entry = this.plans.get(planId);
    if (!entry) {
      throw new PlanTokenError('unknown-plan', `unknown plan token: ${planId}`);
    }
    if (entry.consumed) {
      throw new PlanTokenError('consumed-plan', `plan token already consumed: ${planId}`);
    }

    const acknowledged = new Set((options.acknowledge ?? []).map((path) => canonicalizePath(path).toLowerCase()));
    const missing = entry.plan.items
      .filter((item) => item.grade === 'review')
      .filter((item) => !acknowledged.has(canonicalizePath(item.path).toLowerCase()))
      .map((item) => item.path);
    if (missing.length > 0) {
      throw new PlanTokenError(
        'unacknowledged-review',
        `review-grade items require explicit acknowledgement: ${missing.join(', ')}`,
      );
    }

    entry.consumed = true;

    const startedAt = (this.options.now ?? Date.now)();
    const items: ItemResult[] = [];
    let deletedBytes = 0;
    let skippedLocked = 0;
    let itemErrors = 0;

    for (const item of entry.plan.items) {
      if (!entry.ruleIds.has(item.ruleId)) {
        const result: ItemResult = {
          ruleId: item.ruleId,
          path: item.path,
          action: item.action.kind,
          plannedBytes: item.bytes,
          status: 'failed',
          deletedBytes: 0,
          skippedLocked: 0,
          errors: [{ path: item.path, code: 'RULE-NOT-IN-PLAN' }],
        };
        items.push(result);
        itemErrors += 1;
        // A UI observer's throw must never affect deletion semantics; swallow it.
        try {
          options.onItem?.(result);
        } catch {
          /* ignore observer errors */
        }
        continue;
      }

      const result = executeItem(item, { guard: this.options.guard });
      items.push(result);
      deletedBytes += result.deletedBytes;
      skippedLocked += result.skippedLocked;
      itemErrors += result.errors.length;
      // A UI observer's throw must never affect deletion semantics; swallow it.
      try {
        options.onItem?.(result);
      } catch {
        /* ignore observer errors */
      }
    }

    return {
      planId,
      startedAt,
      finishedAt: (this.options.now ?? Date.now)(),
      items,
      deletedBytes,
      skippedLocked,
      itemErrors,
    };
  }
}
