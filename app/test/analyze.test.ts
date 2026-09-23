import { AggregateTree, createNodeFsProbe } from '@dust/core';
import type { Rule, RuleContext } from '@dust/core';
import { describe, expect, it } from 'vitest';
import { aggregateCategories, collectRuleMatches } from '../src/main/host/analyze';

const ctx: RuleContext = {
  root: 'F:\\synthetic',
  tree: new AggregateTree(),
  markers: [],
  probe: createNodeFsProbe(),
};

function match(path: string, bytes: number) {
  return {
    path,
    bytes,
    grade: 'safe' as const,
    recovery: { kind: 'junk' as const, reason: 'fixture junk' },
    evidence: 'fixture',
  };
}

describe('collectRuleMatches', () => {
  it('stamps every match with its rule id and category, in rule order', async () => {
    const temp: Rule = {
      id: 'temp',
      category: 'temp',
      title: 'Temp',
      action: { kind: 'delete-path' },
      match: () => [match('F:\\junk\\a', 5), match('F:\\junk\\b', 7)],
    };
    const cache: Rule = {
      id: 'cache',
      category: 'app-caches',
      title: 'Cache',
      action: { kind: 'delete-path' },
      match: async () => [match('F:\\cache', 3)],
    };

    const collected = await collectRuleMatches([temp, cache], ctx);
    expect(collected.map((entry) => `${entry.ruleId}:${entry.path}`)).toEqual([
      'temp:F:\\junk\\a',
      'temp:F:\\junk\\b',
      'cache:F:\\cache',
    ]);
    expect(collected[0]!.category).toBe('temp');
    expect(collected[2]!.category).toBe('app-caches');
  });
});

describe('aggregateCategories', () => {
  it('sums bytes and counts items per rule, sorted by bytes', () => {
    const collected = [
      { ...match('F:\\junk\\a', 5), ruleId: 'temp', category: 'temp' as const },
      { ...match('F:\\junk\\b', 7), ruleId: 'temp', category: 'temp' as const },
      { ...match('F:\\cache', 3), ruleId: 'cache', category: 'app-caches' as const },
    ];
    expect(aggregateCategories(collected)).toEqual([
      { ruleId: 'temp', category: 'temp', bytes: 12, items: 2 },
      { ruleId: 'cache', category: 'app-caches', bytes: 3, items: 1 },
    ]);
  });

  it('returns an empty list for no matches', () => {
    expect(aggregateCategories([])).toEqual([]);
  });
});
