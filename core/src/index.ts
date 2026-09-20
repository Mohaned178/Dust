export { AggregateTree } from './model/tree';
export type { TreeNode } from './model/tree';
export type { Entry, FolderRecord, Marker, NodeKind, ProgressUpdate } from './model/types';
export { NodeFsEnumerator } from './scanner/enumerator';
export type { Enumerator, ListResult } from './scanner/enumerator';
export { createExclusionPredicate } from './scanner/exclusions';
export type { ExclusionConfig } from './scanner/exclusions';
export { ScanSession } from './scanner/session';
export type { PoolOptions, ScanResult, SessionOptions } from './scanner/session';
export type { PoolLimits } from './scan/protocol';
export { defaultWorkerCount, DEFAULT_POOL_LIMITS } from './scan/limits';
export { scanTree } from './scanner/scanner';
export type { ScanConfig, ScanStats } from './scanner/scanner';
export { buildPlan } from './cleaner/plan';
export type {
  BuildPlanOptions,
  CleanupPlan,
  PlanItem,
  PlanTotals,
  RefusedMatch,
  RefusedReason,
} from './cleaner/plan';
export { checkDeletable, defaultProtectedPaths } from './cleaner/guard';
export type { GuardDenial, GuardOptions, GuardResult } from './cleaner/guard';
export { Cleaner, PlanTokenError } from './cleaner/cleaner';
export type { CleanerOptions, CleanupReport, ExecuteOptions, PlanTokenErrorCode } from './cleaner/cleaner';
export { executeItem } from './cleaner/executor';
export type { DeleteError, DeleteOutcome, ItemResult } from './cleaner/executor';
export { createNodeFsProbe } from './rules/probe';
export { RuleValidationError, validateRules } from './rules/validate';
export type {
  Action,
  ActionGrade,
  CategoryId,
  FsProbe,
  Recovery,
  Rule,
  RuleContext,
  RuleMatch,
} from './rules/types';
export { createInventoryRules } from './rules/inventory';
export { systemTempRule } from './rules/inventory/system-temp';
export { recycleBinRule, defaultRecycleBinEnumeration } from './rules/inventory/recycle-bin';
export type { RecycleBinInfo } from './rules/inventory/recycle-bin';
export { npmCacheRule } from './rules/inventory/npm-cache';
export {
  cacheRegistryRules,
  chromeCacheRule,
  edgeCacheRule,
  firefoxCacheRule,
  discordCacheRule,
  slackCacheRule,
} from './rules/inventory/cache-registry';
export { defaultRuleEnv, expandProfileWildcard } from './rules/paths';
export type { RuleEnv } from './rules/paths';
export { classifyDisplayGrade } from './display/display-grade';
export type { DisplayGrade, DisplayGradeReason } from './display/display-grade';
export { defaultEmptyRecycleBin } from './cleaner/executor';
export type { EmptyRecycleBinResult } from './cleaner/executor';
