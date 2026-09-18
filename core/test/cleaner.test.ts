import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Cleaner } from '../src/cleaner/cleaner';
import type { RuleContext } from '../src/rules/types';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import { Fixture } from './fixtures';
import { makeMatch, makeRule } from './rule-fixtures';

describe('Cleaner', () => {
  let fixture: Fixture;
  let ctx: RuleContext;

  beforeEach(() => {
    fixture = new Fixture();
    ctx = { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function makeCleaner(): Cleaner {
    return new Cleaner({
      guard: { userProfile: 'C:\\Users\\x', userFolders: [] },
      makeId: () => 'plan-1',
      now: () => 1000,
    });
  }

  it('previews and executes a plan, deleting files and reporting bytes', async () => {
    const junk = fixture.dir('junk');
    fixture.file('junk/a.txt', 'aaaaa');
    fixture.file('junk/b.txt', 'bbbbbbb');

    const cleaner = makeCleaner();
    const rules = [makeRule({ id: 'fixture', matches: [makeMatch({ path: junk, bytes: 12 })] })];
    const plan = await cleaner.preview(rules, ctx);
    expect(plan.items).toHaveLength(1);

    const report = await cleaner.execute(plan.id);
    expect(report.deletedBytes).toBe(12);
    expect(report.skippedLocked).toBe(0);
    expect(report.items[0]).toMatchObject({ ruleId: 'fixture', status: 'done' });
    expect(existsSync(junk)).toBe(false);
  });

  it('rejects unknown and replayed plan tokens', async () => {
    const cleaner = makeCleaner();
    await expect(cleaner.execute('nope')).rejects.toMatchObject({ code: 'unknown-plan' });

    const junk = fixture.dir('junk');
    const rules = [makeRule({ id: 'fixture', matches: [makeMatch({ path: junk })] })];
    const plan = await cleaner.preview(rules, ctx);
    await cleaner.execute(plan.id);
    await expect(cleaner.execute(plan.id)).rejects.toMatchObject({ code: 'consumed-plan' });
  });

  it('requires an explicit acknowledge for review-grade items', async () => {
    const file = fixture.file('review.txt', 'abc');
    const cleaner = makeCleaner();
    const rules = [
      makeRule({
        id: 'reviewer',
        matches: [
          makeMatch({
            path: file,
            bytes: 3,
            grade: 'review',
            recovery: { kind: 'regenerate', command: 'npm ci' },
          }),
        ],
      }),
    ];
    const plan = await cleaner.preview(rules, ctx);

    await expect(cleaner.execute(plan.id)).rejects.toMatchObject({
      code: 'unacknowledged-review',
    });
    expect(existsSync(file)).toBe(true);

    const report = await cleaner.execute(plan.id, { acknowledge: [file] });
    expect(report.deletedBytes).toBe(3);
    expect(existsSync(file)).toBe(false);
  });

  it('reports already-gone items without failing the batch', async () => {
    const file = fixture.file('vanishing.txt', 'abcd');
    const cleaner = makeCleaner();
    const rules = [makeRule({ id: 'fixture', matches: [makeMatch({ path: file, bytes: 4 })] })];
    const plan = await cleaner.preview(rules, ctx);
    fixture.cleanup();
    fixture = new Fixture();
    ctx = { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };

    const report = await cleaner.execute(plan.id);
    expect(report.items[0]?.status).toBe('already-gone');
    expect(report.deletedBytes).toBe(0);
  });

  it('streams per-item results through onItem', async () => {
    const dir = fixture.dir('junk');
    fixture.file('junk/a.txt', 'aa');
    const cleaner = makeCleaner();
    const rules = [makeRule({ id: 'fixture', matches: [makeMatch({ path: dir, bytes: 2 })] })];
    const plan = await cleaner.preview(rules, ctx);

    const seen: string[] = [];
    await cleaner.execute(plan.id, { onItem: (result) => seen.push(`${result.ruleId}:${result.status}`) });
    expect(seen).toEqual(['fixture:done']);
  });

  it('does not execute an unacknowledged plan even partially', async () => {
    const first = fixture.file('first.txt', 'aa');
    const second = fixture.file('second.txt', 'bb');
    const cleaner = makeCleaner();
    const rules = [
      makeRule({
        id: 'mixed',
        matches: [
          makeMatch({ path: first, bytes: 2, grade: 'safe' }),
          makeMatch({ path: second, bytes: 2, grade: 'review', recovery: { kind: 'junk', reason: 'doomed' } }),
        ],
      }),
    ];
    const plan = await cleaner.preview(rules, ctx);
    await expect(cleaner.execute(plan.id)).rejects.toMatchObject({ code: 'unacknowledged-review' });
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(true);
  });
});
