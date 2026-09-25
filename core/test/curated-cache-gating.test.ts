import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import { curatedCacheFindings } from '../src/rules/inventory/cache-findings';
import {
  chromeCacheRule,
  discordCacheRule,
  edgeCacheRule,
  firefoxCacheRule,
  slackCacheRule,
} from '../src/rules/inventory/cache-registry';
import type { RuleContext } from '../src/rules/types';
import type { RuleEnv } from '../src/rules/paths';
import type { InstalledApp, InstalledAppsSnapshot } from '../src/system/installed-apps';
import { Fixture } from './fixtures';

const CHROME: InstalledApp = { displayName: 'Google Chrome', publisher: 'Google LLC', installLocation: '' };
const DISCORD: InstalledApp = { displayName: 'Discord', publisher: 'Discord Inc.', installLocation: '' };
const EDGE: InstalledApp = { displayName: 'Microsoft Edge', publisher: 'Microsoft Corporation', installLocation: '' };
const FIREFOX: InstalledApp = { displayName: 'Mozilla Firefox', publisher: 'Mozilla', installLocation: '' };
const SLACK: InstalledApp = { displayName: 'Slack', publisher: 'Slack Technologies', installLocation: '' };

describe('curated cache gating', () => {
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

  function context(installs?: InstalledAppsSnapshot): RuleContext {
    return { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe(), installs };
  }

  function trusted(apps: InstalledApp[]): InstalledAppsSnapshot {
    return { apps, trusted: true };
  }

  it('matches and produces no leftovers when the app is installed', async () => {
    const cache = fixture.dir('local/Google/Chrome/User Data/Default/Cache/Cache_Data');
    fixture.dir('roaming/discord/Cache');
    fixture.dir('roaming/Slack/GPUCache');
    const ctx = context(trusted([CHROME, DISCORD, SLACK]));

    const chrome = await chromeCacheRule(env).match(ctx);
    expect(chrome.map((match) => match.path)).toEqual([cache]);
    expect(chrome[0]!.grade).toBe('safe');
    expect(await discordCacheRule(env).match(ctx)).toHaveLength(1);
    expect(await slackCacheRule(env).match(ctx)).toHaveLength(1);
    expect(curatedCacheFindings(ctx, env)).toEqual([]);
  });

  it('returns no matches and review findings when the app is verified missing', async () => {
    const cache = fixture.dir('local/Google/Chrome/User Data/Default/Cache/Cache_Data');
    fixture.dir('roaming/discord/Cache');
    const ctx = context(trusted([EDGE, FIREFOX]));

    expect(await chromeCacheRule(env).match(ctx)).toEqual([]);
    expect(await discordCacheRule(env).match(ctx)).toEqual([]);

    const findings = curatedCacheFindings(ctx, env);
    expect(findings.map((finding) => finding.path).sort()).toEqual(
      [cache, `${env.appData}\\discord\\Cache`].sort(),
    );
    expect(findings.every((finding) => finding.grade === 'review')).toBe(true);
    expect(findings.every((finding) => finding.kind === 'curated-leftover')).toBe(true);
    expect(findings.map((finding) => finding.label).sort()).toEqual(['Chrome', 'Discord']);
  });

  it('keeps the legacy behavior when the registry read is untrusted', async () => {
    fixture.dir('local/Google/Chrome/User Data/Default/Cache/Cache_Data');
    const ctx = context({ apps: [], trusted: false });

    expect(await chromeCacheRule(env).match(ctx)).toHaveLength(1);
    expect(curatedCacheFindings(ctx, env)).toEqual([]);
  });

  it('gates every curated rule when no installs snapshot is supplied', async () => {
    fixture.dir('local/Microsoft/Edge/User Data/Default/Cache/Cache_Data');
    fixture.dir('local/Mozilla/Firefox/Profiles/abc.default/cache2');
    fixture.dir('roaming/discord/Cache');
    fixture.dir('roaming/Slack/Cache');
    const ctx = context(undefined);

    expect(await edgeCacheRule(env).match(ctx)).toHaveLength(1);
    expect(await firefoxCacheRule(env).match(ctx)).toHaveLength(1);
    expect(await discordCacheRule(env).match(ctx)).toHaveLength(1);
    expect(await slackCacheRule(env).match(ctx)).toHaveLength(1);
    expect(curatedCacheFindings(ctx, env)).toEqual([]);
  });
});
