import type { Rule, RuleMatch } from '../src/rules/types';

export function makeMatch(overrides: Partial<RuleMatch> & { path: string }): RuleMatch {
  return {
    bytes: 0,
    grade: 'safe',
    recovery: { kind: 'junk', reason: 'fixture junk' },
    evidence: 'fixture',
    ...overrides,
  };
}

export function makeRule(overrides: Partial<Rule> & { id: string; matches: RuleMatch[] }): Rule {
  const { matches, ...rest } = overrides;
  return {
    category: 'temp',
    title: `Fixture rule ${overrides.id}`,
    action: { kind: 'delete-path' },
    match: () => matches,
    ...rest,
  };
}
