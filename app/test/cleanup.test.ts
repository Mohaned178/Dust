import { AggregateTree, createNodeFsProbe } from '@dust/core';
import type {
  CleanupPlan,
  PlanItem,
  ProjectRecord,
  Rule,
  RuleContext,
  RuleMatch,
  SnapshotData,
} from '@dust/core';
import { describe, expect, it } from 'vitest';
import {
  isUnderAny,
  needsElevation,
  samePath,
  scopeRules,
  snapshotRules,
  subtractCategories,
  toCleanPreview,
  toCleanReport,
} from '../src/main/host/cleanup';
import type { CleanReport } from '../src/shared/ipc';

function match(path: string, overrides: Partial<RuleMatch> = {}): RuleMatch {
  return {
    path,
    bytes: 1,
    grade: 'safe',
    recovery: { kind: 'junk', reason: 'fixture' },
    evidence: 'fixture',
    ...overrides,
  };
}

function rule(id: string, category: Rule['category'], matches: RuleMatch[]): Rule {
  return { id, category, title: id, action: { kind: 'delete-path' }, match: () => matches };
}

function planItem(path: string, overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    ruleId: 'system-temp',
    category: 'temp',
    path,
    bytes: 10,
    grade: 'safe',
    recovery: { kind: 'junk', reason: 'junk' },
    evidence: 'evidence',
    action: { kind: 'delete-path' },
    ...overrides,
  };
}

function project(path: string, nodeModulesPath: string, overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    path,
    name: 'app',
    kind: 'project',
    packageManager: 'npm',
    pinned: false,
    workspaceCount: 0,
    nodeModules: { paths: [{ path: nodeModulesPath, bytes: 10 }], bytes: 10 },
    activity: { ms: 100, source: 'files' },
    recency: 'dead',
    restorability: { grade: 'green', reasons: [], restoreCommand: 'npm ci' },
    offered: true,
    evidence: ['npm'],
    ...overrides,
  };
}

function snapshot(overrides: Partial<SnapshotData> = {}): SnapshotData {
  return {
    schemaVersion: 2,
    rulesVersion: '1',
    root: 'C:\\',
    startedAt: 1,
    finishedAt: 2,
    status: 'complete',
    cleanedAt: null,
    disks: [],
    categories: [],
    matches: [],
    projects: [],
    folders: [],
    ...overrides,
  };
}

const ctx: RuleContext = { root: 'C:\\', tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };

describe('path helpers', () => {
  it('compares and nests Windows paths case-insensitively', () => {
    expect(samePath('C:\\Temp\\', 'c:\\temp')).toBe(true);
    expect(isUnderAny('C:\\Users\\x\\Temp', ['C:\\Users'])).toBe(true);
    expect(isUnderAny('C:\\Users', ['C:\\Users'])).toBe(true);
    expect(isUnderAny('C:\\Users2', ['C:\\Users'])).toBe(false);
    expect(isUnderAny('C:\\Temp', ['C:\\'])).toBe(true);
    expect(isUnderAny('D:\\Temp', ['C:\\'])).toBe(false);
  });
});

describe('needsElevation', () => {
  it('flags paths under the Windows directory only', () => {
    expect(needsElevation('C:\\Windows\\Temp', { windowsDir: 'c:\\windows' })).toBe(true);
    expect(needsElevation('C:\\Users\\x\\AppData\\Local\\Temp', { windowsDir: 'C:\\Windows' })).toBe(false);
    expect(needsElevation('C:\\Windows\\Temp', {})).toBe(false);
  });
});

describe('scopeRules', () => {
  const rules = [
    rule('system-temp', 'temp', [match('C:\\Temp'), match('C:\\Windows\\Temp')]),
    rule('npm-project-modules', 'npm-projects', [match('C:\\dev\\app\\node_modules')]),
    rule('npm-project-modules-b', 'npm-projects', [match('C:\\dev\\other\\node_modules')]),
  ];

  it('drops npm projects for quick clean', async () => {
    const scoped = scopeRules(rules, 'quick', []);
    expect(scoped.map((entry) => entry.id)).toEqual(['system-temp']);
    expect(await scoped[0]!.match(ctx)).toHaveLength(2);
  });

  it('keeps only the exact path for row clean', async () => {
    const scoped = scopeRules(rules, 'row', ['c:\\windows\\temp']);
    const matches = await scoped[0]!.match(ctx);
    expect(matches.map((entry) => entry.path)).toEqual(['C:\\Windows\\Temp']);
  });

  it('keeps matches under the selected projects for dev clean', async () => {
    const scoped = scopeRules(rules, 'dev', ['C:\\dev\\app']);
    expect(await scoped[1]!.match(ctx)).toHaveLength(1);
    expect(await scoped[2]!.match(ctx)).toHaveLength(0);
  });

  it('returns nothing without a selection', () => {
    expect(scopeRules(rules, 'dev', [])).toEqual([]);
    expect(scopeRules(rules, 'row', [])).toEqual([]);
  });
});

describe('snapshotRules', () => {
  it('rebuilds one rule per rule id and restores recovery statements', async () => {
    const app = 'C:\\dev\\app';
    const base = snapshot({
      matches: [
        { path: 'C:\\Temp', ruleId: 'system-temp', category: 'temp', bytes: 10, grade: 'safe', evidence: 'temp' },
        { path: 'C:\\$Recycle.Bin', ruleId: 'recycle-bin', category: 'recycle-bin', bytes: 5, grade: 'review', evidence: 'bin' },
        { path: `${app}\\node_modules`, ruleId: 'npm-project-modules', category: 'npm-projects', bytes: 10, grade: 'safe', evidence: 'project' },
      ],
      projects: [project(app, `${app}\\node_modules`)],
    });

    const rules = snapshotRules(base, []);
    const byId = new Map(rules.map((entry) => [entry.id, entry]));
    expect([...byId.keys()]).toEqual(['npm-project-modules', 'recycle-bin', 'system-temp']);
    expect(byId.get('recycle-bin')?.action).toEqual({ kind: 'empty-recycle-bin' });

    const projectMatch = (await byId.get('npm-project-modules')!.match(ctx))[0]!;
    expect(projectMatch.recovery).toEqual({ kind: 'regenerate', command: 'npm ci' });

    const tempMatch = (await byId.get('system-temp')!.match(ctx))[0]!;
    expect(tempMatch.recovery).toEqual({
      kind: 'junk',
      reason: 'Temporary files are recreated by the apps that need them',
    });
  });

  it('drops project matches for pinned or unoffered projects', async () => {
    const app = 'C:\\dev\\app';
    const nodeModules = `${app}\\node_modules`;
    const base = snapshot({
      matches: [
        { path: nodeModules, ruleId: 'npm-project-modules', category: 'npm-projects', bytes: 10, grade: 'safe', evidence: 'project' },
      ],
      projects: [project(app, nodeModules)],
    });

    expect(snapshotRules(base, [app])).toEqual([]);
    expect(snapshotRules(snapshot({ ...base, projects: [project(app, nodeModules, { offered: false })] }), [])).toEqual([]);
  });
});

describe('toCleanPreview', () => {
  it('maps plan items, totals, admin flags and refused entries', () => {
    const plan: CleanupPlan = {
      id: 'plan-1',
      createdAt: 5,
      items: [
        planItem('C:\\Windows\\Temp', { ruleId: 'system-temp' }),
        planItem('C:\\dev\\app\\node_modules', {
          ruleId: 'npm-project-modules',
          category: 'npm-projects',
          grade: 'review',
          recovery: { kind: 'regenerate', command: 'npm ci' },
          bytes: 30,
        }),
      ],
      totals: {
        bytes: 40,
        items: 2,
        bytesByGrade: { safe: 10, review: 30 },
        itemsByGrade: { safe: 1, review: 1 },
      },
      refused: [{ ruleId: 'system-temp', path: 'C:\\Windows', reason: 'protected-root' }],
    };

    const preview = toCleanPreview(plan, 'live', 'C:\\', 500, { windowsDir: 'C:\\Windows' });

    expect(preview.totals).toEqual({ bytes: 40, items: 2, reviewBytes: 30, reviewItems: 1 });
    expect(preview.items[0]).toMatchObject({ name: 'Temp', adminRequired: true, action: 'delete-path' });
    expect(preview.items[1]?.recovery).toEqual({ kind: 'regenerate', text: 'npm ci' });
    expect(preview.items[1]?.adminRequired).toBe(false);
    expect(preview.refused).toEqual([{ ruleId: 'system-temp', path: 'C:\\Windows', reason: 'protected-root' }]);
    expect(preview).toMatchObject({ planId: 'plan-1', root: 'C:\\', source: 'live', scanAgeMs: 500 });
  });
});

describe('toCleanReport and subtractCategories', () => {
  const plan: CleanupPlan = {
    id: 'plan-1',
    createdAt: 5,
    items: [
      planItem('C:\\Temp'),
      planItem('C:\\dev\\app\\node_modules', {
        ruleId: 'npm-project-modules',
        category: 'npm-projects',
        recovery: { kind: 'regenerate', command: 'npm ci' },
      }),
    ],
    totals: { bytes: 20, items: 2, bytesByGrade: { safe: 20, review: 0 }, itemsByGrade: { safe: 2, review: 0 } },
    refused: [],
  };

  it('joins plan items for category and restore commands', () => {
    const report = toCleanReport(
      plan,
      'dev',
      'C:\\',
      {
        planId: 'plan-1',
        startedAt: 1,
        finishedAt: 2,
        items: [
          { ruleId: 'system-temp', path: 'C:\\Temp', action: 'delete-path', status: 'done', plannedBytes: 10, deletedBytes: 10, skippedLocked: 0, errors: [] },
          { ruleId: 'npm-project-modules', path: 'C:\\dev\\app\\node_modules', action: 'delete-path', status: 'partial', plannedBytes: 10, deletedBytes: 4, skippedLocked: 1, errors: [] },
        ],
        deletedBytes: 14,
        skippedLocked: 1,
        itemErrors: 0,
      },
      0,
    );

    expect(report.items[0]).toMatchObject({ category: 'temp', restoreCommand: null });
    expect(report.items[1]).toMatchObject({ category: 'npm-projects', restoreCommand: 'npm ci', skippedLocked: 1 });
    expect(report).toMatchObject({ scope: 'dev', remainingReclaimableBytes: 0, cleanedAt: 2 });
  });

  it('reduces category bytes and item counts', () => {
    const coreReport: CleanReport = {
      planId: 'plan-1',
      scope: 'quick',
      root: 'C:\\',
      startedAt: 1,
      finishedAt: 2,
      items: [
        { ruleId: 'system-temp', path: 'C:\\Temp', category: 'temp', action: 'delete-path', status: 'done', plannedBytes: 10, deletedBytes: 10, skippedLocked: 0, errorCount: 0, restoreCommand: null },
        { ruleId: 'system-temp', path: 'C:\\Temp2', category: 'temp', action: 'delete-path', status: 'partial', plannedBytes: 10, deletedBytes: 4, skippedLocked: 1, errorCount: 0, restoreCommand: null },
      ],
      deletedBytes: 14,
      skippedLocked: 1,
      itemErrors: 0,
      remainingReclaimableBytes: 0,
      cleanedAt: 2,
    };

    const updated = subtractCategories(
      [
        { ruleId: 'system-temp', category: 'temp', bytes: 30, items: 3 },
        { ruleId: 'npm-cache', category: 'npm-cache', bytes: 5, items: 1 },
      ],
      coreReport,
    );

    expect(updated[0]).toEqual({ ruleId: 'system-temp', category: 'temp', bytes: 16, items: 2 });
    expect(updated[1]).toEqual({ ruleId: 'npm-cache', category: 'npm-cache', bytes: 5, items: 1 });
  });
});
