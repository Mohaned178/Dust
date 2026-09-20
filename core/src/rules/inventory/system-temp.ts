import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';

interface Candidate {
  path: string;
  evidence: string;
}

export function systemTempRule(env: Pick<RuleEnv, 'temp' | 'windowsDir'>): Rule {
  return {
    id: 'system-temp',
    category: 'temp',
    title: 'System temporary files',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      const candidates: Candidate[] = [];
      if (env.temp) candidates.push({ path: env.temp, evidence: 'User TEMP directory' });
      if (env.windowsDir) candidates.push({ path: join(env.windowsDir, 'Temp'), evidence: 'Windows Temp directory' });

      const seen = new Set<string>();
      const matches: RuleMatch[] = [];
      for (const candidate of candidates) {
        const key = candidate.path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!ctx.probe.exists(candidate.path)) continue;
        const node = ctx.tree.get(candidate.path);
        matches.push({
          path: candidate.path,
          bytes: node?.bytes ?? 0,
          grade: 'safe',
          recovery: { kind: 'junk', reason: 'Temporary files are recreated by the apps that need them' },
          evidence: `${candidate.evidence} — junk by definition`,
        });
      }
      return matches;
    },
  };
}
