# Scan Performance & Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut perceived scan time 2-3x and eliminate UI freezes by removing blocking PowerShell, stopping scan-time I/O contention, moving finalize off the critical path, running Quick Clean through the worker pool, and tuning workers per drive type.

**Architecture:** All changes stay inside the existing two workspaces. Core gains async volume/snapshot helpers, memoized wildcard expansion, an indexed project lookup, a caller-provided aggregate tree, accumulator release, eager root splitting, and a guarded async snapshot save. The app host gains an async cached volume provider, classify-once rule context, retained live rows, finalize progress + event-loop yields, capped IPC batches, and a pool-based Quick Clean measurement with progress and cancel. The renderer gains Quick Clean progress/cancel and finalize-step display.

**Tech Stack:** TypeScript, Node worker_threads, Electron, React 19, Vitest, npm workspaces (`core`, `app`).

**Spec:** `docs/superpowers/specs/2026-09-23-scan-performance-design.md`
**Evidence:** `docs/superpowers/notes/2026-09-23-scan-performance-measurements.md`

## Global Constraints

- Node `^20.19.0 || >=22.12.0`; npm workspaces `core` and `app`; do not add dependencies.
- Run `npm run typecheck -w core && npm run typecheck -w app` and the relevant test workspace before every commit.
- TDD: write the failing test, watch it fail for the right reason, then implement minimally and watch it pass.
- Rules must stay root-scoped (`scopeRuleToRoot` invariant); snapshot stays system-drive-only; browse volumes stay session-only.
- Renderer accessible names and exact copy asserted by existing tests are contracts; do not change them unless a task says so.
- Instrumentation is env-gated (`DUST_INSTRUMENT`, `DUST_BENCH_ROOT`); behavior must be identical when it is off.
- Perf contract: progress is always visible and cancel is acknowledged within ~1s.

---

### Task 1: Async cached volume resolution (spec A1)

**Files:**
- Modify: `core/src/system/drive-type.ts`
- Modify: `core/src/index.ts`
- Create: `app/src/main/host/volumes.ts`
- Modify: `app/src/main/host/engine-host.ts`
- Test: `app/test/volumes-cache.test.ts` (create), `app/test/engine-host.test.ts`, `core/test/drive-type.test.ts`

**Interfaces:**
- Produces: `listVolumesAsync(): Promise<VolumeInfo[]>` (core, exported); `createVolumeCache(load: () => Promise<VolumeInfo[]>, ttlMs: number, now: () => number): VolumeCache` with `get(): Promise<VolumeInfo[]>` and `invalidate(): void` (app host); `EngineHostDeps.volumesTtlMs?: number`; `EngineHost.getDashboard(): Promise<DashboardState>`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing volume-cache test**

Create `app/test/volumes-cache.test.ts`:

```ts
import type { VolumeInfo } from '@dust/core';
import { describe, expect, it, vi } from 'vitest';
import { createVolumeCache } from '../src/main/host/volumes';

const volumes: VolumeInfo[] = [{ root: 'C:\\', label: 'System', driveType: 'fixed' }];

describe('createVolumeCache', () => {
  it('loads once within the TTL', async () => {
    let clock = 0;
    const load = vi.fn(async () => volumes);
    const cache = createVolumeCache(load, 30_000, () => clock);

    expect(await cache.get()).toEqual(volumes);
    clock = 1_000;
    expect(await cache.get()).toEqual(volumes);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL and after invalidate', async () => {
    let clock = 0;
    const load = vi.fn(async () => volumes);
    const cache = createVolumeCache(load, 30_000, () => clock);

    await cache.get();
    clock = 30_001;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);

    cache.invalidate();
    await cache.get();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('shares an in-flight load', async () => {
    let resolveLoad!: (value: VolumeInfo[]) => void;
    const load = vi.fn(() => new Promise<VolumeInfo[]>((resolve) => (resolveLoad = resolve)));
    const cache = createVolumeCache(load, 30_000, () => 0);

    const first = cache.get();
    const second = cache.get();
    resolveLoad(volumes);

    expect(await first).toEqual(volumes);
    expect(await second).toEqual(volumes);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w app -- test/volumes-cache.test.ts`
Expected: FAIL — `Cannot find module '../src/main/host/volumes'`.

- [ ] **Step 3: Implement the volume cache**

Create `app/src/main/host/volumes.ts`:

```ts
import type { VolumeInfo } from '@dust/core';

export interface VolumeCache {
  get(): Promise<VolumeInfo[]>;
  invalidate(): void;
}

export function createVolumeCache(
  load: () => Promise<VolumeInfo[]>,
  ttlMs: number,
  now: () => number,
): VolumeCache {
  let cached: { at: number; volumes: VolumeInfo[] } | null = null;
  let inflight: Promise<VolumeInfo[]> | null = null;

  return {
    async get() {
      const stamp = now();
      if (cached !== null && stamp - cached.at < ttlMs) return cached.volumes;
      if (inflight !== null) return inflight;
      inflight = load()
        .then((volumes) => {
          cached = { at: now(), volumes };
          return volumes;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };
}
```

- [ ] **Step 4: Run the cache test to verify it passes**

Run: `npm run test -w app -- test/volumes-cache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `listVolumesAsync` to core**

In `core/src/system/drive-type.ts`, extract the PowerShell script into a module constant and add:

```ts
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const LIST_VOLUMES_SCRIPT = `$volumes = @(Get-Volume | Where-Object { $_.DriveLetter } | Select-Object @{n='root';e={"$($_.DriveLetter):\\"}}, FileSystemLabel, DriveType); ConvertTo-Json -InputObject $volumes -Compress`;

export function listVolumes(): VolumeInfo[] {
  if (process.platform !== 'win32') return [];
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LIST_VOLUMES_SCRIPT], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    return parseVolumesJson(raw);
  } catch {
    return [];
  }
}

export async function listVolumesAsync(): Promise<VolumeInfo[]> {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', LIST_VOLUMES_SCRIPT],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true },
    );
    return parseVolumesJson(stdout);
  } catch {
    return [];
  }
}
```

Export it from `core/src/index.ts` next to `listVolumes`:

```ts
export { createExternalPredicate, listVolumes, listVolumesAsync, systemDriveRoot, volumeRootOf } from './system/drive-type';
```

- [ ] **Step 6: Wire the provider into the engine host**

In `app/src/main/host/engine-host.ts`:

1. Import `listVolumesAsync` from `@dust/core` and `createVolumeCache` from `./volumes`.
2. Add `volumesTtlMs?: number;` to `EngineHostDeps`.
3. Change the interface method to `getDashboard(): Promise<DashboardState>;`.
4. Replace `const listVolumesFn = deps.listVolumes ?? listVolumes;` with:

```ts
const volumeSource = deps.listVolumes ?? listVolumesAsync;
const volumes = createVolumeCache(() => Promise.resolve(volumeSource()), deps.volumesTtlMs ?? 30_000, now);
```

5. `getDashboard` becomes async:

```ts
async function getDashboard(): Promise<DashboardState> {
  const volumeList = await volumes.get();
  const usage = getVolumeUsageFn(volumeList.map((volume) => volume.root));
  return buildDashboardState({
    volumes: volumeList,
    usage,
    snapshot: deps.store.load(),
    scan: lock.current(),
    systemRoot,
  });
}
```

6. In `startAnalyze`, `startBrowse`, `targetedSource`, and `finalize`, replace every `listVolumesFn()` call with a single awaited `const volumeList = await volumes.get();` per function and use `volumeList` (target lookup, `createExternalPredicate(volumeList)`, usage mapping). Keep the `instrument('start.listVolumes', ...)` wrapper around the awaited `volumes.get()` call.

- [ ] **Step 7: Update the existing host tests for the async dashboard and add the single-load test**

Run: `grep -n "host.getDashboard()" app/test/engine-host.test.ts app/test/ipc.test.ts`
Add `await` at every direct `host.getDashboard()` call and make the enclosing test callback `async` (the `ipc.test.ts` call goes through `registrar.invoke`, which already awaits — no change there).

Add to `app/test/engine-host.test.ts` (import `vi` from vitest):

```ts
it('resolves volumes once per session', async () => {
  const listVolumes = vi.fn(volumeList);
  const fake = new FakeSession({ root: tree.root });
  const host = createEngineHost({
    store,
    pool: false,
    listVolumes,
    getVolumeUsage: () => [],
    createRules: () => [],
    createSession: () => fake,
  });

  await host.getDashboard();
  const finished = nextEvent(host, 'finished');
  await host.startAnalyze(tree.root);
  fake.finish(emptyScanResult(tree.root, 'complete'));
  await finished;

  expect(listVolumes).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 8: Run the suites and typecheck**

Run: `npm run typecheck -w core && npm run typecheck -w app && npm run test -w core && npm run test -w app`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add core/src/system/drive-type.ts core/src/index.ts app/src/main/host/volumes.ts app/src/main/host/engine-host.ts app/test/volumes-cache.test.ts app/test/engine-host.test.ts
git commit -m "perf(app): resolve volumes once per session without blocking"
```

---

### Task 2: Async snapshot save off the critical path (spec A2)

**Files:**
- Modify: `core/src/snapshot/store.ts`
- Modify: `app/src/main/host/engine-host.ts`
- Test: `core/test/snapshot-store.test.ts`

**Interfaces:**
- Produces: `SnapshotStore.saveAsync(snapshot: SnapshotData): Promise<SaveResult>`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Append to `core/test/snapshot-store.test.ts` (build a valid snapshot with the same shape the file already uses; a minimal literal is enough because `saveAsync` does not validate):

```ts
it('saves asynchronously and round-trips through load', async () => {
  const snapshot = {
    schemaVersion: 2 as const,
    rulesVersion: '1',
    root: 'C:\\',
    startedAt: 10,
    finishedAt: 20,
    status: 'complete' as const,
    cleanedAt: null,
    disks: [],
    categories: [],
    matches: [],
    projects: [],
    folders: [],
  };
  const result = await store.saveAsync(snapshot);
  expect(result).toEqual({ ok: true });
  const loaded = store.load();
  expect(loaded.kind).toBe('ok');
  if (loaded.kind !== 'ok') return;
  expect(loaded.snapshot.root).toBe('C:\\');
});

it('reports a failed async save instead of throwing', async () => {
  const broken = new SnapshotStore({ snapshotPath: join(storePath, 'missing-dir'), userPath: join(storePath, 'user.json') });
  const result = await broken.saveAsync({
    schemaVersion: 2,
    rulesVersion: '1',
    root: 'C:\\',
    startedAt: 0,
    finishedAt: 0,
    status: 'complete',
    cleanedAt: null,
    disks: [],
    categories: [],
    matches: [],
    projects: [],
    folders: [],
  });
  expect(result.ok).toBe(false);
});
```

Adapt the variable names (`store`, `storePath`, `join`) to the existing file's fixtures; it already constructs a `SnapshotStore` and imports `join`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w core -- test/snapshot-store.test.ts`
Expected: FAIL — `store.saveAsync is not a function`.

- [ ] **Step 3: Implement `saveAsync`**

In `core/src/snapshot/store.ts`, add the import and method:

```ts
import { mkdir, rename, writeFile } from 'node:fs/promises';

  async saveAsync(snapshot: SnapshotData): Promise<SaveResult> {
    try {
      await mkdir(dirname(this.paths.snapshotPath), { recursive: true });
      const tmp = `${this.paths.snapshotPath}.tmp`;
      await writeFile(tmp, JSON.stringify(snapshot));
      await rename(tmp, this.paths.snapshotPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }
```

- [ ] **Step 4: Run the store tests**

Run: `npm run test -w core -- test/snapshot-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in finalize**

In `app/src/main/host/engine-host.ts` `finalize`, change:

```ts
const save = deps.store.save(snapshot);
```

to:

```ts
const save = await deps.store.saveAsync(snapshot);
```

- [ ] **Step 6: Run the suites and typecheck**

Run: `npm run typecheck -w core && npm run typecheck -w app && npm run test -w core && npm run test -w app`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add core/src/snapshot/store.ts app/src/main/host/engine-host.ts core/test/snapshot-store.test.ts
git commit -m "perf(core): save snapshots asynchronously"
```

---

### Task 3: Stop scan-time I/O contention (spec B)

**Files:**
- Modify: `core/src/rules/paths.ts`
- Modify: `app/src/main/host/engine-host.ts`
- Test: `core/test/rules-paths.test.ts`, `app/test/engine-host.test.ts`

**Interfaces:**
- Produces: memoized `expandProfileWildcard(base, pattern, probe)` (same signature); live ticks exclude `recycle-bin`; default `categoryIntervalMs` is `5000`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing wildcard memoization test**

Append to `core/test/rules-paths.test.ts`:

```ts
it('memoizes wildcard expansion per probe', () => {
  const calls: string[] = [];
  const probe = {
    exists: () => true,
    stat: () => null,
    listDirectory: (path: string) => {
      calls.push(path);
      return [{ name: 'Default', isDirectory: () => true, isSymbolicLink: () => false }] as never;
    },
    readFile: () => null,
  };

  const first = expandProfileWildcard('C:\\Base', '*\\Cache', probe);
  const second = expandProfileWildcard('C:\\Base', '*\\Cache', probe);

  expect(first).toEqual(second);
  expect(calls).toHaveLength(1);
});
```

Import `expandProfileWildcard` if the file does not already.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w core -- test/rules-paths.test.ts`
Expected: FAIL — `calls` has length 2.

- [ ] **Step 3: Memoize in core**

In `core/src/rules/paths.ts`, wrap the existing body:

```ts
const expansionCache = new WeakMap<FsProbe, Map<string, string[]>>();

export function expandProfileWildcard(base: string, pattern: string, probe: FsProbe): string[] {
  let perProbe = expansionCache.get(probe);
  if (perProbe === undefined) {
    perProbe = new Map();
    expansionCache.set(probe, perProbe);
  }
  const key = `${base}\u0000${pattern}`;
  const cached = perProbe.get(key);
  if (cached !== undefined) return cached;

  const result = expandUncached(base, pattern, probe);
  perProbe.set(key, result);
  return result;
}

function expandUncached(base: string, pattern: string, probe: FsProbe): string[] {
  // existing body of expandProfileWildcard moves here unchanged
}
```

- [ ] **Step 4: Write the failing live-tick tests**

Append to `app/test/engine-host.test.ts`:

```ts
it('keeps the recycle-bin rule off live ticks and runs it at finalize', async () => {
  let fake!: FakeSession;
  let clock = 0;
  let recycleCalls = 0;
  const recycleRule: Rule = {
    id: 'recycle-bin',
    category: 'recycle-bin',
    title: 'Recycle Bin',
    action: { kind: 'empty-recycle-bin' },
    match: () => {
      recycleCalls += 1;
      return [];
    },
  };
  const host = createEngineHost({
    store,
    pool: false,
    now: () => clock,
    listVolumes: volumeList,
    getVolumeUsage: () => [],
    createRules: () => [recycleRule],
    createSession: (options) => (fake = new FakeSession(options)),
    categoryIntervalMs: 1,
  });

  await host.startAnalyze(tree.root);
  clock = 100;
  fake.options.onFolder?.({
    path: join(tree.root, 'a'),
    bytes: 10,
    allocatedBytes: 4096,
    fileCount: 1,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 1,
    errorCount: 0,
    partial: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(recycleCalls).toBe(0);

  const finished = nextEvent(host, 'finished');
  fake.finish(emptyScanResult(tree.root, 'complete'));
  await finished;
  expect(recycleCalls).toBe(1);
});

it('runs live category ticks on the slower default interval', async () => {
  let fake!: FakeSession;
  let clock = 0;
  const events: ScanEvent[] = [];
  const rule: Rule = {
    id: 'fixture-temp',
    category: 'temp',
    title: 'Fixture temp',
    action: { kind: 'delete-path' },
    match: () => [],
  };
  const host = createEngineHost({
    store,
    pool: false,
    now: () => clock,
    listVolumes: volumeList,
    getVolumeUsage: () => [],
    createRules: () => [rule],
    createSession: (options) => (fake = new FakeSession(options)),
  });
  host.onEvent((event) => events.push(event));

  await host.startAnalyze(tree.root);
  clock = 5_000;
  fake.options.onFolder?.({
    path: join(tree.root, 'a'),
    bytes: 10,
    allocatedBytes: 4096,
    fileCount: 1,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 1,
    errorCount: 0,
    partial: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events.filter((event) => event.type === 'categories')).toHaveLength(1);

  clock = 9_000;
  fake.options.onFolder?.({
    path: join(tree.root, 'b'),
    bytes: 10,
    allocatedBytes: 4096,
    fileCount: 1,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 1,
    errorCount: 0,
    partial: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events.filter((event) => event.type === 'categories')).toHaveLength(1);

  clock = 10_000;
  fake.options.onFolder?.({
    path: join(tree.root, 'c'),
    bytes: 10,
    allocatedBytes: 4096,
    fileCount: 1,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 1,
    errorCount: 0,
    partial: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events.filter((event) => event.type === 'categories')).toHaveLength(2);

  const finished = nextEvent(host, 'finished');
  fake.finish(emptyScanResult(tree.root, 'complete'));
  await finished;
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npm run test -w app -- test/engine-host.test.ts`
Expected: FAIL — recycle-bin is called during live ticks; the tick cadence is 2s not 5s.

- [ ] **Step 6: Implement in the host**

In `app/src/main/host/engine-host.ts`:

```ts
const categoryIntervalMs = deps.categoryIntervalMs ?? 5000;
```

and in `maybeLiveCategories`:

```ts
const liveRules = rules.filter((rule) => rule.category !== 'npm-projects' && rule.id !== 'recycle-bin');
```

- [ ] **Step 7: Run the suites and typecheck**

Run: `npm run typecheck -w core && npm run typecheck -w app && npm run test -w core && npm run test -w app`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add core/src/rules/paths.ts core/test/rules-paths.test.ts app/src/main/host/engine-host.ts app/test/engine-host.test.ts
git commit -m "perf(app): keep heavy rules off live ticks and memoize cache paths"
```

---

### Task 4: Classify projects once (spec C1)

**Files:**
- Modify: `core/src/rules/types.ts`
- Modify: `core/src/rules/inventory/npm-project-modules.ts`
- Modify: `app/src/main/host/engine-host.ts`
- Test: `core/test/rule-npm-projects.test.ts`

**Interfaces:**
- Produces: `RuleContext.projects?: ProjectRecord[]` — when present, `npmProjectModulesRule` must not call `classifyProjects`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Append to `core/test/rule-npm-projects.test.ts`:

```ts
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
```

Add the missing imports (`ProjectRecord`, `AggregateTree`, `createNodeFsProbe`) if absent.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w core -- test/rule-npm-projects.test.ts`
Expected: FAIL — the rule ignores `ctx.projects`, finds no markers, returns 0 matches.

- [ ] **Step 3: Implement the contract and the rule**

In `core/src/rules/types.ts`:

```ts
import type { ProjectRecord } from '../projects/types';

export interface RuleContext {
  root: string;
  tree: AggregateTree;
  markers: Marker[];
  probe: FsProbe;
  projects?: ProjectRecord[];
}
```

In `core/src/rules/inventory/npm-project-modules.ts`:

```ts
      const now = (options.now ?? Date.now)();
      const projects =
        ctx.projects ??
        classifyProjects({
          root: ctx.root,
          tree: ctx.tree,
          markers: ctx.markers,
          probe: ctx.probe,
          ...options,
        }).projects;

      const matches: RuleMatch[] = [];
      for (const project of projects) {
```

- [ ] **Step 4: Run the rule tests**

Run: `npm run test -w core -- test/rule-npm-projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Pass the classification through in finalize**

In `app/src/main/host/engine-host.ts` `finalize`, after `analysis` is computed:

```ts
const ctx: RuleContext = {
  root: result.root,
  tree: result.tree,
  markers: result.markers,
  probe,
  projects: analysis.projects,
};
```

- [ ] **Step 6: Run the suites and typecheck**

Run: `npm run typecheck -w core && npm run typecheck -w app && npm run test -w core && npm run test -w app`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add core/src/rules/types.ts core/src/rules/inventory/npm-project-modules.ts app/src/main/host/engine-host.ts core/test/rule-npm-projects.test.ts
git commit -m "perf(core): classify projects once per scan"
```

---

### Task 5: Indexed project discovery (spec C2)

**Files:**
- Modify: `core/src/projects/discover.ts`
- Test: `core/test/projects-discover.test.ts`

**Interfaces:**
- Produces: `createUnitLookup(): UnitLookup` with `add(unit)`, `nearest(dir)`, `monorepoParent(dir)`; `ancestorKeys(dir): Generator<string>`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing lookup test**

Append to `core/test/projects-discover.test.ts`:

```ts
import { createUnitLookup } from '../src/projects/discover';

function unit(root: string, monorepo = false): DiscoveredUnit {
  return {
    root,
    name: root,
    manifest: { name: null, workspaces: false, packageManagerField: null, valid: true },
    monorepo,
    workspaceCount: 0,
    nodeModules: [],
    lockfiles: [],
    pnp: false,
    patches: false,
  };
}

describe('createUnitLookup', () => {
  it('finds the nearest unit by walking ancestors', () => {
    const lookup = createUnitLookup();
    const outer = unit('C:\\repo');
    const inner = unit('C:\\repo\\packages\\app');
    lookup.add(outer);
    lookup.add(inner);

    expect(lookup.nearest('C:\\repo\\packages\\app\\src')?.root).toBe(inner.root);
    expect(lookup.nearest('C:\\repo\\other')?.root).toBe(outer.root);
    expect(lookup.nearest('D:\\elsewhere')).toBeNull();
  });

  it('matches case-insensitively and only returns monorepo parents', () => {
    const lookup = createUnitLookup();
    const plain = unit('C:\\repo');
    const mono = unit('C:\\repo\\mono', true);
    lookup.add(plain);
    lookup.add(mono);

    expect(lookup.monorepoParent('c:\\REPO\\MONO\\packages\\a')?.root).toBe(mono.root);
    expect(lookup.monorepoParent('C:\\repo\\plain-child')).toBeNull();
  });
});
```

Import `DiscoveredUnit` as a type if needed.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w core -- test/projects-discover.test.ts`
Expected: FAIL — `createUnitLookup` is not exported.

- [ ] **Step 3: Implement the lookup and use it**

In `core/src/projects/discover.ts`:

```ts
export interface UnitLookup {
  add(unit: DiscoveredUnit): void;
  nearest(dir: string): DiscoveredUnit | null;
  monorepoParent(dir: string): DiscoveredUnit | null;
}

export function createUnitLookup(): UnitLookup {
  const byRoot = new Map<string, DiscoveredUnit>();
  const find = (dir: string, predicate: (unit: DiscoveredUnit) => boolean): DiscoveredUnit | null => {
    for (const key of ancestorKeys(dir)) {
      const unit = byRoot.get(key);
      if (unit && predicate(unit)) return unit;
    }
    return null;
  };
  return {
    add(unit) {
      byRoot.set(canonicalizePath(unit.root).toLowerCase(), unit);
    },
    nearest(dir) {
      return find(dir, () => true);
    },
    monorepoParent(dir) {
      return find(dir, (unit) => unit.monorepo);
    },
  };
}

export function* ancestorKeys(dir: string): Generator<string> {
  let key = canonicalizePath(dir).toLowerCase();
  for (;;) {
    yield key;
    const parent = dirname(key);
    if (parent === key) return;
    key = parent;
  }
}
```

In `discoverProjects`, replace the linear scans:

```ts
  const lookup = createUnitLookup();
  for (const marker of manifestMarkers) {
    const dir = dirname(marker.path);
    const parent = lookup.monorepoParent(dir);
    if (parent) {
      parent.workspaceCount += 1;
      continue;
    }
    // ... existing unit construction ...
    const unit = { ... };
    units.push(unit);
    lookup.add(unit);
  }
```

and for node_modules markers:

```ts
    const owner = lookup.nearest(dirname(marker.path));
```

Delete the now-unused `nearestUnit` and `isUnder` functions.

- [ ] **Step 4: Run the discovery tests**

Run: `npm run test -w core -- test/projects-discover.test.ts`
Expected: PASS (existing discovery tests plus the two new ones).

- [ ] **Step 5: Run the suites and typecheck**

Run: `npm run typecheck -w core && npm run test -w core`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add core/src/projects/discover.ts core/test/projects-discover.test.ts
git commit -m "perf(core): index project units for ancestor lookups"
```

---

### Task 6: Single aggregate tree (spec C3)

**Files:**
- Modify: `core/src/scanner/session.ts`
- Modify: `app/src/main/host/engine-host.ts`
- Test: `core/test/session.test.ts`

**Interfaces:**
- Produces: `SessionOptions.tree?: AggregateTree` — when provided, `ScanSession.start()` fills and returns that exact instance.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Append to `core/test/session.test.ts`:

```ts
it('fills a caller-provided tree and returns it', async () => {
  fixture.file('a.txt', 'aa');
  const tree = new AggregateTree();

  const result = await new ScanSession({ root: fixture.root, pool: false, tree }).start();

  expect(result.tree).toBe(tree);
  expect(tree.get(fixture.root)?.bytes).toBe(2);
});
```

Import `AggregateTree` from `../src/model/tree`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w core -- test/session.test.ts`
Expected: FAIL — `result.tree` is a different instance and the provided tree stays empty.

- [ ] **Step 3: Implement the option**

In `core/src/scanner/session.ts`:

```ts
export interface SessionOptions {
  root: string;
  tree?: AggregateTree;
  // ...existing fields...
}
```

In `start()`:

```ts
const tree = this.options.tree ?? new AggregateTree();
```

- [ ] **Step 4: Pass the host's live tree**

In `app/src/main/host/engine-host.ts` `startAnalyze`, pass the existing `liveTree` into the session:

```ts
session = createSession({
  root: volume,
  pool: deps.pool ?? (deps.workerPath ? { workerPath: deps.workerPath } : false),
  tree: liveTree,
  onFolder: onLiveFolder,
  // ...unchanged...
});
```

Do the same in `startBrowse` with its `liveTree`.

- [ ] **Step 5: Run the suites and typecheck**

Run: `npm run typecheck -w core && npm run typecheck -w app && npm run test -w core && npm run test -w app`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add core/src/scanner/session.ts app/src/main/host/engine-host.ts core/test/session.test.ts
git commit -m "perf: share one aggregate tree between the session and the host"
```

---

### Task 7: Build rows once and release accumulators (spec C4)

**Files:**
- Modify: `app/src/main/host/results.ts`
- Modify: `app/src/main/host/engine-host.ts`
- Modify: `core/src/scan/coordinator.ts`
- Test: `app/test/results.test.ts`, `app/test/engine-host.test.ts`, `core/test/coordinator.test.ts`

**Interfaces:**
- Produces: `applyMatchesToRows(rows: ResultRow[], matches: ResultMatch[]): ResultRow[]` (app results); `ScanCoordinator.pendingAccumulators(): number` (core).
- Consumes: `liveRows` retained by `startAnalyze`.

- [ ] **Step 1: Write the failing `applyMatchesToRows` test**

Append to `app/test/results.test.ts`:

```ts
it('applies rule matches to existing rows and leaves others untouched', () => {
  const rows = [row('C:\\Temp'), row('C:\\Users')];
  const matches = [
    {
      path: 'C:\\Temp',
      bytes: 10,
      ruleId: 'system-temp',
      category: 'temp' as const,
      grade: 'safe' as const,
      evidence: 'junk',
    },
  ];

  const updated = applyMatchesToRows(rows, matches);

  expect(updated[0]?.action?.ruleId).toBe('system-temp');
  expect(updated[1]?.action).toBeNull();
});
```

Use the file's existing row factory (or the `toResultRow` helper) to build `row(path)`; import `applyMatchesToRows` from `../src/main/host/results`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w app -- test/results.test.ts`
Expected: FAIL — `applyMatchesToRows` is not exported.

- [ ] **Step 3: Implement it**

In `app/src/main/host/results.ts`:

```ts
export function applyMatchesToRows(rows: ResultRow[], matches: ResultMatch[]): ResultRow[] {
  if (matches.length === 0) return rows;
  const actions = new Map<string, ResultAction>();
  for (const match of matches) {
    actions.set(pathKey(match.path), {
      ruleId: match.ruleId,
      category: match.category,
      grade: match.grade,
      evidence: match.evidence,
    });
  }
  for (const row of rows) {
    const action = actions.get(pathKey(row.path));
    if (action) row.action = action;
  }
  return rows;
}
```

- [ ] **Step 4: Retain live rows and use them in finalize**

In `app/src/main/host/engine-host.ts` `startAnalyze`:

```ts
const liveRows: ResultRow[] = [];
```

In `onLiveFolder`, after building `row`, push it: `liveRows.push(row);` (before or after the buffer push, as long as it happens once). In `finishLive`, push the root row into `liveRows` as well.

In `finalize`, replace:

```ts
rows: instrument('row.build.final', () => buildRowsFromTree(result.tree, result.root, matches, guard)),
```

with:

```ts
rows: instrument('row.applyMatches', () => applyMatchesToRows(liveRows, matches)),
```

Delete the now-unused `buildRowsFromTree` import if nothing else uses it (snapshot results still use `buildRowsFromSnapshot`).

- [ ] **Step 5: Add the action assertion to the live-results test**

In `app/test/engine-host.test.ts`, in the test that runs `tempRule` and reads `host.getResults(tree.root)`, add:

```ts
expect(live.rows.find((row) => row.path === join(tree.root, 'temp'))?.action?.ruleId).toBe('fixture-temp');
```

- [ ] **Step 6: Release accumulators in the coordinator**

In `core/src/scan/coordinator.ts` `tryFinalize`, after the parent rollup updates and before `current = parent.path`:

```ts
this.accumulators.delete(accumulator.path);
```

Add the accessor:

```ts
pendingAccumulators(): number {
  return this.accumulators.size;
}
```

- [ ] **Step 7: Assert release in the coordinator test**

In `core/test/coordinator.test.ts`, find the test that completes a full scan through `make()` and, after the run resolves, add:

```ts
expect(coordinator.pendingAccumulators()).toBe(0);
```

- [ ] **Step 8: Run the suites and typecheck**

Run: `npm run typecheck -w core && npm run typecheck -w app && npm run test -w core && npm run test -w app`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add app/src/main/host/results.ts app/src/main/host/engine-host.ts core/src/scan/coordinator.ts app/test/results.test.ts app/test/engine-host.test.ts core/test/coordinator.test.ts
git commit -m "perf: reuse streamed rows and release finalized accumulators"
```

---

### Task 8: Finalize yields, progress, and capped IPC batches (spec C5)

**Files:**
- Modify: `app/src/shared/ipc.ts`
- Modify: `app/src/main/host/engine-host.ts`
- Modify: `app/renderer/src/pages/ScanView.tsx`
- Test: `app/test/engine-host.test.ts`, `app/test/renderer/scan-view.test.tsx`

**Interfaces:**
- Produces: `ScanEvent` gains `{ type: 'finalize-progress'; runId: string; step: string }`; `finalize(result, startedAt, rules, probe, runId)` emits steps `projects`, `rules`, `rows`, `snapshot` and yields between them; folder batches cap at 2000 rows.
- Consumes: Task 7's retained rows.

- [ ] **Step 1: Write the failing host test**

Append to `app/test/engine-host.test.ts`:

```ts
it('emits finalize progress steps and caps folder batches', async () => {
  let fake!: FakeSession;
  const events: ScanEvent[] = [];
  const host = createEngineHost({
    store,
    pool: false,
    listVolumes: volumeList,
    getVolumeUsage: () => [],
    createRules: () => [],
    createSession: (options) => (fake = new FakeSession(options)),
    folderIntervalMs: 60_000,
  });
  host.onEvent((event) => events.push(event));

  await host.startAnalyze(tree.root);
  for (let index = 0; index < 4500; index += 1) {
    fake.options.onFolder?.({
      path: join(tree.root, `d${index}`),
      bytes: 1,
      allocatedBytes: 1,
      fileCount: 0,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: false,
    });
  }

  const folderEvents = events.filter((event) => event.type === 'folders');
  expect(folderEvents.length).toBeGreaterThanOrEqual(3);
  for (const event of folderEvents) {
    if (event.type === 'folders') expect(event.folders.length).toBeLessThanOrEqual(2000);
  }

  const finished = nextEvent(host, 'finished');
  fake.finish(emptyScanResult(tree.root, 'complete'));
  await finished;

  const steps = events
    .filter((event): event is Extract<ScanEvent, { type: 'finalize-progress' }> => event.type === 'finalize-progress')
    .map((event) => event.step);
  expect(steps).toEqual(['projects', 'rules', 'rows', 'snapshot']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w app -- test/engine-host.test.ts`
Expected: FAIL — no `finalize-progress` events; one giant `folders` event with 4500 rows.

- [ ] **Step 3: Add the event and the cap**

In `app/src/shared/ipc.ts`, extend `ScanEvent`:

```ts
  | { type: 'finalize-progress'; runId: string; step: string }
```

In `app/src/main/host/engine-host.ts`:

```ts
const MAX_FOLDER_BATCH = 2000;
```

In `onLiveFolder`, replace the flush condition:

```ts
const stamp = now();
if (folderBuffer.length >= MAX_FOLDER_BATCH) {
  lastFolderFlush = stamp;
  flushFolders();
} else if (stamp - lastFolderFlush >= folderIntervalMs) {
  lastFolderFlush = stamp;
  flushFolders();
}
maybeLiveCategories();
```

- [ ] **Step 4: Emit finalize steps with yields**

In `app/src/main/host/engine-host.ts`, add the helper near the top of `createEngineHost`:

```ts
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
```

Change the `finalize` signature to accept `runId: string` and emit/yield between phases:

```ts
    emit({ type: 'finalize-progress', runId, step: 'projects' });
    const existing = instrument('finalize.store.load', () => deps.store.load());
    // ...
    const analysis = instrument('finalize.classifyProjects', () => classifyProjects({ ... }));
    await yieldToEventLoop();

    emit({ type: 'finalize-progress', runId, step: 'rules' });
    const matches = await instrumentAsync('finalize.collectRuleMatches', () => collectRuleMatches(rules, ctx));
    await yieldToEventLoop();

    emit({ type: 'finalize-progress', runId, step: 'rows' });
    // ...lastResults/lastRun assignment (rows via applyMatchesToRows)...
    await yieldToEventLoop();

    emit({ type: 'finalize-progress', runId, step: 'snapshot' });
    // ...usage, buildSnapshot, saveAsync...
```

Update the call in `runAnalysis`: `const summary = await finalize(result, input.startedAt, input.rules, input.probe, input.runId);`

- [ ] **Step 5: Show the step in ScanView**

In `app/renderer/src/pages/ScanView.tsx`:

```tsx
const finalizeStep = current?.type === 'finalize-progress' ? current.step : null;
```

Replace the finalizing line:

```tsx
{(finalizing || finalizeStep !== null) && (
  <p className="mt-2 text-sm text-emerald-300">
    Analyzing results…{finalizeStep !== null ? ` (${finalizeStep})` : ''}
  </p>
)}
```

Add to `app/test/renderer/scan-view.test.tsx`:

```tsx
it('shows the finalize step while results are built', () => {
  const event: ScanEvent = { type: 'finalize-progress', runId: 'run-1', step: 'rows' };
  render(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={event} onBack={vi.fn()} />);
  expect(screen.getByText('Analyzing results… (rows)')).toBeInTheDocument();
});
```

- [ ] **Step 6: Run the suites and typecheck**

Run: `npm run typecheck -w core && npm run typecheck -w app && npm run test -w core && npm run test -w app`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/src/shared/ipc.ts app/src/main/host/engine-host.ts app/renderer/src/pages/ScanView.tsx app/test/engine-host.test.ts app/test/renderer/scan-view.test.tsx
git commit -m "perf(app): yield through finalize with progress and cap IPC batches"
```

---

### Task 9: Quick Clean through the worker pool (spec D)

**Files:**
- Modify: `app/src/main/host/targeted.ts`
- Modify: `app/src/main/host/engine-host.ts`
- Modify: `app/src/shared/ipc.ts`
- Modify: `app/renderer/src/pages/QuickCleanView.tsx`
- Test: `app/test/targeted.test.ts`, `app/test/engine-host.test.ts`, `app/test/renderer/quick-clean-view.test.tsx`

**Interfaces:**
- Produces: `measureDirectories(paths, measure)` is async and accepts `(path) => Promise<FolderRecord | null> | FolderRecord | null`; `ScanEvent` gains `{ type: 'quick-clean-progress'; progress: ScanProgressPayload }`; `previewClean` returns `{ ok: false, reason: 'failed', message: 'Quick clean cancelled' }` when the user cancels.
- Consumes: Task 1's volume cache.

- [ ] **Step 1: Write the failing targeted test**

In `app/test/targeted.test.ts`, update the existing calls to pass an explicit measure and await, then add:

```ts
it('awaits an async measure and skips duplicates', async () => {
  const measured: string[] = [];
  const tree = await measureDirectories(['C:\\A', 'C:\\a\\', 'C:\\B'], async (path) => {
    measured.push(path);
    return {
      path,
      bytes: 5,
      allocatedBytes: 4096,
      fileCount: 1,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: false,
    };
  });

  expect(measured).toEqual(['C:\\A', 'C:\\B']);
  expect(tree.size()).toBe(2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w app -- test/targeted.test.ts`
Expected: FAIL — `measureDirectories` does not await the measure and dedupes only exact keys.

- [ ] **Step 3: Make it async**

In `app/src/main/host/targeted.ts`:

```ts
export async function measureDirectories(
  paths: readonly string[],
  measure: (path: string) => Promise<FolderRecord | null> | FolderRecord | null,
): Promise<AggregateTree> {
  const tree = new AggregateTree();
  const seen = new Set<string>();
  for (const path of paths) {
    const key = path.replace(/[\\/]+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const record = await measure(path);
    if (record !== null) tree.addFolder(record);
  }
  return tree;
}
```

Keep `measurePath` exported for callers that still want the synchronous walk.

- [ ] **Step 4: Run the targeted tests**

Run: `npm run test -w app -- test/targeted.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing host progress/cancel test**

Append to `app/test/engine-host.test.ts`:

```ts
it('streams quick-clean progress and cancels the targeted measurement', async () => {
  let fake!: FakeSession;
  const events: ScanEvent[] = [];
  const host = createEngineHost({
    store,
    pool: false,
    env: ruleEnvFor(tree.root),
    listVolumes: volumeList,
    getVolumeUsage: () => [],
    createRules: () => [tempRule(tree.root)],
    createSession: (options) => (fake = new FakeSession(options)),
  });
  host.onEvent((event) => events.push(event));

  const pending = host.previewClean({ scope: 'quick' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  fake.options.onProgress?.({
    filesScanned: 5,
    bytesSeen: 10,
    currentPath: join(tree.root, 'temp'),
    dirsCompleted: 1,
    errors: 0,
  });
  expect(events.some((event) => event.type === 'quick-clean-progress')).toBe(true);

  const cancelled = host.cancelScan();
  fake.finish(emptyScanResult(tree.root, 'cancelled'));
  expect(await cancelled).toBe(true);

  const preview = await pending;
  expect(preview).toMatchObject({ ok: false, reason: 'failed', message: 'Quick clean cancelled' });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test -w app -- test/engine-host.test.ts`
Expected: FAIL — no quick-clean progress events and the targeted measurement is synchronous.

- [ ] **Step 7: Implement pool-based targeted measurement**

In `app/src/shared/ipc.ts`, extend `ScanEvent`:

```ts
  | { type: 'quick-clean-progress'; progress: ScanProgressPayload }
```

In `app/src/main/host/engine-host.ts`, replace `targetedSource`:

```ts
  async function targetedSource(root: string): Promise<PlanSource> {
    const probe = createNodeFsProbe();
    const volumeList = await volumes.get();
    const rules = createRules(
      env,
      { pins: deps.store.getPins(), isExternal: createExternalPredicate(volumeList), now },
      { recycleBin: { enumerate: () => defaultRecycleBinEnumeration() } },
    );
    const actions = new Map(rules.map((rule) => [rule.id, rule.action.kind]));
    const discovery = await collectRuleMatches(scopeRules(rules, 'quick', []), {
      root,
      tree: new AggregateTree(),
      markers: [],
      probe,
    });

    const quickRunId = randomUUID();
    const startedAt = now();
    let cancelled = false;

    const tree = await measureDirectories(
      discovery.filter((match) => actions.get(match.ruleId) !== 'empty-recycle-bin').map((match) => match.path),
      async (path) => {
        const session = createSession({
          root: path,
          pool: deps.pool ?? (deps.workerPath ? { workerPath: deps.workerPath } : false),
          onProgress: (update) => {
            emit({
              type: 'quick-clean-progress',
              progress: {
                filesScanned: update.filesScanned,
                bytesSeen: update.bytesSeen,
                currentPath: update.currentPath,
                dirsCompleted: update.dirsCompleted,
                errors: update.errors,
                elapsedMs: Math.max(now() - startedAt, 0),
              },
            });
          },
        });
        let settle!: () => void;
        const settled = new Promise<void>((resolve) => {
          settle = resolve;
        });
        active = { runId: quickRunId, session, settled };
        try {
          const result = await session.start();
          if (result.status === 'cancelled') {
            cancelled = true;
            return null;
          }
          return result.tree.get(result.root) ?? null;
        } finally {
          active = null;
          settle();
        }
      },
    );

    if (cancelled) throw new Error('Quick clean cancelled');
    return { source: 'targeted', root, scanAgeMs: null, rules, ctx: { root, tree, markers: [], probe } };
  }
```

`previewClean` already catches thrown errors and returns `{ ok: false, reason: 'failed', message }`, so the cancel path needs no further change.

- [ ] **Step 8: Show progress and cancel in QuickCleanView**

In `app/renderer/src/pages/QuickCleanView.tsx`:

```tsx
import type { CleanPreview, CleanReport, DustApi, ScanProgressPayload } from '../../../src/shared/ipc';
import { formatCount } from '../format';

  const [progress, setProgress] = useState<ScanProgressPayload | null>(null);

  useEffect(
    () =>
      api.onScanEvent((event) => {
        if (event.type === 'quick-clean-progress') setProgress(event.progress);
      }),
    [api],
  );
```

Replace the "Building the cleanup plan." branch:

```tsx
      ) : preview === null ? (
        error === null && (
          <>
            <p className="text-sm text-neutral-400">Building the cleanup plan.</p>
            {progress !== null && (
              <p className="mt-2 text-xs text-neutral-500">
                {formatCount(progress.filesScanned)} files scanned · {progress.currentPath}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                void api.cancelScan().catch(() => {});
              }}
              className="mt-3 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
            >
              Cancel
            </button>
          </>
        )
      ) : (
```

Add to `app/test/renderer/quick-clean-view.test.tsx`:

```tsx
it('shows targeted scan progress and cancels', async () => {
  const handlers: Array<(event: ScanEvent) => void> = [];
  const cancelScan = vi.fn(async () => {});
  const api = makeApi({
    cancelScan,
    previewClean: () => new Promise(() => {}),
    onScanEvent: (handler) => {
      handlers.push(handler);
      return () => {};
    },
  });
  render(<QuickCleanView api={api} onDone={vi.fn()} onViewResults={vi.fn()} />);

  act(() => {
    handlers[0]?.({
      type: 'quick-clean-progress',
      progress: {
        filesScanned: 1234,
        bytesSeen: 2048,
        currentPath: 'C:\\Temp',
        dirsCompleted: 3,
        errors: 0,
        elapsedMs: 1000,
      },
    });
  });

  expect(await screen.findByText(/1,234 files scanned/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancelScan).toHaveBeenCalledTimes(1);
});
```

Add the needed imports (`act`, `ScanEvent`) to that test file.

- [ ] **Step 9: Run the suites and typecheck**

Run: `npm run typecheck -w core && npm run typecheck -w app && npm run test -w core && npm run test -w app`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add app/src/main/host/targeted.ts app/src/main/host/engine-host.ts app/src/shared/ipc.ts app/renderer/src/pages/QuickCleanView.tsx app/test/targeted.test.ts app/test/engine-host.test.ts app/test/renderer/quick-clean-view.test.tsx
git commit -m "perf(app): measure quick clean through the worker pool with progress and cancel"
```

---

### Task 10: Cold HDD A/B and drive-aware worker tuning (spec E)

**Files:**
- Modify: `core/src/system/drive-type.ts`
- Modify: `core/src/scan/limits.ts`
- Modify: `core/src/scan/worker-scan.ts`
- Modify: `core/src/scan/coordinator.ts`
- Modify: `app/src/main/host/engine-host.ts`
- Test: `core/test/drive-type.test.ts`, `core/test/limits.test.ts` (create), `core/test/worker-scan.test.ts`
- Docs: `docs/superpowers/notes/2026-09-23-scan-performance-measurements.md`

**Interfaces:**
- Produces: `VolumeInfo.mediaType: 'ssd' | 'hdd' | 'unknown'`; `defaultWorkersForVolume(mediaType): number`; worker-scan splits the root immediately; coordinator queue uses a head index.
- Consumes: `listVolumesAsync` from Task 1.

- [ ] **Step 1: Run the cold HDD A/B and record it**

Pick a large HDD subtree that has not been read recently (e.g. a games folder on `G:\`), then run:

```bash
cd core
npx tsx scripts/bench-scan.ts --root "G:/<fresh-subtree>" --workers 1
npx tsx scripts/bench-scan.ts --root "G:/<fresh-subtree>" --workers 2
npx tsx scripts/bench-scan.ts --root "G:/<fresh-subtree>" --workers 4
npx tsx scripts/bench-scan.ts --root "G:/<fresh-subtree>" --workers 8
```

Run the four commands back-to-back on the same subtree and record `elapsedMs` / `filesPerSecond` in `docs/superpowers/notes/2026-09-23-scan-performance-measurements.md` under a new "Cold HDD worker A/B" section. Use the fastest cold configuration as `HDD_WORKERS` below; if the curve is flat, keep `2`.

- [ ] **Step 2: Write the failing media-type tests**

In `core/test/drive-type.test.ts`, extend the `parseVolumesJson` expectations to include `mediaType` and add:

```ts
it('maps media types to ssd, hdd, or unknown', () => {
  const volumes = parseVolumesJson(
    JSON.stringify([
      { root: 'C:\\', FileSystemLabel: 'System', DriveType: 'Fixed', MediaType: 'SSD' },
      { root: 'F:\\', FileSystemLabel: 'Data', DriveType: 'Fixed', MediaType: 'HDD' },
      { root: 'E:\\', FileSystemLabel: '', DriveType: 'Removable', MediaType: 'Unspecified' },
    ]),
  );
  expect(volumes.map((volume) => volume.mediaType)).toEqual(['ssd', 'hdd', 'unknown']);
});
```

Create `core/test/limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultWorkersForVolume } from '../src/scan/limits';

describe('defaultWorkersForVolume', () => {
  it('uses two workers for spinning disks', () => {
    expect(defaultWorkersForVolume('hdd')).toBe(2);
  });

  it('falls back to the default count for ssd and unknown media', () => {
    const ssd = defaultWorkersForVolume('ssd');
    const unknown = defaultWorkersForVolume(undefined);
    expect(ssd).toBeGreaterThanOrEqual(4);
    expect(unknown).toBe(ssd);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm run test -w core -- test/drive-type.test.ts test/limits.test.ts`
Expected: FAIL — `mediaType` is not parsed and `defaultWorkersForVolume` is not exported.

- [ ] **Step 4: Implement media type and the worker policy**

In `core/src/system/drive-type.ts`:

```ts
export type MediaType = 'ssd' | 'hdd' | 'unknown';

export interface VolumeInfo {
  root: string;
  label: string | null;
  driveType: DriveType;
  mediaType: MediaType;
}
```

Extend the PowerShell script to join partitions and physical disks:

```
$parts = @(Get-Partition | Where-Object { $_.DriveLetter } | Select-Object @{n='root';e={"$($_.DriveLetter):\\"}}, DiskNumber);
$disks = @{}; foreach ($disk in Get-PhysicalDisk) { $disks[[string]$disk.DeviceId] = $disk.MediaType }
$volumes = @(Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object {
  $root = "$($_.DriveLetter):\\";
  $part = $parts | Where-Object { $_.root -eq $root } | Select-Object -First 1;
  $media = if ($part) { $disks[[string]$part.DiskNumber] } else { $null };
  [pscustomobject]@{ root = $root; FileSystemLabel = $_.FileSystemLabel; DriveType = $_.DriveType; MediaType = $media }
});
ConvertTo-Json -InputObject $volumes -Compress
```

Add the mapper and parse it:

```ts
export function mapMediaType(raw: unknown): MediaType {
  if (typeof raw !== 'string') return 'unknown';
  switch (raw.trim().toLowerCase()) {
    case 'ssd':
      return 'ssd';
    case 'hdd':
      return 'hdd';
    default:
      return 'unknown';
  }
}
```

In `parseVolumesJson`, add `mediaType: mapMediaType(record.MediaType)` to the pushed object. Update the existing `toEqual` expectations in `core/test/drive-type.test.ts` to include `mediaType: 'unknown'` where the fixtures omit it.

In `core/src/scan/limits.ts`:

```ts
export const HDD_WORKERS = 2;

export function defaultWorkersForVolume(mediaType: 'ssd' | 'hdd' | 'unknown' | undefined): number {
  return mediaType === 'hdd' ? HDD_WORKERS : defaultWorkerCount();
}
```

Set `HDD_WORKERS` to the measured optimum from Step 1 if it differs from 2.

- [ ] **Step 5: Write the failing eager-split test**

Append to `core/test/worker-scan.test.ts` (the `run` helper is already defined in that file):

```ts
it('submits the root children immediately', () => {
  const sink = run(
    {
      'F:\\synthetic': { dirs: ['a', 'b'] },
      'F:\\synthetic\\a': {},
      'F:\\synthetic\\b': {},
    },
    20_000,
  );
  expect(sink.submits).toEqual([join(root, 'a'), join(root, 'b')]);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test -w core -- test/worker-scan.test.ts`
Expected: FAIL — `sink.submits` is empty because the budget is not exhausted.

- [ ] **Step 7: Implement eager root split and queue head index**

In `core/src/scan/worker-scan.ts`:

```ts
    budget -= result.entryCount;
    const shouldSplit = root ? result.childDirs.length > 1 : budget <= 0 && result.childDirs.length > 0;
    if (shouldSplit) {
      ctx.submitTasks(result.childDirs);
      return;
    }
```

In `core/src/scan/coordinator.ts`, replace the two `queue.shift()` uses with a head index:

```ts
  private queueHead = 0;

  private takeNext(): Task | undefined {
    const task = this.queue[this.queueHead];
    if (task === undefined) return undefined;
    this.queueHead += 1;
    if (this.queueHead > 64 && this.queueHead * 2 > this.queue.length) {
      this.queue.splice(0, this.queueHead);
      this.queueHead = 0;
    }
    return task;
  }
```

Use `takeNext()` in `assign` and `enqueue`, and replace `this.queue.length === 0` checks with `this.queueHead >= this.queue.length`.

- [ ] **Step 8: Wire the worker policy into the host**

In `app/src/main/host/engine-host.ts`, import `defaultWorkersForVolume` and build the pool options per target volume:

```ts
function poolForVolume(volume: VolumeInfo): SessionOptions['pool'] {
  if (deps.pool !== undefined) return deps.pool;
  if (!deps.workerPath) return false;
  return { workerPath: deps.workerPath, workers: defaultWorkersForVolume(volume.mediaType) };
}
```

Use `poolForVolume(target)` in `startAnalyze` and `startBrowse` (both already have the resolved `target`).

- [ ] **Step 9: Run the suites and typecheck**

Run: `npm run typecheck -w core && npm run typecheck -w app && npm run test -w core && npm run test -w app`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add core/src/system/drive-type.ts core/src/scan/limits.ts core/src/scan/worker-scan.ts core/src/scan/coordinator.ts app/src/main/host/engine-host.ts core/test/drive-type.test.ts core/test/limits.test.ts core/test/worker-scan.test.ts docs/superpowers/notes/2026-09-23-scan-performance-measurements.md
git commit -m "perf: tune workers per drive media type and split the root eagerly"
```

---

### Task 11: Perf gate and before/after numbers (spec F)

**Files:**
- Modify: `core/test/perf.test.ts`
- Docs: `docs/superpowers/notes/2026-09-23-scan-performance-measurements.md`

**Interfaces:**
- Produces: gated perf assertion on throughput, not a hang threshold; recorded before/after app numbers.
- Consumes: every earlier task.

- [ ] **Step 1: Tighten the gated perf test**

In `core/test/perf.test.ts`, replace the elapsed assertion with a throughput floor:

```ts
    const filesPerSecond = elapsedMs > 0 ? Math.round((result.filesScanned / elapsedMs) * 1000) : 0;
    expect(filesPerSecond).toBeGreaterThanOrEqual(8_000);
```

Keep the `DUST_PERF=1` gate and the existing console output.

- [ ] **Step 2: Run the gated perf test**

Run: `DUST_PERF=1 npm run test -w core -- test/perf.test.ts`
Expected: PASS with throughput well above 8,000 files/s.

- [ ] **Step 3: Re-run the app instrumentation before/after**

Run the real app bench for the system drive and one browse volume, and record the results:

```bash
npm run build -w app
DUST_BENCH_ROOT="C:/" DUST_BENCH_REPORT="app/.bench-after-c.json" npm run start -w app
DUST_BENCH_ROOT="G:/" DUST_BENCH_MODE=browse DUST_BENCH_REPORT="app/.bench-after-g.json" npm run start -w app
```

Append a "After (perf plan)" table to `docs/superpowers/notes/2026-09-23-scan-performance-measurements.md` with `scanMs`, `finalizeMs`, `totalMs`, and the main-process samples, next to the original baseline table. Note the PowerShell totals (previously ~5s per Analyze) and the finalize duration.

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: core and app suites green; perf test skipped unless gated.

- [ ] **Step 5: Commit**

```bash
git add core/test/perf.test.ts docs/superpowers/notes/2026-09-23-scan-performance-measurements.md
git commit -m "perf(core): gate the perf test on throughput and record after numbers"
```

---

## Self-Review

**Spec coverage:** A1 → Task 1; A2 → Task 2; B → Task 3; C1 → Task 4; C2 → Task 5;
C3 single tree → Task 6; C4 rows once + accumulator release → Task 7; C5 yields/progress/capped IPC → Task 8;
D → Task 9; E cold A/B + drive-aware workers + eager split + queue → Task 10; F gate + numbers → Task 11.
Native enumerator remains a non-goal (spec §3).

**Placeholder scan:** No TBD/TODO; every code step shows the code; every test step shows the test and the expected failure.

**Type consistency:** `createVolumeCache`/`VolumeCache` (Task 1) are reused by Tasks 9-10;
`applyMatchesToRows` (Task 7) is used by Task 8's finalize; `finalize` gains the `runId` parameter in Task 8 and is called from `runAnalysis`;
`measureDirectories` is async from Task 9 and its only host caller is updated in the same task;
`VolumeInfo.mediaType` (Task 10) is consumed by `poolForVolume` in the same task;
`ScanEvent` gains `finalize-progress` (Task 8) and `quick-clean-progress` (Task 9) without breaking existing consumers.
