import { join } from 'node:path';
import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import { curatedCacheRule } from './cache-specs';
import type { CuratedCacheSpec } from './cache-specs';

const SUBDIRS = [['Cache'], ['Code Cache'], ['GPUCache'], ['Service Worker', 'CacheStorage']];

export const slackCacheSpec: CuratedCacheSpec = {
  ruleId: 'cache-slack',
  title: 'Slack cache',
  appLabel: 'Slack',
  appTokens: ['slack'],
  recoveryReason: 'Slack cache is re-downloaded on next use',
  evidence: () => 'Slack cache directory',
  roots: (env) => (env.appData ? [join(env.appData, 'Slack')] : []),
  candidates: (env, probe) => {
    if (!env.appData) return [];
    const paths: string[] = [];
    for (const subdir of SUBDIRS) {
      const path = join(env.appData, 'Slack', ...subdir);
      if (probe.exists(path)) paths.push(path);
    }
    return paths;
  },
};

export function slackCacheRule(env: RuleEnv): Rule {
  return curatedCacheRule(slackCacheSpec, env);
}
