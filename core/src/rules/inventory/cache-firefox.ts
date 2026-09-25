import { join } from 'node:path';
import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import { expandProfileWildcard } from '../paths';
import { curatedCacheRule } from './cache-specs';
import type { CuratedCacheSpec } from './cache-specs';

export const firefoxCacheSpec: CuratedCacheSpec = {
  ruleId: 'cache-firefox',
  title: 'Firefox cache',
  appLabel: 'Firefox',
  appTokens: ['firefox', 'mozilla'],
  recoveryReason: 'Firefox cache is re-downloaded on next use',
  evidence: () => 'Firefox profile cache directory',
  roots: (env) => (env.localAppData ? [join(env.localAppData, 'Mozilla', 'Firefox')] : []),
  candidates: (env, probe) => {
    if (!env.localAppData) return [];
    const profiles = join(env.localAppData, 'Mozilla', 'Firefox', 'Profiles');
    return expandProfileWildcard(profiles, '*/cache2', probe);
  },
};

export function firefoxCacheRule(env: RuleEnv): Rule {
  return curatedCacheRule(firefoxCacheSpec, env);
}
