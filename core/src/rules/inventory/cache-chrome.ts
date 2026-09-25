import { join } from 'node:path';
import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import { expandProfileWildcard } from '../paths';
import { curatedCacheRule } from './cache-specs';
import type { CuratedCacheSpec } from './cache-specs';

export const chromeCacheSpec: CuratedCacheSpec = {
  ruleId: 'cache-chrome',
  title: 'Chrome cache',
  appLabel: 'Chrome',
  appTokens: ['chrome', 'googlechrome'],
  recoveryReason: 'Chrome cache is re-downloaded on next use',
  evidence: () => 'Chrome profile cache directory',
  roots: (env) => (env.localAppData ? [join(env.localAppData, 'Google', 'Chrome')] : []),
  candidates: (env, probe) => {
    if (!env.localAppData) return [];
    const userData = join(env.localAppData, 'Google', 'Chrome', 'User Data');
    return [
      ...expandProfileWildcard(userData, '*/Cache/Cache_Data', probe),
      ...expandProfileWildcard(userData, '*/Code Cache', probe),
    ];
  },
};

export function chromeCacheRule(env: RuleEnv): Rule {
  return curatedCacheRule(chromeCacheSpec, env);
}
