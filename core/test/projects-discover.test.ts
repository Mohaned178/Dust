import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverProjects } from '../src/projects/discover';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { FolderRecord, Marker } from '../src/model/types';
import { Fixture } from './fixtures';

function record(path: string, bytes: number): FolderRecord {
  return {
    path,
    bytes,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
  };
}

describe('discoverProjects', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('creates a unit per manifest and attributes the nearest node_modules', () => {
    const app = fixture.dir('app');
    fixture.file('app/package.json', JSON.stringify({ name: 'app' }));
    fixture.dir('app/node_modules/dep');
    const other = fixture.dir('other');
    fixture.file('other/package.json', '{}');
    fixture.dir('other/node_modules');
    fixture.dir('outside/node_modules');

    const tree = new AggregateTree();
    tree.addFolder(record(join(app, 'node_modules'), 111));
    tree.addFolder(record(join(other, 'node_modules'), 222));
    tree.addFolder(record(join(fixture.root, 'outside', 'node_modules'), 333));

    const markers: Marker[] = [
      { kind: 'package-json', path: join(app, 'package.json') },
      { kind: 'package-json', path: join(other, 'package.json') },
      { kind: 'node-modules', path: join(app, 'node_modules') },
      { kind: 'node-modules', path: join(other, 'node_modules') },
      { kind: 'node-modules', path: join(fixture.root, 'outside', 'node_modules') },
    ];

    const { units, orphans } = discoverProjects({ tree, markers, probe: createNodeFsProbe() });
    const appUnit = units.find((unit) => unit.root === app)!;
    expect(appUnit.name).toBe('app');
    expect(appUnit.monorepo).toBe(false);
    expect(appUnit.nodeModules).toEqual([{ path: join(app, 'node_modules'), bytes: 111 }]);
    expect(units.find((unit) => unit.root === other)!.nodeModules).toEqual([
      { path: join(other, 'node_modules'), bytes: 222 },
    ]);
    expect(orphans).toEqual([{ path: join(fixture.root, 'outside', 'node_modules'), bytes: 333 }]);
  });

  it('merges workspace members into one monorepo unit with a member count', () => {
    const mono = fixture.dir('mono');
    fixture.file('mono/package.json', JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }));
    fixture.file('mono/packages/a/package.json', JSON.stringify({ name: 'a' }));
    fixture.file('mono/packages/b/package.json', JSON.stringify({ name: 'b' }));
    fixture.dir('mono/node_modules');
    fixture.dir('mono/packages/a/node_modules');

    const tree = new AggregateTree();
    tree.addFolder(record(join(mono, 'node_modules'), 500));
    tree.addFolder(record(join(mono, 'packages', 'a', 'node_modules'), 50));

    const markers: Marker[] = [
      { kind: 'package-json', path: join(mono, 'package.json') },
      { kind: 'package-json', path: join(mono, 'packages', 'a', 'package.json') },
      { kind: 'package-json', path: join(mono, 'packages', 'b', 'package.json') },
      { kind: 'node-modules', path: join(mono, 'node_modules') },
      { kind: 'node-modules', path: join(mono, 'packages', 'a', 'node_modules') },
    ];

    const { units, orphans } = discoverProjects({ tree, markers, probe: createNodeFsProbe() });
    expect(units).toHaveLength(1);
    const unit = units[0]!;
    expect(unit).toMatchObject({ root: mono, name: 'mono', monorepo: true, workspaceCount: 2 });
    expect(unit.nodeModules.map((entry) => entry.path).sort()).toEqual(
      [join(mono, 'node_modules'), join(mono, 'packages', 'a', 'node_modules')].sort(),
    );
    expect(orphans).toEqual([]);
  });

  it('detects pnpm workspace signals, patches and lockfiles', () => {
    const app = fixture.dir('app');
    fixture.file('app/package.json', '{}');
    fixture.file('app/pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    fixture.dir('app/patches');
    fixture.file('app/pnpm-lock.yaml', '');

    const { units } = discoverProjects({ tree: new AggregateTree(), markers: [{ kind: 'package-json', path: join(app, 'package.json') }], probe: createNodeFsProbe() });
    expect(units[0]).toMatchObject({ monorepo: true, pnp: false, patches: true, lockfiles: ['pnpm-lock.yaml'] });
  });

  it('ignores git markers and returns empty results for marker-less input', () => {
    expect(discoverProjects({ tree: new AggregateTree(), markers: [{ kind: 'git-dir', path: join(fixture.root, 'x', '.git') }], probe: createNodeFsProbe() })).toEqual({
      units: [],
      orphans: [],
    });
  });
});
