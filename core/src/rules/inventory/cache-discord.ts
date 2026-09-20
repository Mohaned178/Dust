import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';

const VARIANTS = ['discord', 'discordptb', 'discordcanary'];
const SUBDIRS = ['Cache', 'Code Cache', 'GPUCache'];

export function discordCacheRule(env: Pick<RuleEnv, 'appData'>): Rule {
  return {
    id: 'cache-discord',
    category: 'app-caches',
    title: 'Discord cache',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      if (!env.appData) return [];
      const matches: RuleMatch[] = [];
      for (const variant of VARIANTS) {
        for (const subdir of SUBDIRS) {
          const path = join(env.appData, variant, subdir);
          if (!ctx.probe.exists(path)) continue;
          matches.push({
            path,
            bytes: ctx.tree.get(path)?.bytes ?? 0,
            grade: 'safe',
            recovery: { kind: 'junk', reason: 'Discord cache is re-downloaded on next use' },
            evidence: `Discord (${variant}) cache directory`,
          });
        }
      }
      return matches;
    },
  };
}
