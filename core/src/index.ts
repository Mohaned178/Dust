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
export { defaultWorkerCount, defaultWorkersForVolume, DEFAULT_POOL_LIMITS, HDD_WORKERS } from './scan/limits';
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
export { deleteUnprotectedPath } from './cleaner/browse-delete';
export type { BrowseDeleteResult, BrowseDeleteStatus } from './cleaner/browse-delete';
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
export { scopeRuleToRoot } from './rules/scope';
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
export { classifyDisplayGrade, createDisplayGrader } from './display/display-grade';
export type { DisplayGrade, DisplayGradeReason } from './display/display-grade';
export { defaultEmptyRecycleBin } from './cleaner/executor';
export type { EmptyRecycleBinResult } from './cleaner/executor';
export { classifyProjects, DEFAULT_RECENCY_THRESHOLDS } from './projects/classify';
export { discoverProjects } from './projects/discover';
export type { DiscoveredOrphan, DiscoveredUnit } from './projects/discover';
export {
  PUBLIC_REGISTRY_HOSTS,
  hasPnp,
  hasWorkspaceSignals,
  parsePackageManager,
  readManifest,
  sampleRegistryHosts,
} from './projects/manifest';
export type { LockfileName, ManifestInfo } from './projects/manifest';
export type {
  ActivitySource,
  ClassifyInput,
  NodeModulesLocation,
  PackageManager,
  ProjectActivity,
  ProjectAnalysis,
  ProjectKind,
  ProjectOptions,
  ProjectRecord,
  RecencyGroup,
  RecencyThresholds,
  Restorability,
  RestorabilityGrade,
} from './projects/types';
export { npmProjectModulesRule } from './rules/inventory/npm-project-modules';
export { SNAPSHOT_SCHEMA_VERSION, parseSnapshot, SnapshotCorruptError } from './snapshot/schema';
export type {
  ScanStatus,
  SnapshotCategory,
  SnapshotData,
  SnapshotDisk,
  SnapshotFolder,
  SnapshotMatch,
} from './snapshot/schema';
export { applyCleanupReport, buildFolderMap, buildSnapshot } from './snapshot/build';
export { pruneSnapshotAfterCleanup } from './snapshot/prune';
export type { FolderMapOptions, SnapshotInput } from './snapshot/build';
export { SnapshotStore } from './snapshot/store';
export type { SaveResult, SnapshotLoadResult, StorePaths, UserPreferences } from './snapshot/store';
export { RULES_VERSION } from './rules/version';
export { getVolumeUsage, listFixedVolumes } from './system/volumes';
export type { VolumeUsage } from './system/volumes';
export {
  createExternalPredicate,
  listVolumes,
  listVolumesAsync,
  resetVolumeCache,
  systemDriveRoot,
  volumeRootOf,
} from './system/drive-type';
export type { DriveType, VolumeInfo } from './system/drive-type';
export { DEFAULT_CLUSTER_SIZE, roundUpToCluster, volumeClusterSize } from './system/cluster';
