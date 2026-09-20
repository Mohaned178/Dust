import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import { systemTempRule } from './system-temp';
import { recycleBinRule } from './recycle-bin';
import { npmCacheRule } from './npm-cache';
import { cacheRegistryRules } from './cache-registry';
import type { RecycleBinInfo } from './recycle-bin';

export function createInventoryRules(
  env: RuleEnv,
  options: { npmCacheDir?: string | null; recycleBin?: { enumerate?: () => RecycleBinInfo | Promise<RecycleBinInfo> } } = {},
): Rule[] {
  return [
    systemTempRule(env),
    recycleBinRule(options.recycleBin),
    npmCacheRule(env, { npmCacheDir: options.npmCacheDir }),
    ...cacheRegistryRules(env),
  ];
}
