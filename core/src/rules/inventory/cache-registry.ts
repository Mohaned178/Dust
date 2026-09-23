import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import { chromeCacheRule } from './cache-chrome';
import { edgeCacheRule } from './cache-edge';
import { firefoxCacheRule } from './cache-firefox';
import { discordCacheRule } from './cache-discord';
import { slackCacheRule } from './cache-slack';

export { chromeCacheRule } from './cache-chrome';
export { edgeCacheRule } from './cache-edge';
export { firefoxCacheRule } from './cache-firefox';
export { discordCacheRule } from './cache-discord';
export { slackCacheRule } from './cache-slack';

export function cacheRegistryRules(env: RuleEnv): Rule[] {
  return [
    chromeCacheRule(env),
    edgeCacheRule(env),
    firefoxCacheRule(env),
    discordCacheRule(env),
    slackCacheRule(env),
  ];
}
