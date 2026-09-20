import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { systemTempRule } from '../src/rules/inventory/system-temp';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import type { FolderRecord } from '../src/model/types';
import { Fixture } from './fixtures';

function record(path: string, overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    path,
    bytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    ...overrides,
  };
}

describe('systemTempRule', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('matches the user temp dir and the windows temp dir with scan sizes', async () => {
    const userTemp = fixture.dir('user-temp');
    const windowsTemp = fixture.dir('win-temp');
    const tree = new AggregateTree();
    tree.addFolder(record(userTemp, { bytes: 1234 }));
    tree.addFolder(record(windowsTemp, { bytes: 5678 }));

    const rule = systemTempRule({ temp: userTemp, windowsDir: fixture.root });
    const ctx: RuleContext = { root: fixture.root, tree, markers: [], probe: createNodeFsProbe() };
    // windowsDir/Temp must exist for the rule to match it:
    fixture.dir('Temp');

    const matches = await rule.match(ctx);
    expect(matches.map((m) => m.path).sort()).toEqual([userTemp, `${fixture.root}\\Temp`].sort());
    const userMatch = matches.find((m) => m.path === userTemp)!;
    expect(userMatch.bytes).toBe(1234);
    expect(userMatch.grade).toBe('safe');
    expect(userMatch.recovery.kind).toBe('junk');
    expect(userMatch.evidence).toContain('TEMP');
  });

  it('skips paths that do not exist', async () => {
    const rule = systemTempRule({ temp: `${fixture.root}\\missing`, windowsDir: `${fixture.root}\\missing-win` });
    const ctx: RuleContext = {
      root: fixture.root,
      tree: new AggregateTree(),
      markers: [],
      probe: createNodeFsProbe(),
    };
    expect(await rule.match(ctx)).toEqual([]);
  });

  it('does not match the same path twice when TEMP and SystemRoot\\Temp coincide', async () => {
    const shared = fixture.dir('shared-temp');
    const tree = new AggregateTree();
    tree.addFolder(record(shared, { bytes: 11 }));
    const rule = systemTempRule({ temp: shared, windowsDir: `${fixture.root}\\missing` });
    const ctx: RuleContext = { root: fixture.root, tree, markers: [], probe: createNodeFsProbe() };
    const matches = await rule.match(ctx);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.bytes).toBe(11);
  });
});
