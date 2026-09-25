import type { RuleEnv } from '../paths';
import type { FsProbe, Rule, RuleMatch } from '../types';
import { appIsInstalled } from '../installed-state';

export interface CuratedCacheSpec {
  ruleId: string;
  title: string;
  appLabel: string;
  appTokens: readonly string[];
  recoveryReason: string;
  evidence: (path: string) => string;
  roots: (env: RuleEnv) => string[];
  candidates: (env: RuleEnv, probe: FsProbe) => string[];
}

export function curatedCacheRule(spec: CuratedCacheSpec, env: RuleEnv): Rule {
  return {
    id: spec.ruleId,
    category: 'app-caches',
    title: spec.title,
    action: { kind: 'delete-path' },
    match(ctx): RuleMatch[] {
      if (!appIsInstalled(ctx.installs, spec.appTokens)) return [];
      return spec.candidates(env, ctx.probe).map((path) => ({
        path,
        bytes: ctx.tree.get(path)?.bytes ?? 0,
        grade: 'safe' as const,
        recovery: { kind: 'junk' as const, reason: spec.recoveryReason },
        evidence: spec.evidence(path),
      }));
    },
  };
}
