import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/cleaner/plan';
import { RuleValidationError } from '../src/rules/validate';
import type { RuleContext } from '../src/rules/types';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import { makeMatch, makeRule } from './rule-fixtures';

const guard = {
  systemRoot: 'C:\\Windows',
  programFiles: ['C:\\Program Files'],
  programData: 'C:\\ProgramData',
  userProfile: 'C:\\Users\\x',
  userFolders: ['Documents'],
};

const ctx: RuleContext = {
  root: 'F:\\synthetic',
  tree: new AggregateTree(),
  markers: [],
  probe: createNodeFsProbe(),
};

function build(rules: Parameters<typeof buildPlan>[0]) {
  return buildPlan(rules, ctx, { guard, makeId: () => 'plan-1', now: () => 1000 });
}

describe('buildPlan', () => {
  it('accepts rule matches and computes totals', async () => {
    const plan = await build([
      makeRule({
        id: 'temp',
        matches: [
          makeMatch({ path: 'F:\\junk\\a', bytes: 5, grade: 'safe' }),
          makeMatch({ path: 'F:\\junk\\b', bytes: 7, grade: 'review', recovery: { kind: 'regenerate', command: 'npm ci' } }),
        ],
      }),
    ]);

    expect(plan.id).toBe('plan-1');
    expect(plan.createdAt).toBe(1000);
    expect(plan.items.map((item) => item.path)).toEqual(['F:\\junk\\a', 'F:\\junk\\b']);
    expect(plan.totals).toEqual({
      bytes: 12,
      items: 2,
      bytesByGrade: { safe: 5, review: 7 },
      itemsByGrade: { safe: 1, review: 1 },
    });
    expect(plan.refused).toEqual([]);
  });

  it('refuses duplicate and nested paths', async () => {
    const plan = await build([
      makeRule({
        id: 'one',
        matches: [
          makeMatch({ path: 'F:\\junk\\a', bytes: 1 }),
          makeMatch({ path: 'F:\\junk\\a', bytes: 1 }),
          makeMatch({ path: 'F:\\junk\\a\\child', bytes: 1 }),
        ],
      }),
    ]);

    expect(plan.items).toHaveLength(1);
    expect(plan.refused).toEqual([
      { ruleId: 'one', path: 'F:\\junk\\a', reason: 'duplicate' },
      { ruleId: 'one', path: 'F:\\junk\\a\\child', reason: 'nested' },
    ]);
  });

  it('refuses protected paths and records the guard reason', async () => {
    const plan = await build([
      makeRule({
        id: 'bad',
        matches: [
          makeMatch({ path: 'C:\\Windows', bytes: 1 }),
          makeMatch({ path: 'C:\\Users', bytes: 1 }),
        ],
      }),
    ]);

    expect(plan.items).toEqual([]);
    expect(plan.refused).toEqual([
      { ruleId: 'bad', path: 'C:\\Windows', reason: 'protected-root' },
      { ruleId: 'bad', path: 'C:\\Users', reason: 'protected-ancestor' },
    ]);
  });

  it('allows an exact rule match inside a protected root (temp case)', async () => {
    const plan = await build([
      makeRule({ id: 'temp', matches: [makeMatch({ path: 'C:\\Windows\\Temp\\sub', bytes: 3 })] }),
    ]);
    expect(plan.items).toHaveLength(1);
  });

  it('refuses invalid recovery statements', async () => {
    const plan = await build([
      makeRule({
        id: 'bad-recovery',
        matches: [
          makeMatch({ path: 'F:\\junk\\a', recovery: { kind: 'regenerate', command: '   ' } }),
          makeMatch({ path: 'F:\\junk\\b', recovery: { kind: 'junk', reason: '' } }),
        ],
      }),
    ]);

    expect(plan.items).toEqual([]);
    expect(plan.refused.map((r) => r.reason)).toEqual(['invalid-recovery', 'invalid-recovery']);
  });

  it('validates the rule set before matching', async () => {
    await expect(build([makeRule({ id: 'dup', matches: [] }), makeRule({ id: 'dup', matches: [] })])).rejects.toThrow(
      RuleValidationError,
    );
  });

  it('supports async match functions and sorts items parents-first', async () => {
    const plan = await build([
      makeRule({
        id: 'async',
        matches: [],
        match: async () => [
          makeMatch({ path: 'F:\\junk\\a\\deep\\child', bytes: 1 }),
          makeMatch({ path: 'F:\\junk\\a', bytes: 2 }),
        ],
      }),
    ]);

    expect(plan.items.map((item) => item.path)).toEqual(['F:\\junk\\a', 'F:\\junk\\a\\deep\\child']);
  });
});
