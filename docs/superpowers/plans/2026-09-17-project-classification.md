# Project Discovery & Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the scanner's `package-json` / `node-modules` markers into classified npm projects — monorepo-aware units, restorability grades, recency groups, orphaned installs, pins — and ship the `npm-project-modules` cleanup rule that matches only offered projects' `node_modules` with the correct grade and restore command.

**Architecture:** A pure `core/src/projects/` module set over scan output: `manifest.ts` (lazy manifest/lockfile/registry reading through the extended `FsProbe.readFile`), `discover.ts` (markers → project units + orphaned installs, nearest-root node_modules attribution, monorepo merging), `classify.ts` (`classifyProjects`: restorability, activity/recency, pins/external, evidence). The `npm-project-modules` rule is a thin adapter that calls `classifyProjects` inside `match(ctx)` — so the Dev Cleanup UI (Plan 9) and the cleaner consume the identical analysis. No filesystem deletion lives here; Plan 3's Cleaner stays the only mutator.

**Tech Stack:** TypeScript (strict, ESM), Node >= 20 (`node:fs` via probe, `node:path`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-dust-mvp-design.md` (Sections 6.1–6.4 data side, 5.1–5.3 rule/recovery side, 10)

## Global Constraints

- **Base branch:** `plan-4-rule-inventory` at `140fe34` (Plan 4, stacked PR open at the time of writing). If Plans 2-4 have merged to `master` by execution time, branch from `master` instead — whichever tree contains Plans 1-4. Never branch this plan from a tree without the rule inventory.
- Platform: Windows first; commands run in PowerShell 7. Node >= 20. TypeScript strict. ESM everywhere. `core/` has zero Electron imports and runs under vitest in plain Node.
- Discovery is marker-driven only: `package.json` outside node_modules is a candidate root (the scanner already suppresses manifests inside node_modules and nested node_modules markers); classification never walks the filesystem itself beyond `probe` reads.
- Restorability grades (spec §6.2): green = `package-lock.json` or `yarn.lock` present, no `patches/`, lockfile registry hosts public (best-effort 64 KB sample); yellow = missing lockfile, `patches/` present, or private registry host detected; not offered = pnpm/bun/yarn 2+ (`packageManager` field or lockfile), or Yarn PnP (`.pnp.cjs`/`.pnp.js`) — labeled, never matched by the rule.
- Recency (spec §6.3): `lastActivity = max(newest source-file mtime from the scan tree excluding node_modules/.git, .git/logs/HEAD mtime, manifest mtime)` with the winning source recorded; groups Active ≤ 30 d, Occasional 31–180 d, Dead > 180 d (single config constant `DEFAULT_RECENCY_THRESHOLDS`); no activity data → `unknown` (never bulk-selected).
- Pins (`pins: string[]`, case-insensitive canonical paths) always win: pinned projects are never offered. `isExternal(path)` marks removable/network-drive projects not offered in MVP.
- The `npm-project-modules` rule matches ONLY `offered` projects with `node_modules` paths; green → `safe` with the exact restore command, yellow → `review` with the best-effort command, orphaned → `review` with a junk recovery statement. Unsupported/pinned/external never produce matches.
- Commit after every task. Before each commit run: `npm run test -w core` and `npm run typecheck -w core`.

---

## File Structure

- `core/src/rules/types.ts` — MODIFY: `FsProbe` gains `readFile(path): string | null` (additive, like Plan 4's `listDirectory`).
- `core/src/rules/probe.ts` — MODIFY: implement `readFile` (`readFileSync(path, 'utf8')`, null on error).
- `core/src/projects/types.ts` — NEW: record/analysis/options types.
- `core/src/projects/manifest.ts` — NEW: `readManifest`, `hasWorkspaceSignals`, `detectLockfiles`, `hasPnp`, `parsePackageManager`, `sampleRegistryHosts`, `PUBLIC_REGISTRY_HOSTS`.
- `core/src/projects/discover.ts` — NEW: `discoverProjects` (units + orphans).
- `core/src/projects/classify.ts` — NEW: `classifyProjects`, `DEFAULT_RECENCY_THRESHOLDS`.
- `core/src/rules/inventory/npm-project-modules.ts` — NEW: `npmProjectModulesRule`.
- `core/src/rules/inventory/index.ts` — MODIFY: append the projects rule to `createInventoryRules`.
- `core/src/index.ts` — MODIFY: append exports (Task 5).
- Tests: `projects-manifest.test.ts`, `projects-discover.test.ts`, `projects-classify.test.ts`, `rule-npm-projects.test.ts`, `projects-pipeline.test.ts`; `smoke.test.ts` extended in Task 5.

---

### Task 1: Manifest & lockfile reading helpers

**Files:**
- Modify: `core/src/rules/types.ts`
- Modify: `core/src/rules/probe.ts`
- Create: `core/src/projects/types.ts`
- Create: `core/src/projects/manifest.ts`
- Test: `core/test/projects-manifest.test.ts`

**Interfaces:**
- Consumes: `FsProbe` from `core/src/rules/types.ts`; `Fixture` from tests.
- Produces: `FsProbe.readFile(path: string): string | null`; `ManifestInfo { name: string | null; workspaces: boolean; packageManagerField: string | null; valid: boolean }`; `readManifest(dir, probe): ManifestInfo | null`; `hasWorkspaceSignals(dir, probe, manifest): boolean`; `LOCKFILE_NAMES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'] as const`; `LockfileName`; `detectLockfiles(dir, probe): LockfileName[]`; `hasPnp(dir, probe): boolean`; `parsePackageManager(field): { name: string; major: number | null } | null`; `PUBLIC_REGISTRY_HOSTS: ReadonlySet<string>`; `sampleRegistryHosts(content: string): string[]`; project record types in `projects/types.ts` (defined now, consumed by Tasks 2-5).

- [ ] **Step 1: Write the failing tests**

`core/test/projects-manifest.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeFsProbe } from '../src/rules/probe';
import {
  PUBLIC_REGISTRY_HOSTS,
  detectLockfiles,
  hasPnp,
  hasWorkspaceSignals,
  parsePackageManager,
  readManifest,
  sampleRegistryHosts,
} from '../src/projects/manifest';
import { Fixture } from './fixtures';

describe('readManifest', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('returns null when package.json is absent', () => {
    const dir = fixture.dir('empty');
    expect(readManifest(dir, createNodeFsProbe())).toBeNull();
  });

  it('parses name, workspaces array and the packageManager field', () => {
    const dir = fixture.dir('app');
    fixture.file('app/package.json', JSON.stringify({ name: 'my-app', workspaces: ['packages/*'], packageManager: 'pnpm@8.6.0' }));
    expect(readManifest(dir, createNodeFsProbe())).toEqual({
      name: 'my-app',
      workspaces: true,
      packageManagerField: 'pnpm@8.6.0',
      valid: true,
    });
  });

  it('accepts the workspaces object form and reports invalid JSON as parsed-but-invalid', () => {
    const dir = fixture.dir('app');
    fixture.file('app/package.json', JSON.stringify({ workspaces: { packages: ['apps/*'] } }));
    expect(readManifest(dir, createNodeFsProbe())).toMatchObject({ workspaces: true, valid: true });

    fixture.file('app/package.json', '{ not json');
    expect(readManifest(dir, createNodeFsProbe())).toMatchObject({ workspaces: false, valid: false, name: null });
  });
});

describe('hasWorkspaceSignals', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('is true for manifest workspaces and for each signal file', () => {
    const dir = fixture.dir('plain');
    fixture.file('plain/package.json', '{}');
    const probe = createNodeFsProbe();
    const plain = readManifest(dir, probe)!;
    expect(hasWorkspaceSignals(dir, probe, plain)).toBe(false);

    for (const signal of ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'nx.json']) {
      const target = fixture.dir(`mono-${signal}`);
      fixture.file(`mono-${signal}/package.json`, '{}');
      fixture.file(`mono-${signal}/${signal}`, '{}');
      const manifest = readManifest(target, probe)!;
      expect(hasWorkspaceSignals(target, probe, manifest)).toBe(true);
    }
  });
});

describe('detectLockfiles and hasPnp', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('lists present lockfiles in stable order', () => {
    const dir = fixture.dir('app');
    fixture.file('app/pnpm-lock.yaml', '');
    fixture.file('app/package-lock.json', '{}');
    expect(detectLockfiles(dir, createNodeFsProbe())).toEqual(['package-lock.json', 'pnpm-lock.yaml']);
    expect(detectLockfiles(fixture.dir('bare'), createNodeFsProbe())).toEqual([]);
  });

  it('detects Plug n Play files', () => {
    const dir = fixture.dir('berry');
    expect(hasPnp(dir, createNodeFsProbe())).toBe(false);
    fixture.file('berry/.pnp.cjs', '');
    expect(hasPnp(dir, createNodeFsProbe())).toBe(true);
  });
});

describe('parsePackageManager', () => {
  it('parses name and major and rejects malformed fields', () => {
    expect(parsePackageManager('yarn@3.2.1')).toEqual({ name: 'yarn', major: 3 });
    expect(parsePackageManager('npm@10.2.0')).toEqual({ name: 'npm', major: 10 });
    expect(parsePackageManager('pnpm')).toEqual({ name: 'pnpm', major: null });
    expect(parsePackageManager('')).toBeNull();
  });
});

describe('sampleRegistryHosts', () => {
  it('extracts resolved hosts and treats npmjs and yarnpkg as public', () => {
    const content = [
      '"resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz"',
      '"resolved": "https://registry.yarnpkg.com/right-pad/-/right-pad-1.0.0.tgz"',
      '"resolved": "https://npm.internal.example/secret/-/secret-2.0.0.tgz"',
      '"resolved": "https://npm.internal.example/other/-/other-1.0.0.tgz"',
    ].join('\n');
    expect(sampleRegistryHosts(content)).toEqual(['registry.npmjs.org', 'registry.yarnpkg.com', 'npm.internal.example']);
    expect(PUBLIC_REGISTRY_HOSTS.has('npm.internal.example')).toBe(false);
    expect(sampleRegistryHosts('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/projects/manifest`.

- [ ] **Step 3: Extend the probe with `readFile`**

In `core/src/rules/types.ts`, extend `FsProbe`:

```ts
export interface FsProbe {
  exists(path: string): boolean;
  stat(path: string): Stats | null;
  listDirectory(path: string): Dirent[];
  readFile(path: string): string | null;
}
```

In `core/src/rules/probe.ts`, add to the returned object (and import `readFileSync`):

```ts
    readFile(path: string) {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
```

- [ ] **Step 4: Implement the project types and manifest helpers**

`core/src/projects/types.ts`:

```ts
import type { AggregateTree } from '../model/tree';
import type { Marker } from '../model/types';
import type { FsProbe } from '../rules/types';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';

export type ProjectKind = 'project' | 'monorepo' | 'orphaned-node-modules';

export type RecencyGroup = 'active' | 'occasional' | 'dead' | 'unknown';

export type RestorabilityGrade = 'green' | 'yellow' | 'not-offered';

export type ActivitySource = 'files' | 'git-reflog' | 'manifest' | 'unknown';

export interface NodeModulesLocation {
  path: string;
  bytes: number;
}

export interface Restorability {
  grade: RestorabilityGrade;
  reasons: string[];
  restoreCommand: string | null;
}

export interface ProjectActivity {
  ms: number | null;
  source: ActivitySource;
}

export interface ProjectRecord {
  path: string;
  name: string;
  kind: ProjectKind;
  packageManager: PackageManager;
  pinned: boolean;
  workspaceCount: number;
  nodeModules: { paths: NodeModulesLocation[]; bytes: number };
  activity: ProjectActivity;
  recency: RecencyGroup;
  restorability: Restorability;
  offered: boolean;
  evidence: string[];
}

export interface ProjectAnalysis {
  projects: ProjectRecord[];
}

export interface RecencyThresholds {
  activeDays: number;
  occasionalDays: number;
}

export interface ProjectOptions {
  now?: () => number;
  thresholds?: Partial<RecencyThresholds>;
  pins?: string[];
  isExternal?: (path: string) => boolean;
}

export interface ClassifyInput extends ProjectOptions {
  root: string;
  tree: AggregateTree;
  markers: Marker[];
  probe: FsProbe;
}
```

`core/src/projects/manifest.ts`:

```ts
import { join } from 'node:path';
import type { FsProbe } from '../rules/types';

export interface ManifestInfo {
  name: string | null;
  workspaces: boolean;
  packageManagerField: string | null;
  valid: boolean;
}

export const LOCKFILE_NAMES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'] as const;
export type LockfileName = (typeof LOCKFILE_NAMES)[number];

export const PUBLIC_REGISTRY_HOSTS: ReadonlySet<string> = new Set([
  'registry.npmjs.org',
  'registry.yarnpkg.com',
]);

export function readManifest(dir: string, probe: FsProbe): ManifestInfo | null {
  const raw = probe.readFile(join(dir, 'package.json'));
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { name: null, workspaces: false, packageManagerField: null, valid: false };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { name: null, workspaces: false, packageManagerField: null, valid: false };
  }

  const object = parsed as Record<string, unknown>;
  const name = typeof object.name === 'string' && object.name.trim() !== '' ? object.name : null;
  const packageManagerField = typeof object.packageManager === 'string' && object.packageManager.trim() !== ''
    ? object.packageManager
    : null;

  return { name, workspaces: detectWorkspaces(object), packageManagerField, valid: true };
}

export function hasWorkspaceSignals(dir: string, probe: FsProbe, manifest: ManifestInfo): boolean {
  if (manifest.workspaces) return true;
  return ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'nx.json'].some((signal) =>
    probe.exists(join(dir, signal)),
  );
}

export function detectLockfiles(dir: string, probe: FsProbe): LockfileName[] {
  return LOCKFILE_NAMES.filter((name) => probe.exists(join(dir, name)));
}

export function hasPnp(dir: string, probe: FsProbe): boolean {
  return probe.exists(join(dir, '.pnp.cjs')) || probe.exists(join(dir, '.pnp.js'));
}

export function parsePackageManager(field: string): { name: string; major: number | null } | null {
  if (field.trim() === '') return null;
  const at = field.lastIndexOf('@');
  const name = at > 0 ? field.slice(0, at) : field;
  const version = at > 0 ? field.slice(at + 1) : '';
  if (name.trim() === '') return null;
  const majorMatch = /^(\d+)/.exec(version);
  return { name, major: majorMatch ? Number(majorMatch[1]) : null };
}

export function sampleRegistryHosts(content: string): string[] {
  const sample = content.slice(0, 64 * 1024);
  const hosts = new Set<string>();
  const pattern = /"resolved"\s*:\s*"https?:\/\/([^/"\\]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sample)) !== null) {
    hosts.add(match[1]!);
  }
  return [...hosts];
}

function detectWorkspaces(object: Record<string, unknown>): boolean {
  const workspaces = object.workspaces;
  if (Array.isArray(workspaces)) return workspaces.length > 0;
  if (typeof workspaces === 'object' && workspaces !== null) {
    const packages = (workspaces as { packages?: unknown }).packages;
    return Array.isArray(packages) && packages.length > 0;
  }
  return false;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/rules/types.ts core/src/rules/probe.ts core/src/projects core/test/projects-manifest.test.ts
git commit -m "feat(core): add manifest and lockfile reading helpers"
```

---

### Task 2: Project discovery — units, monorepos, orphans

**Files:**
- Create: `core/src/projects/discover.ts`
- Test: `core/test/projects-discover.test.ts`

**Interfaces:**
- Consumes: `Marker` from `core/src/model/types.ts`; `AggregateTree` from `core/src/model/tree.ts`; `canonicalizePath` from `core/src/cleaner/guard.ts`; manifest helpers + `ManifestInfo` from Task 1.
- Produces: `DiscoveredUnit { root: string; name: string; manifest: ManifestInfo; monorepo: boolean; workspaceCount: number; nodeModules: NodeModulesLocation[]; lockfiles: LockfileName[]; pnp: boolean; patches: boolean }`; `DiscoveredOrphan { path: string; bytes: number }`; `discoverProjects(input: { tree: AggregateTree; markers: Marker[]; probe: FsProbe }): { units: DiscoveredUnit[]; orphans: DiscoveredOrphan[] }`.

- [ ] **Step 1: Write the failing tests**

`core/test/projects-discover.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/projects/discover`.

- [ ] **Step 3: Implement discovery**

`core/src/projects/discover.ts`:

```ts
import { basename, dirname, join, sep } from 'node:path';
import { canonicalizePath } from '../cleaner/guard';
import type { AggregateTree } from '../model/tree';
import type { Marker } from '../model/types';
import type { FsProbe } from '../rules/types';
import type { NodeModulesLocation } from './types';
import { detectLockfiles, hasPnp, readManifest } from './manifest';
import type { LockfileName, ManifestInfo } from './manifest';

export interface DiscoveredUnit {
  root: string;
  name: string;
  manifest: ManifestInfo;
  monorepo: boolean;
  workspaceCount: number;
  nodeModules: NodeModulesLocation[];
  lockfiles: LockfileName[];
  pnp: boolean;
  patches: boolean;
}

export interface DiscoveredOrphan {
  path: string;
  bytes: number;
}

export interface DiscoverInput {
  tree: AggregateTree;
  markers: Marker[];
  probe: FsProbe;
}

export function discoverProjects(input: DiscoverInput): { units: DiscoveredUnit[]; orphans: DiscoveredOrphan[] } {
  const manifestMarkers = input.markers
    .filter((marker) => marker.kind === 'package-json')
    .sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  const nodeModulesMarkers = input.markers.filter((marker) => marker.kind === 'node-modules');

  const units: DiscoveredUnit[] = [];
  for (const marker of manifestMarkers) {
    const dir = dirname(marker.path);
    if (units.some((unit) => unit.monorepo && isUnder(dir, unit.root))) {
      const parent = nearestUnit(units, dir)!;
      parent.workspaceCount += 1;
      continue;
    }
    const manifest = readManifest(dir, input.probe) ?? {
      name: null,
      workspaces: false,
      packageManagerField: null,
      valid: false,
    };
    const hasSignals =
      manifest.workspaces ||
      ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'nx.json'].some((signal) =>
        input.probe.exists(join(dir, signal)),
      );
    units.push({
      root: dir,
      name: manifest.name ?? basename(dir),
      manifest,
      monorepo: hasSignals,
      workspaceCount: 0,
      nodeModules: [],
      lockfiles: detectLockfiles(dir, input.probe),
      pnp: hasPnp(dir, input.probe),
      patches: input.probe.exists(join(dir, 'patches')),
    });
  }

  const orphans: DiscoveredOrphan[] = [];
  for (const marker of nodeModulesMarkers) {
    const owner = nearestUnit(units, dirname(marker.path));
    const bytes = input.tree.get(marker.path)?.bytes ?? 0;
    if (owner) {
      owner.nodeModules.push({ path: marker.path, bytes });
    } else {
      orphans.push({ path: marker.path, bytes });
    }
  }

  return { units, orphans };
}

function nearestUnit(units: DiscoveredUnit[], targetDir: string): DiscoveredUnit | null {
  let best: DiscoveredUnit | null = null;
  for (const unit of units) {
    if (!isUnder(targetDir, unit.root) && canonicalizePath(targetDir) !== canonicalizePath(unit.root)) continue;
    if (!best || unit.root.length > best.root.length) best = unit;
  }
  return best;
}

function isUnder(candidate: string, parent: string): boolean {
  const child = canonicalizePath(candidate).toLowerCase();
  const root = canonicalizePath(parent).toLowerCase();
  return child.startsWith(root + sep.toLowerCase());
}
```

Note: `nearestUnit(units, dir)` for member detection is called before creating the unit, and it matches the member dir against existing (monorepo) unit roots. The `workspaceCount` increments for every manifest strictly inside a monorepo root (including nested non-workspace manifests — accepted MVP heuristic).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. If the monorepo test counts a member wrongly, trace `nearestUnit` ordering — units are created shallow-first, so the root exists before its members.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/projects/discover.ts core/test/projects-discover.test.ts
git commit -m "feat(core): discover npm project units and orphaned installs"
```

---

### Task 3: Classification — restorability, recency, pins

**Files:**
- Create: `core/src/projects/classify.ts`
- Test: `core/test/projects-classify.test.ts`

**Interfaces:**
- Consumes: `discoverProjects` + `DiscoveredUnit`/`DiscoveredOrphan` (Task 2); `ManifestInfo`/`parsePackageManager`/`sampleRegistryHosts`/`PUBLIC_REGISTRY_HOSTS` (Task 1); `ClassifyInput`, `ProjectRecord`, `ProjectAnalysis`, `RecencyGroup`, `Restorability`, `ProjectActivity`, `PackageManager`, `ActivitySource`, `RecencyThresholds` (types); `canonicalizePath` from guard.
- Produces: `DEFAULT_RECENCY_THRESHOLDS: RecencyThresholds = { activeDays: 30, occasionalDays: 180 }`; `classifyProjects(input: ClassifyInput): ProjectAnalysis`.

- [ ] **Step 1: Write the failing tests**

`core/test/projects-classify.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyProjects, DEFAULT_RECENCY_THRESHOLDS } from '../src/projects/classify';
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
    expect(project.nodeModules).toEqual({ paths: [{ path: join(fixture.root, 'app', 'node_modules'), bytes: 900 }], bytes: 900 });
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
      JSON.stringify({ packages: { 'node_modules/secret': { resolved: 'https://npm.internal.example/secret/-/secret-2.0.0.tgz' } } }),
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
    const { app, analysis } = analyze({ pins: [app] });
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

  it('exposes the pinned threshold constants', () => {
    expect(DEFAULT_RECENCY_THRESHOLDS).toEqual({ activeDays: 30, occasionalDays: 180 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/projects/classify`.

- [ ] **Step 3: Implement classification**

`core/src/projects/classify.ts`:

```ts
import { basename, dirname, join } from 'node:path';
import { canonicalizePath } from '../cleaner/guard';
import type { AggregateTree } from '../model/tree';
import type { FsProbe } from '../rules/types';
import { discoverProjects } from './discover';
import type { DiscoveredOrphan, DiscoveredUnit } from './discover';
import { PUBLIC_REGISTRY_HOSTS, parsePackageManager, sampleRegistryHosts } from './manifest';
import type { LockfileName } from './manifest';
import type {
  ActivitySource,
  ClassifyInput,
  PackageManager,
  ProjectActivity,
  ProjectAnalysis,
  ProjectRecord,
  RecencyGroup,
  RecencyThresholds,
  Restorability,
} from './types';

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_RECENCY_THRESHOLDS: RecencyThresholds = { activeDays: 30, occasionalDays: 180 };

export function classifyProjects(input: ClassifyInput): ProjectAnalysis {
  const { units, orphans } = discoverProjects({ tree: input.tree, markers: input.markers, probe: input.probe });
  const now = (input.now ?? Date.now)();
  const thresholds: RecencyThresholds = { ...DEFAULT_RECENCY_THRESHOLDS, ...(input.thresholds ?? {}) };
  const pins = new Set((input.pins ?? []).map((pin) => canonicalizePath(pin).toLowerCase()));

  const projects = [
    ...units.map((unit) => classifyUnit(unit, input, now, thresholds, pins)),
    ...orphans.map((orphan) => classifyOrphan(orphan, input, pins)),
  ];
  projects.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { projects };
}

function classifyUnit(
  unit: DiscoveredUnit,
  input: ClassifyInput,
  now: number,
  thresholds: RecencyThresholds,
  pins: Set<string>,
): ProjectRecord {
  const manager = resolveManager(unit);
  const restorability = resolveRestorability(unit, input.probe, manager);
  const activity = computeActivity(unit, input.tree, input.probe);
  const recency = recencyOf(activity, now, thresholds);
  const pinned = pins.has(canonicalizePath(unit.root).toLowerCase());
  const external = input.isExternal?.(unit.root) ?? false;
  const bytes = unit.nodeModules.reduce((sum, entry) => sum + entry.bytes, 0);

  const evidence: string[] = [
    manager.label,
    unit.monorepo ? `Monorepo · ${unit.workspaceCount} packages` : 'Project',
    describeActivity(activity, now),
    ...restorability.reasons,
  ];
  if (unit.pnp) evidence.push('Yarn Plug\u2019n\u2019Play detected');
  if (pinned) evidence.push('pinned by user — never suggested');
  if (external) evidence.push('external drive — not offered in MVP');
  if (unit.nodeModules.length === 0) evidence.push('node_modules not present');

  return {
    path: unit.root,
    name: unit.name,
    kind: unit.monorepo ? 'monorepo' : 'project',
    packageManager: manager.manager,
    pinned,
    workspaceCount: unit.workspaceCount,
    nodeModules: { paths: unit.nodeModules, bytes },
    activity,
    recency,
    restorability,
    offered: !pinned && !external && restorability.grade !== 'not-offered' && unit.nodeModules.length > 0,
    evidence,
  };
}

function classifyOrphan(orphan: DiscoveredOrphan, input: ClassifyInput, pins: Set<string>): ProjectRecord {
  const parentDir = dirname(orphan.path);
  const pinned = pins.has(canonicalizePath(orphan.path).toLowerCase());
  const external = input.isExternal?.(parentDir) ?? false;
  return {
    path: orphan.path,
    name: basename(parentDir),
    kind: 'orphaned-node-modules',
    packageManager: 'unknown',
    pinned,
    workspaceCount: 0,
    nodeModules: { paths: [{ path: orphan.path, bytes: orphan.bytes }], bytes: orphan.bytes },
    activity: { ms: null, source: 'unknown' },
    recency: 'unknown',
    restorability: {
      grade: 'yellow',
      reasons: ['no manifest or lockfile found — node_modules cannot be recreated'],
      restoreCommand: null,
    },
    offered: !pinned && !external,
    evidence: ['Orphaned node_modules — no package.json above', 'cannot be recreated'],
  };
}

interface ManagerResolution {
  manager: PackageManager;
  label: string;
  unsupportedReason: string | null;
}

function resolveManager(unit: DiscoveredUnit): ManagerResolution {
  const field = unit.manifest.packageManagerField;
  if (field) {
    const parsed = parsePackageManager(field);
    if (parsed && ['npm', 'yarn', 'pnpm', 'bun'].includes(parsed.name)) {
      const manager = parsed.name as PackageManager;
      if (manager === 'yarn' && parsed.major !== null && parsed.major >= 2) {
        return { manager, label: `yarn ${parsed.major} (Berry)`, unsupportedReason: `yarn ${parsed.major} (Berry) is not supported — Phase 2` };
      }
      if (manager === 'pnpm') {
        return { manager, label: 'pnpm', unsupportedReason: 'pnpm is not supported — Phase 2' };
      }
      if (manager === 'bun') {
        return { manager, label: 'bun', unsupportedReason: 'bun is not supported — Phase 2' };
      }
      return { manager, label: manager, unsupportedReason: null };
    }
  }

  if (unit.lockfiles.includes('pnpm-lock.yaml')) {
    return { manager: 'pnpm', label: 'pnpm', unsupportedReason: 'pnpm is not supported — Phase 2' };
  }
  if (unit.lockfiles.includes('bun.lockb')) {
    return { manager: 'bun', label: 'bun', unsupportedReason: 'bun is not supported — Phase 2' };
  }
  if (unit.lockfiles.includes('yarn.lock')) {
    return { manager: 'yarn', label: 'yarn (classic)', unsupportedReason: null };
  }
  if (unit.lockfiles.includes('package-lock.json')) {
    return { manager: 'npm', label: 'npm', unsupportedReason: null };
  }
  return { manager: 'unknown', label: 'unknown package manager', unsupportedReason: null };
}

function resolveRestorability(unit: DiscoveredUnit, probe: FsProbe, manager: ManagerResolution): Restorability {
  if (manager.unsupportedReason) {
    return { grade: 'not-offered', reasons: [manager.unsupportedReason], restoreCommand: null };
  }
  if (unit.pnp) {
    return {
      grade: 'not-offered',
      reasons: ["Yarn Plug'n'Play project — no node_modules to clean"],
      restoreCommand: null,
    };
  }

  const hasLockfile = unit.lockfiles.includes('package-lock.json') || unit.lockfiles.includes('yarn.lock');
  const reasons: string[] = [];
  if (!hasLockfile) {
    reasons.push('no lockfile — dependency versions may drift on reinstall');
  }
  if (unit.patches) {
    reasons.push('patches/ directory present — verify patch-package runs after install');
  }

  const privateHosts = detectPrivateRegistryHosts(unit, probe);
  if (privateHosts.length > 0) {
    reasons.push(`lockfile references a private registry (${privateHosts[0]}) — ensure access before removing`);
  }

  const grade = reasons.length === 0 ? 'green' : 'yellow';
  const restoreCommand =
    grade === 'green'
      ? manager.manager === 'yarn'
        ? 'yarn install --frozen-lockfile'
        : 'npm ci'
      : manager.manager === 'yarn'
        ? 'yarn install'
        : 'npm install';

  return { grade, reasons, restoreCommand };
}

function detectPrivateRegistryHosts(unit: DiscoveredUnit, probe: FsProbe): string[] {
  const lockfile: LockfileName | undefined = unit.lockfiles.find(
    (name) => name === 'package-lock.json' || name === 'yarn.lock',
  );
  if (!lockfile) return [];
  const content = probe.readFile(join(unit.root, lockfile));
  if (content === null) return [];
  return sampleRegistryHosts(content).filter((host) => !PUBLIC_REGISTRY_HOSTS.has(host));
}

function computeActivity(unit: DiscoveredUnit, tree: AggregateTree, probe: FsProbe): ProjectActivity {
  const files = tree.get(unit.root)?.newestMtimeMs ?? 0;
  const reflog = probe.stat(join(unit.root, '.git', 'logs', 'HEAD'))?.mtimeMs ?? 0;
  const manifest = probe.stat(join(unit.root, 'package.json'))?.mtimeMs ?? 0;

  let ms = 0;
  let source: ActivitySource = 'unknown';
  if (files > 0) {
    ms = files;
    source = 'files';
  }
  if (reflog > ms) {
    ms = reflog;
    source = 'git-reflog';
  }
  if (manifest > ms) {
    ms = manifest;
    source = 'manifest';
  }
  return ms > 0 ? { ms, source } : { ms: null, source: 'unknown' };
}

function recencyOf(activity: ProjectActivity, now: number, thresholds: RecencyThresholds): RecencyGroup {
  if (activity.ms === null) return 'unknown';
  const age = now - activity.ms;
  if (age <= thresholds.activeDays * DAY) return 'active';
  if (age <= thresholds.occasionalDays * DAY) return 'occasional';
  return 'dead';
}

function describeActivity(activity: ProjectActivity, now: number): string {
  if (activity.ms === null) return 'Last activity: unknown';
  const days = Math.floor((now - activity.ms) / DAY);
  return `Last activity: ${days}d ago (${activity.source})`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. The git-reflog test pins the manifest-vs-reflog precedence: reflog newer than files and manifest.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/projects/classify.ts core/test/projects-classify.test.ts
git commit -m "feat(core): classify projects by restorability, recency and pins"
```

---

### Task 4: The `npm-project-modules` rule

**Files:**
- Create: `core/src/rules/inventory/npm-project-modules.ts`
- Modify: `core/src/rules/inventory/index.ts`
- Test: `core/test/rule-npm-projects.test.ts`

**Interfaces:**
- Consumes: `classifyProjects`, `ProjectRecord`, `ProjectOptions`; `Rule`, `RuleContext`, `RuleMatch`; `AggregateTree`; `Marker`.
- Produces: `npmProjectModulesRule(options?: ProjectOptions): Rule` — id `npm-project-modules`, category `npm-projects`, action `delete-path`; `createInventoryRules(env, options)` now appends this rule (options gains `projects?: ProjectOptions`).

- [ ] **Step 1: Write the failing tests**

`core/test/rule-npm-projects.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npmProjectModulesRule } from '../src/rules/inventory/npm-project-modules';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import type { FolderRecord, Marker } from '../src/model/types';
import { Fixture } from './fixtures';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function record(path: string, overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    path,
    bytes: 0,
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/rules/inventory/npm-project-modules`.

- [ ] **Step 3: Implement the rule and wire the inventory**

`core/src/rules/inventory/npm-project-modules.ts`:

```ts
import { classifyProjects } from '../../projects/classify';
import type { ProjectOptions, ProjectRecord } from '../../projects/types';
import type { Rule, RuleContext, RuleMatch } from '../types';

export function npmProjectModulesRule(options: ProjectOptions = {}): Rule {
  return {
    id: 'npm-project-modules',
    category: 'npm-projects',
    title: 'Project node_modules',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      const now = (options.now ?? Date.now)();
      const analysis = classifyProjects({
        root: ctx.root,
        tree: ctx.tree,
        markers: ctx.markers,
        probe: ctx.probe,
        ...options,
      });

      const matches: RuleMatch[] = [];
      for (const project of analysis.projects) {
        if (!project.offered) continue;
        for (const location of project.nodeModules.paths) {
          matches.push({
            path: location.path,
            bytes: location.bytes,
            grade: project.restorability.grade === 'green' ? 'safe' : 'review',
            recovery: project.restorability.restoreCommand
              ? { kind: 'regenerate', command: project.restorability.restoreCommand }
              : { kind: 'junk', reason: 'No manifest found — node_modules cannot be recreated' },
            evidence: buildEvidence(project, now),
          });
        }
      }
      return matches;
    },
  };
}

function buildEvidence(project: ProjectRecord, now: number): string {
  const parts: string[] = [];
  parts.push(project.kind === 'monorepo' ? `Monorepo · ${project.workspaceCount} packages` : 'Project');
  parts.push(capitalize(project.recency));
  if (project.activity.ms !== null) {
    const days = Math.floor((now - project.activity.ms) / (24 * 60 * 60 * 1000));
    parts.push(`${Math.max(days, 0)}d ago (${project.activity.source})`);
  }
  if (project.restorability.restoreCommand) {
    parts.push(`restore: ${project.restorability.restoreCommand}`);
  }
  for (const reason of project.restorability.reasons) parts.push(reason);
  if (project.kind === 'orphaned-node-modules') parts.push('cannot be recreated');
  return parts.join(' · ');
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
```

In `core/src/rules/inventory/index.ts`, add these imports and extend the options and rule list:

```ts
import type { ProjectOptions } from '../../projects/types';
import { npmProjectModulesRule } from './npm-project-modules';
```

```ts
export function createInventoryRules(
  env: RuleEnv,
  options: {
    npmCacheDir?: string | null;
    recycleBin?: { enumerate?: () => RecycleBinInfo | Promise<RecycleBinInfo> };
    projects?: ProjectOptions;
  } = {},
): Rule[] {
  return [
    systemTempRule(env),
    recycleBinRule(options.recycleBin),
    npmCacheRule(env, { npmCacheDir: options.npmCacheDir }),
    ...cacheRegistryRules(env),
    npmProjectModulesRule(options.projects),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS — including Plan 4's `inventory-pipeline` tests (their fixtures carry no markers, so the new rule yields zero matches).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/rules/inventory/npm-project-modules.ts core/src/rules/inventory/index.ts core/test/rule-npm-projects.test.ts
git commit -m "feat(core): add npm project node_modules rule"
```

---

### Task 5: End-to-end pipeline + public exports

**Files:**
- Modify: `core/src/index.ts`
- Modify: `core/test/smoke.test.ts`
- Test: `core/test/projects-pipeline.test.ts`

**Interfaces:**
- Consumes: `ScanSession` (real scan, `pool: false`); `classifyProjects`; `createInventoryRules`; `Cleaner`; `npmProjectModulesRule`.
- Produces: public exports — `classifyProjects`, `DEFAULT_RECENCY_THRESHOLDS`, `discoverProjects`, `readManifest`, `npmProjectModulesRule`; types `ProjectRecord`, `ProjectAnalysis`, `ProjectKind`, `RecencyGroup`, `RestorabilityGrade`, `PackageManager`, `ActivitySource`, `ProjectActivity`, `Restorability`, `NodeModulesLocation`, `ProjectOptions`, `ClassifyInput`, `RecencyThresholds`, `DiscoveredUnit`, `DiscoveredOrphan`, `ManifestInfo`, `LockfileName`.

- [ ] **Step 1: Write the failing integration test**

`core/test/projects-pipeline.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { ScanSession } from '../src/scanner/session';
import { classifyProjects } from '../src/projects/classify';
import { npmProjectModulesRule } from '../src/rules/inventory/npm-project-modules';
import { Cleaner } from '../src/cleaner/cleaner';
import { Fixture } from './fixtures';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

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

  it('exposes the project classification surface through the public index', () => {
    expect(typeof core.classifyProjects).toBe('function');
    expect(typeof core.discoverProjects).toBe('function');
    expect(typeof core.readManifest).toBe('function');
    expect(typeof core.npmProjectModulesRule).toBe('function');
    expect(core.DEFAULT_RECENCY_THRESHOLDS).toEqual({ activeDays: 30, occasionalDays: 180 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — `core.classifyProjects` etc. are not exported from `../src/index`.

- [ ] **Step 3: Extend the public surface**

Append to `core/src/index.ts`:

```ts
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
```

Add a fourth `it(...)` block to `core/test/smoke.test.ts` (keep the existing three):

```ts
  it('exposes the project classification surface', () => {
    expect(typeof core.classifyProjects).toBe('function');
    expect(typeof core.discoverProjects).toBe('function');
    expect(typeof core.readManifest).toBe('function');
    expect(typeof core.npmProjectModulesRule).toBe('function');
    expect(core.DEFAULT_RECENCY_THRESHOLDS).toEqual({ activeDays: 30, occasionalDays: 180 });
  });
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npm run test -w core`
Expected: PASS — all suites. The pipeline test's `app/node_modules.bytes` is 4 (`'yyyy'`); if it mismatches, `mono` carries two node_modules locations (root + `packages/a`) and the orphan is `lost` — recount fixture sizes before touching classification.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/index.ts core/test/smoke.test.ts core/test/projects-pipeline.test.ts
git commit -m "feat(core): export project classification surface with end-to-end coverage"
```

---

## Plan Self-Review Notes

- Spec coverage: marker-driven discovery with manifest-outside-node_modules (§6.1 — the scanner already suppresses nested manifests), monorepo merging with member counts and "Monorepo · N packages" evidence (§6.1), nearest-root node_modules attribution incl. member-level installs (§6.1), orphaned installs as their own yellow group (§6.1), global npm roots excluded by construction (their manifests live inside node_modules → suppressed) (§6.1), restorability grades green/yellow/not-offered with best-effort 64 KB registry sampling (§6.2), recency from tree mtimes + `.git/logs/HEAD` + manifest with source labels and the 30/180-day groups (§6.3), pins always winning and external drives not offered (§6.3), and the `npm-project-modules` rule matching only offered projects with exact restore commands (§5.1/5.3). Deliberately deferred: Dev Cleanup UI, bulk selection, confirmation copy, "Recently cleaned" (Plan 9); snapshot persistence of pins and last analysis (Plan 6); drive-type detection (Plan 7 passes `isExternal`).
- Determinism: `now`/`pins`/`isExternal` are injectable at every layer; `classifyProjects` sorts records by path; fixtures build real files so manifest/lockfile/patches/pnp detection is exercised through the probe, not mocks.
- Type consistency: `NodeModulesLocation` flows discover → classify → rule (`location.path`/`location.bytes`); `ProjectOptions` is the shared options surface (classify, rule, inventory `projects`); `Restorability.restoreCommand` null ⟺ junk recovery in the rule; `RecencyGroup` includes `unknown` so orphans and activity-less projects are never bulk-selected.
- Known heuristic limits carried forward (documented, not hidden): workspaceCount counts every manifest strictly under a monorepo root (nested non-workspace manifests included); default `unknown` manager ties reinstall advice to `npm install`; registry sampling reads only the first 64 KB of a lockfile.
