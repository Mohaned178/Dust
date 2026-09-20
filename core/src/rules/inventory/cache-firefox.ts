import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';
import { expandProfileWildcard } from '../paths';

export function firefoxCacheRule(env: Pick<RuleEnv, 'localAppData'>): Rule {
  return {
    id: 'cache-firefox',
    category: 'app-caches',
    title: 'Firefox cache',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      if (!env.localAppData) return [];
      const profiles = join(env.localAppData, 'Mozilla', 'Firefox', 'Profiles');
      return expandProfileWildcard(profiles, '*/cache2', ctx.probe).map((path) => ({
        path,
        bytes: ctx.tree.get(path)?.bytes ?? 0,
        grade: 'safe' as const,
        recovery: { kind: 'junk' as const, reason: 'Firefox cache is re-downloaded on next use' },
        evidence: 'Firefox profile cache directory',
      }));
    },
  };
}
