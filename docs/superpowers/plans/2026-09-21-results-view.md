# Results View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Results view: a Category Summary Strip that fills in live and filters the tree, and a virtualized, sortable, expandable Tree Table with display/action safety grades, streaming folder rows, cluster-rounded Allocated bytes, and Windows Explorer reveal — working both during/after a scan and from the persisted snapshot after relaunch.

**Architecture:** Three layers of change. (1) `core/` gains per-file cluster-rounded `allocatedBytes` through the whole scan pipeline (enumerator → legacy scanner and worker protocol/coordinator → `FolderRecord`/`AggregateTree`) and a v2 snapshot schema that persists `allocatedBytes` plus per-path rule matches. (2) `app/src/main/` gains an Electron-free results read model (`results.ts`), the engine host retains the last run's full rows/categories and streams throttled `folders`/`categories` events plus a final `matches` event, and `getResults` serves live rows or rebuilds a depth-limited view from the snapshot. (3) `app/renderer/` gains a pure tree store (`tree.ts`), a TanStack Table + react-virtual `TreeTable`, a `CategoryStrip`, and a `ResultsView` wired into the Dashboard ("View results") and the live Scan view. Deletion stays out of scope: Plan 9 owns the cleaner, plan tokens, Quick Clean and Dev Cleanup.

**Tech Stack:** TypeScript (strict, ESM), Electron 44, React 19, Vite 7, Tailwind 4, vitest 3 (node + jsdom projects), `@testing-library/react` 16, `@tanstack/react-table` 8, `@tanstack/react-virtual` 3, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-17-dust-mvp-design.md` (Sections 2, 4.1, 4.5, 5.1, 5.2, 7.1, 7.4, 7.5, 8, 9, 10)

## Global Constraints

- **Base branch:** `plan-7-app-shell-engine-host` at `4296810` (contains Plans 1-7). If it has merged to `master` by execution time, branch from `master` instead — whichever tree contains `app/src/main/host/engine-host.ts` and `core/src/snapshot/`. Create the worktree per the `superpowers:using-git-worktrees` skill: `git -C F:\Dust worktree add .worktrees/results-view -b plan-8-results-view plan-7-app-shell-engine-host`, then run `npm install` inside the worktree. This plan document lives on the master working tree at `F:\Dust\docs\superpowers\plans\2026-09-21-results-view.md`; copy it into the worktree (`Copy-Item F:\Dust\docs\superpowers\plans\2026-09-21-results-view.md .\docs\superpowers\plans\`) so the branch carries it.
- Platform: Windows first; commands run in PowerShell 7 from the worktree root. Node >= 20.19. TypeScript strict. ESM everywhere (`"type": "module"`).
- **`core/` stays Electron-free** and runs under vitest in plain Node.
- Renderer security is not negotiable: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the renderer imports **no Node built-ins** (no `node:path`, no `process`), touches no filesystem, and reaches the engine only through `window.dust`. Path handling in the renderer is string-only (`app/renderer/src/tree.ts`).
- **Nothing in this plan deletes a file.** `Cleaner`, plan tokens, Quick Clean, Dev Cleanup and the row-level Clean button are Plan 9. The Action column renders Explore only; rows already carry `action` so Plan 9 only adds the button.
- Display grades are informational and computed in the main process with `classifyDisplayGrade` (core). The cleaner never consults display grades (existing `core/test/display-grade.test.ts` enforces that `core/src/cleaner/` never imports `display/`).
- Snapshot enum policy (Plan 6 final-review ruling FR-4): strict enum validation stays. `SNAPSHOT_SCHEMA_VERSION` bumps **1 → 2** in Task 2 because `SnapshotFolder.allocatedBytes` and `SnapshotData.matches` are new required fields. Old v1 snapshots surface as `corrupt`/`schema-version` and prompt a rescan — never crash.
- Pin `@tanstack/react-table` to v8 (`^8.21.3`): v9 changed its API and is out of scope. Pin `@tanstack/react-virtual` to `^3.14.13`. Do not upgrade Vite past 7 or vitest past 3.
- Renderer tests alias `@tanstack/react-virtual` to `app/test/renderer/virtual-mock.ts` so rows render deterministically in jsdom; real virtualization is covered by the manual smoke checklist.
- No comments in source files. Keep code self-describing; rationale lives in this plan.
- Commit after every task. Before each commit run the full suites from the worktree root: `npm run test` and `npm run typecheck` (both fan out to `core` and `app`).

---

## File Structure

**Modified in `core/`:**

- `core/src/system/cluster.ts` — **create**: `DEFAULT_CLUSTER_SIZE`, `roundUpToCluster`, `volumeClusterSize`.
- `core/src/model/types.ts` — **modify**: `FolderRecord.allocatedBytes`.
- `core/src/model/tree.ts` — **modify**: copy `allocatedBytes` in `addFolder`/`ensure`.
- `core/src/scanner/dir-scan.ts` — **modify**: `clusterSize` context, `directAllocatedBytes`.
- `core/src/scanner/scanner.ts` — **modify**: `clusterSize` config, allocated rollup.
- `core/src/scanner/session.ts` — **modify**: `SessionOptions.clusterSize`, default `volumeClusterSize(root)`.
- `core/src/scan/protocol.ts` — **modify**: `PROTOCOL_VERSION = 2`, `WorkerInit.clusterSize`, `DirOpen.directAllocatedBytes`.
- `core/src/scan/worker-scan.ts`, `worker-runtime.ts`, `worker-entry.ts` — **modify**: plumb `clusterSize`/`directAllocatedBytes`.
- `core/src/scan/coordinator.ts` — **modify**: allocated accumulator and rollup.
- `core/src/snapshot/schema.ts` — **modify**: v2, `SnapshotFolder.allocatedBytes`, `SnapshotMatch`, `SnapshotData.matches`, validators.
- `core/src/snapshot/build.ts` — **modify**: `SnapshotInput.matches`, copy `allocatedBytes`.
- `core/src/index.ts` — **modify**: export the cluster helpers and `SnapshotMatch`.

**New/modified in `app/`:**

- `app/src/shared/categories.ts` — **create**: `CATEGORY_ORDER`, `CATEGORY_LABELS`, `isCategoryId`.
- `app/src/shared/ipc.ts` — **modify**: `resultsGet`/`revealPath` channels, `ResultRow`/`ResultAction`/`ResultMatch`/`CategorySummaryRow`/`ResultsState`, `folders`/`categories`/`matches` scan events, `DustApi.getResults`/`revealPath`.
- `app/src/main/host/results.ts` — **create**: `sameRoot`, `ResultsEnv`, `toResultRow`, `buildRowsFromTree`, `buildRowsFromSnapshot`, `summarizeCategories`.
- `app/src/main/host/engine-host.ts` — **modify**: retained results, `getResults`, live folder/category streaming, memoized recycle-bin enumeration.
- `app/src/main/ipc.ts` — **modify**: register `resultsGet`/`revealPath`, `ShellActions`.
- `app/src/main/index.ts` — **modify**: pass `shell.openPath` as the reveal action.
- `app/src/preload/index.ts` — **modify**: bridge the two new methods.
- `app/renderer/src/tree.ts` — **create**: pure row store, flatten/sort/filter helpers.
- `app/renderer/src/components/CategoryStrip.tsx` — **create**.
- `app/renderer/src/components/TreeTable.tsx` — **create**.
- `app/renderer/src/pages/ResultsView.tsx` — **create**.
- `app/renderer/src/pages/Dashboard.tsx`, `components/DiskCard.tsx`, `pages/ScanView.tsx`, `App.tsx` — **modify**: navigation and the live table.
- `app/vitest.config.ts`, `app/package.json`, `app/test/renderer/virtual-mock.ts`, `app/test/renderer/fakes.ts`, `app/test/setup.ts` — **modify**: deps, alias, fakes, jsdom setup.
- Tests: `core/test/cluster.test.ts` (create) plus listed modifications; `app/test/results.test.ts`, `app/test/renderer/tree.test.ts`, `app/test/renderer/category-strip.test.tsx`, `app/test/renderer/tree-table.test.tsx`, `app/test/renderer/results-view.test.tsx` (create) plus listed modifications.
- `app/README.md` — **modify**: smoke checklist for the Results view.

---

### Task 1: Cluster-rounded allocated bytes through the scan pipeline

**Files:**
- Create: `core/src/system/cluster.ts`, `core/test/cluster.test.ts`
- Modify: `core/src/model/types.ts`, `core/src/model/tree.ts`, `core/src/scanner/dir-scan.ts`, `core/src/scanner/scanner.ts`, `core/src/scanner/session.ts`, `core/src/scan/protocol.ts`, `core/src/scan/worker-scan.ts`, `core/src/scan/worker-runtime.ts`, `core/src/scan/worker-entry.ts`, `core/src/scan/coordinator.ts`, `core/src/index.ts`
- Modify tests: `core/test/tree.test.ts`, `core/test/dir-scan.test.ts`, `core/test/scanner.test.ts`, `core/test/session.test.ts`, `core/test/coordinator.test.ts`, `core/test/coordinator-failure.test.ts`, `core/test/worker-scan.test.ts`, `core/test/worker-runtime.test.ts`, `core/test/projects-classify.test.ts`, `core/test/projects-discover.test.ts`, `core/test/rule-npm-projects.test.ts`, `core/test/rule-system-temp.test.ts`, `core/test/smoke.test.ts`

**Interfaces:**
- Consumes: `node:fs` `statfsSync`, `node:path` (unchanged elsewhere).
- Produces: `DEFAULT_CLUSTER_SIZE = 4096`; `roundUpToCluster(bytes: number, clusterSize: number): number`; `volumeClusterSize(root: string): number`. `FolderRecord` gains `allocatedBytes: number`. `SessionOptions`/`ScanConfig`/`DirScanContext`/`WorkerScanContext`/`WorkerRuntimeDeps` gain `clusterSize`; `DirScanResult`/`DirOpen` gain `directAllocatedBytes`; `WorkerInit` gains `clusterSize`; `PROTOCOL_VERSION` becomes `2`.

- [ ] **Step 1: Write the failing cluster test**

`core/test/cluster.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { roundUpToCluster, volumeClusterSize } from '../src/system/cluster';

describe('roundUpToCluster', () => {
  it('rounds file sizes up to whole clusters', () => {
    expect(roundUpToCluster(0, 4096)).toBe(0);
    expect(roundUpToCluster(1, 4096)).toBe(4096);
    expect(roundUpToCluster(4096, 4096)).toBe(4096);
    expect(roundUpToCluster(4097, 4096)).toBe(8192);
  });

  it('falls back to 4096 for invalid cluster sizes', () => {
    expect(roundUpToCluster(1, 0)).toBe(4096);
    expect(roundUpToCluster(5000, Number.NaN)).toBe(8192);
  });
});

describe('volumeClusterSize', () => {
  it('falls back to 4096 when the volume cannot be queried', () => {
    expect(volumeClusterSize('Q:\\definitely-not-a-volume')).toBe(4096);
  });

  it('returns a positive cluster size for the current drive', () => {
    expect(volumeClusterSize(process.cwd())).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w core -- test/cluster.test.ts`
Expected: FAIL — `Failed to resolve import "../src/system/cluster"`.

- [ ] **Step 3: Create `core/src/system/cluster.ts`**

```ts
import { statfsSync } from 'node:fs';

export const DEFAULT_CLUSTER_SIZE = 4096;

export function roundUpToCluster(bytes: number, clusterSize: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  const cluster = Number.isFinite(clusterSize) && clusterSize > 0 ? clusterSize : DEFAULT_CLUSTER_SIZE;
  return Math.ceil(bytes / cluster) * cluster;
}

export function volumeClusterSize(root: string): number {
  try {
    const stats = statfsSync(root);
    return Number.isFinite(stats.bsize) && stats.bsize > 0 ? stats.bsize : DEFAULT_CLUSTER_SIZE;
  } catch {
    return DEFAULT_CLUSTER_SIZE;
  }
}
```

- [ ] **Step 4: Run the cluster test to verify it passes**

Run: `npm run test -w core -- test/cluster.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add `allocatedBytes` to the model and tree**

`core/src/model/types.ts` — replace `FolderRecord` with:

```ts
export interface FolderRecord {
  path: string;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
  linkCount: number;
  newestMtimeMs: number;
  errorCount: number;
  partial: boolean;
}
```

`core/src/model/tree.ts` — in `addFolder`, add `node.allocatedBytes = record.allocatedBytes;` after `node.bytes = record.bytes;`; in `ensure`, add `allocatedBytes: 0,` after `bytes: 0,`.

- [ ] **Step 6: Plumb cluster size and allocated bytes through the legacy scanner**

`core/src/scanner/dir-scan.ts` — add the import at the top:

```ts
import { DEFAULT_CLUSTER_SIZE, roundUpToCluster } from '../system/cluster';
```

Add `clusterSize?: number;` to `DirScanContext`; add `directAllocatedBytes: number;` to `DirScanResult` directly after `directBytes: number;`. Initialize `directAllocatedBytes: 0,` in the `result` literal. At the top of the function (right after `const result = ...`), add:

```ts
  const clusterSize = ctx.clusterSize ?? DEFAULT_CLUSTER_SIZE;
```

In the `entry.kind === 'file'` branch, after `result.directBytes += entry.size;` add:

```ts
      result.directAllocatedBytes += roundUpToCluster(entry.size, clusterSize);
```

`core/src/scanner/scanner.ts` — add `clusterSize?: number;` to `ScanConfig`. In `scanDir`, add `clusterSize: config.clusterSize,` to the `scanDirectory(dir, trackMtime, { ... })` context. Replace `let bytes = result.directBytes;` with:

```ts
  let bytes = result.directBytes;
  let allocatedBytes = result.directAllocatedBytes;
```

In the child loop, after `bytes += child.bytes;` add `allocatedBytes += child.allocatedBytes;`. Add `allocatedBytes,` to the returned record. Add `allocatedBytes: 0,` to the synthetic link record and to `emptyRecord`.

`core/src/scanner/session.ts` — import `volumeClusterSize` from `../system/cluster`. Add `clusterSize?: number;` to `SessionOptions`. In `start()`, after `const root = normalizeRoot(this.options.root);` add:

```ts
    const clusterSize = this.options.clusterSize ?? volumeClusterSize(root);
```

Pass it to the legacy path: `return this.startLegacy(startedAt, tree, isExcluded, root, clusterSize);` and change `startLegacy` to accept `clusterSize: number` with `clusterSize,` added to the `scanTree({ ... })` call. In the pooled path, add `clusterSize,` to the `createNodeWorkerTransport({ ... })` init object. Add `allocatedBytes: 0,` to the synthetic pre-start-cancel record (the one built when `this.controller.signal.aborted` is true).

- [ ] **Step 7: Plumb cluster size and allocated bytes through the worker pool**

`core/src/scan/protocol.ts`:

```ts
export const PROTOCOL_VERSION = 2;
```

Add `clusterSize: number;` to `WorkerInit` after `limits`. Add `directAllocatedBytes: number;` to `DirOpen` directly after `directBytes: number;`.

`core/src/scan/worker-scan.ts` — add `clusterSize: number;` to `WorkerScanContext`; pass `clusterSize: ctx.clusterSize,` in the `scanDirectory` context; add `directAllocatedBytes: result.directAllocatedBytes,` to the `ctx.openDir({ ... })` literal after `directBytes`.

`core/src/scan/worker-runtime.ts` — add `clusterSize: number;` to `WorkerRuntimeDeps`; add `clusterSize: deps.clusterSize,` to the `scanTask(path, isRoot, { ... })` context.

`core/src/scan/worker-entry.ts` — add `clusterSize: init.clusterSize,` to the `createWorkerRuntime({ ... })` deps.

`core/src/scan/coordinator.ts` — add `directAllocatedBytes: number;` to `Accumulator` after `directBytes` and `sumAllocated: number;` after `sumBytes`. In `onDirOpen`, after `accumulator.directBytes = open.directBytes;` add `accumulator.directAllocatedBytes = open.directAllocatedBytes;`. In `tryFinalize`, after `parent.sumBytes += record.bytes;` add `parent.sumAllocated += record.allocatedBytes;`. In `buildRecord`, add `allocatedBytes: accumulator.directAllocatedBytes + accumulator.sumAllocated,` after `bytes`. In `ensure`, initialize both new fields to `0`.

- [ ] **Step 8: Export the helpers and update the existing test fixtures**

`core/src/index.ts` — append:

```ts
export { DEFAULT_CLUSTER_SIZE, roundUpToCluster, volumeClusterSize } from './system/cluster';
```

Mechanical fixture updates so the workspace compiles (every `FolderRecord` literal gains `allocatedBytes: 0`, every `DirOpen` literal gains `directAllocatedBytes: 0`):

- `core/test/tree.test.ts`: add `allocatedBytes: 0,` after `bytes: 0,` in the `record()` helper. In the first test change the child record to `tree.addFolder(record(child, { bytes: 5, allocatedBytes: 8192, fileCount: 1 }));` and add `expect(tree.get(child)?.allocatedBytes).toBe(8192);`.
- `core/test/projects-classify.test.ts`, `core/test/projects-discover.test.ts`, `core/test/rule-npm-projects.test.ts`, `core/test/rule-system-temp.test.ts`: add `allocatedBytes: 0,` after `bytes: 0,` (or after `bytes,`) in each local `record()` helper.
- `core/test/coordinator.test.ts`: add `directAllocatedBytes: 0,` after `directBytes: 0,` in `open()`.
- `core/test/coordinator-failure.test.ts`: add `directAllocatedBytes: 0,` after `directBytes: 0,` in `open()`.
- `core/test/worker-scan.test.ts`: add `clusterSize: 4096,` to the `scanTask` context in `run()`.
- `core/test/worker-runtime.test.ts`: add `clusterSize: 4096,` to both `createWorkerRuntime({ ... })` calls; in the expected `dirOpens` literal add `directAllocatedBytes: 4096,` after `directBytes: 5,`.
- `core/test/smoke.test.ts`: add `expect(typeof core.volumeClusterSize).toBe('function');` to the snapshot/volumes block.

- [ ] **Step 9: Add allocated assertions to the existing tests**

`core/test/dir-scan.test.ts` — in `separates direct file stats from child dirs and counts entries`, after `expect(result.directBytes).toBe(12);` add:

```ts
    expect(result.directAllocatedBytes).toBe(8192);
```

Add a new test:

```ts
  it('honors an explicit cluster size for allocated bytes', () => {
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 },
        { name: 'b.txt', kind: 'file', size: 7, mtimeMs: 1000 },
      ],
    });
    const result = scanDirectory(root, true, { enumerator, isExcluded: noneExcluded, clusterSize: 1024 });
    expect(result.directAllocatedBytes).toBe(2048);
  });
```

`core/test/scanner.test.ts` — in `aggregates sizes and counts post-order`, after the `sub` assertion add:

```ts
    expect(sub?.allocatedBytes).toBe(8192);
    expect(stats.rootRecord.allocatedBytes).toBe(3 * 4096);
```

`core/test/session.test.ts` — in `returns a complete result with an aggregated tree`, after the root bytes assertion add:

```ts
    expect(result.tree.get(fixture.root)?.allocatedBytes).toBe(3 * 4096);
```

`core/test/coordinator.test.ts` — in `finalizes children before parents and never streams the root record`, change the three `open(...)` calls to carry allocated bytes:

```ts
    t.emit(batch([open(ROOT, true, { childDirs: [join(ROOT, 'a')], directBytes: 1, directAllocatedBytes: 4096 })]));
    t.emit(batch([open(join(ROOT, 'a'), false, { directBytes: 5, directAllocatedBytes: 4096, directFileCount: 1, childDirs: [join(ROOT, 'a', 'b')] })]));
    t.emit(batch([open(join(ROOT, 'a', 'b'), false, { directBytes: 7, directAllocatedBytes: 4096, directFileCount: 1 })]));
```

and add `allocatedBytes: 12288,` to the `result.rootRecord` expectation.

`core/test/worker-scan.test.ts` — in `opens every directory and never submits when the budget lasts`, after the `rootOpen.childDirs` assertion add:

```ts
    expect(sink.opens.find((o) => o.path === join(root, 'a', 'c'))!.directAllocatedBytes).toBe(8192);
```

- [ ] **Step 10: Run the core suite and typecheck**

Run: `npm run test -w core` then `npm run typecheck -w core`
Expected: all core tests pass, typecheck clean. The pooled/legacy comparison in `core/test/session-pool.test.ts` uses `toEqual` on the root record, so both paths must produce identical `allocatedBytes` — they do because both receive the same `clusterSize`.

- [ ] **Step 11: Commit**

```bash
git add core
git commit -m "feat(core): track cluster-rounded allocated bytes through the scan pipeline"
```

---

### Task 2: Snapshot schema v2 — allocated bytes and persisted rule matches

**Files:**
- Modify: `core/src/snapshot/schema.ts`, `core/src/snapshot/build.ts`, `core/src/index.ts`
- Modify tests: `core/test/snapshot-schema.test.ts`, `core/test/snapshot-build.test.ts`, `core/test/snapshot-store.test.ts`, `core/test/snapshot-pipeline.test.ts`, `core/test/smoke.test.ts`, `app/test/dashboard-state.test.ts`

**Interfaces:**
- Consumes: `FolderRecord.allocatedBytes` (Task 1), `RULES_VERSION`.
- Produces: `SNAPSHOT_SCHEMA_VERSION = 2`; `SnapshotFolder.allocatedBytes: number`; `SnapshotMatch { path; ruleId; category: string; bytes: number; grade: 'safe' | 'review'; evidence: string }`; `SnapshotData.matches: SnapshotMatch[]`; `SnapshotInput.matches?: SnapshotMatch[]`.

- [ ] **Step 1: Write the failing schema tests**

Replace `core/test/snapshot-schema.test.ts` lines 6-46 with:

```ts
function validSnapshot(): SnapshotData {
  return {
    schemaVersion: 2,
    rulesVersion: '1',
    root: 'F:\\synthetic',
    startedAt: 1000,
    finishedAt: 2000,
    status: 'complete',
    cleanedAt: null,
    disks: [{ volume: 'F:\\', totalBytes: 100, freeBytes: 40 }],
    categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 10, items: 2 }],
    projects: [],
    folders: [
      {
        path: 'F:\\synthetic',
        name: 'synthetic',
        bytes: 10,
        allocatedBytes: 4096,
        fileCount: 2,
        folderCount: 0,
        newestMtimeMs: 3000,
        errorCount: 0,
        partial: false,
        complete: true,
        childCount: 0,
      },
    ],
    matches: [
      {
        path: 'F:\\synthetic\\Temp',
        ruleId: 'system-temp',
        category: 'temp',
        bytes: 10,
        grade: 'safe',
        evidence: 'User TEMP directory — junk by definition',
      },
    ],
  };
}

describe('parseSnapshot', () => {
  it('accepts a complete valid snapshot', () => {
    expect(parseSnapshot(JSON.stringify(validSnapshot()))).toEqual(validSnapshot());
  });

  it('rejects garbage, wrong shapes and the wrong schema version', () => {
    for (const raw of ['{oops', '5', 'null', '[]', '{}', '{"schemaVersion": 3}']) {
      expect(() => parseSnapshot(raw), raw).toThrow(SnapshotCorruptError);
    }
    const wrongVersion = { ...validSnapshot(), schemaVersion: 3 };
    expect(() => parseSnapshot(JSON.stringify(wrongVersion))).toThrow(SnapshotCorruptError);
  });

  it('rejects a malformed persisted match', () => {
    const bad = {
      ...validSnapshot(),
      matches: [{ path: 'F:\\x', ruleId: 'system-temp', category: 'temp', bytes: 1, grade: 'maybe', evidence: 'x' }],
    };
    expect(() => parseSnapshot(JSON.stringify(bad))).toThrow(SnapshotCorruptError);
    const missing = { ...validSnapshot(), matches: undefined };
    expect(() => parseSnapshot(JSON.stringify(missing))).toThrow(SnapshotCorruptError);
  });
```

In `rejects entries with bad field types`, after the `badFolders` assertion add:

```ts
    const badAllocated = { ...validSnapshot(), folders: [{ ...validSnapshot().folders[0]!, allocatedBytes: 'lots' }] };
    expect(() => parseSnapshot(JSON.stringify(badAllocated))).toThrow(SnapshotCorruptError);
```

Change the version constant assertion at the end to:

```ts
  it('exposes the current schema version constant', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(2);
  });
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run: `npm run test -w core -- test/snapshot-schema.test.ts`
Expected: FAIL — `allocatedBytes`/`matches` are missing from `SnapshotData` and `SNAPSHOT_SCHEMA_VERSION` is still `1`.

- [ ] **Step 3: Update `core/src/snapshot/schema.ts`**

Change the version:

```ts
export const SNAPSHOT_SCHEMA_VERSION = 2;
```

Add to `SnapshotFolder` after `bytes: number;`:

```ts
  allocatedBytes: number;
```

Add after `SnapshotFolder`:

```ts
export interface SnapshotMatch {
  path: string;
  ruleId: string;
  category: string;
  bytes: number;
  grade: 'safe' | 'review';
  evidence: string;
}
```

Add to `SnapshotData` after `categories: SnapshotCategory[];`:

```ts
  matches: SnapshotMatch[];
```

In `parseSnapshot`, after the `categories` validation block add:

```ts
  if (!Array.isArray(object.matches) || !object.matches.every(isSnapshotMatch)) {
    throw new SnapshotCorruptError('matches');
  }
```

In `isSnapshotFolder`, add `isFiniteNumber(value.allocatedBytes) &&` directly after `isFiniteNumber(value.bytes) &&`. Add after `isSnapshotCategory`:

```ts
function isSnapshotMatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    typeof value.ruleId === 'string' &&
    typeof value.category === 'string' &&
    isFiniteNumber(value.bytes) &&
    (value.grade === 'safe' || value.grade === 'review') &&
    typeof value.evidence === 'string'
  );
}
```

- [ ] **Step 4: Update `core/src/snapshot/build.ts`**

Add `matches?: SnapshotMatch[];` to `SnapshotInput` after `categories`. Add `SnapshotMatch` to the type import block from `./schema`. In `buildSnapshot`, add `matches: input.matches ?? [],` after `categories: input.categories,`. In `buildFolderMap`, add `allocatedBytes: node.allocatedBytes,` after `bytes: node.bytes,`.

- [ ] **Step 5: Export the match type**

`core/src/index.ts` — add `SnapshotMatch` to the snapshot type export block:

```ts
export type {
  ScanStatus,
  SnapshotCategory,
  SnapshotData,
  SnapshotDisk,
  SnapshotFolder,
  SnapshotMatch,
} from './snapshot/schema';
```

- [ ] **Step 6: Update the remaining snapshot tests and the app snapshot fixture**

- `core/test/snapshot-build.test.ts`: change `schemaVersion: 1` to `schemaVersion: 2`; pass `matches: [{ path: join(fixture.root, 'a'), ruleId: 'system-temp', category: 'temp', bytes: 10, grade: 'safe', evidence: 'fixture' }]` in the first `buildSnapshot` input; add `expect(snapshot.matches).toHaveLength(1);` and `expect(snapshot.folders.find((folder) => folder.path === join(fixture.root, 'a'))?.allocatedBytes).toBe(4096);`.
- `core/test/snapshot-store.test.ts`: in `reports save failure instead of throwing when the path is unusable`, change `schemaVersion: 1` to `schemaVersion: 2` and add `matches: [],` after `categories: [],`.
- `core/test/snapshot-pipeline.test.ts`: change `expect(core.SNAPSHOT_SCHEMA_VERSION).toBe(1);` to `toBe(2);`.
- `core/test/smoke.test.ts`: change `expect(core.SNAPSHOT_SCHEMA_VERSION).toBe(1);` to `toBe(2);`.
- `app/test/dashboard-state.test.ts`: change `schemaVersion: 1` to `schemaVersion: 2` and add `matches: [],` after the `categories` line in the `snapshot()` helper.

- [ ] **Step 7: Run the core and app suites**

Run: `npm run test -w core` and `npm run test -w app` and `npm run typecheck`
Expected: all green. `buildSnapshot` supplies `matches: []` by default, so no other snapshot literals need changes.

- [ ] **Step 8: Commit**

```bash
git add core app/test/dashboard-state.test.ts
git commit -m "feat(core): persist allocated bytes and rule matches in snapshot schema v2"
```

---

### Task 3: App shared contract — results IPC, categories, test fakes

**Files:**
- Create: `app/src/shared/categories.ts`, `app/test/renderer/virtual-mock.ts`
- Modify: `app/src/shared/ipc.ts`, `app/src/preload/index.ts`, `app/package.json`, `app/vitest.config.ts`, `app/test/ipc-contract.test.ts`, `app/test/renderer/fakes.ts`

**Interfaces:**
- Consumes: type-only `ActionGrade`, `CategoryId`, `DisplayGrade`, `DriveType` from `@dust/core`.
- Produces: `IPC.resultsGet`/`IPC.revealPath`; `ResultAction`, `ResultMatch`, `ResultRow`, `CategorySummaryRow`, `ResultsState`; `ScanEvent` variants `folders`/`categories`/`matches`; `DustApi.getResults(root)`/`DustApi.revealPath(path)`; `CATEGORY_ORDER`, `CATEGORY_LABELS`, `isCategoryId`. Renderer tests get a deterministic `useVirtualizer` mock plus `makeResultsRows`, `makeCategories`, `makeResultsState`.

- [ ] **Step 1: Add the new dependencies and install**

Run from the worktree root:

```bash
npm install -w app @tanstack/react-table@^8.21.3 @tanstack/react-virtual@^3.14.13
```

Expected: `app/package.json` `dependencies` gains both packages and the lockfile updates.

- [ ] **Step 2: Extend the shared IPC contract**

Replace `app/src/shared/ipc.ts` with:

```ts
import type { ActionGrade, CategoryId, DisplayGrade, DriveType } from '@dust/core';

export const IPC = {
  dashboardGet: 'dust:dashboard:get',
  scanStart: 'dust:scan:start',
  scanCancel: 'dust:scan:cancel',
  scanEvent: 'dust:scan:event',
  resultsGet: 'dust:results:get',
  revealPath: 'dust:shell:reveal',
} as const;

export type ScanKind = 'analyze' | 'quick-clean';

export interface ScanState {
  kind: ScanKind;
  root: string;
  startedAt: number;
}

export interface ScanProgressPayload {
  filesScanned: number;
  bytesSeen: number;
  currentPath: string;
  dirsCompleted: number;
  errors: number;
  elapsedMs: number;
}

export interface ResultAction {
  ruleId: string;
  category: CategoryId;
  grade: ActionGrade;
  evidence: string;
}

export interface ResultMatch extends ResultAction {
  path: string;
  bytes: number;
}

export interface ResultRow {
  path: string;
  name: string;
  parent: string | null;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
  linkCount: number;
  newestMtimeMs: number;
  errorCount: number;
  partial: boolean;
  complete: boolean;
  childCount: number;
  grade: DisplayGrade;
  gradeReason: string;
  action: ResultAction | null;
}

export interface CategorySummaryRow {
  category: CategoryId;
  label: string;
  bytes: number;
  items: number;
  ruleIds: string[];
}

export interface ResultsState {
  source: 'live' | 'snapshot' | 'empty';
  root: string;
  finishedAt: number | null;
  status: 'complete' | 'cancelled' | null;
  rulesStale: boolean;
  depthLimited: boolean;
  categories: CategorySummaryRow[];
  rows: ResultRow[];
}

export type ScanEvent =
  | { type: 'started'; runId: string; root: string; startedAt: number }
  | { type: 'progress'; runId: string; progress: ScanProgressPayload }
  | { type: 'folders'; runId: string; folders: ResultRow[] }
  | { type: 'categories'; runId: string; categories: CategorySummaryRow[] }
  | { type: 'matches'; runId: string; matches: ResultMatch[] }
  | { type: 'finalizing'; runId: string }
  | {
      type: 'finished';
      runId: string;
      status: 'complete' | 'cancelled';
      startedAt: number;
      finishedAt: number;
      filesScanned: number;
      bytesSeen: number;
      errors: number;
      projects: number;
      reclaimableBytes: number;
      saved: boolean;
    }
  | { type: 'failed'; runId: string; message: string };

export type StartAnalyzeResult =
  | { ok: true; runId: string }
  | { ok: false; reason: 'busy'; running: ScanKind }
  | { ok: false; reason: 'invalid-volume'; message: string }
  | { ok: false; reason: 'start-failed'; message: string };

export interface DashboardVolumeCard {
  root: string;
  label: string | null;
  driveType: DriveType;
  external: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  lastAnalyzedAt: number | null;
  lastCleanedAt: number | null;
  reclaimableBytes: number | null;
}

export interface DashboardSnapshotInfo {
  status: 'missing' | 'corrupt' | 'ok';
  reason?: string;
  root: string | null;
  finishedAt: number | null;
  scanStatus: 'complete' | 'cancelled' | null;
  reclaimableBytes: number | null;
  cleanedAt: number | null;
  rulesStale: boolean;
}

export interface DashboardState {
  volumes: DashboardVolumeCard[];
  scan: ScanState | null;
  snapshot: DashboardSnapshotInfo;
}

export interface DustApi {
  getDashboard(): Promise<DashboardState>;
  startAnalyze(volume: string): Promise<StartAnalyzeResult>;
  cancelScan(): Promise<void>;
  getResults(root: string): Promise<ResultsState>;
  revealPath(path: string): Promise<void>;
  onScanEvent(handler: (event: ScanEvent) => void): () => void;
}
```

- [ ] **Step 3: Create `app/src/shared/categories.ts`**

```ts
import type { CategoryId } from '@dust/core';

export const CATEGORY_ORDER: CategoryId[] = ['temp', 'recycle-bin', 'npm-cache', 'app-caches', 'npm-projects'];

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  temp: 'Temp',
  'recycle-bin': 'Recycle Bin',
  'npm-cache': 'npm cache',
  'app-caches': 'App caches',
  'npm-projects': 'npm projects',
};

export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_ORDER as string[]).includes(value);
}
```

- [ ] **Step 4: Update the preload bridge**

Replace `app/src/preload/index.ts` with:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { DashboardState, DustApi, ResultsState, ScanEvent, StartAnalyzeResult } from '../shared/ipc';

const api: DustApi = {
  getDashboard: () => ipcRenderer.invoke(IPC.dashboardGet) as Promise<DashboardState>,
  startAnalyze: (volume: string) => ipcRenderer.invoke(IPC.scanStart, volume) as Promise<StartAnalyzeResult>,
  cancelScan: () => ipcRenderer.invoke(IPC.scanCancel) as Promise<void>,
  getResults: (root: string) => ipcRenderer.invoke(IPC.resultsGet, root) as Promise<ResultsState>,
  revealPath: (path: string) => ipcRenderer.invoke(IPC.revealPath, path) as Promise<void>,
  onScanEvent: (handler: (event: ScanEvent) => void) => {
    const listener = (_event: unknown, payload: ScanEvent) => handler(payload);
    ipcRenderer.on(IPC.scanEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC.scanEvent, listener);
    };
  },
};

contextBridge.exposeInMainWorld('dust', api);
```

- [ ] **Step 5: Update the IPC contract test**

`app/test/ipc-contract.test.ts` — change `expect(channels).toHaveLength(4);` to `expect(channels).toHaveLength(6);`.

- [ ] **Step 6: Add the jsdom virtualizer mock and alias**

Create `app/test/renderer/virtual-mock.ts`:

```ts
export interface MockVirtualItem {
  index: number;
  key: string | number;
  start: number;
  size: number;
  end: number;
  lane: number;
}

export function useVirtualizer(options: { count: number; estimateSize: (index: number) => number }) {
  const items: MockVirtualItem[] = [];
  let start = 0;
  for (let index = 0; index < options.count; index += 1) {
    const size = options.estimateSize(index);
    items.push({ index, key: index, start, size, end: start + size, lane: 0 });
    start += size;
  }
  return {
    getTotalSize: () => start,
    getVirtualItems: () => items,
    measureElement: () => {},
  };
}
```

`app/vitest.config.ts` — replace the whole file with:

```ts
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'host',
          environment: 'node',
          include: ['test/*.test.ts'],
        },
      },
      {
        extends: true,
        resolve: {
          alias: {
            '@tanstack/react-virtual': fileURLToPath(new URL('./test/renderer/virtual-mock.ts', import.meta.url)),
          },
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['test/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['test/setup.ts'],
        },
      },
    ],
  },
});
```

- [ ] **Step 7: Extend the renderer test fakes**

Replace `app/test/renderer/fakes.ts` with:

```ts
import type { CategorySummaryRow, DashboardState, DustApi, ResultRow, ResultsState } from '../../src/shared/ipc';

export function makeResultsRows(): ResultRow[] {
  const root = 'C:\\';
  return [
    {
      path: root,
      name: root,
      parent: null,
      bytes: 1024 * 1024,
      allocatedBytes: 2 * 1024 * 1024,
      fileCount: 10,
      folderCount: 2,
      linkCount: 0,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: false,
      complete: true,
      childCount: 2,
      grade: 'danger',
      gradeReason: 'System-critical — read-only',
      action: null,
    },
    {
      path: 'C:\\Users',
      name: 'Users',
      parent: root,
      bytes: 512 * 1024,
      allocatedBytes: 1024 * 1024,
      fileCount: 6,
      folderCount: 1,
      linkCount: 0,
      newestMtimeMs: Date.UTC(2026, 0, 1),
      errorCount: 0,
      partial: false,
      complete: true,
      childCount: 1,
      grade: 'review',
      gradeReason: 'Unrecognized folder — review before deleting',
      action: null,
    },
    {
      path: 'C:\\Users\\x',
      name: 'x',
      parent: 'C:\\Users',
      bytes: 128 * 1024,
      allocatedBytes: 256 * 1024,
      fileCount: 2,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: Date.UTC(2026, 0, 1),
      errorCount: 0,
      partial: false,
      complete: true,
      childCount: 0,
      grade: 'review',
      gradeReason: 'Unrecognized folder — review before deleting',
      action: null,
    },
    {
      path: 'C:\\Temp',
      name: 'Temp',
      parent: root,
      bytes: 256 * 1024,
      allocatedBytes: 512 * 1024,
      fileCount: 4,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: Date.UTC(2026, 0, 2),
      errorCount: 0,
      partial: false,
      complete: true,
      childCount: 0,
      grade: 'safe',
      gradeReason: 'Temporary files — apps recreate them as needed',
      action: {
        ruleId: 'system-temp',
        category: 'temp',
        grade: 'safe',
        evidence: 'User TEMP directory — junk by definition',
      },
    },
  ];
}

export function makeCategories(): CategorySummaryRow[] {
  return [
    { category: 'temp', label: 'Temp', bytes: 256 * 1024, items: 1, ruleIds: ['system-temp'] },
    { category: 'recycle-bin', label: 'Recycle Bin', bytes: 0, items: 0, ruleIds: [] },
    { category: 'npm-cache', label: 'npm cache', bytes: 0, items: 0, ruleIds: [] },
    { category: 'app-caches', label: 'App caches', bytes: 0, items: 0, ruleIds: [] },
    { category: 'npm-projects', label: 'npm projects', bytes: 0, items: 0, ruleIds: [] },
  ];
}

export function makeResultsState(overrides: Partial<ResultsState> = {}): ResultsState {
  return {
    source: 'snapshot',
    root: 'C:\\',
    finishedAt: Date.UTC(2026, 0, 2),
    status: 'complete',
    rulesStale: false,
    depthLimited: true,
    categories: makeCategories(),
    rows: makeResultsRows(),
    ...overrides,
  };
}

export function makeDashboardState(overrides: Partial<DashboardState> = {}): DashboardState {
  const finishedAt = Date.UTC(2026, 0, 2);
  return {
    volumes: [
      {
        root: 'C:\\',
        label: 'System',
        driveType: 'fixed',
        external: false,
        totalBytes: 1024 ** 3,
        freeBytes: 512 * 1024 ** 2,
        lastAnalyzedAt: finishedAt,
        lastCleanedAt: null,
        reclaimableBytes: 512 * 1024 ** 2,
      },
      {
        root: 'E:\\',
        label: null,
        driveType: 'removable',
        external: true,
        totalBytes: 64 * 1024 ** 3,
        freeBytes: 60 * 1024 ** 3,
        lastAnalyzedAt: null,
        lastCleanedAt: null,
        reclaimableBytes: null,
      },
    ],
    scan: null,
    snapshot: {
      status: 'ok',
      root: 'C:\\',
      finishedAt,
      scanStatus: 'complete',
      reclaimableBytes: 512 * 1024 ** 2,
      cleanedAt: null,
      rulesStale: false,
    },
    ...overrides,
  };
}

export function makeApi(overrides: Partial<DustApi> = {}): DustApi {
  return {
    getDashboard: async () => makeDashboardState(),
    startAnalyze: async () => ({ ok: true, runId: 'run-1' }),
    cancelScan: async () => {},
    getResults: async () => makeResultsState(),
    revealPath: async () => {},
    onScanEvent: () => () => {},
    ...overrides,
  };
}
```

- [ ] **Step 8: Run typecheck and the contract test**

Run: `npm run typecheck -w app` then `npm run test -w app -- test/ipc-contract.test.ts`
Expected: typecheck clean (the preload bridge from Step 4 satisfies `DustApi`); contract test PASS.

- [ ] **Step 9: Commit**

```bash
git add app/package.json package-lock.json app/src/shared app/src/preload/index.ts app/vitest.config.ts app/test/ipc-contract.test.ts app/test/renderer/fakes.ts app/test/renderer/virtual-mock.ts
git commit -m "feat(app): add results IPC contract and renderer test harness"
```

---

### Task 4: Main-process results builders

**Files:**
- Create: `app/src/main/host/results.ts`, `app/test/results.test.ts`

**Interfaces:**
- Consumes: `classifyDisplayGrade`, `AggregateTree`, `SnapshotData` from `@dust/core`; `CategoryId`, `ResultAction`, `ResultMatch`, `ResultRow`, `CategorySummaryRow` from Task 3; `CATEGORY_LABELS`/`CATEGORY_ORDER`/`isCategoryId` from Task 3.
- Produces: `sameRoot(a, b): boolean`; `ResultsEnv { systemRoot?; programData?; userProfile? }`; `RowInput`; `RowOptions`; `toResultRow(record, options): ResultRow`; `buildRowsFromTree(tree, root, matches, env?): ResultRow[]`; `buildRowsFromSnapshot(snapshot, env?): ResultRow[]`; `summarizeCategories(categories): CategorySummaryRow[]` (always five rows in `CATEGORY_ORDER`).

- [ ] **Step 1: Write the failing tests**

`app/test/results.test.ts`:

```ts
import { join } from 'node:path';
import { AggregateTree } from '@dust/core';
import type { FolderRecord, SnapshotData } from '@dust/core';
import { describe, expect, it } from 'vitest';
import {
  buildRowsFromSnapshot,
  buildRowsFromTree,
  sameRoot,
  summarizeCategories,
  toResultRow,
} from '../src/main/host/results';
import type { ResultMatch } from '../src/shared/ipc';

const ENV = { systemRoot: 'C:\\Windows', programData: 'C:\\ProgramData', userProfile: 'C:\\Users\\x' };

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

const root = 'C:\\Users\\x';

describe('sameRoot', () => {
  it('compares roots case-insensitively and ignores trailing separators', () => {
    expect(sameRoot('C:\\', 'c:\\')).toBe(true);
    expect(sameRoot('C:\\Users\\x\\', 'c:\\users\\x')).toBe(true);
    expect(sameRoot('C:\\Users\\x', 'C:\\Users\\y')).toBe(false);
  });
});

describe('toResultRow', () => {
  it('grades a volume root as danger and names the scanned root by its full path', () => {
    const row = toResultRow(record('C:\\', { bytes: 5, allocatedBytes: 4096 }), {
      root: 'C:\\',
      complete: true,
      childCount: 2,
      env: ENV,
    });
    expect(row).toMatchObject({ name: 'C:\\', parent: null, grade: 'danger' });
  });

  it('grades temp paths safe and unknown paths review', () => {
    const temp = toResultRow(record('C:\\Users\\x\\AppData\\Local\\Temp', { bytes: 10 }), {
      root,
      complete: true,
      childCount: 0,
      env: ENV,
    });
    const unknown = toResultRow(record('C:\\Users\\x\\mystery', { bytes: 10 }), {
      root,
      complete: true,
      childCount: 0,
      env: ENV,
    });
    expect(temp.grade).toBe('safe');
    expect(unknown.grade).toBe('review');
    expect(temp.parent).toBe('C:\\Users\\x\\AppData\\Local');
    expect(temp.name).toBe('Temp');
  });

  it('keeps an explicit action override', () => {
    const action = { ruleId: 'system-temp', category: 'temp' as const, grade: 'safe' as const, evidence: 'fixture' };
    const row = toResultRow(record('C:\\Users\\x\\AppData\\Local\\Temp'), {
      root,
      complete: true,
      childCount: 0,
      action,
      env: ENV,
    });
    expect(row.action).toEqual(action);
  });
});

describe('buildRowsFromTree', () => {
  it('walks the scanned root breadth-first and attaches matches by path', () => {
    const tree = new AggregateTree();
    tree.addFolder(record(join(root, 'proj', 'node_modules'), { bytes: 100, allocatedBytes: 4096 }));
    tree.addFolder(record(join(root, 'proj'), { bytes: 100, allocatedBytes: 4096 }));
    tree.addFolder(record(root, { bytes: 100, allocatedBytes: 4096, folderCount: 2 }));
    const matches: ResultMatch[] = [
      {
        path: join(root, 'proj', 'node_modules'),
        bytes: 100,
        ruleId: 'npm-project-modules',
        category: 'npm-projects',
        grade: 'safe',
        evidence: 'Project · Dead',
      },
    ];

    const rows = buildRowsFromTree(tree, root, matches, ENV);

    expect(rows.map((row) => row.path)).toEqual([
      root,
      join(root, 'proj'),
      join(root, 'proj', 'node_modules'),
    ]);
    expect(rows[2]!.action).toMatchObject({ ruleId: 'npm-project-modules', category: 'npm-projects' });
    expect(rows[0]!.parent).toBeNull();
    expect(rows[1]!.parent).toBe(root);
  });
});

describe('buildRowsFromSnapshot', () => {
  it('reattaches rows whose parent is outside the depth-limited map', () => {
    const snapshot: SnapshotData = {
      schemaVersion: 2,
      rulesVersion: '1',
      root: 'C:\\',
      startedAt: 1,
      finishedAt: 2,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [],
      projects: [],
      matches: [
        {
          path: 'C:\\deep\\a\\b',
          ruleId: 'system-temp',
          category: 'temp',
          bytes: 5,
          grade: 'safe',
          evidence: 'fixture',
        },
      ],
      folders: [
        { path: 'C:\\', name: 'C:\\', bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 2, newestMtimeMs: 0, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: 'C:\\deep', name: 'deep', bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 1, newestMtimeMs: 0, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: 'C:\\deep\\a\\b', name: 'b', bytes: 5, allocatedBytes: 4096, fileCount: 1, folderCount: 0, newestMtimeMs: 0, errorCount: 0, partial: false, complete: true, childCount: 0 },
      ],
    };

    const rows = buildRowsFromSnapshot(snapshot, ENV);
    const byPath = new Map(rows.map((row) => [row.path, row]));

    expect(byPath.get('C:\\')?.parent).toBeNull();
    expect(byPath.get('C:\\deep\\a\\b')?.parent).toBe('C:\\deep');
    expect(byPath.get('C:\\deep\\a\\b')?.action).toMatchObject({ ruleId: 'system-temp' });
    expect(byPath.get('C:\\deep\\a\\b')?.grade).toBe('safe');
  });
});

describe('summarizeCategories', () => {
  it('rolls rules up per category in fixed order and keeps empty rows', () => {
    const rows = summarizeCategories([
      { ruleId: 'cache-chrome', category: 'app-caches', bytes: 10, items: 1 },
      { ruleId: 'cache-edge', category: 'app-caches', bytes: 5, items: 2 },
      { ruleId: 'system-temp', category: 'temp', bytes: 7, items: 1 },
      { ruleId: 'mystery', category: 'nonsense', bytes: 99, items: 9 },
    ]);

    expect(rows.map((row) => row.category)).toEqual([
      'temp',
      'recycle-bin',
      'npm-cache',
      'app-caches',
      'npm-projects',
    ]);
    expect(rows[0]).toMatchObject({ label: 'Temp', bytes: 7, items: 1 });
    expect(rows[3]).toMatchObject({ label: 'App caches', bytes: 15, items: 3, ruleIds: ['cache-chrome', 'cache-edge'] });
    expect(rows[1]).toMatchObject({ bytes: 0, items: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/results.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/host/results"`.

- [ ] **Step 3: Create `app/src/main/host/results.ts`**

```ts
import { basename, dirname } from 'node:path';
import { classifyDisplayGrade } from '@dust/core';
import type { AggregateTree, CategoryId, SnapshotData } from '@dust/core';
import { CATEGORY_LABELS, CATEGORY_ORDER, isCategoryId } from '../../shared/categories';
import type { CategorySummaryRow, ResultAction, ResultMatch, ResultRow } from '../../shared/ipc';

export interface ResultsEnv {
  systemRoot?: string;
  programData?: string;
  userProfile?: string;
}

export interface RowInput {
  path: string;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
  linkCount: number;
  newestMtimeMs: number;
  errorCount: number;
  partial: boolean;
}

export interface RowOptions {
  root: string;
  complete: boolean;
  childCount: number;
  action?: ResultAction | null;
  parent?: string | null;
  env?: ResultsEnv;
}

export function sameRoot(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function toResultRow(record: RowInput, options: RowOptions): ResultRow {
  const isRoot = sameRoot(record.path, options.root);
  const display = classifyDisplayGrade(record.path, { env: options.env ?? {} });
  const parent = options.parent !== undefined ? options.parent : isRoot ? null : dirname(record.path);
  return {
    path: record.path,
    name: isRoot ? record.path : basename(record.path),
    parent,
    bytes: record.bytes,
    allocatedBytes: record.allocatedBytes,
    fileCount: record.fileCount,
    folderCount: record.folderCount,
    linkCount: record.linkCount,
    newestMtimeMs: record.newestMtimeMs,
    errorCount: record.errorCount,
    partial: record.partial,
    complete: options.complete,
    childCount: options.childCount,
    grade: display.grade,
    gradeReason: display.reason,
    action: options.action ?? null,
  };
}

export function buildRowsFromTree(
  tree: AggregateTree,
  root: string,
  matches: ResultMatch[],
  env?: ResultsEnv,
): ResultRow[] {
  const actions = new Map<string, ResultAction>();
  for (const match of matches) {
    actions.set(pathKey(match.path), {
      ruleId: match.ruleId,
      category: match.category,
      grade: match.grade,
      evidence: match.evidence,
    });
  }

  const rows: ResultRow[] = [];
  const queue: string[] = [root];
  let head = 0;
  while (head < queue.length) {
    const path = queue[head]!;
    head += 1;
    const node = tree.get(path);
    if (!node) continue;
    rows.push(
      toResultRow(node, {
        root,
        complete: node.complete,
        childCount: tree.children(path).length,
        action: actions.get(pathKey(path)) ?? null,
        env,
      }),
    );
    for (const child of tree.children(path)) queue.push(child.path);
  }
  return rows;
}

export function buildRowsFromSnapshot(snapshot: SnapshotData, env?: ResultsEnv): ResultRow[] {
  const foldersByPath = new Set(snapshot.folders.map((folder) => pathKey(folder.path)));
  const actions = new Map<string, ResultAction>();
  for (const match of snapshot.matches) {
    if (!isCategoryId(match.category)) continue;
    actions.set(pathKey(match.path), {
      ruleId: match.ruleId,
      category: match.category,
      grade: match.grade,
      evidence: match.evidence,
    });
  }

  return snapshot.folders.map((folder) => {
    const isRoot = sameRoot(folder.path, snapshot.root);
    return toResultRow(
      { ...folder, linkCount: 0 },
      {
        root: snapshot.root,
        complete: folder.complete,
        childCount: folder.childCount,
        action: actions.get(pathKey(folder.path)) ?? null,
        parent: isRoot ? null : nearestIncludedParent(folder.path, snapshot.root, foldersByPath),
        env,
      },
    );
  });
}

export function summarizeCategories(
  categories: ReadonlyArray<{ ruleId: string; category: string; bytes: number; items: number }>,
): CategorySummaryRow[] {
  const byCategory = new Map<CategoryId, CategorySummaryRow>();
  for (const entry of categories) {
    if (!isCategoryId(entry.category)) continue;
    const existing = byCategory.get(entry.category);
    if (existing) {
      existing.bytes += entry.bytes;
      existing.items += entry.items;
      if (!existing.ruleIds.includes(entry.ruleId)) existing.ruleIds.push(entry.ruleId);
    } else {
      byCategory.set(entry.category, {
        category: entry.category,
        label: CATEGORY_LABELS[entry.category],
        bytes: entry.bytes,
        items: entry.items,
        ruleIds: [entry.ruleId],
      });
    }
  }
  return CATEGORY_ORDER.map(
    (category) =>
      byCategory.get(category) ?? { category, label: CATEGORY_LABELS[category], bytes: 0, items: 0, ruleIds: [] },
  );
}

function nearestIncludedParent(path: string, root: string, folders: Set<string>): string | null {
  let current = dirname(path);
  while (current.length > 0) {
    if (folders.has(pathKey(current))) return current;
    if (sameRoot(current, root)) return null;
    const next = dirname(current);
    if (next === current) return null;
    current = next;
  }
  return null;
}

function pathKey(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w app -- test/results.test.ts` then `npm run typecheck -w app`
Expected: PASS (7 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/host/results.ts app/test/results.test.ts
git commit -m "feat(app): add main-process results read model"
```

---

### Task 5: Engine host — retained results, getResults, reveal IPC

**Files:**
- Modify: `app/src/main/host/engine-host.ts`, `app/src/main/ipc.ts`, `app/src/main/index.ts`
- Modify tests: `app/test/engine-host.test.ts`, `app/test/ipc.test.ts`

**Interfaces:**
- Consumes: `results.ts` from Task 4; `IPC.resultsGet`/`IPC.revealPath` from Task 3; `RULES_VERSION`, `SnapshotMatch` from `@dust/core`.
- Produces: `EngineHost.getResults(root: string): ResultsState`; `ShellActions { revealPath(path: string): Promise<void> }`; `registerIpcHandlers(registrar, host, sender, shell)`; scan events `categories` and `matches` emitted before `finished`.

- [ ] **Step 1: Write the failing engine-host tests**

Add to `app/test/engine-host.test.ts` inside the `describe` block:

```ts
  it('serves retained live results after a run and reports empty for other roots', async () => {
    tree.file('temp/junk.bin', 'abcdefghij');

    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [tempRule(tree.root)],
    });

    const empty = host.getResults(tree.root);
    expect(empty.source).toBe('empty');
    expect(empty.categories).toHaveLength(5);

    const finished = nextEvent(host, 'finished');
    await host.startAnalyze(tree.root);
    await finished;

    const live = host.getResults(tree.root);
    expect(live.source).toBe('live');
    expect(live.depthLimited).toBe(false);
    expect(live.rows.some((row) => row.path === join(tree.root, 'temp'))).toBe(true);
    expect(live.categories.find((row) => row.category === 'temp')?.bytes).toBe(10);

    expect(host.getResults('Z:\\').source).toBe('empty');
  });

  it('builds a depth-limited view from a saved snapshot when no live run matches', () => {
    store.save({
      schemaVersion: 2,
      rulesVersion: '1',
      root: 'C:\\',
      startedAt: 1,
      finishedAt: 2,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 25, items: 1 }],
      projects: [],
      folders: [
        { path: 'C:\\', name: 'C:\\', bytes: 25, allocatedBytes: 4096, fileCount: 1, folderCount: 1, newestMtimeMs: 0, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: 'C:\\Temp', name: 'Temp', bytes: 25, allocatedBytes: 4096, fileCount: 1, folderCount: 0, newestMtimeMs: 0, errorCount: 0, partial: false, complete: true, childCount: 0 },
      ],
      matches: [
        { path: 'C:\\Temp', ruleId: 'system-temp', category: 'temp', bytes: 25, grade: 'safe', evidence: 'fixture' },
      ],
    });

    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
    });

    const results = host.getResults('c:\\');
    expect(results.source).toBe('snapshot');
    expect(results.depthLimited).toBe(true);
    expect(results.categories.find((row) => row.category === 'temp')?.bytes).toBe(25);
    expect(results.rows.find((row) => row.path === 'C:\\Temp')?.action).toMatchObject({ ruleId: 'system-temp' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/engine-host.test.ts`
Expected: FAIL — `host.getResults is not a function`.

- [ ] **Step 3: Modify `app/src/main/host/engine-host.ts`**

Add `RULES_VERSION` to the `@dust/core` value import list and `SnapshotMatch` to the core type import list. Add to the shared type import from `../../shared/ipc`: `CategorySummaryRow`, `ResultMatch`, `ResultRow`, `ResultsState`. Add after the existing host imports:

```ts
import { buildRowsFromSnapshot, buildRowsFromTree, sameRoot, summarizeCategories } from './results';
import type { ResultsEnv } from './results';
```

Add a module-level helper above `createEngineHost`:

```ts
function guardEnv(env: RuleEnv): ResultsEnv {
  return {
    systemRoot: env.windowsDir || undefined,
    programData: env.programData || undefined,
    userProfile: env.userProfile || undefined,
  };
}
```

Add `getResults(root: string): ResultsState;` to the `EngineHost` interface. Add the retained-results state after `let active`:

```ts
  let lastResults: {
    root: string;
    status: 'complete' | 'cancelled';
    finishedAt: number;
    categories: CategorySummaryRow[];
    rows: ResultRow[];
  } | null = null;
```

In `startAnalyze`, after `const runId = randomUUID();` add `lastResults = null;`.

Replace the whole `finalize` function with:

```ts
  async function finalize(
    result: ScanResult,
    startedAt: number,
  ): Promise<{
    finishedAt: number;
    projects: number;
    reclaimableBytes: number;
    saved: boolean;
    categories: CategorySummaryRow[];
    matches: ResultMatch[];
  }> {
    const probe = createNodeFsProbe();
    const existing = deps.store.load();
    const priorCleanedAt = existing.kind === 'ok' ? existing.snapshot.cleanedAt : null;
    const external = createExternalPredicate(listVolumesFn());
    const pins = deps.store.getPins();

    const analysis = classifyProjects({
      root: result.root,
      tree: result.tree,
      markers: result.markers,
      probe,
      pins,
      isExternal: external,
      now,
    });
    const rules = createRules(env, { pins, isExternal: external, now });
    const ctx: RuleContext = { root: result.root, tree: result.tree, markers: result.markers, probe };
    const matches = await collectRuleMatches(rules, ctx);
    const ruleCategories = aggregateCategories(matches);
    const categories = summarizeCategories(ruleCategories);
    const finishedAt = now();

    lastResults = {
      root: result.root,
      status: result.status,
      finishedAt,
      categories,
      rows: buildRowsFromTree(result.tree, result.root, matches, guardEnv(env)),
    };

    const usage = getVolumeUsageFn(listVolumesFn().map((volume) => volume.root));
    const snapshot = buildSnapshot({
      root: result.root,
      startedAt,
      finishedAt,
      status: result.status,
      tree: result.tree,
      projects: analysis.projects,
      categories: ruleCategories,
      matches: matches.map(
        (match): SnapshotMatch => ({
          path: match.path,
          ruleId: match.ruleId,
          category: match.category,
          bytes: match.bytes,
          grade: match.grade,
          evidence: match.evidence,
        }),
      ),
      disks: usage.map((entry) => ({
        volume: entry.volume,
        totalBytes: entry.totalBytes,
        freeBytes: entry.freeBytes,
      })),
      priorCleanedAt,
    });
    const save = deps.store.save(snapshot);

    return {
      finishedAt,
      projects: analysis.projects.length,
      reclaimableBytes: categories.reduce((sum, entry) => sum + entry.bytes, 0),
      saved: save.ok,
      categories,
      matches,
    };
  }
```

In `runAnalysis`, replace the block from `const summary = await finalize(...)` through the `emit({ type: 'finished', ... })` call with:

```ts
      const summary = await finalize(result, input.startedAt);
      emit({ type: 'categories', runId: input.runId, categories: summary.categories });
      emit({ type: 'matches', runId: input.runId, matches: summary.matches });
      emit({
        type: 'finished',
        runId: input.runId,
        status: result.status,
        startedAt: input.startedAt,
        finishedAt: summary.finishedAt,
        filesScanned: result.filesScanned,
        bytesSeen: result.bytesSeen,
        errors: result.errors,
        projects: summary.projects,
        reclaimableBytes: summary.reclaimableBytes,
        saved: summary.saved,
      });
```

Add `getResults` after `cancelScan`:

```ts
  function getResults(requestedRoot: string): ResultsState {
    if (lastResults !== null && sameRoot(lastResults.root, requestedRoot)) {
      return {
        source: 'live',
        root: lastResults.root,
        finishedAt: lastResults.finishedAt,
        status: lastResults.status,
        rulesStale: false,
        depthLimited: false,
        categories: lastResults.categories,
        rows: lastResults.rows,
      };
    }

    const loaded = deps.store.load();
    if (loaded.kind === 'ok' && sameRoot(loaded.snapshot.root, requestedRoot)) {
      return {
        source: 'snapshot',
        root: loaded.snapshot.root,
        finishedAt: loaded.snapshot.finishedAt,
        status: loaded.snapshot.status,
        rulesStale: loaded.snapshot.rulesVersion !== RULES_VERSION,
        depthLimited: true,
        categories: summarizeCategories(loaded.snapshot.categories),
        rows: buildRowsFromSnapshot(loaded.snapshot, guardEnv(env)),
      };
    }

    return {
      source: 'empty',
      root: requestedRoot,
      finishedAt: null,
      status: null,
      rulesStale: false,
      depthLimited: false,
      categories: summarizeCategories([]),
      rows: [],
    };
  }
```

Change the final return to `return { getDashboard, startAnalyze, cancelScan, getResults, onEvent, dispose };`.

- [ ] **Step 4: Wire the IPC channels**

Replace `app/src/main/ipc.ts` with:

```ts
import { IPC } from '../shared/ipc';
import type { ScanEvent } from '../shared/ipc';
import type { EngineHost } from './host/engine-host';

export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface EventSender {
  send(channel: string, payload: unknown): void;
}

export interface ShellActions {
  revealPath(path: string): Promise<void>;
}

export function registerIpcHandlers(
  registrar: IpcRegistrar,
  host: EngineHost,
  sender: EventSender,
  shell: ShellActions,
): () => void {
  registrar.handle(IPC.dashboardGet, () => host.getDashboard());
  registrar.handle(IPC.scanStart, (_event, volume) => host.startAnalyze(typeof volume === 'string' ? volume : ''));
  registrar.handle(IPC.scanCancel, () => host.cancelScan());
  registrar.handle(IPC.resultsGet, (_event, root) => host.getResults(typeof root === 'string' ? root : ''));
  registrar.handle(IPC.revealPath, (_event, path) => shell.revealPath(typeof path === 'string' ? path : ''));
  return host.onEvent((event: ScanEvent) => sender.send(IPC.scanEvent, event));
}
```

`app/src/main/index.ts` — change the electron import to `import { BrowserWindow, app, ipcMain, shell } from 'electron';` and replace the `registerIpcHandlers(...)` call with:

```ts
  registerIpcHandlers(
    registrar,
    host,
    {
      send: (channel, payload) => {
        if (!window.webContents.isDestroyed()) window.webContents.send(channel, payload);
      },
    },
    {
      revealPath: async (path) => {
        await shell.openPath(path);
      },
    },
  );
```

- [ ] **Step 5: Update the IPC routing test**

`app/test/ipc.test.ts` — replace the `registerIpcHandlers(...)` call with:

```ts
    const revealed: string[] = [];
    const unsubscribe = registerIpcHandlers(
      registrar,
      host,
      {
        send: (channel, payload) => sent.push({ channel, payload }),
      },
      {
        revealPath: async (path) => {
          revealed.push(path);
        },
      },
    );
```

Add before `unsubscribe();`:

```ts
    const results = (await registrar.invoke(IPC.resultsGet, 'T:\\')) as { source: string };
    expect(results.source).toBe('empty');

    await registrar.invoke(IPC.revealPath, 'T:\\Temp');
    expect(revealed).toEqual(['T:\\Temp']);
```

- [ ] **Step 6: Run the app suite and typecheck**

Run: `npm run test -w app` and `npm run typecheck -w app`
Expected: all green. The existing `isolates a throwing listener from the run outcome` test asserts the event sequence; the new `categories`/`matches` events sit between `finalizing` and `finished`, so update that assertion to:

```ts
    expect(seen).toEqual(['started', 'finalizing', 'categories', 'matches', 'finished']);
```

- [ ] **Step 7: Commit**

```bash
git add app/src/main app/test/engine-host.test.ts app/test/ipc.test.ts
git commit -m "feat(app): retain results, serve getResults and reveal paths over IPC"
```

---

### Task 6: Engine host — live folder and category streaming

**Files:**
- Modify: `app/src/main/host/engine-host.ts`
- Modify tests: `app/test/engine-host.test.ts`

**Interfaces:**
- Consumes: Task 5 host; `AggregateTree`, `defaultRecycleBinEnumeration`, `RecycleBinInfo`, `FolderRecord`, `Marker` from `@dust/core`; `toResultRow` from Task 4.
- Produces: `EngineHostDeps.folderIntervalMs?` (default 100), `EngineHostDeps.categoryIntervalMs?` (default 2000); `createRules` third parameter `{ recycleBin?: { enumerate?: () => RecycleBinInfo | Promise<RecycleBinInfo> } }`; throttled `folders` events and live `categories` events during a run; the recycle-bin PowerShell enumeration is memoized for the whole run.

- [ ] **Step 1: Write the failing streaming test**

Add to `app/test/engine-host.test.ts`:

```ts
  it('streams completed folders, live categories and final matches during a scan', async () => {
    const fake = new FakeSession({ root: tree.root });
    let clock = 0;
    const liveRule: Rule = {
      id: 'fixture-live',
      category: 'temp',
      title: 'Fixture live',
      action: { kind: 'delete-path' },
      match: (ctx: RuleContext) => {
        const path = join(tree.root, 'b');
        return [
          {
            path,
            bytes: ctx.tree.get(path)?.bytes ?? 0,
            grade: 'safe',
            recovery: { kind: 'junk', reason: 'fixture junk' },
            evidence: 'live fixture',
          },
        ];
      },
    };
    const host = createEngineHost({
      store,
      pool: false,
      now: () => clock,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [liveRule],
      createSession: () => fake,
      folderIntervalMs: 100,
      categoryIntervalMs: 50,
    });

    const events: ScanEvent[] = [];
    host.onEvent((event) => events.push(event));
    const started = await host.startAnalyze(tree.root);
    expect(started.ok).toBe(true);

    const record = (path: string, bytes: number) => ({
      path,
      bytes,
      allocatedBytes: 4096,
      fileCount: 1,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 1,
      errorCount: 0,
      partial: false,
    });

    fake.options.onFolder?.(record(join(tree.root, 'a'), 10));
    clock = 500;
    fake.options.onFolder?.(record(join(tree.root, 'b'), 20));

    const folderEvent = events.find((event) => event.type === 'folders');
    expect(folderEvent?.type === 'folders' && folderEvent.folders.map((row) => row.path)).toEqual([
      join(tree.root, 'a'),
      join(tree.root, 'b'),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const liveCategories = events.filter((event) => event.type === 'categories');
    expect(liveCategories.length).toBeGreaterThan(0);
    const live = liveCategories.at(-1);
    expect(live?.type === 'categories' && live.categories.find((row) => row.category === 'temp')?.bytes).toBe(20);

    const finished = nextEvent(host, 'finished');
    fake.finish(emptyScanResult(tree.root, 'complete'));
    await finished;

    const matches = events.find((event) => event.type === 'matches');
    expect(matches?.type === 'matches' && matches.matches[0]?.path).toBe(join(tree.root, 'b'));
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w app -- test/engine-host.test.ts`
Expected: FAIL — no `folders`/`categories`/`matches` events.

- [ ] **Step 3: Modify `app/src/main/host/engine-host.ts`**

Add `AggregateTree` and `defaultRecycleBinEnumeration` to the `@dust/core` value imports; add `FolderRecord`, `Marker`, `RecycleBinInfo` to the core type imports. Add `toResultRow` to the `./results` value import.

Extend `EngineHostDeps` with the interval options and the third `createRules` parameter:

```ts
export interface EngineHostDeps {
  store: SnapshotStore;
  workerPath?: string;
  pool?: SessionOptions['pool'];
  env?: RuleEnv;
  now?: () => number;
  progressIntervalMs?: number;
  folderIntervalMs?: number;
  categoryIntervalMs?: number;
  listVolumes?: () => VolumeInfo[];
  getVolumeUsage?: (volumes: string[]) => VolumeUsage[];
  createSession?: (options: SessionOptions) => ScanSessionLike;
  createRules?: (
    env: RuleEnv,
    projects: ProjectOptions,
    options: { recycleBin?: { enumerate?: () => RecycleBinInfo | Promise<RecycleBinInfo> } },
  ) => Rule[];
}
```

Update the default factory:

```ts
  const createRules =
    deps.createRules ??
    ((ruleEnv: RuleEnv, projects: ProjectOptions, options) =>
      createInventoryRules(ruleEnv, { projects, recycleBin: options.recycleBin }));
```

In `startAnalyze`, replace everything from `const runId = randomUUID();` through `return { ok: true, runId };` with:

```ts
    const runId = randomUUID();
    const startedAt = now();
    lastResults = null;
    const progress = new ThrottledEmitter<ScanEvent>((event) => emit(event), {
      intervalMs: deps.progressIntervalMs ?? 100,
    });

    const folderIntervalMs = deps.folderIntervalMs ?? 100;
    const categoryIntervalMs = deps.categoryIntervalMs ?? 2000;
    const guard = guardEnv(env);
    const probe = createNodeFsProbe();
    const liveTree = new AggregateTree();
    const liveMarkers: Marker[] = [];
    const folderBuffer: ResultRow[] = [];
    let lastFolderFlush = 0;
    let lastCategoryRun = 0;
    let categoryRunning = false;
    let liveEnded = false;

    let recycleBinInfo: RecycleBinInfo | null = null;
    const rules = createRules(
      env,
      { pins: deps.store.getPins(), isExternal: createExternalPredicate(listVolumesFn()), now },
      {
        recycleBin: {
          enumerate: () => (recycleBinInfo ??= defaultRecycleBinEnumeration()),
        },
      },
    );

    function flushFolders(): void {
      if (folderBuffer.length === 0) return;
      emit({ type: 'folders', runId, folders: folderBuffer.splice(0) });
    }

    function maybeLiveCategories(): void {
      if (liveEnded || categoryRunning) return;
      const stamp = now();
      if (stamp - lastCategoryRun < categoryIntervalMs) return;
      lastCategoryRun = stamp;
      categoryRunning = true;
      void collectRuleMatches(rules, { root: target.root, tree: liveTree, markers: liveMarkers, probe })
        .then((matches) => {
          if (liveEnded) return;
          emit({ type: 'categories', runId, categories: summarizeCategories(aggregateCategories(matches)) });
        })
        .catch(() => {})
        .finally(() => {
          categoryRunning = false;
        });
    }

    function onLiveFolder(record: FolderRecord): void {
      liveTree.addFolder(record);
      folderBuffer.push(
        toResultRow(record, {
          root: target.root,
          complete: true,
          childCount: liveTree.children(record.path).length,
          env: guard,
        }),
      );
      const stamp = now();
      if (stamp - lastFolderFlush >= folderIntervalMs) {
        lastFolderFlush = stamp;
        flushFolders();
      }
      maybeLiveCategories();
    }

    function finishLive(): void {
      liveEnded = true;
      flushFolders();
    }

    let session: ScanSessionLike;
    try {
      session = createSession({
        root: volume,
        pool: deps.pool ?? (deps.workerPath ? { workerPath: deps.workerPath } : false),
        onFolder: onLiveFolder,
        onMarker: (marker) => liveMarkers.push(marker),
        onProgress: (update) => {
          progress.push({
            type: 'progress',
            runId,
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
    } catch (error) {
      lock.release();
      return {
        ok: false,
        reason: 'start-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    active = { runId, session, settled };
    emit({ type: 'started', runId, root: target.root, startedAt });

    void runAnalysis({ session, runId, startedAt, progress, settle, rules, probe, finishLive });

    return { ok: true, runId };
```

Update `runAnalysis` to accept and use the new inputs:

```ts
  async function runAnalysis(input: {
    session: ScanSessionLike;
    runId: string;
    startedAt: number;
    progress: ThrottledEmitter<ScanEvent>;
    settle: () => void;
    rules: Rule[];
    probe: RuleContext['probe'];
    finishLive: () => void;
  }): Promise<void> {
    try {
      const result = await input.session.start();
      input.finishLive();
      input.progress.flush();
      emit({ type: 'finalizing', runId: input.runId });
      const summary = await finalize(result, input.startedAt, input.rules, input.probe);
```

In the `catch` branch, add `input.finishLive();` immediately before `input.progress.cancel();`.

Update `finalize`'s signature and delete the now-duplicated probe/rules creation:

```ts
  async function finalize(
    result: ScanResult,
    startedAt: number,
    rules: Rule[],
    probe: RuleContext['probe'],
  ): Promise<{
    finishedAt: number;
    projects: number;
    reclaimableBytes: number;
    saved: boolean;
    categories: CategorySummaryRow[];
    matches: ResultMatch[];
  }> {
    const existing = deps.store.load();
    const priorCleanedAt = existing.kind === 'ok' ? existing.snapshot.cleanedAt : null;
    const external = createExternalPredicate(listVolumesFn());
    const pins = deps.store.getPins();
```

Remove `const probe = createNodeFsProbe();` and `const rules = createRules(env, { pins, isExternal: external, now });` from `finalize` (the `pins`/`external` reads stay for `classifyProjects`).

- [ ] **Step 4: Run the streaming test and the whole app suite**

Run: `npm run test -w app` and `npm run typecheck -w app`
Expected: all green. The existing `passes pins and an external-drive predicate into rule creation` test still sees exactly one `createRules` call, now at scan start.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/host/engine-host.ts app/test/engine-host.test.ts
git commit -m "feat(app): stream folder rows and live categories during a scan"
```

---

### Task 7: Category Summary Strip

**Files:**
- Create: `app/renderer/src/components/CategoryStrip.tsx`, `app/test/renderer/category-strip.test.tsx`

**Interfaces:**
- Consumes: `CategorySummaryRow` (Task 3), `CategoryId` (type-only from `@dust/core`), `formatBytes`/`formatCount` from `renderer/src/format`.
- Produces: `CategoryStrip({ categories, active, onSelect })` — five fixed rows, `aria-pressed`, disabled at zero, label "0 B" plus "nothing to clean".

- [ ] **Step 1: Write the failing test**

`app/test/renderer/category-strip.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryStrip } from '../../renderer/src/components/CategoryStrip';
import { makeCategories } from './fakes';

describe('CategoryStrip', () => {
  it('renders five categories in fixed order with zero rows disabled', () => {
    render(<CategoryStrip categories={makeCategories()} active={null} onSelect={vi.fn()} />);

    const strip = screen.getByRole('region', { name: 'Reclaimable by category' });
    expect(strip).toBeInTheDocument();
    for (const label of ['Temp', 'Recycle Bin', 'npm cache', 'App caches', 'npm projects']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('256 KB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recycle Bin/ })).toBeDisabled();
    expect(screen.getByText(/nothing to clean/)).toBeInTheDocument();
  });

  it('selects and clears the active category', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<CategoryStrip categories={makeCategories()} active={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /Temp/ }));
    expect(onSelect).toHaveBeenCalledWith('temp');

    rerender(<CategoryStrip categories={makeCategories()} active="temp" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /Temp/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Temp/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w app -- test/renderer/category-strip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/renderer/src/components/CategoryStrip.tsx`**

```tsx
import type { CategoryId } from '@dust/core';
import type { CategorySummaryRow } from '../../../src/shared/ipc';
import { formatBytes, formatCount } from '../format';

export interface CategoryStripProps {
  categories: CategorySummaryRow[];
  active: CategoryId | null;
  onSelect: (category: CategoryId | null) => void;
}

export function CategoryStrip({ categories, active, onSelect }: CategoryStripProps) {
  return (
    <section aria-label="Reclaimable by category" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {categories.map((row) => {
        const empty = row.bytes === 0;
        const selected = active === row.category;
        return (
          <button
            key={row.category}
            type="button"
            disabled={empty}
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : row.category)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              selected
                ? 'border-emerald-600 bg-emerald-950/40'
                : 'border-neutral-800 bg-neutral-900 enabled:hover:border-neutral-600'
            } disabled:opacity-60`}
          >
            <span className="block text-xs text-neutral-400">{row.label}</span>
            <span className="mt-1 block text-lg font-medium text-neutral-100">{formatBytes(row.bytes)}</span>
            <span className="mt-1 block text-xs text-neutral-500">
              {empty ? 'nothing to clean' : `${formatCount(row.items)} items`}
            </span>
          </button>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w app -- test/renderer/category-strip.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/components/CategoryStrip.tsx app/test/renderer/category-strip.test.tsx
git commit -m "feat(app): add the Category Summary Strip"
```

---

### Task 8: Renderer tree store and view helpers

**Files:**
- Create: `app/renderer/src/tree.ts`, `app/test/renderer/tree.test.ts`

**Interfaces:**
- Consumes: `ResultRow`, `ResultMatch` from Task 3; no Node built-ins.
- Produces: `pathParent`, `pathName`, `pathKey`, `sameRoot`; `RowNode`, `RowStore`, `createRowStore`, `upsertRows`, `mergeMatches`, `filterPaths`, `flattenVisible`, `compareRows`; `SortKey`, `SortState`, `FlatRow { row; depth; hasChildren }`. Stub ancestors are synthesized for rows whose parent has not streamed yet; a real record merges in place.

- [ ] **Step 1: Write the failing tests**

`app/test/renderer/tree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  compareRows,
  createRowStore,
  filterPaths,
  flattenVisible,
  mergeMatches,
  pathKey,
  pathName,
  pathParent,
  sameRoot,
  upsertRows,
} from '../../renderer/src/tree';
import type { ResultRow } from '../../src/shared/ipc';

function row(path: string, parent: string | null, overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    path,
    name: pathName(path),
    parent,
    bytes: 0,
    allocatedBytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    complete: true,
    childCount: 0,
    grade: 'review',
    gradeReason: 'Unrecognized folder — review before deleting',
    action: null,
    ...overrides,
  };
}

describe('path helpers', () => {
  it('splits Windows paths without Node built-ins', () => {
    expect(pathParent('C:\\Users\\x\\Temp')).toBe('C:\\Users\\x');
    expect(pathParent('C:\\Users')).toBe('C:\\');
    expect(pathName('C:\\Users\\x\\Temp')).toBe('Temp');
    expect(pathKey('C:\\Users\\X\\')).toBe('c:\\users\\x');
    expect(sameRoot('C:\\', 'c:\\')).toBe(true);
  });
});

describe('RowStore', () => {
  it('creates stub ancestors for rows that stream in before their parents', () => {
    const store = createRowStore('C:\\');
    upsertRows(store, [row('C:\\a\\b', 'C:\\a', { bytes: 5 })]);

    expect(store.nodes.get(pathKey('C:\\a'))?.complete).toBe(false);
    expect(store.nodes.get(pathKey('C:\\a'))?.name).toBe('a');
    expect(store.nodes.get(pathKey('C:\\a\\b'))?.bytes).toBe(5);
    expect(flattenVisible(store, new Set([pathKey('C:\\a')]), { key: 'size', desc: true }, null)).toHaveLength(2);
  });

  it('merges the real parent record in place and sorts siblings', () => {
    const store = createRowStore('C:\\');
    upsertRows(store, [
      row('C:\\small', 'C:\\', { bytes: 1 }),
      row('C:\\big', 'C:\\', { bytes: 100 }),
    ]);
    upsertRows(store, [row('C:\\big', 'C:\\', { bytes: 100, complete: true, childCount: 0 })]);

    const flat = flattenVisible(store, new Set(), { key: 'size', desc: true }, null);
    expect(flat.map((entry) => entry.row.path)).toEqual(['C:\\big', 'C:\\small']);
    expect(flat[0]!.depth).toBe(0);
  });

  it('applies rule matches to existing rows', () => {
    const store = createRowStore('C:\\');
    upsertRows(store, [row('C:\\Temp', 'C:\\')]);
    mergeMatches(store, [
      { path: 'C:\\Temp', bytes: 1, ruleId: 'system-temp', category: 'temp', grade: 'safe', evidence: 'fixture' },
    ]);
    expect(store.nodes.get(pathKey('C:\\Temp'))?.action).toMatchObject({ ruleId: 'system-temp' });
  });
});

describe('compareRows', () => {
  it('orders by every supported key', () => {
    const a = row('C:\\a', 'C:\\', { name: 'a', bytes: 2, allocatedBytes: 1, fileCount: 1, grade: 'safe', newestMtimeMs: 5 });
    const b = row('C:\\b', 'C:\\', { name: 'b', bytes: 1, allocatedBytes: 2, fileCount: 4, grade: 'danger', newestMtimeMs: 9 });
    expect(compareRows(a, b, 'name')).toBeLessThan(0);
    expect(compareRows(a, b, 'size')).toBeGreaterThan(0);
    expect(compareRows(a, b, 'allocated')).toBeLessThan(0);
    expect(compareRows(a, b, 'items')).toBeLessThan(0);
    expect(compareRows(a, b, 'grade')).toBeLessThan(0);
    expect(compareRows(a, b, 'modified')).toBeLessThan(0);
  });
});

describe('filterPaths', () => {
  it('includes matched paths and all their ancestors', () => {
    const store = createRowStore('C:\\');
    upsertRows(store, [
      row('C:\\Users\\x\\AppData\\Local\\Temp', 'C:\\Users\\x\\AppData\\Local', {
        action: { ruleId: 'system-temp', category: 'temp', grade: 'safe', evidence: 'fixture' },
      }),
    ]);
    const included = filterPaths(store, 'temp');
    expect(included).not.toBeNull();
    expect(included!.has(pathKey('C:\\'))).toBe(true);
    expect(included!.has(pathKey('C:\\Users'))).toBe(true);
    expect(included!.has(pathKey('C:\\Users\\x\\AppData\\Local\\Temp'))).toBe(true);
    expect(included!.has(pathKey('C:\\other'))).toBe(false);
    expect(filterPaths(store, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/renderer/tree.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/renderer/src/tree.ts`**

```ts
import type { DisplayGrade } from '@dust/core';
import type { CategoryId, ResultMatch, ResultRow } from '../../src/shared/ipc';

export function pathKey(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}

export function sameRoot(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function pathParent(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (index < 0) return null;
  if (index === 2 && trimmed[1] === ':') return trimmed.slice(0, 3);
  if (index === 0) return null;
  return trimmed.slice(0, index);
}

export function pathName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

export type SortKey = 'name' | 'size' | 'allocated' | 'items' | 'percent' | 'grade' | 'modified';

export interface SortState {
  key: SortKey;
  desc: boolean;
}

export interface RowNode extends ResultRow {
  children: string[];
  childSet: Set<string>;
}

export interface RowStore {
  root: string;
  nodes: Map<string, RowNode>;
}

export interface FlatRow {
  row: ResultRow;
  depth: number;
  hasChildren: boolean;
}

export function createRowStore(root: string): RowStore {
  return { root, nodes: new Map() };
}

export function upsertRows(store: RowStore, rows: ResultRow[]): void {
  for (const row of rows) upsertRow(store, row);
}

export function mergeMatches(store: RowStore, matches: ResultMatch[]): void {
  for (const match of matches) {
    const node = store.nodes.get(pathKey(match.path));
    if (!node) continue;
    node.action = {
      ruleId: match.ruleId,
      category: match.category,
      grade: match.grade,
      evidence: match.evidence,
    };
  }
}

export function flattenVisible(
  store: RowStore,
  expanded: ReadonlySet<string>,
  sort: SortState,
  filter: ReadonlySet<string> | null,
): FlatRow[] {
  const root = store.nodes.get(pathKey(store.root));
  if (!root) return [];

  const out: FlatRow[] = [];
  const visit = (node: RowNode, depth: number): void => {
    for (const child of sortedChildren(store, node, sort)) {
      const key = pathKey(child.path);
      if (filter !== null && !filter.has(key)) continue;
      out.push({ row: child, depth, hasChildren: child.children.length > 0 });
      if (filter !== null || expanded.has(key)) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

export function filterPaths(store: RowStore, category: CategoryId | null): Set<string> | null {
  if (category === null) return null;
  const included = new Set<string>();
  for (const node of store.nodes.values()) {
    if (node.action?.category !== category) continue;
    let key: string | null = pathKey(node.path);
    while (key !== null && !included.has(key)) {
      included.add(key);
      const parent = store.nodes.get(key)?.parent;
      key = parent === null || parent === undefined ? null : pathKey(parent);
    }
  }
  return included;
}

const GRADE_RANK: Record<DisplayGrade, number> = { safe: 0, review: 1, danger: 2 };

export function compareRows(a: ResultRow, b: ResultRow, key: SortKey): number {
  let result = 0;
  switch (key) {
    case 'name':
      result = a.name.localeCompare(b.name);
      break;
    case 'size':
    case 'percent':
      result = a.bytes - b.bytes;
      break;
    case 'allocated':
      result = a.allocatedBytes - b.allocatedBytes;
      break;
    case 'items':
      result = a.fileCount + a.folderCount - (b.fileCount + b.folderCount);
      break;
    case 'grade':
      result = GRADE_RANK[a.grade] - GRADE_RANK[b.grade];
      break;
    case 'modified':
      result = a.newestMtimeMs - b.newestMtimeMs;
      break;
  }
  if (result !== 0) return result;
  return a.path.localeCompare(b.path);
}

function sortedChildren(store: RowStore, node: RowNode, sort: SortState): RowNode[] {
  const children: RowNode[] = [];
  for (const key of node.children) {
    const child = store.nodes.get(key);
    if (child) children.push(child);
  }
  children.sort((a, b) => {
    const result = compareRows(a, b, sort.key);
    return sort.desc ? -result : result;
  });
  return children;
}

function upsertRow(store: RowStore, row: ResultRow): void {
  const key = pathKey(row.path);
  const existing = store.nodes.get(key);
  if (existing) {
    existing.bytes = row.bytes;
    existing.allocatedBytes = row.allocatedBytes;
    existing.fileCount = row.fileCount;
    existing.folderCount = row.folderCount;
    existing.linkCount = row.linkCount;
    existing.newestMtimeMs = row.newestMtimeMs;
    existing.errorCount = row.errorCount;
    existing.partial = row.partial;
    existing.complete = row.complete;
    existing.childCount = row.childCount;
    existing.grade = row.grade;
    existing.gradeReason = row.gradeReason;
    existing.action = row.action;
    return;
  }

  const node: RowNode = { ...row, children: [], childSet: new Set() };
  store.nodes.set(key, node);
  ensureAncestors(store, node);
  const parentKey = row.parent !== null ? pathKey(row.parent) : null;
  if (parentKey !== null && parentKey !== key) {
    const parent = store.nodes.get(parentKey);
    if (parent && !parent.childSet.has(key)) {
      parent.childSet.add(key);
      parent.children.push(key);
    }
  }
}

function ensureAncestors(store: RowStore, node: RowNode): void {
  if (node.parent === null) return;
  const parentKey = pathKey(node.parent);
  if (store.nodes.has(parentKey)) return;

  const stub: RowNode = {
    path: node.parent,
    name: pathName(node.parent),
    parent: sameRoot(node.parent, store.root) ? null : pathParent(node.parent),
    bytes: 0,
    allocatedBytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    complete: false,
    childCount: 0,
    grade: 'review',
    gradeReason: 'Not scanned yet',
    action: null,
    children: [],
    childSet: new Set(),
  };
  store.nodes.set(parentKey, stub);
  ensureAncestors(store, stub);
  if (stub.parent !== null) {
    const grandParent = store.nodes.get(pathKey(stub.parent));
    if (grandParent && !grandParent.childSet.has(parentKey)) {
      grandParent.childSet.add(parentKey);
      grandParent.children.push(parentKey);
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w app -- test/renderer/tree.test.ts` and `npm run typecheck -w app`
Expected: PASS (7 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/tree.ts app/test/renderer/tree.test.ts
git commit -m "feat(app): add the renderer tree store and view helpers"
```

---

### Task 9: Tree Table with sorting, expansion and virtualization

**Files:**
- Create: `app/renderer/src/components/TreeTable.tsx`, `app/test/renderer/tree-table.test.tsx`

**Interfaces:**
- Consumes: `FlatRow`/`SortState`/`SortKey`/`pathKey` from Task 8; `ResultRow` from Task 3; `formatBytes`/`formatCount`/`formatRelativeTime`; `@tanstack/react-table` v8 and `@tanstack/react-virtual` v3 (aliased in tests).
- Produces: `TreeTable({ rows, totalBytes, sort, onSortChange, expanded, onToggle, onReveal, onSelect, selectedPath })` with columns `Name | Size | Allocated | Files / Folders | % | Safety | Last modified | Action`. Action renders Explore only (Clean is Plan 9).

- [ ] **Step 1: Write the failing test**

`app/test/renderer/tree-table.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreeTable } from '../../renderer/src/components/TreeTable';
import { createRowStore, flattenVisible, pathKey, upsertRows } from '../../renderer/src/tree';
import type { SortState } from '../../renderer/src/tree';
import { makeResultsRows } from './fakes';

function setup(overrides: { expanded?: ReadonlySet<string>; sort?: SortState } = {}) {
  const store = createRowStore('C:\\');
  upsertRows(store, makeResultsRows());
  const expanded = overrides.expanded ?? new Set([pathKey('C:\\Users')]);
  const sort = overrides.sort ?? { key: 'size' as const, desc: true };
  const onToggle = vi.fn();
  const onReveal = vi.fn();
  const onSelect = vi.fn();
  const onSortChange = vi.fn();
  render(
    <TreeTable
      rows={flattenVisible(store, expanded, sort, null)}
      totalBytes={1024 * 1024}
      sort={sort}
      onSortChange={onSortChange}
      expanded={expanded}
      onToggle={onToggle}
      onReveal={onReveal}
      onSelect={onSelect}
      selectedPath={null}
    />,
  );
  return { onToggle, onReveal, onSelect, onSortChange };
}

describe('TreeTable', () => {
  it('renders the tree with all eight columns and formatted cells', () => {
    setup();

    for (const header of ['Name', 'Size', 'Allocated', 'Files / Folders', '%', 'Safety', 'Last modified', 'Action']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(header) })).toBeInTheDocument();
    }
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Temp')).toBeInTheDocument();
    expect(screen.getByText('256 KB')).toBeInTheDocument();
    expect(screen.getByText('4 / 0')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
  });

  it('toggles expansion and reveals paths', () => {
    const { onToggle, onReveal } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Users' }));
    expect(onToggle).toHaveBeenCalledWith('C:\\Users');

    fireEvent.doubleClick(screen.getByText('Temp'));
    expect(onReveal).toHaveBeenCalledWith('C:\\Temp');

    fireEvent.click(screen.getAllByRole('button', { name: 'Explore' })[0]!);
    expect(onReveal).toHaveBeenCalledTimes(2);
  });

  it('reports sort changes and shows the active sort direction', () => {
    const { onSortChange } = setup();

    fireEvent.click(screen.getByRole('columnheader', { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', desc: false });

    fireEvent.click(screen.getByRole('columnheader', { name: /Size/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'size', desc: false });
  });

  it('shows rule evidence and the action grade for matched rows', () => {
    const { onSelect } = setup();

    expect(screen.getByText('User TEMP directory — junk by definition')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Why Temp is graded safe' }));
    expect(onSelect).toHaveBeenCalledWith('C:\\Temp');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w app -- test/renderer/tree-table.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/renderer/src/components/TreeTable.tsx`**

```tsx
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef } from 'react';
import type { DisplayGrade } from '@dust/core';
import type { FlatRow, SortKey, SortState } from '../tree';
import { pathKey } from '../tree';
import { formatBytes, formatCount, formatRelativeTime } from '../format';

const GRID =
  'grid grid-cols-[minmax(0,2.5fr)_90px_90px_130px_120px_minmax(0,1.8fr)_110px_90px] items-center gap-1';

const SORTABLE: Record<string, SortKey | null> = {
  name: 'name',
  size: 'size',
  allocated: 'allocated',
  items: 'items',
  percent: 'percent',
  grade: 'grade',
  modified: 'modified',
  action: null,
};

const columnHelper = createColumnHelper<FlatRow>();

export interface TreeTableProps {
  rows: FlatRow[];
  totalBytes: number;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onReveal: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}

export function TreeTable({
  rows,
  totalBytes,
  sort,
  onSortChange,
  expanded,
  onToggle,
  onReveal,
  onSelect,
  selectedPath,
}: TreeTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const columns = useMemo(
    () => [
      columnHelper.accessor((item) => item.row.name, {
        id: 'name',
        header: 'Name',
        cell: (info) => {
          const item = info.row.original;
          const row = item.row;
          const isExpanded = expanded.has(pathKey(row.path));
          return (
            <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: `${item.depth * 16}px` }}>
              {item.hasChildren ? (
                <button
                  type="button"
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.name}`}
                  aria-expanded={isExpanded}
                  onClick={() => onToggle(row.path)}
                  className="w-5 shrink-0 text-neutral-400"
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <span
                className="min-w-0 truncate text-neutral-100"
                title={row.path}
                onDoubleClick={() => onReveal(row.path)}
              >
                {row.name}
              </span>
              {!row.complete && <span className="shrink-0 text-xs text-neutral-500">scanning…</span>}
              {row.partial && <span className="shrink-0 text-xs text-amber-400">partial</span>}
            </div>
          );
        },
      }),
      columnHelper.accessor((item) => item.row.bytes, {
        id: 'size',
        header: 'Size',
        cell: (info) => <span className="tabular-nums text-neutral-200">{formatBytes(info.getValue())}</span>,
      }),
      columnHelper.accessor((item) => item.row.allocatedBytes, {
        id: 'allocated',
        header: 'Allocated',
        cell: (info) => <span className="tabular-nums text-neutral-400">{formatBytes(info.getValue())}</span>,
      }),
      columnHelper.accessor((item) => item.row.fileCount + item.row.folderCount, {
        id: 'items',
        header: 'Files / Folders',
        cell: (info) => (
          <span className="tabular-nums text-neutral-400">
            {formatCount(info.row.original.row.fileCount)} / {formatCount(info.row.original.row.folderCount)}
          </span>
        ),
      }),
      columnHelper.accessor((item) => item.row.bytes, {
        id: 'percent',
        header: '%',
        cell: (info) => {
          const percent = totalBytes > 0 ? (info.getValue() / totalBytes) * 100 : 0;
          const clamped = Math.min(Math.max(percent, 0), 100);
          return (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-neutral-800">
                <div className="h-full bg-emerald-500" style={{ width: `${clamped}%` }} />
              </div>
              <span className="tabular-nums text-xs text-neutral-400">
                {percent > 0 && percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`}
              </span>
            </div>
          );
        },
      }),
      columnHelper.accessor((item) => item.row.grade, {
        id: 'grade',
        header: 'Safety',
        cell: (info) => {
          const row = info.row.original.row;
          const label = row.action ? row.action.grade : row.grade;
          const detail = row.action ? row.action.evidence : row.gradeReason;
          return (
            <button
              type="button"
              onClick={() => onSelect(row.path)}
              title={detail}
              aria-label={`Why ${row.name} is graded ${label}`}
              className="flex min-w-0 items-center gap-2 text-left"
            >
              <GradeBadge grade={label} />
              <span className="min-w-0 truncate text-xs text-neutral-400">{detail}</span>
            </button>
          );
        },
      }),
      columnHelper.accessor((item) => item.row.newestMtimeMs, {
        id: 'modified',
        header: 'Last modified',
        cell: (info) => (
          <span className="text-xs text-neutral-400">
            {info.getValue() > 0 ? formatRelativeTime(info.getValue()) : '—'}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'action',
        header: 'Action',
        cell: (info) => (
          <button
            type="button"
            onClick={() => onReveal(info.row.original.row.path)}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
          >
            Explore
          </button>
        ),
      }),
    ],
    [expanded, onReveal, onSelect, onToggle, totalBytes],
  );

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 12,
    getItemKey: (index) => rows[index]?.row.path ?? index,
  });

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      role="table"
      aria-label="Folder tree"
      className="h-[560px] overflow-auto rounded-xl border border-neutral-800 bg-neutral-900"
    >
      <div role="row" className={`${GRID} sticky top-0 z-10 border-b border-neutral-800 bg-neutral-900 px-2`}>
        {headers.map((header) => {
          const sortKey = SORTABLE[header.id] ?? null;
          const active = sortKey !== null && sort.key === sortKey;
          return (
            <button
              key={header.id}
              type="button"
              role="columnheader"
              aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
              disabled={sortKey === null}
              onClick={() => {
                if (sortKey === null) return;
                onSortChange({ key: sortKey, desc: active ? !sort.desc : sortKey !== 'name' });
              }}
              className="px-1 py-2 text-left text-xs font-medium text-neutral-400 disabled:cursor-default"
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
              {active ? (sort.desc ? ' ▼' : ' ▲') : ''}
            </button>
          );
        })}
      </div>
      <div role="rowgroup" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualItems.map((item) => {
          const flat = rows[item.index];
          const tableRow = table.getRowModel().rows[item.index];
          if (!flat || !tableRow) return null;
          return (
            <div
              key={item.key}
              role="row"
              data-index={item.index}
              ref={virtualizer.measureElement}
              className={`${GRID} absolute left-0 top-0 w-full border-b border-neutral-900 px-2 text-sm ${
                selectedPath !== null && pathKey(selectedPath) === pathKey(flat.row.path) ? 'bg-neutral-800/60' : ''
              }`}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {tableRow.getVisibleCells().map((cell) => (
                <div key={cell.id} role="cell" className="min-w-0 truncate py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GradeBadge({ grade }: { grade: DisplayGrade }) {
  const styles =
    grade === 'safe'
      ? 'bg-emerald-500/15 text-emerald-300'
      : grade === 'review'
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-red-500/15 text-red-300';
  const label = grade === 'safe' ? 'Green' : grade === 'review' ? 'Yellow' : 'Red';
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${styles}`}>{label}</span>;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w app -- test/renderer/tree-table.test.tsx` and `npm run typecheck -w app`
Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/components/TreeTable.tsx app/test/renderer/tree-table.test.tsx
git commit -m "feat(app): add the virtualized Tree Table"
```

---

### Task 10: Results view page

**Files:**
- Create: `app/renderer/src/pages/ResultsView.tsx`, `app/test/renderer/results-view.test.tsx`

**Interfaces:**
- Consumes: `CategoryStrip` (Task 7), `TreeTable` (Task 9), `tree.ts` helpers (Task 8), `DustApi`/`ResultsState`/`ScanEvent` (Task 3), `formatBytes`/`formatCount`/`formatRelativeTime`.
- Produces: `ResultsView({ api, root, runId, event })` — a `<section aria-label="Results">` that fetches `getResults(root)` when `runId === null`, merges live `folders`/`categories`/`matches` events when `runId` matches, owns expansion/sort/filter/selection state, and renders the strip, banners, table and the "why this grade" details panel.

- [ ] **Step 1: Write the failing test**

`app/test/renderer/results-view.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultsView } from '../../renderer/src/pages/ResultsView';
import type { ScanEvent } from '../../src/shared/ipc';
import { makeApi, makeResultsState } from './fakes';

describe('ResultsView', () => {
  it('renders the strip, the tree and the snapshot banner from getResults', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} event={null} />);

    expect(await screen.findByText('Users')).toBeInTheDocument();
    expect(screen.getAllByText('Temp').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Reclaimable by category' })).toBeInTheDocument();
    expect(screen.getByText(/tree is limited to depth 4 plus top contributors/)).toBeInTheDocument();
  });

  it('filters the tree when a category is selected', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} event={null} />);

    expect(await screen.findByText('Users')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Temp/ }));

    await waitFor(() => expect(screen.queryByText('Users')).toBeNull());
    expect(screen.getAllByText('Temp').length).toBeGreaterThan(0);
  });

  it('shows the why-this-grade details for a selected row', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} event={null} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Why Temp is graded safe' }));

    expect(screen.getByText('Why this grade')).toBeInTheDocument();
    expect(screen.getAllByText('User TEMP directory — junk by definition').length).toBeGreaterThan(0);
    expect(screen.getByText('Rule: system-temp')).toBeInTheDocument();
  });

  it('reveals a path through the api', async () => {
    const revealPath = vi.fn(async () => {});
    const api = makeApi({ getResults: async () => makeResultsState(), revealPath });
    render(<ResultsView api={api} root="C:\\" runId={null} event={null} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Explore' }))[0]!);
    await waitFor(() => expect(revealPath).toHaveBeenCalledTimes(1));
  });

  it('shows an empty state when there are no results', async () => {
    const api = makeApi({ getResults: async () => makeResultsState({ source: 'empty', rows: [], categories: [] }) });
    render(<ResultsView api={api} root="C:\\" runId={null} event={null} />);

    expect(await screen.findByText(/No results yet/)).toBeInTheDocument();
  });

  it('merges live folder and match events during a scan', async () => {
    const getResults = vi.fn(async () => makeResultsState());
    const api = makeApi({ getResults });
    const { rerender } = render(<ResultsView api={api} root="C:\\" runId="run-1" event={null} />);

    const folders: ScanEvent = {
      type: 'folders',
      runId: 'run-1',
      folders: [
        {
          path: 'C:\\Temp',
          name: 'Temp',
          parent: 'C:\\',
          bytes: 512,
          allocatedBytes: 4096,
          fileCount: 2,
          folderCount: 0,
          linkCount: 0,
          newestMtimeMs: 0,
          errorCount: 0,
          partial: false,
          complete: true,
          childCount: 0,
          grade: 'safe',
          gradeReason: 'Temporary files — apps recreate them as needed',
          action: null,
        },
      ],
    };
    rerender(<ResultsView api={api} root="C:\\" runId="run-1" event={folders} />);
    expect(await screen.findByText('Temp')).toBeInTheDocument();
    expect(screen.getByText('512 B')).toBeInTheDocument();

    const matches: ScanEvent = {
      type: 'matches',
      runId: 'run-1',
      matches: [
        {
          path: 'C:\\Temp',
          bytes: 512,
          ruleId: 'system-temp',
          category: 'temp',
          grade: 'safe',
          evidence: 'live evidence',
        },
      ],
    };
    rerender(<ResultsView api={api} root="C:\\" runId="run-1" event={matches} />);
    expect(await screen.findByText('live evidence')).toBeInTheDocument();
    expect(getResults).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w app -- test/renderer/results-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/renderer/src/pages/ResultsView.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryId } from '@dust/core';
import type { DustApi, ResultsState, ScanEvent } from '../../../src/shared/ipc';
import { CategoryStrip } from '../components/CategoryStrip';
import { TreeTable } from '../components/TreeTable';
import { formatBytes, formatCount, formatRelativeTime } from '../format';
import {
  createRowStore,
  filterPaths,
  flattenVisible,
  mergeMatches,
  pathKey,
  upsertRows,
} from '../tree';
import type { RowNode, RowStore, SortState } from '../tree';

export interface ResultsViewProps {
  api: DustApi;
  root: string;
  runId: string | null;
  event: ScanEvent | null;
}

export function ResultsView({ api, root, runId, event }: ResultsViewProps) {
  const storeRef = useRef<RowStore>(createRowStore(root));
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<ResultsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveCategories, setLiveCategories] = useState<ResultsState['categories']>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ key: 'size', desc: true });
  const [filter, setFilter] = useState<CategoryId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (runId !== null) return;
    let active = true;
    storeRef.current = createRowStore(root);
    setState(null);
    setError(null);
    setExpanded(new Set());
    setFilter(null);
    setSelected(null);
    api
      .getResults(root)
      .then((next) => {
        if (!active) return;
        upsertRows(storeRef.current, next.rows);
        setState(next);
        setVersion((value) => value + 1);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [api, root, runId]);

  useEffect(() => {
    if (runId === null || event === null || !('runId' in event) || event.runId !== runId) return;
    if (event.type === 'folders') {
      upsertRows(storeRef.current, event.folders);
      setVersion((value) => value + 1);
    } else if (event.type === 'categories') {
      setLiveCategories(event.categories);
    } else if (event.type === 'matches') {
      mergeMatches(storeRef.current, event.matches);
      setVersion((value) => value + 1);
    }
  }, [event, runId]);

  const filterSet = useMemo(
    () => filterPaths(storeRef.current, filter),
    [filter, version],
  );
  const flatRows = useMemo(
    () => flattenVisible(storeRef.current, expanded, sort, filterSet),
    [version, expanded, sort, filterSet],
  );
  const totalBytes = useMemo(() => storeRef.current.nodes.get(pathKey(root))?.bytes ?? 0, [version, root]);

  const categories = runId !== null ? liveCategories : state?.categories ?? [];
  const source = runId !== null ? 'live' : state?.source ?? 'empty';
  const selectedRow: RowNode | undefined =
    selected !== null ? storeRef.current.nodes.get(pathKey(selected)) : undefined;

  const toggle = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      const key = pathKey(path);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const reveal = useCallback(
    (path: string) => {
      void api.revealPath(path).catch(() => {});
    },
    [api],
  );

  if (error !== null) {
    return <section aria-label="Results" className="text-sm text-red-300">{error}</section>;
  }

  return (
    <section aria-label="Results" className="space-y-4">
      {source === 'snapshot' && state?.finishedAt != null && (
        <p className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
          Snapshot from {formatRelativeTime(state.finishedAt)} — the tree is limited to depth 4 plus top contributors.
          Rescan for the full tree.
        </p>
      )}
      {runId === null && state?.rulesStale === true && (
        <p className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
          Rules updated — rescan for accuracy.
        </p>
      )}
      {runId === null && state?.status === 'cancelled' && (
        <p className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
          The last scan was cancelled — results are partial.
        </p>
      )}

      <CategoryStrip categories={categories} active={filter} onSelect={setFilter} />

      {source === 'empty' ? (
        <p className="text-sm text-neutral-400">No results yet — run an Analyze from the dashboard.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <TreeTable
            rows={flatRows}
            totalBytes={totalBytes}
            sort={sort}
            onSortChange={setSort}
            expanded={expanded}
            onToggle={toggle}
            onReveal={reveal}
            onSelect={setSelected}
            selectedPath={selected}
          />
          <aside className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
            {selectedRow ? (
              <>
                <p className="break-all text-xs text-neutral-500">{selectedRow.path}</p>
                <dl className="mt-3 space-y-2">
                  <Detail label="Size" value={formatBytes(selectedRow.bytes)} />
                  <Detail label="Allocated" value={formatBytes(selectedRow.allocatedBytes)} />
                  <Detail
                    label="Files / folders"
                    value={`${formatCount(selectedRow.fileCount)} / ${formatCount(selectedRow.folderCount)}`}
                  />
                  <Detail
                    label="Last modified"
                    value={selectedRow.newestMtimeMs > 0 ? formatRelativeTime(selectedRow.newestMtimeMs) : '—'}
                  />
                </dl>
                <div className="mt-3 rounded-lg border border-neutral-800 p-3">
                  <p className="text-xs uppercase tracking-wide text-neutral-500">Why this grade</p>
                  <p className="mt-1 text-neutral-300">
                    {selectedRow.action ? selectedRow.action.evidence : selectedRow.gradeReason}
                  </p>
                  {selectedRow.action && (
                    <p className="mt-1 text-xs text-neutral-500">Rule: {selectedRow.action.ruleId}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => reveal(selectedRow.path)}
                  className="mt-3 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
                >
                  Explore
                </button>
              </>
            ) : (
              <p className="text-neutral-500">Select a row to see why it is graded this way.</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-neutral-200">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w app -- test/renderer/results-view.test.tsx` and `npm run typecheck -w app`
Expected: PASS (6 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/src/pages/ResultsView.tsx app/test/renderer/results-view.test.tsx
git commit -m "feat(app): add the Results view page"
```

---

### Task 11: App wiring, dashboard entry point and smoke docs

**Files:**
- Modify: `app/renderer/src/App.tsx`, `app/renderer/src/pages/Dashboard.tsx`, `app/renderer/src/pages/ScanView.tsx`, `app/renderer/src/components/DiskCard.tsx`
- Modify tests: `app/test/renderer/app.test.tsx`, `app/test/renderer/dashboard.test.tsx`, `app/test/renderer/scan-view.test.tsx`
- Modify: `app/README.md`

**Interfaces:**
- Consumes: `ResultsView` (Task 10), existing `DustApi`.
- Produces: `View = { name: 'dashboard' } | { name: 'scan'; root; runId } | { name: 'results'; root }`; `DashboardProps.onViewResults(root)`; `DiskCardProps.onViewResults`; `ScanView` embeds the live `ResultsView`.

- [ ] **Step 1: Write the failing navigation test**

Add to `app/test/renderer/dashboard.test.tsx`:

```tsx
  it('opens the results view for an analyzed volume', async () => {
    const onViewResults = vi.fn();
    render(<Dashboard api={makeApi()} onAnalyze={okAnalyze()} onViewResults={onViewResults} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View results for C:\\' }));
    expect(onViewResults).toHaveBeenCalledWith('C:\\');
    expect(screen.queryByRole('button', { name: 'View results for E:\\' })).toBeNull();
  });
```

Add to `app/test/renderer/app.test.tsx`:

```tsx
  it('opens the results view from a disk card', async () => {
    const api = makeApi();
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View results for C:\\' }));
    expect(await screen.findByRole('heading', { name: 'Results' })).toBeInTheDocument();
    expect(await screen.findByText('Users')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dust' })).toBeInTheDocument();
  });
```

Add to `app/test/renderer/scan-view.test.tsx`:

```tsx
  it('streams folder rows into the live results table', async () => {
    const folders: ScanEvent = {
      type: 'folders',
      runId: 'run-1',
      folders: [
        {
          path: 'C:\\Temp',
          name: 'Temp',
          parent: 'C:\\',
          bytes: 512,
          allocatedBytes: 4096,
          fileCount: 2,
          folderCount: 0,
          linkCount: 0,
          newestMtimeMs: 0,
          errorCount: 0,
          partial: false,
          complete: true,
          childCount: 0,
          grade: 'safe',
          gradeReason: 'Temporary files — apps recreate them as needed',
          action: null,
        },
      ],
    };
    render(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={folders} onBack={vi.fn()} />);

    expect(await screen.findByText('Temp')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Folder tree' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/renderer/dashboard.test.tsx test/renderer/app.test.tsx test/renderer/scan-view.test.tsx`
Expected: FAIL — `onViewResults` is not a prop yet and the results table is absent.

- [ ] **Step 3: Wire the Dashboard entry point**

`app/renderer/src/components/DiskCard.tsx` — add `onViewResults: () => void;` to `DiskCardProps`, destructure it, and replace the single Analyze button with:

```tsx
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          aria-label={`Analyze ${volume.root}`}
          disabled={busy}
          onClick={onAnalyze}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Analyze
        </button>
        {volume.lastAnalyzedAt !== null && (
          <button
            type="button"
            aria-label={`View results for ${volume.root}`}
            onClick={onViewResults}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
          >
            View results
          </button>
        )}
      </div>
```

`app/renderer/src/pages/Dashboard.tsx` — add `onViewResults: (root: string) => void;` to `DashboardProps`, destructure it, and pass `onViewResults={() => onViewResults(volume.root)}` to `DiskCard`.

- [ ] **Step 4: Wire App routing and the live Scan view**

Replace `app/renderer/src/App.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { DustApi, ScanEvent, StartAnalyzeResult } from '../../src/shared/ipc';
import { Dashboard } from './pages/Dashboard';
import { ResultsView } from './pages/ResultsView';
import { ScanView } from './pages/ScanView';

export interface AppProps {
  api: DustApi;
}

type View = { name: 'dashboard' } | { name: 'scan'; root: string; runId: string } | { name: 'results'; root: string };

export function App({ api }: AppProps) {
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [event, setEvent] = useState<ScanEvent | null>(null);

  useEffect(() => api.onScanEvent(setEvent), [api]);

  const analyze = useCallback(
    async (root: string): Promise<StartAnalyzeResult> => {
      const result = await api.startAnalyze(root);
      if (result.ok) {
        setEvent(null);
        setView({ name: 'scan', root, runId: result.runId });
      }
      return result;
    },
    [api],
  );

  const back = useCallback(() => setView({ name: 'dashboard' }), []);

  if (view.name === 'scan') {
    return <ScanView api={api} root={view.root} runId={view.runId} event={event} onBack={back} />;
  }
  if (view.name === 'results') {
    return (
      <main className="mx-auto max-w-6xl px-8 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-100">Results</h1>
          <p className="mt-1 text-sm text-neutral-400">{view.root}</p>
        </header>
        <ResultsView api={api} root={view.root} runId={null} event={null} />
        <button
          type="button"
          onClick={back}
          className="mt-6 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200"
        >
          Back to dashboard
        </button>
      </main>
    );
  }
  return <Dashboard api={api} onAnalyze={analyze} onViewResults={(root) => setView({ name: 'results', root })} />;
}
```

`app/renderer/src/pages/ScanView.tsx` — import `ResultsView`, widen the page shell to `mx-auto max-w-6xl px-8 py-10`, and insert `<ResultsView api={api} root={root} runId={runId} event={event} />` between the summary/failed sections and the `Back to dashboard` button.

- [ ] **Step 5: Update the README smoke checklist**

Append to `app/README.md`:

```markdown
8. Click `View results` on an analyzed card: the Results view shows the Category Summary Strip and a tree whose Name/Size/Allocated/Files-Folders/%/Safety/Last-modified/Action columns render. The snapshot banner explains the depth-4 limit.
9. Expand and collapse folders with the chevrons; click any column header to re-sort (default Size descending); click a Safety cell to see the full "why this grade" text and rule evidence in the details panel.
10. Click a category in the strip: the tree filters to that category's matched paths; click it again to clear.
11. Double-click a folder name (or click `Explore`): Windows Explorer opens at that path.
12. Start an Analyze and stay on the Scan view: rows stream into the table as folders complete (parents appear as "scanning…" stubs until finalized), the strip fills in, and when the scan finishes the action grades and evidence appear. `Cancel scan` keeps the partial tree.
13. Relaunch the built app and open `View results`: the tree rebuilds from the snapshot (depth-limited) with the amber banner; running a fresh Analyze replaces it with the full tree.
```

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm run test` and `npm run typecheck` from the worktree root
Expected: all green across `core` and `app`.

- [ ] **Step 7: Commit**

```bash
git add app/renderer app/test/renderer app/README.md
git commit -m "feat(app): wire the Results view into the dashboard and live scan flow"
```

---

## Deliberately deferred (recorded so the executor does not invent it)

- **Row-level Clean button, plan preview, confirmation, acknowledge, restore commands, elevation relaunch:** Plan 9. `ResultRow.action` already carries `ruleId`/`category`/`grade`/`evidence`, and the snapshot now persists matches, so Plan 9 can add the button without touching the read model.
- **`applyCleanupReport` match pruning:** Plan 9's recorded ordering (Plan 6 FR-2) is rescan-then-save after cleanup, which rebuilds `matches` and `folders` wholesale; `applyCleanupReport` stays as-is.
- **Category totals for `recycle-bin` live ticks:** the memoized enumeration runs once per run (PowerShell); live ticks reuse it.
- **Virtualized rendering itself is not unit-tested:** renderer tests alias `react-virtual`; the manual smoke checklist covers scrolling at scale.
