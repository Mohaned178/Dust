import type { CategoryId, Rule, RuleContext, RuleMatch, SnapshotCategory } from '@dust/core';

export interface RuleMatchWithRule extends RuleMatch {
  ruleId: string;
  category: CategoryId;
}

export async function collectRuleMatches(rules: Rule[], ctx: RuleContext): Promise<RuleMatchWithRule[]> {
  const collected: RuleMatchWithRule[] = [];
  for (const rule of rules) {
    const matches = await rule.match(ctx);
    for (const match of matches) {
      collected.push({ ...match, ruleId: rule.id, category: rule.category });
    }
  }
  return collected;
}

export function aggregateCategories(matches: RuleMatchWithRule[]): SnapshotCategory[] {
  const byRule = new Map<string, SnapshotCategory>();
  for (const match of matches) {
    const entry = byRule.get(match.ruleId);
    if (entry) {
      entry.bytes += match.bytes;
      entry.items += 1;
    } else {
      byRule.set(match.ruleId, { ruleId: match.ruleId, category: match.category, bytes: match.bytes, items: 1 });
    }
  }
  return [...byRule.values()].sort((a, b) => b.bytes - a.bytes || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
}
