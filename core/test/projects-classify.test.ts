import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyProjects, DEFAULT_RECENCY_THRESHOLDS } from '../src/projects/classify';
import { INSTALLED_SOFTWARE_REASON, isInstalledSoftwarePath } from '../src/projects/installed-software';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { FolderRecord, Marker } from '../src/model/types';
import type { ClassifyInput } from '../src/projects/types';
import { Fixture } from './fixtures';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

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

describe('classifyProjects', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function fixtureProject() {
    const app = fixture.dir('app');
    fixture.file('app/package.json', JSON.stringify({ name: 'app' }), NOW - 300 * DAY);
    fixture.file('app/package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} }), NOW - 300 * DAY);
    fixture.dir('app/node_modules');
    const tree = new AggregateTree();
    tree.addFolder(record(app, { newestMtimeMs: NOW - 200 * DAY }));
    tree.addFolder(record(join(app, 'node_modules'), { bytes: 900 }));
    const markers: Marker[] = [
      { kind: 'package-json', path: join(app, 'package.json') },
      { kind: 'node-modules', path: join(app, 'node_modules') },
    ];
    return { app, tree, markers };
  }

  function analyze(overrides: Partial<ClassifyInput> = {}) {
    const base = fixtureProject();
    return {
      app: base.app,
      analysis: classifyProjects({
        root: fixture.root,
        tree: base.tree,
        markers: base.markers,
        probe: createNodeFsProbe(),
        now: () => NOW,
        ...overrides,
      }),
    };
  }

  it('grades a lockfile project green and a 200-day-old project dead', () => {
    const { analysis } = analyze();
    const project = analysis.projects[0]!;
    expect(project).toMatchObject({
      kind: 'project',
      packageManager: 'npm',
      recency: 'dead',
      offered: true,
      restorability: { grade: 'green', reasons: [], restoreCommand: 'npm ci' },
    });
    expect(project.activity).toEqual({ ms: NOW - 200 * DAY, source: 'files' });
    expect(project.nodeModules).toEqual({
      paths: [{ path: join(fixture.root, 'app', 'node_modules'), bytes: 900 }],
      bytes: 900,
    });
  });

  it('grades missing lockfiles and patches yellow with best-effort commands', () => {
    const app = fixture.dir('legacy');
    fixture.file('legacy/package.json', '{}');
    fixture.dir('legacy/node_modules');
    fixture.dir('legacy/patches');
    const tree = new AggregateTree();
    tree.addFolder(record(join(app, 'node_modules'), { bytes: 10 }));
    const analysis = classifyProjects({
      root: fixture.root,
      tree,
      markers: [
        { kind: 'package-json', path: join(app, 'package.json') },
        { kind: 'node-modules', path: join(app, 'node_modules') },
      ],
      probe: createNodeFsProbe(),
      now: () => NOW,
    });
    const project = analysis.projects[0]!;
    expect(project.restorability.grade).toBe('yellow');
    expect(project.restorability.restoreCommand).toBe('npm install');
    expect(project.restorability.reasons).toHaveLength(2);
    expect(project.restorability.reasons[0]).toContain('no lockfile');
    expect(project.restorability.reasons[1]).toContain('patches/');
  });

  it('marks pnpm projects, yarn berry and PnP as not offered', () => {
    const pnpmDir = fixture.dir('pnpm-app');
    fixture.file('pnpm-app/package.json', JSON.stringify({ packageManager: 'pnpm@8.6.0' }));
    fixture.file('pnpm-app/pnpm-lock.yaml', '');
    fixture.dir('pnpm-app/node_modules');
    const berry = fixture.dir('berry');
    fixture.file('berry/package.json', JSON.stringify({ packageManager: 'yarn@3.6.0' }));
    fixture.file('berry/.pnp.cjs', '');

    const analysis = classifyProjects({
      root: fixture.root,
      tree: new AggregateTree(),
      markers: [
        { kind: 'package-json', path: join(pnpmDir, 'package.json') },
        { kind: 'node-modules', path: join(pnpmDir, 'node_modules') },
        { kind: 'package-json', path: join(berry, 'package.json') },
      ],
      probe: createNodeFsProbe(),
      now: () => NOW,
    });

    const pnpm = analysis.projects.find((project) => project.path === pnpmDir)!;
    expect(pnpm.restorability.grade).toBe('not-offered');
    expect(pnpm.restorability.reasons[0]).toContain('pnpm');
    expect(pnpm.offered).toBe(false);

    const berryProject = analysis.projects.find((project) => project.path === berry)!;
    expect(berryProject.restorability.grade).toBe('not-offered');
    expect(berryProject.restorability.reasons.join(' ')).toContain("Plug'n'Play");
  });

  it('flags private registries in the lockfile sample as yellow', () => {
    const app = fixture.dir('private');
    fixture.file('private/package.json', '{}');
    fixture.file(
      'private/package-lock.json',
      JSON.stringify({
        packages: { 'node_modules/secret': { resolved: 'https://npm.internal.example/secret/-/secret-2.0.0.tgz' } },
      }),
    );
    fixture.dir('private/node_modules');
    const analysis = classifyProjects({
      root: fixture.root,
      tree: new AggregateTree(),
      markers: [
        { kind: 'package-json', path: join(app, 'package.json') },
        { kind: 'node-modules', path: join(app, 'node_modules') },
      ],
      probe: createNodeFsProbe(),
      now: () => NOW,
    });
    expect(analysis.projects[0]!.restorability.grade).toBe('yellow');
    expect(analysis.projects[0]!.restorability.reasons[0]).toContain('npm.internal.example');
  });

  it('uses the git reflog mtime when it is the newest signal', () => {
    const app = fixture.dir('gitty');
    fixture.file('gitty/package.json', '{}', NOW - 250 * DAY);
    fixture.file('gitty/package-lock.json', '{}');
    fixture.dir('gitty/node_modules');
    fixture.file('gitty/.git/logs/HEAD', '', NOW - 2 * DAY);
    fixture.file('gitty/src/index.ts', 'x', NOW - 300 * DAY);
    const tree = new AggregateTree();
    tree.addFolder(record(app, { newestMtimeMs: NOW - 300 * DAY }));
    const analysis = classifyProjects({
      root: fixture.root,
      tree,
      markers: [
        { kind: 'package-json', path: join(app, 'package.json') },
        { kind: 'node-modules', path: join(app, 'node_modules') },
      ],
      probe: createNodeFsProbe(),
      now: () => NOW,
    });
    expect(analysis.projects[0]!.activity.source).toBe('git-reflog');
    expect(analysis.projects[0]!.recency).toBe('active');
  });

  it('honors pins', () => {
    const base = fixtureProject();
    const analysis = classifyProjects({
      root: fixture.root,
      tree: base.tree,
      markers: base.markers,
      probe: createNodeFsProbe(),
      now: () => NOW,
      pins: [base.app],
    });
    expect(analysis.projects[0]).toMatchObject({ pinned: true, offered: false });
    expect(analysis.projects[0]!.evidence.join(' ')).toContain('pinned');
  });

  it('marks external-drive projects not offered', () => {
    const base = fixtureProject();
    const analysis = classifyProjects({
      root: fixture.root,
      tree: base.tree,
      markers: base.markers,
      probe: createNodeFsProbe(),
      now: () => NOW,
      isExternal: (path) => path === base.app,
    });
    const project = analysis.projects.find((candidate) => candidate.path === base.app)!;
    expect(project).toMatchObject({ offered: false });
    expect(project.evidence.join(' ')).toContain('external drive');
  });

  it('classifies orphaned node_modules as review with a no-manifest reason', () => {
    const orphan = fixture.dir('lost/node_modules');
    const tree = new AggregateTree();
    tree.addFolder(record(orphan, { bytes: 77 }));
    const analysis = classifyProjects({
      root: fixture.root,
      tree,
      markers: [{ kind: 'node-modules', path: orphan }],
      probe: createNodeFsProbe(),
      now: () => NOW,
    });
    expect(analysis.projects[0]).toMatchObject({
      kind: 'orphaned-node-modules',
      recency: 'unknown',
      offered: true,
      restorability: { grade: 'yellow', restoreCommand: null },
    });
    expect(analysis.projects[0]!.restorability.reasons[0]).toContain('no manifest');
  });

  it('exposes the pinned threshold constants frozen', () => {
    expect(DEFAULT_RECENCY_THRESHOLDS).toEqual({ activeDays: 30, occasionalDays: 180 });
    expect(Object.isFrozen(DEFAULT_RECENCY_THRESHOLDS)).toBe(true);
  });

  it('grades a yarn.lock-only project with a private registry yellow', () => {
    const app = fixture.dir('yarn-private');
    fixture.file('yarn-private/package.json', '{}');
    fixture.file(
      'yarn-private/yarn.lock',
      'resolved "https://npm.internal.example/foo/-/foo-1.0.0.tgz#hash"\nresolved "https://registry.yarnpkg.com/bar/-/bar-1.0.0.tgz#hash"\n',
    );
    fixture.dir('yarn-private/node_modules');
    const analysis = classifyProjects({
      root: fixture.root,
      tree: new AggregateTree(),
      markers: [
        { kind: 'package-json', path: join(app, 'package.json') },
        { kind: 'node-modules', path: join(app, 'node_modules') },
      ],
      probe: createNodeFsProbe(),
      now: () => NOW,
    });
    const project = analysis.projects[0]!;
    expect(project.packageManager).toBe('yarn');
    expect(project.restorability.grade).toBe('yellow');
    expect(project.restorability.reasons[0]).toContain('npm.internal.example');
  });

  it('does not offer orphans under a global install root', () => {
    const npmRoot = fixture.dir('appdata/npm');
    const orphan = fixture.dir('appdata/npm/node_modules');
    const control = fixture.dir('elsewhere/node_modules');
    const tree = new AggregateTree();
    tree.addFolder(record(orphan, { bytes: 42 }));
    tree.addFolder(record(control, { bytes: 7 }));
    const analysis = classifyProjects({
      root: fixture.root,
      tree,
      markers: [
        { kind: 'node-modules', path: orphan },
        { kind: 'node-modules', path: control },
      ],
      probe: createNodeFsProbe(),
      now: () => NOW,
      globalInstallRoots: [npmRoot],
    });

    const global = analysis.projects.find((project) => project.path === orphan)!;
    expect(global).toMatchObject({ kind: 'orphaned-node-modules', offered: false });
    expect(global.restorability.reasons.join(' ')).toContain('global');
    expect(global.evidence.join(' ')).toContain('global');

    const other = analysis.projects.find((project) => project.path === control)!;
    expect(other.offered).toBe(true);
    expect(other.evidence.join(' ')).not.toContain('global');
  });

  it('does not offer units whose manifest lives under a global install root', () => {
    const npmRoot = fixture.dir('appdata/npm');
    const tool = fixture.dir('appdata/npm/some-tool');
    fixture.file('appdata/npm/some-tool/package.json', JSON.stringify({ name: 'some-tool' }));
    fixture.dir('appdata/npm/some-tool/node_modules');
    const analysis = classifyProjects({
      root: fixture.root,
      tree: new AggregateTree(),
      markers: [
        { kind: 'package-json', path: join(tool, 'package.json') },
        { kind: 'node-modules', path: join(tool, 'node_modules') },
      ],
      probe: createNodeFsProbe(),
      now: () => NOW,
      globalInstallRoots: [npmRoot],
    });
    const project = analysis.projects[0]!;
    expect(project).toMatchObject({ kind: 'project', offered: false });
    expect(project.evidence.join(' ')).toContain('global');
  });

  it("does not offer an installed app's own node_modules, even with a lockfile", () => {
    const bundle = fixture.dir('Some App/resources/app');
    fixture.file('Some App/resources/app/package.json', JSON.stringify({ name: 'some-app' }), NOW - 300 * DAY);
    fixture.file('Some App/resources/app/package-lock.json', JSON.stringify({ lockfileVersion: 3 }), NOW - 300 * DAY);
    fixture.dir('Some App/resources/app/node_modules');
    const orphan = fixture.dir('Some App/resources/app.asar.unpacked/node_modules');
    const tree = new AggregateTree();
    tree.addFolder(record(join(bundle, 'node_modules'), { bytes: 500 }));
    tree.addFolder(record(orphan, { bytes: 50 }));
    const analysis = classifyProjects({
      root: fixture.root,
      tree,
      markers: [
        { kind: 'package-json', path: join(bundle, 'package.json') },
        { kind: 'node-modules', path: join(bundle, 'node_modules') },
        { kind: 'node-modules', path: orphan },
      ],
      probe: createNodeFsProbe(),
      now: () => NOW,
    });

    const unit = analysis.projects.find((project) => project.path === bundle)!;
    expect(unit).toMatchObject({
      offered: false,
      restorability: { grade: 'not-offered', reasons: [INSTALLED_SOFTWARE_REASON], restoreCommand: null },
    });
    const loose = analysis.projects.find((project) => project.path === orphan)!;
    expect(loose.offered).toBe(false);
    expect(loose.restorability.reasons[0]).toBe(INSTALLED_SOFTWARE_REASON);
  });
});

describe('isInstalledSoftwarePath', () => {
  it.each([
    'C:\\Program Files\\Docker\\Docker\\resources\\node_modules',
    'D:\\Program Files (x86)\\Tool\\node_modules',
    'C:\\ProgramData\\chocolatey\\lib\\x\\node_modules',
    'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\resources\\app\\node_modules',
    'C:\\Users\\me\\AppData\\Local\\Discord\\app-1.0.9\\modules\\discord_voice-1\\node_modules',
    'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules',
    'C:\\Users\\me\\.vscode\\extensions\\ms-python.python-1.0\\node_modules',
    'C:\\Users\\me\\.cursor\\extensions\\x\\node_modules',
    'E:\\Games\\Launcher\\resources\\app.asar.unpacked\\node_modules',
    'C:\\Users\\me\\scoop\\apps\\nodejs\\current\\node_modules',
  ])('treats %s as part of an installed app', (path) => {
    expect(isInstalledSoftwarePath(path)).toBe(true);
  });

  it.each([
    'C:\\Users\\me\\code\\site\\node_modules',
    'D:\\dev\\windows-tools\\node_modules',
    'D:\\work\\programs\\api\\node_modules',
    'C:\\Users\\me\\AppData\\Local\\Temp\\clone\\node_modules',
    'C:\\Users\\me\\code\\electron-app\\resources\\icons\\node_modules',
    'D:\\projects\\Windows\\app\\node_modules',
  ])('offers %s as an ordinary project', (path) => {
    expect(isInstalledSoftwarePath(path)).toBe(false);
  });
});
