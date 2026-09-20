import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cacheRegistryRules,
  chromeCacheRule,
  edgeCacheRule,
  firefoxCacheRule,
  discordCacheRule,
  slackCacheRule,
} from '../src/rules/inventory/cache-registry';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import type { RuleEnv } from '../src/rules/paths';
import { Fixture } from './fixtures';

describe('cache registry', () => {
  let fixture: Fixture;
  let env: RuleEnv;

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
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function ctx(): RuleContext {
    return { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
  }

  it('registry returns the five app rules in stable order with correct ids', () => {
    const rules = cacheRegistryRules(env);
    expect(rules.map((rule) => rule.id)).toEqual([
      'cache-chrome',
      'cache-edge',
      'cache-firefox',
      'cache-discord',
      'cache-slack',
    ]);
    expect(rules.every((rule) => rule.category === 'app-caches')).toBe(true);
  });

  it('chrome matches every profile cache and code cache, and nothing when absent', async () => {
    const defaultCache = fixture.dir('local/Google/Chrome/User Data/Default/Cache/Cache_Data');
    const profileTwoCache = fixture.dir('local/Google/Chrome/User Data/Profile 1/Cache/Cache_Data');
    fixture.dir('local/Google/Chrome/User Data/Default/Code Cache');

    const matches = await chromeCacheRule(env).match(ctx());
    expect(matches.map((m) => m.path).sort()).toEqual(
      [
        defaultCache,
        profileTwoCache,
        join(env.localAppData, 'Google/Chrome/User Data/Default/Code Cache'),
      ].sort(),
    );
    expect(matches.every((m) => m.grade === 'safe')).toBe(true);
    expect(matches[0]!.recovery).toEqual({
      kind: 'junk',
      reason: 'Chrome cache is re-downloaded on next use',
    });

    const emptyEnv = { ...env, localAppData: `${fixture.root}\\missing` };
    expect(await chromeCacheRule(emptyEnv).match(ctx())).toEqual([]);
  });

  it('edge, firefox, discord and slack match their real subpaths', async () => {
    fixture.dir('local/Microsoft/Edge/User Data/Default/Cache/Cache_Data');
    fixture.dir('local/Mozilla/Firefox/Profiles/abc.default/cache2');
    fixture.dir('roaming/discord/Cache');
    fixture.dir('roaming/Slack/Cache');

    expect((await edgeCacheRule(env).match(ctx())).length).toBeGreaterThan(0);
    expect((await firefoxCacheRule(env).match(ctx())).length).toBeGreaterThan(0);
    const discord = await discordCacheRule(env).match(ctx());
    expect(discord.map((m) => m.path)).toEqual([join(env.appData, 'discord', 'Cache')]);
    const slack = await slackCacheRule(env).match(ctx());
    expect(slack.map((m) => m.path)).toEqual([join(env.appData, 'Slack', 'Cache')]);
  });

  it('discord matches its PTB and Canary variants too', async () => {
    fixture.dir('roaming/discordptb/GPUCache');
    fixture.dir('roaming/discordcanary/Code Cache');
    const matches = await discordCacheRule(env).match(ctx());
    expect(matches.map((m) => m.path).sort()).toEqual(
      [
        join(env.appData, 'discordptb', 'GPUCache'),
        join(env.appData, 'discordcanary', 'Code Cache'),
      ].sort(),
    );
  });

  it('slack matches Service Worker CacheStorage', async () => {
    fixture.dir('roaming/Slack/Service Worker/CacheStorage');
    const matches = await slackCacheRule(env).match(ctx());
    expect(matches.map((m) => m.path)).toContain(join(env.appData, 'Slack', 'Service Worker', 'CacheStorage'));
  });
});
