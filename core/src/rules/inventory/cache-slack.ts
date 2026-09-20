import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';

const SUBDIRS = [['Cache'], ['Code Cache'], ['GPUCache'], ['Service Worker', 'CacheStorage']];

export function slackCacheRule(env: Pick<RuleEnv, 'appData'>): Rule {
  return {
    id: 'cache-slack',
    category: 'app-caches',
    title: 'Slack cache',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      if (!env.appData) return [];
      const matches: RuleMatch[] = [];
      for (const subdir of SUBDIRS) {
        const path = join(env.appData, 'Slack', ...subdir);
        if (!ctx.probe.exists(path)) continue;
        matches.push({
          path,
          bytes: ctx.tree.get(path)?.bytes ?? 0,
          grade: 'safe',
          recovery: { kind: 'junk', reason: 'Slack cache is re-downloaded on next use' },
          evidence: 'Slack cache directory',
        });
      }
      return matches;
    },
  };
}
