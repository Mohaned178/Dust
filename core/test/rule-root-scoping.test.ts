import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AggregateTree } from '../src/model/tree';
import { createInventoryRules } from '../src/rules/inventory';
import { scopeRuleToRoot } from '../src/rules/scope';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleEnv } from '../src/rules/paths';
import type { Rule, RuleContext, RuleMatch } from '../src/rules/types';
import { volumeRootOf } from '../src/system/drive-type';
import { Fixture } from './fixtures';

function matchOn(path: string): RuleMatch {
  return {
    path,
    bytes: 1,
    grade: 'safe',
    recovery: { kind: 'junk', reason: 'test' },
    evidence: 'test',
  };
}

function fakeRule(matches: RuleMatch[]): Rule {
  return {
    id: 'fake',
    category: 'temp',
    title: 'Fake',
    action: { kind: 'delete-path' },
    match: () => matches,
  };
}

function context(root: string): RuleContext {
  return { root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
}

describe('scopeRuleToRoot', () => {
  it('preserves rule identity', () => {
    const scoped = scopeRuleToRoot(fakeRule([]));
    expect(scoped.id).toBe('fake');
    expect(scoped.category).toBe('temp');
    expect(scoped.action).toEqual({ kind: 'delete-path' });
  });

  it('drops matches on other volumes', async () => {
    const rule = scopeRuleToRoot(fakeRule([matchOn('C:\\Temp\\a'), matchOn('D:\\Games\\b')]));
    const matches = await rule.match(context('D:\\'));
    expect(matches.map((entry) => entry.path)).toEqual(['D:\\Games\\b']);
  });

  it('keeps matches on the scanned volume case-insensitively', async () => {
    const rule = scopeRuleToRoot(fakeRule([matchOn('C:\\Temp\\a')]));
    const matches = await rule.match(context('c:\\'));
    expect(matches.map((entry) => entry.path)).toEqual(['C:\\Temp\\a']);
  });

  it('keeps matches that use forward slashes on the scanned volume', async () => {
    const rule = scopeRuleToRoot(fakeRule([matchOn('D:/Games/b')]));
    const matches = await rule.match(context('D:\\'));
    expect(matches.map((entry) => entry.path)).toEqual(['D:/Games/b']);
  });

  it('passes matches through when the scanned root has no volume', async () => {
    const rule = scopeRuleToRoot(fakeRule([matchOn('/tmp/a')]));
    const matches = await rule.match(context('/tmp'));
    expect(matches.map((entry) => entry.path)).toEqual(['/tmp/a']);
  });

  it('awaits async rules', async () => {
    const rule = scopeRuleToRoot({
      ...fakeRule([]),
      match: async () => [matchOn('C:\\Temp\\a')],
    });
    const matches = await rule.match(context('C:\\'));
    expect(matches).toHaveLength(1);
  });
});

describe('inventory root scoping', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function envFor(): RuleEnv {
    return {
      temp: fixture.dir('temp'),
      localAppData: fixture.dir('local'),
      appData: fixture.dir('roaming'),
      userProfile: fixture.dir('profile'),
      windowsDir: fixture.dir('windows'),
      programData: fixture.dir('program-data'),
    };
  }

  it('never returns system-drive paths when scanning a different root', async () => {
    fixture.file('temp/a.tmp', 'x');
    fixture.file('local/npm-cache/_cacache/blob', 'x');
    fixture.file('windows/Temp/c.tmp', 'x');
    const rules = createInventoryRules(envFor(), {
      recycleBin: {
        enumerate: () => ({ fileCount: 1, bytes: 5, oldestMs: null, newestMs: null, volume: 'C:' }),
      },
    });

    const matches = (await Promise.all(rules.map((rule) => rule.match(context('Z:\\'))))).flat();

    expect(matches).toEqual([]);
  });

  it('keeps matches on the scanned volume', async () => {
    const temp = fixture.dir('temp');
    fixture.file('temp/a.tmp', 'x');
    const rules = createInventoryRules(envFor(), {
      recycleBin: {
        enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null }),
      },
    });
    const root = volumeRootOf(fixture.root) ?? fixture.root;

    const matches = (await Promise.all(rules.map((rule) => rule.match(context(root))))).flat();

    expect(matches.map((entry) => entry.path)).toContain(temp);
  });
});
