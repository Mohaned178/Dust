import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npmProjectModulesRule } from '../src/rules/inventory/npm-project-modules';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import type { FolderRecord, Marker } from '../src/model/types';
import type { ProjectRecord } from '../src/projects/types';
import { Fixture } from './fixtures';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function record(path: string, overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    path,
    bytes: 0,
    allocatedBytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    ...overrides,
  };
}

describe('npmProjectModulesRule', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function setup(): { ctx: RuleContext; green: string; yellow: string } {
    const green = fixture.dir('green-app');
    fixture.file('green-app/package.json', JSON.stringify({ name: 'green-app' }), NOW - 200 * DAY);
    fixture.file('green-app/package-lock.json', '{}');
    const yellow = fixture.dir('yellow-app');
    fixture.file('yellow-app/package.json', '{}');
    const unsupported = fixture.dir('pnpm-app');
    fixture.file('pnpm-app/package.json', JSON.stringify({ packageManager: 'pnpm@8.0.0' }));
    fixture.file('pnpm-app/pnpm-lock.yaml', '');
    const pinned = fixture.dir('pinned-app');
    fixture.file('pinned-app/package.json', '{}');
    fixture.file('pinned-app/package-lock.json', '{}');
    const orphan = fixture.dir('lost/node_modules');

    const tree = new AggregateTree();
    tree.addFolder(record(green, { newestMtimeMs: NOW - 200 * DAY }));
    tree.addFolder(record(join(green, 'node_modules'), { bytes: 100 }));
    tree.addFolder(record(join(yellow, 'node_modules'), { bytes: 200 }));
    tree.addFolder(record(join(unsupported, 'node_modules'), { bytes: 300 }));
    tree.addFolder(record(join(pinned, 'node_modules'), { bytes: 400 }));
    tree.addFolder(record(orphan, { bytes: 500 }));

    const markers: Marker[] = [
      { kind: 'package-json', path: join(green, 'package.json') },
      { kind: 'package-json', path: join(yellow, 'package.json') },
      { kind: 'package-json', path: join(unsupported, 'package.json') },
      { kind: 'package-json', path: join(pinned, 'package.json') },
      { kind: 'node-modules', path: join(green, 'node_modules') },
      { kind: 'node-modules', path: join(yellow, 'node_modules') },
      { kind: 'node-modules', path: join(unsupported, 'node_modules') },
      { kind: 'node-modules', path: join(pinned, 'node_modules') },
      { kind: 'node-modules', path: orphan },
    ];

    const ctx: RuleContext = {
      root: fixture.root,
      tree,
      markers,
      probe: createNodeFsProbe(),
    };
    return { ctx, green, yellow };
  }

  it('matches offered projects only, with grades and restore commands', async () => {
    const { ctx, green, yellow } = setup();
    const rule = npmProjectModulesRule({ now: () => NOW, pins: [join(fixture.root, 'pinned-app')] });
    const matches = await rule.match(ctx);
    const byPath = new Map(matches.map((match) => [match.path, match]));

    expect(byPath.get(join(green, 'node_modules'))).toMatchObject({
      bytes: 100,
      grade: 'safe',
      recovery: { kind: 'regenerate', command: 'npm ci' },
    });
    expect(byPath.get(join(yellow, 'node_modules'))).toMatchObject({
      bytes: 200,
      grade: 'review',
      recovery: { kind: 'regenerate', command: 'npm install' },
    });
    expect(byPath.has(join(fixture.root, 'pnpm-app', 'node_modules'))).toBe(false);
    expect(byPath.has(join(fixture.root, 'pinned-app', 'node_modules'))).toBe(false);
    expect(byPath.get(join(fixture.root, 'lost', 'node_modules'))).toMatchObject({
      bytes: 500,
      grade: 'review',
      recovery: { kind: 'junk' },
    });
    expect(matches).toHaveLength(3);
  });

  it('carries actionable evidence on each match', async () => {
    const { ctx, green } = setup();
    const rule = npmProjectModulesRule({ now: () => NOW });
    const matches = await rule.match(ctx);
    const greenMatch = matches.find((match) => match.path === join(green, 'node_modules'))!;
    expect(greenMatch.evidence).toContain('Dead');
    expect(greenMatch.evidence).toContain('npm ci');
    expect(greenMatch.evidence).toContain('200d');
  });

  it('uses precomputed project records without reclassifying', async () => {
    const rule = npmProjectModulesRule();
    const projects: ProjectRecord[] = [
      {
        path: 'C:\\proj',
        name: 'proj',
        kind: 'project',
        packageManager: 'npm',
        pinned: false,
        workspaceCount: 0,
        nodeModules: { paths: [{ path: 'C:\\proj\\node_modules', bytes: 10 }], bytes: 10 },
        activity: { ms: null, source: 'unknown' },
        recency: 'dead',
        restorability: { grade: 'green', reasons: [], restoreCommand: 'npm ci' },
        offered: true,
        evidence: [],
      },
    ];
    const ctx: RuleContext = {
      root: 'C:\\',
      tree: new AggregateTree(),
      markers: [],
      probe: createNodeFsProbe(),
      projects,
    };

    const matches = await rule.match(ctx);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe('C:\\proj\\node_modules');
    expect(matches[0]?.grade).toBe('safe');
  });
});
