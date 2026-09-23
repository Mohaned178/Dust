import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { Cleaner } from '../src/cleaner/cleaner';
import { createInventoryRules } from '../src/rules/inventory';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext, RuleEnv } from '../src/index';
import { Fixture } from './fixtures';

describe('inventory pipeline (end to end)', () => {
  let fixture: Fixture;
  let env: RuleEnv;
  let ctx: RuleContext;

  beforeEach(() => {
    fixture = new Fixture();
    env = {
      temp: fixture.dir('temp'),
      localAppData: fixture.dir('local'),
      appData: fixture.dir('roaming'),
      userProfile: fixture.dir('profile'),
      windowsDir: fixture.dir('windows'),
      programData: fixture.dir('program-data'),
    };
    ctx = { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('previews the whole inventory, executes it, and reports per item', async () => {
    fixture.file('temp/a.tmp', 'aaaa');
    fixture.file('temp/nested/b.tmp', 'bbbbbb');
    fixture.file('windows/Temp/c.tmp', 'cc');
    fixture.file('local/npm-cache/_cacache/blob', 'ddddd');
    fixture.file('local/Google/Chrome/User Data/Default/Cache/Cache_Data/x', 'eeeeee');
    fixture.file('roaming/discord/Cache/x', 'ffff');

    const cleaner = new Cleaner({ guard: { userProfile: env.userProfile, userFolders: [] } });
    const rules = createInventoryRules(env, {
      recycleBin: { enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null }) },
    });
    const plan = await cleaner.preview(rules, ctx);

    const ids = plan.items.map((item) => item.ruleId).sort();
    expect(ids).toEqual(['cache-chrome', 'cache-discord', 'npm-cache', 'system-temp', 'system-temp']);
    expect(plan.refused).toEqual([]);

    const report = await cleaner.execute(plan.id);
    expect(report.deletedBytes).toBe(4 + 6 + 2 + 5 + 6 + 4);
    expect(existsSync(join(env.temp, 'a.tmp'))).toBe(false);
    expect(existsSync(join(env.localAppData, 'npm-cache', '_cacache'))).toBe(false);
    expect(report.items.every((item) => item.status === 'done')).toBe(true);
  });

  it('records the recycle bin item as review and refuses to execute without acknowledgement', async () => {
    fixture.file('local/npm-cache/_cacache/blob', 'dd');
    const cleaner = new Cleaner({ guard: { userProfile: env.userProfile, userFolders: [] } });
    const rules = createInventoryRules(env, {
      recycleBin: {
        enumerate: () => ({ fileCount: 3, bytes: 999, oldestMs: 1000, newestMs: 2000, volume: 'C:' }),
      },
    });
    const plan = await cleaner.preview(rules, ctx);
    const recycle = plan.items.find((item) => item.ruleId === 'recycle-bin');
    expect(recycle).toMatchObject({ grade: 'review' });
    await expect(cleaner.execute(plan.id)).rejects.toMatchObject({ code: 'unacknowledged-review' });
  });

  it('emits cache rules only for apps that exist', async () => {
    fixture.file('local/npm-cache/_cacache/blob', 'x');
    const cleaner = new Cleaner({ guard: { userProfile: env.userProfile, userFolders: [] } });
    const rules = createInventoryRules(env, {
      recycleBin: { enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null }) },
    });
    const plan = await cleaner.preview(rules, ctx);
    expect(plan.items.map((item) => item.ruleId).sort()).toEqual(['npm-cache', 'system-temp']);
  });

  it('exposes the inventory and display surfaces through the public index', () => {
    expect(typeof core.createInventoryRules).toBe('function');
    expect(typeof core.defaultRuleEnv).toBe('function');
    expect(typeof core.classifyDisplayGrade).toBe('function');
    expect(typeof core.defaultEmptyRecycleBin).toBe('function');
    expect(typeof core.cacheRegistryRules).toBe('function');
  });
});
