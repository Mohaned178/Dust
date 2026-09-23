import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { ScanSession } from '../src/scanner/session';
import { classifyProjects } from '../src/projects/classify';
import { npmProjectModulesRule } from '../src/rules/inventory/npm-project-modules';
import { Cleaner } from '../src/cleaner/cleaner';
import { Fixture } from './fixtures';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const workerPath = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'scan', 'worker-entry.ts');

describe('project classification pipeline (real scan)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  async function scan() {
    return new ScanSession({ root: fixture.root, pool: false }).start();
  }

  it('classifies a real scan into green/yellow/unsupported/monorepo/orphan records', async () => {
    fixture.file('app/package.json', JSON.stringify({ name: 'app' }), NOW - 200 * DAY);
    fixture.file('app/package-lock.json', '{}', NOW - 200 * DAY);
    fixture.file('app/src/index.ts', 'x', NOW - 200 * DAY);
    fixture.file('app/node_modules/dep/index.js', 'yyyy');

    fixture.file('legacy/package.json', '{}', NOW - 10 * DAY);
    fixture.file('legacy/node_modules/dep/index.js', 'zzz');

    fixture.file('pnpm-app/package.json', JSON.stringify({ packageManager: 'pnpm@8.6.0' }));
    fixture.file('pnpm-app/pnpm-lock.yaml', '');
    fixture.file('pnpm-app/node_modules/dep/index.js', 'q');

    fixture.file('mono/package.json', JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }));
    fixture.file('mono/package-lock.json', '{}');
    fixture.file('mono/packages/a/package.json', JSON.stringify({ name: 'a' }));
    fixture.file('mono/node_modules/dep/index.js', 'ww');
    fixture.file('mono/packages/a/node_modules/dep/index.js', 'vv');

    fixture.file('lost/node_modules/dep/index.js', 'uu');

    const result = await scan();
    expect(result.status).toBe('complete');

    const analysis = classifyProjects({
      root: fixture.root,
      tree: result.tree,
      markers: result.markers,
      probe: core.createNodeFsProbe(),
      now: () => NOW,
    });

    const byName = new Map(analysis.projects.map((project) => [project.name, project]));
    expect(byName.get('app')).toMatchObject({
      kind: 'project',
      recency: 'dead',
      offered: true,
      restorability: { grade: 'green', restoreCommand: 'npm ci' },
    });
    expect(byName.get('app')!.nodeModules.bytes).toBe(4);
    expect(byName.get('legacy')).toMatchObject({ recency: 'active', restorability: { grade: 'yellow' } });
    expect(byName.get('pnpm-app')!.restorability.grade).toBe('not-offered');
    expect(byName.get('mono')).toMatchObject({ kind: 'monorepo', workspaceCount: 1, offered: true });
    expect(byName.get('mono')!.nodeModules.paths).toHaveLength(2);
    expect(byName.get('lost')).toMatchObject({ kind: 'orphaned-node-modules' });
  });

  it('drives the cleaner end to end and respects pins and unsupported managers', async () => {
    fixture.file('app/package.json', JSON.stringify({ name: 'app' }));
    fixture.file('app/package-lock.json', '{}');
    fixture.file('app/node_modules/dep/index.js', 'yyyy');
    fixture.file('pnpm-app/package.json', JSON.stringify({ packageManager: 'pnpm@8.6.0' }));
    fixture.file('pnpm-app/pnpm-lock.yaml', '');
    fixture.file('pnpm-app/node_modules/dep/index.js', 'q');

    const result = await scan();
    const rules = [npmProjectModulesRule({ now: () => NOW, pins: [join(fixture.root, 'app')] })];
    const cleaner = new Cleaner({ guard: { userProfile: join(fixture.root, 'profile'), userFolders: [] } });
    const plan = await cleaner.preview(rules, {
      root: fixture.root,
      tree: result.tree,
      markers: result.markers,
      probe: core.createNodeFsProbe(),
    });

    // app is pinned → no match; pnpm-app is not offered → no match.
    expect(plan.items).toEqual([]);
    expect(existsSync(join(fixture.root, 'app', 'node_modules'))).toBe(true);

    const rules2 = [npmProjectModulesRule({ now: () => NOW })];
    const plan2 = await cleaner.preview(rules2, {
      root: fixture.root,
      tree: result.tree,
      markers: result.markers,
      probe: core.createNodeFsProbe(),
    });
    expect(plan2.items.map((item) => item.path)).toEqual([join(fixture.root, 'app', 'node_modules')]);
    expect(plan2.items[0]).toMatchObject({ grade: 'safe', category: 'npm-projects' });

    const report = await cleaner.execute(plan2.id);
    expect(report.deletedBytes).toBe(4);
    expect(existsSync(join(fixture.root, 'app', 'node_modules'))).toBe(false);
    expect(existsSync(join(fixture.root, 'pnpm-app', 'node_modules'))).toBe(true);
  });

  it('keeps old project recency through a real pooled scan with fresh node_modules mtimes', async () => {
    fixture.file('app/package.json', JSON.stringify({ name: 'app' }), NOW - 200 * DAY);
    fixture.file('app/package-lock.json', '{}', NOW - 200 * DAY);
    fixture.file('app/src/index.ts', 'x', NOW - 200 * DAY);
    fixture.file('app/node_modules/dep/index.js', 'yyyy');

    const result = await new ScanSession({
      root: fixture.root,
      pool: { workers: 2, splitAfterEntries: 1, workerPath, execArgv: ['--import', 'tsx'] },
    }).start();
    expect(result.status).toBe('complete');

    const analysis = classifyProjects({
      root: fixture.root,
      tree: result.tree,
      markers: result.markers,
      probe: core.createNodeFsProbe(),
      now: () => NOW,
    });
    const app = analysis.projects.find((project) => project.name === 'app')!;
    expect(app).toMatchObject({ recency: 'dead', offered: true });
    expect(app.activity).toEqual({ ms: NOW - 200 * DAY, source: 'files' });
  }, 30_000);

  it('exposes the project classification surface through the public index', () => {
    expect(typeof core.classifyProjects).toBe('function');
    expect(typeof core.discoverProjects).toBe('function');
    expect(typeof core.readManifest).toBe('function');
    expect(typeof core.npmProjectModulesRule).toBe('function');
    expect(core.DEFAULT_RECENCY_THRESHOLDS).toEqual({ activeDays: 30, occasionalDays: 180 });
  });
});
