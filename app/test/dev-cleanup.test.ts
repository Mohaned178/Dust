import type { ProjectRecord } from '@dust/core';
import { describe, expect, it } from 'vitest';
import { groupDevProjects, projectNameOf, toDevProjects } from '../src/main/host/dev-cleanup';

function project(path: string, overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    path,
    name: path.split('\\').pop() ?? path,
    kind: 'project',
    packageManager: 'npm',
    pinned: false,
    workspaceCount: 0,
    nodeModules: { paths: [{ path: `${path}\\node_modules`, bytes: 100 }], bytes: 100 },
    activity: { ms: 100, source: 'files' },
    recency: 'dead',
    restorability: { grade: 'green', reasons: [], restoreCommand: 'npm ci' },
    offered: true,
    evidence: ['npm'],
    ...overrides,
  };
}

describe('projectNameOf', () => {
  it('names orphaned node_modules by their parent folder', () => {
    expect(projectNameOf('C:\\dev\\zombie\\node_modules')).toBe('zombie');
    expect(projectNameOf('C:\\dev\\app')).toBe('app');
  });
});

describe('toDevProjects', () => {
  it('recomputes pinned and offered against the current pin list', () => {
    const records = [
      project('C:\\dev\\a'),
      project('C:\\dev\\b', { pinned: true }),
      project('C:\\dev\\c', { offered: false }),
    ];

    const mapped = toDevProjects(records, ['c:\\dev\\a\\']);

    expect(mapped.map((entry) => [entry.path, entry.pinned, entry.offered])).toEqual([
      ['C:\\dev\\a', true, false],
      ['C:\\dev\\b', true, false],
      ['C:\\dev\\c', false, false],
    ]);
  });
});

describe('groupDevProjects', () => {
  it('groups pinned first-class, orphaned by kind, and unknown recency as occasional', () => {
    const grouped = groupDevProjects(
      toDevProjects(
        [
          project('C:\\dev\\dead', { nodeModules: { paths: [], bytes: 400 } }),
          project('C:\\dev\\active', { recency: 'active', nodeModules: { paths: [], bytes: 300 } }),
          project('C:\\dev\\occasional', { recency: 'occasional', nodeModules: { paths: [], bytes: 200 } }),
          project('C:\\dev\\orphan', { kind: 'orphaned-node-modules', recency: 'unknown', nodeModules: { paths: [], bytes: 100 } }),
          project('C:\\dev\\pinned', { recency: 'dead', pinned: true, nodeModules: { paths: [], bytes: 500 } }),
          project('C:\\dev\\mystery', { recency: 'unknown', activity: { ms: null, source: 'unknown' }, nodeModules: { paths: [], bytes: 50 } }),
        ],
        [],
      ),
    );

    const byId = new Map(grouped.map((group) => [group.id, group.projects.map((entry) => entry.name)]));
    expect(grouped.map((group) => group.id)).toEqual(['dead', 'occasional', 'active', 'orphaned', 'pinned']);
    expect(byId.get('dead')).toEqual(['dead']);
    expect(byId.get('active')).toEqual(['active']);
    expect(byId.get('orphaned')).toEqual(['orphan']);
    expect(byId.get('pinned')).toEqual(['pinned']);
    expect(byId.get('occasional')).toEqual(['occasional', 'mystery']);
  });

  it('sorts each group by node_modules bytes descending', () => {
    const grouped = groupDevProjects(
      toDevProjects(
        [
          project('C:\\dev\\small', { nodeModules: { paths: [], bytes: 10 } }),
          project('C:\\dev\\big', { nodeModules: { paths: [], bytes: 900 } }),
        ],
        [],
      ),
    );

    expect(grouped[0]?.projects.map((entry) => entry.name)).toEqual(['big', 'small']);
  });
});
