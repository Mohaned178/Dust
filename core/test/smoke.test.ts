import { describe, expect, it } from 'vitest';
import * as core from '../src/index';

describe('core public API', () => {
  it('exposes the scan engine surface', () => {
    expect(typeof core.ScanSession).toBe('function');
    expect(typeof core.scanTree).toBe('function');
    expect(typeof core.AggregateTree).toBe('function');
    expect(typeof core.NodeFsEnumerator).toBe('function');
    expect(typeof core.createExclusionPredicate).toBe('function');
  });

  it('exposes the rules and cleaner surface', () => {
    expect(typeof core.Cleaner).toBe('function');
    expect(typeof core.buildPlan).toBe('function');
    expect(typeof core.checkDeletable).toBe('function');
    expect(typeof core.createNodeFsProbe).toBe('function');
    expect(typeof core.validateRules).toBe('function');
    expect(typeof core.defaultProtectedPaths).toBe('function');
    expect(typeof core.PlanTokenError).toBe('function');
    expect(typeof core.RuleValidationError).toBe('function');
  });

  it('exposes the inventory and display surface', () => {
    expect(typeof core.createInventoryRules).toBe('function');
    expect(typeof core.defaultRuleEnv).toBe('function');
    expect(typeof core.classifyDisplayGrade).toBe('function');
    expect(typeof core.recycleBinRule).toBe('function');
    expect(typeof core.cacheRegistryRules).toBe('function');
    expect(typeof core.defaultEmptyRecycleBin).toBe('function');
  });

  it('exposes the project classification surface', () => {
    expect(typeof core.classifyProjects).toBe('function');
    expect(typeof core.discoverProjects).toBe('function');
    expect(typeof core.readManifest).toBe('function');
    expect(typeof core.npmProjectModulesRule).toBe('function');
    expect(core.DEFAULT_RECENCY_THRESHOLDS).toEqual({ activeDays: 30, occasionalDays: 180 });
  });

  it('exposes the snapshot and volumes surface', () => {
    expect(typeof core.buildSnapshot).toBe('function');
    expect(typeof core.buildFolderMap).toBe('function');
    expect(typeof core.applyCleanupReport).toBe('function');
    expect(typeof core.SnapshotStore).toBe('function');
    expect(typeof core.getVolumeUsage).toBe('function');
    expect(typeof core.listFixedVolumes).toBe('function');
    expect(typeof core.SnapshotCorruptError).toBe('function');
    expect(core.SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(core.RULES_VERSION).toBe('1');
    expect(typeof core.parseSnapshot).toBe('function');
  });

  it('exposes the drive-type surface', () => {
    expect(typeof core.listVolumes).toBe('function');
    expect(typeof core.volumeRootOf).toBe('function');
    expect(typeof core.createExternalPredicate).toBe('function');
    expect(typeof core.volumeClusterSize).toBe('function');
  });
});
