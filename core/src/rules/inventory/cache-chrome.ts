import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';
import { expandProfileWildcard } from '../paths';

export function chromeCacheRule(env: Pick<RuleEnv, 'localAppData'>): Rule {
  return {
    id: 'cache-chrome',
    category: 'app-caches',
    title: 'Chrome cache',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      if (!env.localAppData) return [];
      const userData = join(env.localAppData, 'Google', 'Chrome', 'User Data');
      const candidates = [
        ...expandProfileWildcard(userData, '*/Cache/Cache_Data', ctx.probe),
        ...expandProfileWildcard(userData, '*/Code Cache', ctx.probe),
      ];
      return candidates.map((path) => ({
        path,
        bytes: ctx.tree.get(path)?.bytes ?? 0,
        grade: 'safe' as const,
        recovery: { kind: 'junk' as const, reason: 'Chrome cache is re-downloaded on next use' },
        evidence: 'Chrome profile cache directory',
      }));
    },
  };
}
