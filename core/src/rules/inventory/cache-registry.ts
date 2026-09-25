import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import { chromeCacheRule, chromeCacheSpec } from './cache-chrome';
import { edgeCacheRule, edgeCacheSpec } from './cache-edge';
import { firefoxCacheRule, firefoxCacheSpec } from './cache-firefox';
import { discordCacheRule, discordCacheSpec } from './cache-discord';
import { slackCacheRule, slackCacheSpec } from './cache-slack';
import type { CuratedCacheSpec } from './cache-specs';

export { chromeCacheRule, chromeCacheSpec } from './cache-chrome';
export { edgeCacheRule, edgeCacheSpec } from './cache-edge';
export { firefoxCacheRule, firefoxCacheSpec } from './cache-firefox';
export { discordCacheRule, discordCacheSpec } from './cache-discord';
export { slackCacheRule, slackCacheSpec } from './cache-slack';
export type { CuratedCacheSpec } from './cache-specs';

export const CURATED_CACHE_SPECS: CuratedCacheSpec[] = [
  chromeCacheSpec,
  edgeCacheSpec,
  firefoxCacheSpec,
  discordCacheSpec,
  slackCacheSpec,
];

export function cacheRegistryRules(env: RuleEnv): Rule[] {
  return [
    chromeCacheRule(env),
    edgeCacheRule(env),
    firefoxCacheRule(env),
    discordCacheRule(env),
    slackCacheRule(env),
  ];
}
