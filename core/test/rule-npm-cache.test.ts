import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npmCacheRule } from '../src/rules/inventory/npm-cache';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import { Fixture } from './fixtures';

describe('npmCacheRule', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function ctxWith(tree: AggregateTree, probe = createNodeFsProbe()): RuleContext {
    return { root: fixture.root, tree, markers: [], probe };
  }

  it('matches localAppData\\npm-cache\\_cacache with its scan size', async () => {
    const cache = fixture.dir('npm-cache/_cacache');
    const tree = new AggregateTree();
    const rule = npmCacheRule({ localAppData: fixture.root });
    const matches = await rule.match(ctxWith(tree));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ path: cache, grade: 'safe' });
    expect(matches[0]!.recovery.kind).toBe('junk');
    expect(matches[0]!.evidence).toContain('re-download');
  });

  it('honors an explicit npm cache dir when it exists', async () => {
    const custom = fixture.dir('custom-cacache');
    const rule = npmCacheRule({ localAppData: `${fixture.root}\\missing` }, { npmCacheDir: custom });
    const matches = await rule.match(ctxWith(new AggregateTree()));
    expect(matches.map((m) => m.path)).toEqual([custom]);
  });

  it('returns nothing when no cache directory exists', async () => {
    const rule = npmCacheRule({ localAppData: `${fixture.root}\\missing` });
    expect(await rule.match(ctxWith(new AggregateTree()))).toEqual([]);
  });
});
