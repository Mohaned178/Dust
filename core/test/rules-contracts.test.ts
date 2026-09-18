import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import { RuleValidationError, validateRules } from '../src/rules/validate';
import { Fixture } from './fixtures';
import { makeRule } from './rule-fixtures';

describe('validateRules', () => {
  it('accepts distinct, non-empty rules', () => {
    expect(() =>
      validateRules([makeRule({ id: 'a', matches: [] }), makeRule({ id: 'b', matches: [] })]),
    ).not.toThrow();
  });

  it('rejects duplicate ids', () => {
    expect(() => validateRules([makeRule({ id: 'a', matches: [] }), makeRule({ id: 'a', matches: [] })])).toThrow(
      RuleValidationError,
    );
  });

  it('rejects empty ids and titles', () => {
    expect(() => validateRules([makeRule({ id: '  ', matches: [] })])).toThrow(RuleValidationError);
    expect(() => validateRules([makeRule({ id: 'a', title: '', matches: [] })])).toThrow(RuleValidationError);
  });
});

describe('createNodeFsProbe', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('reports existence and stats for real paths', () => {
    const file = fixture.file('a.txt', 'hello');
    const probe = createNodeFsProbe();
    expect(probe.exists(file)).toBe(true);
    expect(probe.stat(file)?.size).toBe(5);
    expect(probe.exists(join(fixture.root, 'missing.txt'))).toBe(false);
    expect(probe.stat(join(fixture.root, 'missing.txt'))).toBeNull();
  });

  it('does not follow links when statting', (ctx) => {
    fixture.file('real/inner.txt', '12345');
    try {
      fixture.link('linked', join(fixture.root, 'real'));
    } catch {
      ctx.skip();
      return;
    }
    const probe = createNodeFsProbe();
    expect(probe.stat(join(fixture.root, 'linked'))?.isSymbolicLink()).toBe(true);
  });
});

describe('RuleContext shape', () => {
  it('is satisfiable with a tree, markers and a probe', () => {
    const ctx: RuleContext = {
      root: 'F:\\synthetic',
      tree: new AggregateTree(),
      markers: [],
      probe: createNodeFsProbe(),
    };
    expect(ctx.tree.size()).toBe(0);
  });
});
