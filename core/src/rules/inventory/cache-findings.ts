import type { RuleContext } from '../types';
import type { RuleEnv } from '../paths';
import type { CacheFinding } from '../findings';
import { appIsVerifiedMissing } from '../installed-state';
import { CURATED_CACHE_SPECS } from './cache-registry';

export function curatedCacheFindings(ctx: RuleContext, env: RuleEnv): CacheFinding[] {
  const snapshot = ctx.installs;
  if (snapshot === undefined || !snapshot.trusted) return [];
  const findings: CacheFinding[] = [];
  for (const spec of CURATED_CACHE_SPECS) {
    if (!appIsVerifiedMissing(snapshot, spec.appTokens)) continue;
    for (const path of spec.candidates(env, ctx.probe)) {
      findings.push({
        path,
        bytes: ctx.tree.get(path)?.bytes ?? 0,
        kind: 'curated-leftover',
        grade: 'review',
        label: spec.appLabel,
        reason: `Leftover cache from ${spec.appLabel} (not installed) — regenerated if the app returns`,
      });
    }
  }
  return findings;
}
