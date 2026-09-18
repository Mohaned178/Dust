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
});
