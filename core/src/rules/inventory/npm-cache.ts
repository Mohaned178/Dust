import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';

export function npmCacheRule(
  env: Pick<RuleEnv, 'localAppData'>,
  options: { npmCacheDir?: string | null } = {},
): Rule {
  return {
    id: 'npm-cache',
    category: 'npm-cache',
    title: 'npm download cache',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      const candidates: string[] = [];
      if (options.npmCacheDir) candidates.push(options.npmCacheDir);
      if (env.localAppData) candidates.push(join(env.localAppData, 'npm-cache', '_cacache'));

      const seen = new Set<string>();
      const matches: RuleMatch[] = [];
      for (const candidate of candidates) {
        const key = candidate.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!ctx.probe.exists(candidate)) continue;
        const node = ctx.tree.get(candidate);
        matches.push({
          path: candidate,
          bytes: node?.bytes ?? 0,
          grade: 'safe',
          recovery: { kind: 'junk', reason: 'Download cache; npm re-downloads packages on demand' },
          evidence: 'npm cache (content-addressed downloads, re-downloaded on demand)',
        });
      }
      return matches;
    },
  };
}
