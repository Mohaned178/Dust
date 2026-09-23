import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { Cleaner } from '../src/cleaner/cleaner';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import { Fixture } from './fixtures';
import { makeMatch, makeRule } from './rule-fixtures';

describe('cleaner pipeline (end to end)', () => {
  let fixture: Fixture;
  let ctx: RuleContext;

  beforeEach(() => {
    fixture = new Fixture();
    ctx = { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('previews, records refusals, executes and reports', async () => {
    const cache = fixture.dir('cache');
    fixture.file('cache/blob.bin', '0123456789');
    const staleFile = fixture.file('stale.tmp', 'abc');
    const fakeProfile = join(fixture.root, 'fake-profile');

    const cleaner = new Cleaner({
      guard: { userProfile: fakeProfile, userFolders: ['Documents'] },
      makeId: () => 'plan-e2e',
      now: () => 42,
    });

    const rules = [
      makeRule({
        id: 'cache',
        category: 'app-caches',
        matches: [
          makeMatch({
            path: cache,
            bytes: 10,
            recovery: { kind: 'junk', reason: 'cache is re-downloaded on demand' },
          }),
        ],
      }),
      makeRule({
        id: 'stale',
        category: 'temp',
        matches: [
          makeMatch({
            path: staleFile,
            bytes: 3,
            recovery: { kind: 'regenerate', command: 'rebuild output' },
          }),
        ],
      }),
      makeRule({
        id: 'forbidden',
        category: 'temp',
        matches: [makeMatch({ path: join(fakeProfile, 'Documents'), bytes: 999 })],
      }),
    ];

    const plan = await cleaner.preview(rules, ctx);
    expect(plan.id).toBe('plan-e2e');
    expect(plan.createdAt).toBe(42);
    expect(plan.items.map((item) => item.path).sort()).toEqual([cache, staleFile].sort());
    expect(plan.refused).toHaveLength(1);
    expect(plan.refused[0]).toMatchObject({ ruleId: 'forbidden', reason: 'protected-root' });
    expect(plan.totals.bytes).toBe(13);

    const report = await cleaner.execute(plan.id);
    expect(report.deletedBytes).toBe(13);
    expect(report.itemErrors).toBe(0);
    expect(report.skippedLocked).toBe(0);
    expect(existsSync(cache)).toBe(false);
    expect(existsSync(staleFile)).toBe(false);
    expect(existsSync(join(fakeProfile, 'Documents'))).toBe(false);
  });

  it('exposes the cleaner surface through the public index', () => {
    expect(typeof core.Cleaner).toBe('function');
    expect(typeof core.buildPlan).toBe('function');
    expect(typeof core.checkDeletable).toBe('function');
    expect(typeof core.createNodeFsProbe).toBe('function');
    expect(typeof core.validateRules).toBe('function');
    expect(typeof core.defaultProtectedPaths).toBe('function');
    expect(typeof core.PlanTokenError).toBe('function');
    expect(typeof core.RuleValidationError).toBe('function');
  });
});
