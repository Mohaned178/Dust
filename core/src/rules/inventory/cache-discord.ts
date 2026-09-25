import { join } from 'node:path';
import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import { curatedCacheRule } from './cache-specs';
import type { CuratedCacheSpec } from './cache-specs';

const VARIANTS = ['discord', 'discordptb', 'discordcanary'];
const SUBDIRS = ['Cache', 'Code Cache', 'GPUCache'];

export const discordCacheSpec: CuratedCacheSpec = {
  ruleId: 'cache-discord',
  title: 'Discord cache',
  appLabel: 'Discord',
  appTokens: ['discord', 'discordptb', 'discordcanary'],
  recoveryReason: 'Discord cache is re-downloaded on next use',
  evidence: (path) => {
    const lower = path.toLowerCase();
    const variant = VARIANTS.find((entry) => lower.includes(`\\${entry}\\`)) ?? 'discord';
    return `Discord (${variant}) cache directory`;
  },
  roots: (env) => (env.appData ? VARIANTS.map((variant) => join(env.appData, variant)) : []),
  candidates: (env, probe) => {
    if (!env.appData) return [];
    const paths: string[] = [];
    for (const variant of VARIANTS) {
      for (const subdir of SUBDIRS) {
        const path = join(env.appData, variant, subdir);
        if (probe.exists(path)) paths.push(path);
      }
    }
    return paths;
  },
};

export function discordCacheRule(env: RuleEnv): Rule {
  return curatedCacheRule(discordCacheSpec, env);
}
