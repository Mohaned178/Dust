import { describe, expect, it } from 'vitest';
import { recycleBinRule } from '../src/rules/inventory/recycle-bin';
import type { RuleContext } from '../src/rules/types';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';

function ctx(): RuleContext {
  return { root: 'F:\\synthetic', tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
}

describe('recycleBinRule', () => {
  it('matches with review grade and an irreversible recovery note when the bin has content', async () => {
    const rule = recycleBinRule({
      enumerate: () => ({ fileCount: 12, bytes: 4096, oldestMs: 1000, newestMs: 2000, volume: 'C:' }),
    });
    const matches = await rule.match(ctx());
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ path: 'C:\\$Recycle.Bin', grade: 'review', bytes: 4096 });
    expect(matches[0]!.recovery).toEqual({ kind: 'junk', reason: 'Emptied items are permanently gone' });
    expect(matches[0]!.evidence).toBe('12 items, 4096 bytes on C: for the current user, dated 1970-01-01 to 1970-01-01');
    expect(rule.action).toEqual({ kind: 'empty-recycle-bin' });
  });

  it('returns no matches when the bin is empty', async () => {
    const rule = recycleBinRule({
      enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: 'C:' }),
    });
    expect(await rule.match(ctx())).toEqual([]);
  });

  it('returns no matches when enumeration is unavailable', async () => {
    const rule = recycleBinRule({
      enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null }),
    });
    expect(await rule.match(ctx())).toEqual([]);
  });

  it('returns no matches when enumeration failed, keeping the error marker off the match surface', async () => {
    const rule = recycleBinRule({
      enumerate: () => ({
        fileCount: 0,
        bytes: 0,
        oldestMs: null,
        newestMs: null,
        volume: 'C:',
        error: 'access denied',
      }),
    });
    expect(await rule.match(ctx())).toEqual([]);
  });
});
