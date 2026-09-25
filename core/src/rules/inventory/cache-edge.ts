import { join } from 'node:path';
import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import { expandProfileWildcard } from '../paths';
import { curatedCacheRule } from './cache-specs';
import type { CuratedCacheSpec } from './cache-specs';

export const edgeCacheSpec: CuratedCacheSpec = {
  ruleId: 'cache-edge',
  title: 'Edge cache',
  appLabel: 'Edge',
  appTokens: ['edge', 'microsoftedge'],
  recoveryReason: 'Edge cache is re-downloaded on next use',
  evidence: () => 'Edge profile cache directory',
  roots: (env) => (env.localAppData ? [join(env.localAppData, 'Microsoft', 'Edge')] : []),
  candidates: (env, probe) => {
    if (!env.localAppData) return [];
    const userData = join(env.localAppData, 'Microsoft', 'Edge', 'User Data');
    return [
      ...expandProfileWildcard(userData, '*/Cache/Cache_Data', probe),
      ...expandProfileWildcard(userData, '*/Code Cache', probe),
    ];
  },
};

export function edgeCacheRule(env: RuleEnv): Rule {
  return curatedCacheRule(edgeCacheSpec, env);
}
