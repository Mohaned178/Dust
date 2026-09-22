import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import type { ProjectOptions } from '../../projects/types';
import { scopeRuleToRoot } from '../scope';
import { systemTempRule } from './system-temp';
import { recycleBinRule } from './recycle-bin';
import { npmCacheRule } from './npm-cache';
import { cacheRegistryRules } from './cache-registry';
import { npmProjectModulesRule } from './npm-project-modules';
import type { RecycleBinInfo } from './recycle-bin';

export function createInventoryRules(
  env: RuleEnv,
  options: {
    npmCacheDir?: string | null;
    recycleBin?: { enumerate?: () => RecycleBinInfo | Promise<RecycleBinInfo> };
    projects?: ProjectOptions;
  } = {},
): Rule[] {
  return [
    systemTempRule(env),
    recycleBinRule(options.recycleBin),
    npmCacheRule(env, { npmCacheDir: options.npmCacheDir }),
    ...cacheRegistryRules(env),
    npmProjectModulesRule(options.projects),
  ].map(scopeRuleToRoot);
}
