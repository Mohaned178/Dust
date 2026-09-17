# Worker Pool & Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `@dust/core`'s single-threaded scan into a `worker_threads` pool that parallelizes the walk across directory-level tasks, aggregates folder records on the main thread in global post-order, supports cancellation and one crash restart, and stays byte-for-byte identical to the legacy walker's results.

**Architecture:** Workers run a budgeted depth-first traversal (`worker-scan.ts`) built on the shared per-directory primitive extracted as `scanner/dir-scan.ts`. Each worker reports one `dir-open` per directory (direct stats + child dirs) plus markers/progress in 200 ms batches. The host `ScanCoordinator` owns scheduling (directory-level producer/consumer queue), finalization (a directory becomes a `FolderRecord` when all its child dirs have finalized — so records stream globally post-order), worker crash recovery, and cancellation. `ScanSession` keeps its public API and picks the pool automatically unless an `Enumerator` is injected or `pool: false`.

**Tech Stack:** TypeScript (strict, ESM), Node >= 20 (`worker_threads`, `SharedArrayBuffer`, `Atomics`), vitest, `tsx` (dev loader for TS worker entry points and the benchmark script).

**Spec:** `docs/superpowers/specs/2026-09-17-dust-mvp-design.md` (Sections 4.2, 4.3, 8, 9)

## Global Constraints

- Platform: Windows first; commands run in PowerShell 7 from the repo root. Base branch is `master` (Plan 1 complete at `9232202`).
- Node >= 20. TypeScript strict. ESM everywhere (`"type": "module"`). `core/` has zero Electron imports and runs under vitest in plain Node.
- Public API compatibility: `ScanSession`, `ScanResult`, `SessionOptions`, `FolderRecord`, `Marker`, `ProgressUpdate` shapes are unchanged. Plan 1's 29 tests must stay green; unit tests that intentionally exercise the legacy path add `pool: false` (Task 7).
- Records stream post-order: a directory's `FolderRecord` is emitted only after all of its child directories have finalized. The root record is never passed to `onFolder`; the session adds it to the tree last.
- Exactly one `dir-open` per directory, produced by exactly one worker. Deferred directories are submitted as tasks; the worker that claims the task lists them.
- Cancellation: a shared `Int32Array` abort flag (`Atomics`) is checked between directories; workers drain the current directory, then stop. Partial results are kept and the result status is `'cancelled'`.
- Worker crash: one automatic restart per worker; a second crash marks the affected subtree partial (never hangs the scan).
- Defaults: `splitAfterEntries: 20000`, `batchIntervalMs: 200`, `batchMaxItems: 500`, worker count `clamp(availableParallelism() - 1, 4, 8)`.
- One stat per file remains the irreducible cost; directories are not statted; reparse dirents take exactly one `lstat` (Plan 1 behavior, unchanged).
- Commit after every task. Before each commit run: `npm run test -w core` and `npm run typecheck -w core`.

---

## File Structure

- `core/src/scanner/dir-scan.ts` — NEW: shared per-directory primitive (`scanDirectory`), marker helpers, mtime-tracking rule. Used by both the legacy walker and the pool worker.
- `core/src/scanner/scanner.ts` — MODIFIED: `scanDir` rewritten on top of `scanDirectory`; behavior preserved.
- `core/src/scan/protocol.ts` — NEW: pool message types + defaults (`PoolLimits`, `DirOpen`, `WorkerBatch`, `WorkerCommand`, `WorkerEvent`, `WorkerInit`).
- `core/src/scan/worker-scan.ts` — NEW: budgeted traversal producing `dir-open`s and deferred tasks.
- `core/src/scan/worker-runtime.ts` — NEW: batching runtime (buffers events, flushes on interval/size, command handling).
- `core/src/scan/worker-entry.ts` — NEW: real worker entry (wires runtime + `NodeFsEnumerator` + abort flag).
- `core/src/scan/coordinator.ts` — NEW: host scheduler, finalizer, crash recovery, cancellation.
- `core/src/scan/node-worker.ts` — NEW: `WorkerTransport` interface + `worker_threads` implementation.
- `core/src/scan/limits.ts` — NEW: defaults + `defaultWorkerCount()`.
- `core/src/scanner/session.ts` — MODIFIED: pool path, options, cancel wiring.
- `core/src/index.ts` — MODIFIED: export the new public pool types.
- `core/scripts/bench-scan.ts` — NEW: benchmark harness (synthetic + real-disk modes).
- Tests: `core/test/dir-scan.test.ts`, `core/test/worker-scan.test.ts`, `core/test/worker-runtime.test.ts`, `core/test/coordinator.test.ts`, `core/test/coordinator-failure.test.ts`, `core/test/pool-integration.test.ts`, `core/test/session-pool.test.ts`, `core/test/perf.test.ts`; plus `pool: false` additions to `core/test/session.test.ts` and `core/test/pipeline.test.ts`.

---

### Task 1: Extract the shared per-directory primitive (`dir-scan.ts`)

**Files:**
- Create: `core/src/scanner/dir-scan.ts`
- Modify: `core/src/scanner/scanner.ts`
- Test: `core/test/dir-scan.test.ts`
- Must stay green: `core/test/scanner.test.ts` (unchanged), `core/test/pipeline.test.ts` (unchanged in this task), all other suites.

**Interfaces:**
- Consumes: `Entry`, `Marker` from `core/src/model/types.ts`; `Enumerator` from `core/src/scanner/enumerator.ts`.
- Produces: `scanDirectory(dir, trackMtime, ctx): DirScanResult` with `DirScanResult { path, directBytes, directFileCount, linkCount, linkPaths, errorCount, newestMtimeMs, partial, aborted, entryCount, childDirs, markers }`; helpers `isPackageJsonMarker(dir, name)`, `isNodeModulesRootMarker(dir, name)`, `pathHasNodeModules(dir)`, `isMtimeTrackedChild(name)`; `DirScanContext { enumerator, isExcluded, shouldAbort?, onEntry? }` where `onEntry` receives `{ entries: 1, files: 0 | 1, bytes: number, path }`.

- [ ] **Step 1: Write the failing tests**

`core/test/dir-scan.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMtimeTrackedChild, scanDirectory } from '../src/scanner/dir-scan';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { createExclusionPredicate } from '../src/scanner/exclusions';
import type { Entry } from '../src/model/types';

const external = (absPath: string): boolean => false;
const noneExcluded = createExclusionPredicate();

function mockEnumerator(tree: Record<string, Entry[]>): NodeFsEnumerator {
  return {
    list: (dir: string) => {
      const entries = tree[dir];
      if (!entries) throw new Error(`ENOENT: ${dir}`);
      return { entries, entryErrors: 0 };
    },
  } as unknown as NodeFsEnumerator;
}

describe('scanDirectory', () => {
  const root = 'F:\\synthetic';

  it('separates direct file stats from child dirs and counts entries', () => {
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 },
        { name: 'b.txt', kind: 'file', size: 7, mtimeMs: 2000 },
        { name: 'sub', kind: 'dir', size: 0, mtimeMs: 0 },
        { name: 'link', kind: 'link', size: 0, mtimeMs: 0 },
      ],
    });
    const result = scanDirectory(root, true, { enumerator, isExcluded: noneExcluded });

    expect(result.directBytes).toBe(12);
    expect(result.directFileCount).toBe(2);
    expect(result.linkCount).toBe(1);
    expect(result.linkPaths).toEqual([join(root, 'link')]);
    expect(result.childDirs).toEqual([join(root, 'sub')]);
    expect(result.newestMtimeMs).toBe(2000);
    expect(result.entryCount).toBe(4);
    expect(result.partial).toBe(false);
    expect(result.markers).toEqual([]);
  });

  it('zeroes newestMtimeMs when mtime tracking is off but still counts bytes', () => {
    const enumerator = mockEnumerator({
      [root]: [{ name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 }],
    });
    const result = scanDirectory(root, false, { enumerator, isExcluded: noneExcluded });
    expect(result.directBytes).toBe(5);
    expect(result.newestMtimeMs).toBe(0);
  });

  it('emits markers and suppresses nested package.json and node_modules roots', () => {
    const nested = join(root, 'node_modules', 'a');
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'package.json', kind: 'file', size: 2, mtimeMs: 1000 },
        { name: 'node_modules', kind: 'dir', size: 0, mtimeMs: 0 },
        { name: '.git', kind: 'dir', size: 0, mtimeMs: 0 },
      ],
      [nested]: [
        { name: 'package.json', kind: 'file', size: 2, mtimeMs: 1000 },
        { name: 'node_modules', kind: 'dir', size: 0, mtimeMs: 0 },
      ],
    });
    const outer = scanDirectory(root, true, { enumerator, isExcluded: noneExcluded });
    expect(outer.markers).toEqual([
      { kind: 'package-json', path: join(root, 'package.json') },
      { kind: 'node-modules', path: join(root, 'node_modules') },
      { kind: 'git-dir', path: join(root, '.git') },
    ]);

    const inner = scanDirectory(nested, false, { enumerator, isExcluded: noneExcluded });
    expect(inner.markers).toEqual([]);
  });

  it('skips excluded entries without counting them as files or child dirs', () => {
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'keep.txt', kind: 'file', size: 3, mtimeMs: 1000 },
        { name: 'pagefile.sys', kind: 'file', size: 999, mtimeMs: 1000 },
        { name: '$Recycle.Bin', kind: 'dir', size: 0, mtimeMs: 0 },
      ],
    });
    const result = scanDirectory(root, true, { enumerator, isExcluded: noneExcluded });
    expect(result.directBytes).toBe(3);
    expect(result.directFileCount).toBe(1);
    expect(result.childDirs).toEqual([]);
    expect(result.entryCount).toBe(3);
  });

  it('reports a partial result when the listing throws', () => {
    const enumerator = mockEnumerator({});
    const result = scanDirectory(root, true, { enumerator, isExcluded: noneExcluded });
    expect(result.partial).toBe(true);
    expect(result.errorCount).toBe(1);
    expect(result.childDirs).toEqual([]);
  });

  it('stops on shouldAbort and marks the result partial and aborted', () => {
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 },
        { name: 'b.txt', kind: 'file', size: 5, mtimeMs: 1000 },
      ],
    });
    let seen = 0;
    const result = scanDirectory(root, true, {
      enumerator,
      isExcluded: noneExcluded,
      shouldAbort: () => seen >= 1,
      onEntry: () => {
        seen += 1;
      },
    });
    expect(result.aborted).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.directFileCount).toBe(1);
  });

  it('ticks onEntry with per-entry contributions', () => {
    const enumerator = mockEnumerator({
      [root]: [
        { name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 },
        { name: 'sub', kind: 'dir', size: 0, mtimeMs: 0 },
        { name: 'link', kind: 'link', size: 0, mtimeMs: 0 },
      ],
    });
    const ticks: Array<{ entries: number; files: number; bytes: number }> = [];
    scanDirectory(root, true, {
      enumerator,
      isExcluded: noneExcluded,
      onEntry: (c) => ticks.push({ entries: c.entries, files: c.files, bytes: c.bytes }),
    });
    expect(ticks).toEqual([
      { entries: 1, files: 1, bytes: 5 },
      { entries: 1, files: 0, bytes: 0 },
      { entries: 1, files: 0, bytes: 0 },
    ]);
  });

  it('knows which child names keep mtime tracking', () => {
    expect(isMtimeTrackedChild('node_modules')).toBe(false);
    expect(isMtimeTrackedChild('NODE_MODULES')).toBe(false);
    expect(isMtimeTrackedChild('.git')).toBe(false);
    expect(isMtimeTrackedChild('src')).toBe(true);
    expect(external('anything')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/scanner/dir-scan`.

- [ ] **Step 3: Implement `dir-scan.ts`**

`core/src/scanner/dir-scan.ts`:

```ts
import { join } from 'node:path';
import type { Entry, Marker } from '../model/types';
import type { Enumerator } from './enumerator';

export interface DirScanContext {
  enumerator: Enumerator;
  isExcluded: (absPath: string) => boolean;
  shouldAbort?: () => boolean;
  onEntry?: (contribution: { entries: 1; files: 0 | 1; bytes: number; path: string }) => void;
}

export interface DirScanResult {
  path: string;
  directBytes: number;
  directFileCount: number;
  linkCount: number;
  linkPaths: string[];
  errorCount: number;
  newestMtimeMs: number;
  partial: boolean;
  aborted: boolean;
  entryCount: number;
  childDirs: string[];
  markers: Marker[];
}

export function scanDirectory(dir: string, trackMtime: boolean, ctx: DirScanContext): DirScanResult {
  const result: DirScanResult = {
    path: dir,
    directBytes: 0,
    directFileCount: 0,
    linkCount: 0,
    linkPaths: [],
    errorCount: 0,
    newestMtimeMs: 0,
    partial: false,
    aborted: false,
    entryCount: 0,
    childDirs: [],
    markers: [],
  };

  let entries: Entry[];
  try {
    const listing = ctx.enumerator.list(dir);
    entries = listing.entries;
    result.errorCount = listing.entryErrors;
  } catch {
    result.errorCount = 1;
    result.partial = true;
    return result;
  }

  for (const entry of entries) {
    if (ctx.shouldAbort?.()) {
      result.aborted = true;
      result.partial = true;
      break;
    }
    result.entryCount += 1;
    const abs = join(dir, entry.name);

    if (ctx.isExcluded(abs)) {
      ctx.onEntry?.({ entries: 1, files: 0, bytes: 0, path: dir });
      continue;
    }

    if (entry.kind === 'link') {
      result.linkCount += 1;
      result.linkPaths.push(abs);
      ctx.onEntry?.({ entries: 1, files: 0, bytes: 0, path: dir });
      continue;
    }

    if (entry.kind === 'file') {
      result.directBytes += entry.size;
      result.directFileCount += 1;
      if (trackMtime && entry.mtimeMs > result.newestMtimeMs) result.newestMtimeMs = entry.mtimeMs;
      if (isPackageJsonMarker(dir, entry.name)) {
        result.markers.push({ kind: 'package-json', path: abs });
      }
      ctx.onEntry?.({ entries: 1, files: 1, bytes: entry.size, path: dir });
      continue;
    }

    if (isNodeModulesRootMarker(dir, entry.name)) {
      result.markers.push({ kind: 'node-modules', path: abs });
    }
    if (entry.name.toLowerCase() === '.git') {
      result.markers.push({ kind: 'git-dir', path: abs });
    }
    result.childDirs.push(abs);
    ctx.onEntry?.({ entries: 1, files: 0, bytes: 0, path: dir });
  }

  return result;
}

export function isPackageJsonMarker(dir: string, name: string): boolean {
  return name.toLowerCase() === 'package.json' && !pathHasNodeModules(dir);
}

export function isNodeModulesRootMarker(dir: string, name: string): boolean {
  return name.toLowerCase() === 'node_modules' && !pathHasNodeModules(dir);
}

export function pathHasNodeModules(dir: string): boolean {
  return dir.toLowerCase().split(/[\\/]/).includes('node_modules');
}

export function isMtimeTrackedChild(name: string): boolean {
  const lower = name.toLowerCase();
  return lower !== 'node_modules' && lower !== '.git';
}
```

- [ ] **Step 4: Rewrite `scanner.ts`'s `scanDir` on top of `scanDirectory`**

In `core/src/scanner/scanner.ts`:

- Replace the imports with:

```ts
import { basename } from 'node:path';
import type { FolderRecord, Marker, ProgressUpdate } from '../model/types';
import type { Enumerator } from './enumerator';
import { isMtimeTrackedChild, scanDirectory } from './dir-scan';
```

- Replace the entire `scanDir` function (and delete the now-unused `pathHasNodeModules` helper at the bottom, plus the unused `join` import if no longer referenced — `scanDir` no longer joins paths) with:

```ts
function scanDir(dir: string, trackMtime: boolean, config: ScanConfig, state: ScanState): FolderRecord {
  if (config.signal?.aborted) {
    state.aborted = true;
    return emptyRecord(dir, true);
  }

  const result = scanDirectory(dir, trackMtime, {
    enumerator: config.enumerator,
    isExcluded: config.isExcluded,
    shouldAbort: () => config.signal?.aborted === true,
    onEntry: () => {
      state.entriesSeen += 1;
      emitProgress(config, state, dir);
    },
  });
  state.errors += result.errorCount;
  if (result.aborted) state.aborted = true;

  let bytes = result.directBytes;
  let fileCount = result.directFileCount;
  let folderCount = 0;
  let linkCount = result.linkCount;
  let errorCount = result.errorCount;
  let newestMtimeMs = result.newestMtimeMs;
  let partial = result.partial;

  for (const marker of result.markers) config.onMarker?.(marker);
  for (const linkPath of result.linkPaths) {
    config.onFolder?.({
      path: linkPath,
      bytes: 0,
      fileCount: 0,
      folderCount: 0,
      linkCount: 1,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: false,
    });
  }

  for (const childPath of result.childDirs) {
    if (config.signal?.aborted) {
      state.aborted = true;
      partial = true;
      break;
    }
    const child = scanDir(childPath, trackMtime && isMtimeTrackedChild(basename(childPath)), config, state);
    bytes += child.bytes;
    fileCount += child.fileCount;
    folderCount += 1 + child.folderCount;
    linkCount += child.linkCount;
    errorCount += child.errorCount;
    if (child.partial) partial = true;
    if (trackMtime && child.newestMtimeMs > newestMtimeMs) newestMtimeMs = child.newestMtimeMs;
    config.onFolder?.(child);
  }

  state.dirsCompleted += 1;
  if (config.signal?.aborted) {
    state.aborted = true;
    partial = true;
  }

  return {
    path: dir,
    bytes,
    fileCount,
    folderCount,
    linkCount,
    newestMtimeMs,
    errorCount,
    partial,
  };
}
```

- Keep `ScanConfig`, `ScanStats`, `ScanState`, `scanTree`, `emptyRecord`, `emitMarker` (if still referenced — it will no longer be; delete `emitMarker`) and `emitProgress` unchanged.

- [ ] **Step 5: Run the full suite to verify the refactor is behavior-preserving**

Run: `npm run test -w core`
Expected: PASS — all Plan 1 tests (29) plus the new `dir-scan.test.ts` tests. If any Plan 1 scanner/pipeline test fails, the refactor changed behavior — fix the refactor, do not edit the Plan 1 tests.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scanner/dir-scan.ts core/src/scanner/scanner.ts core/test/dir-scan.test.ts
git commit -m "refactor(core): extract shared directory scan primitive"
```

---

### Task 2: Pool protocol + batching worker runtime

**Files:**
- Create: `core/src/scan/protocol.ts`
- Create: `core/src/scan/limits.ts`
- Create: `core/src/scan/worker-runtime.ts`
- Test: `core/test/worker-runtime.test.ts`

**Interfaces:**
- Consumes: `Marker` from `core/src/model/types.ts`; `ExclusionConfig` from `core/src/scanner/exclusions.ts`; `Enumerator` from `core/src/scanner/enumerator.ts`.
- Produces: `PoolLimits`, `DEFAULT_POOL_LIMITS`, `WorkerInit`, `DirOpen`, `WorkerBatch`, `WorkerCommand`, `WorkerEvent`, `PROTOCOL_VERSION` from `protocol.ts`; `defaultWorkerCount()` from `limits.ts`; `WorkerRuntimeDeps`, `WorkerRuntime`, `createWorkerRuntime(deps)` from `worker-runtime.ts` with `{ start(), handleCommand(command), flush(), dispose() }`.

- [ ] **Step 1: Write the failing tests**

`core/test/worker-runtime.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkerRuntime } from '../src/scan/worker-runtime';
import type { WorkerEvent } from '../src/scan/protocol';
import type { Entry } from '../src/model/types';
import type { Enumerator } from '../src/scanner/enumerator';

const root = 'F:\\synthetic';

function mockEnumerator(tree: Record<string, Entry[]>): Enumerator {
  return {
    list: (dir: string) => {
      const entries = tree[dir];
      if (!entries) throw new Error(`ENOENT: ${dir}`);
      return { entries, entryErrors: 0 };
    },
  };
}

const simpleTree: Record<string, Entry[]> = {
  [root]: [{ name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 }],
};

interface Harness {
  events: WorkerEvent[];
  flushTimers: Array<() => void>;
  runtime: ReturnType<typeof createWorkerRuntime>;
}

function harness(tree: Record<string, Entry[]> = simpleTree, batchMaxItems = 500): Harness {
  const events: WorkerEvent[] = [];
  const flushTimers: Array<() => void> = [];
  const runtime = createWorkerRuntime({
    send: (event) => events.push(event),
    enumerator: mockEnumerator(tree),
    isExcluded: () => false,
    shouldAbort: () => false,
    splitAfterEntries: 10000,
    batchIntervalMs: 200,
    batchMaxItems,
    setIntervalFn: (fn) => {
      flushTimers.push(fn);
      return flushTimers.length;
    },
    clearIntervalFn: () => {},
  });
  return { events, flushTimers, runtime };
}

describe('worker runtime', () => {
  it('sends ready on start', () => {
    const { events, runtime } = harness();
    runtime.start();
    expect(events).toEqual([{ type: 'ready' }]);
  });

  it('flushes one batch per task with the dir-open, progress and ready', () => {
    const { events, runtime } = harness();
    runtime.start();
    runtime.handleCommand({ type: 'task', path: root, isRoot: true });

    expect(events).toHaveLength(3);
    const batch = events[1];
    expect(batch.type).toBe('batch');
    if (batch.type !== 'batch') throw new Error('expected batch');
    expect(batch.batch.dirOpens).toEqual([
      {
        path: root,
        isRoot: true,
        directBytes: 5,
        directFileCount: 1,
        linkCount: 0,
        errorCount: 0,
        newestMtimeMs: 1000,
        partial: false,
        childDirs: [],
      },
    ]);
    expect(batch.batch.progress).toEqual({ filesSeen: 1, bytesSeen: 5, errors: 0, currentPath: root });
    expect(events[2]).toEqual({ type: 'ready' });
  });

  it('flushes when the batch reaches batchMaxItems before the task ends', () => {
    const tree: Record<string, Entry[]> = {
      [root]: Array.from({ length: 6 }, (_, i) => ({
        name: `f-${i}.txt`,
        kind: 'file' as const,
        size: 1,
        mtimeMs: 1000,
      })),
    };
    // The six entries tick progress six times; with batchMaxItems 2 the runtime
    // must flush as items accumulate, i.e. more than one batch before ready.
    const events: WorkerEvent[] = [];
    const runtime = createWorkerRuntime({
      send: (event) => events.push(event),
      enumerator: mockEnumerator(tree),
      isExcluded: () => false,
      shouldAbort: () => false,
      splitAfterEntries: 10000,
      batchIntervalMs: 200,
      batchMaxItems: 2,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
    });
    runtime.start();
    runtime.handleCommand({ type: 'task', path: root, isRoot: true });

    const batches = events.filter((e) => e.type === 'batch');
    expect(batches.length).toBeGreaterThan(1);
    const totalProgress = batches.reduce((sum, e) => (e.type === 'batch' && e.batch.progress ? sum + e.batch.progress.filesSeen : sum), 0);
    expect(totalProgress).toBe(6);
  });

  it('flushes buffered items on the interval timer', () => {
    const { events, flushTimers, runtime } = harness();
    runtime.start();
    runtime.handleCommand({ type: 'task', path: root, isRoot: false });
    const before = events.length;
    flushTimers[0]?.();
    expect(events.length).toBe(before);
  });

  it('reports abort as shouldAbort to the traversal', () => {
    const tree: Record<string, Entry[]> = {
      [root]: [{ name: 'sub', kind: 'dir', size: 0, mtimeMs: 0 }],
      [join(root, 'sub')]: [{ name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 }],
    };
    const { events, runtime } = harness(tree, 1);
    runtime.start();
    runtime.handleCommand({ type: 'abort' });
    runtime.handleCommand({ type: 'task', path: root, isRoot: true });

    const opens: string[] = [];
    for (const event of events) {
      if (event.type === 'batch') opens.push(...event.batch.dirOpens.map((o) => o.path));
    }
    expect(opens).not.toContain(join(root, 'sub'));
  });

  it('stops the interval timer on dispose', () => {
    let cleared = 0;
    const runtime = createWorkerRuntime({
      send: () => {},
      enumerator: mockEnumerator(simpleTree),
      isExcluded: () => false,
      shouldAbort: () => false,
      splitAfterEntries: 10000,
      batchIntervalMs: 200,
      batchMaxItems: 500,
      setIntervalFn: () => 42,
      clearIntervalFn: (handle) => {
        expect(handle).toBe(42);
        cleared += 1;
      },
    });
    runtime.dispose();
    expect(cleared).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/scan/worker-runtime`.

- [ ] **Step 3: Implement the protocol, limits, and runtime**

`core/src/scan/protocol.ts`:

```ts
import type { Marker } from '../model/types';
import type { ExclusionConfig } from '../scanner/exclusions';

export const PROTOCOL_VERSION = 1;

export interface PoolLimits {
  splitAfterEntries: number;
  batchIntervalMs: number;
  batchMaxItems: number;
}

export interface WorkerInit {
  workerId: number;
  root: string;
  exclusions: ExclusionConfig;
  limits: PoolLimits;
  abortFlag: SharedArrayBuffer;
}

export interface DirOpen {
  path: string;
  isRoot: boolean;
  directBytes: number;
  directFileCount: number;
  linkCount: number;
  errorCount: number;
  newestMtimeMs: number;
  partial: boolean;
  childDirs: string[];
}

export interface WorkerBatch {
  dirOpens: DirOpen[];
  markers: Marker[];
  submits: string[];
  progress: { filesSeen: number; bytesSeen: number; errors: number; currentPath: string } | null;
}

export type WorkerCommand =
  | { type: 'task'; path: string; isRoot: boolean }
  | { type: 'abort' }
  | { type: 'stop' };

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'batch'; batch: WorkerBatch }
  | { type: 'fatal'; message: string };
```

`core/src/scan/limits.ts`:

```ts
import { availableParallelism } from 'node:os';
import type { PoolLimits } from './protocol';

export const DEFAULT_POOL_LIMITS: PoolLimits = {
  splitAfterEntries: 20_000,
  batchIntervalMs: 200,
  batchMaxItems: 500,
};

export function defaultWorkerCount(): number {
  const parallelism = availableParallelism();
  return Math.min(8, Math.max(4, parallelism - 1));
}
```

`core/src/scan/worker-runtime.ts`:

```ts
import { basename } from 'node:path';
import type { Marker } from '../model/types';
import type { Enumerator } from '../scanner/enumerator';
import { isMtimeTrackedChild, scanDirectory } from '../scanner/dir-scan';
import type { DirOpen, WorkerBatch, WorkerCommand, WorkerEvent } from './protocol';

export interface WorkerRuntimeDeps {
  send: (event: WorkerEvent) => void;
  enumerator: Enumerator;
  isExcluded: (absPath: string) => boolean;
  shouldAbort: () => boolean;
  splitAfterEntries: number;
  batchIntervalMs: number;
  batchMaxItems: number;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export interface WorkerRuntime {
  start(): void;
  handleCommand(command: WorkerCommand): void;
  flush(): void;
  dispose(): void;
}

export function createWorkerRuntime(deps: WorkerRuntimeDeps): WorkerRuntime {
  let disposed = false;
  let localAbort = false;

  const dirOpens: DirOpen[] = [];
  const markers: Marker[] = [];
  const submits: string[] = [];
  let filesSeen = 0;
  let bytesSeen = 0;
  let errors = 0;
  let currentPath = '';
  let flushedFiles = 0;
  let flushedBytes = 0;
  let flushedErrors = 0;
  let flushedPath = '';

  const setIntervalFn = deps.setIntervalFn ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearIntervalFn =
    deps.clearIntervalFn ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  const timer = setIntervalFn(() => flush(), deps.batchIntervalMs);

  const shouldAbort = (): boolean => localAbort || deps.shouldAbort();

  function itemCount(): number {
    return dirOpens.length + markers.length + submits.length;
  }

  function flush(): void {
    if (disposed && itemCount() === 0) return;
    const progressChanged = filesSeen !== flushedFiles || bytesSeen !== flushedBytes || errors !== flushedErrors || currentPath !== flushedPath;
    if (itemCount() === 0 && !progressChanged) return;

    const progress = progressChanged
      ? {
          filesSeen: filesSeen - flushedFiles,
          bytesSeen: bytesSeen - flushedBytes,
          errors: errors - flushedErrors,
          currentPath,
        }
      : null;
    flushedFiles = filesSeen;
    flushedBytes = bytesSeen;
    flushedErrors = errors;
    flushedPath = currentPath;

    const batch: WorkerBatch = {
      dirOpens: dirOpens.splice(0),
      markers: markers.splice(0),
      submits: submits.splice(0),
      progress,
    };
    deps.send({ type: 'batch', batch });
  }

  function pendingItemCount(): number {
    const progressItems =
      filesSeen - flushedFiles + (bytesSeen !== flushedBytes ? 1 : 0) + (errors - flushedErrors);
    return dirOpens.length + markers.length + submits.length + progressItems;
  }

  function maybeAutoFlush(): void {
    if (pendingItemCount() >= deps.batchMaxItems) flush();
  }

  function runTask(path: string, isRoot: boolean): void {
    let budget = deps.splitAfterEntries;

    const walk = (dir: string, root: boolean, trackMtime: boolean): void => {
      if (shouldAbort()) return;
      const result = scanDirectory(dir, trackMtime, {
        enumerator: deps.enumerator,
        isExcluded: deps.isExcluded,
        shouldAbort,
        onEntry: (contribution) => {
          filesSeen += contribution.files;
          bytesSeen += contribution.bytes;
          currentPath = contribution.path;
          maybeAutoFlush();
        },
      });
      for (const marker of result.markers) {
        markers.push(marker);
        maybeAutoFlush();
      }
      dirOpens.push({
        path: dir,
        isRoot: root,
        directBytes: result.directBytes,
        directFileCount: result.directFileCount,
        linkCount: result.linkCount,
        errorCount: result.errorCount,
        newestMtimeMs: result.newestMtimeMs,
        partial: result.partial,
        childDirs: result.childDirs,
      });
      errors += result.errorCount;
      maybeAutoFlush();

      budget -= result.entryCount;
      if (budget <= 0 && result.childDirs.length > 0) {
        for (const child of result.childDirs) submits.push(child);
        maybeAutoFlush();
        return;
      }
      for (const child of result.childDirs) {
        if (shouldAbort()) return;
        walk(child, false, trackMtime && isMtimeTrackedChild(basename(child)));
      }
    };

    walk(path, isRoot, true);
  }

  return {
    start(): void {
      deps.send({ type: 'ready' });
    },

    handleCommand(command: WorkerCommand): void {
      if (disposed) return;
      if (command.type === 'abort') {
        localAbort = true;
        return;
      }
      if (command.type === 'stop') {
        flush();
        return;
      }
      runTask(command.path, command.isRoot);
      flush();
      deps.send({ type: 'ready' });
    },

    flush,

    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearIntervalFn(timer);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. If the batchMaxItems test sees only one batch, the auto-flush threshold counts items after push — trace `maybeAutoFlush` calls and fix the runtime, not the test.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scan core/test/worker-runtime.test.ts
git commit -m "feat(core): add pool protocol and batching worker runtime"
```

---

### Task 3: Budgeted worker traversal (`worker-scan.ts`)

**Files:**
- Create: `core/src/scan/worker-scan.ts`
- Test: `core/test/worker-scan.test.ts`

**Interfaces:**
- Consumes: `scanDirectory`, `isMtimeTrackedChild` from `core/src/scanner/dir-scan.ts`; `Marker` from `core/src/model/types.ts`; `DirOpen` from `core/src/scan/protocol.ts`; `Enumerator` from `core/src/scanner/enumerator.ts`.
- Produces: `WorkerScanContext`, `scanTask(taskPath: string, isRoot: boolean, ctx: WorkerScanContext): void` where `ctx = { enumerator, isExcluded, shouldAbort, splitAfterEntries, openDir(open), submitTasks(paths), marker(marker), progress(contribution) }` and the progress contribution is `{ entries: 1; files: 0 | 1; bytes: number; path: string }`.

- [ ] **Step 1: Write the failing tests**

`core/test/worker-scan.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanTask } from '../src/scan/worker-scan';
import type { DirOpen } from '../src/scan/protocol';
import type { Marker } from '../src/model/types';
import type { Entry } from '../src/model/types';
import type { Enumerator } from '../src/scanner/enumerator';

const root = 'F:\\synthetic';

interface Tree {
  dirs?: string[];
  files?: Array<[string, number]>;
}

function mockEnumerator(tree: Record<string, Tree>): Enumerator {
  return {
    list: (dir: string) => {
      const spec = tree[dir];
      if (!spec) throw new Error(`ENOENT: ${dir}`);
      const entries: Entry[] = [
        ...(spec.dirs ?? []).map((name) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0 })),
        ...(spec.files ?? []).map(([name, size]) => ({ name, kind: 'file' as const, size, mtimeMs: 1000 })),
      ];
      return { entries, entryErrors: 0 };
    },
  };
}

interface Sink {
  opens: DirOpen[];
  submits: string[];
  markers: Marker[];
  progress: number;
}

function run(
  tree: Record<string, Tree>,
  splitAfterEntries: number,
  path = root,
  isRoot = true,
  shouldAbort?: () => boolean,
): Sink {
  const sink: Sink = { opens: [], submits: [], markers: [], progress: 0 };
  scanTask(path, isRoot, {
    enumerator: mockEnumerator(tree),
    isExcluded: () => false,
    shouldAbort: shouldAbort ?? (() => false),
    splitAfterEntries,
    openDir: (open) => sink.opens.push(open),
    submitTasks: (paths) => sink.submits.push(...paths),
    marker: (marker) => sink.markers.push(marker),
    progress: () => {
      sink.progress += 1;
    },
  });
  return sink;
}

const tree: Record<string, Tree> = {
  [root]: { dirs: ['a', 'b'] },
  [join(root, 'a')]: { dirs: ['c'] },
  [join(root, 'a', 'c')]: { files: [['f1', 5], ['f2', 7]] },
  [join(root, 'b')]: { files: [['f3', 3]] },
};

describe('scanTask', () => {
  it('opens every directory and never submits when the budget lasts', () => {
    const sink = run(tree, 1000);
    expect(sink.opens.map((o) => o.path)).toEqual([
      root,
      join(root, 'a'),
      join(root, 'a', 'c'),
      join(root, 'b'),
    ]);
    expect(sink.submits).toEqual([]);
    expect(sink.progress).toBe(6);
    const rootOpen = sink.opens[0]!;
    expect(rootOpen.isRoot).toBe(true);
    expect(rootOpen.childDirs).toEqual([join(root, 'a'), join(root, 'b')]);
  });

  it('splits a directory whose children exceed the remaining budget', () => {
    const sink = run(tree, 3);
    expect(sink.opens.map((o) => o.path)).toEqual([root, join(root, 'a'), join(root, 'b')]);
    expect(sink.submits).toEqual([join(root, 'a', 'c')]);
    const a = sink.opens.find((o) => o.path === join(root, 'a'))!;
    expect(a.childDirs).toEqual([join(root, 'a', 'c')]);
  });

  it('does not descend into directories handed off as tasks', () => {
    const sink = run(tree, 1);
    expect(sink.opens.map((o) => o.path)).toEqual([root]);
    expect(sink.submits).toEqual([join(root, 'a'), join(root, 'b')]);
  });

  it('submits a non-root task path and marks isRoot false', () => {
    const sink = run(tree, 1000, join(root, 'a'), false);
    expect(sink.opens[0]!.isRoot).toBe(false);
    expect(sink.opens.map((o) => o.path)).toEqual([join(root, 'a'), join(root, 'a', 'c')]);
  });

  it('stops immediately when shouldAbort is already true', () => {
    const sink = run(tree, 1000, root, true, () => true);
    expect(sink.opens).toEqual([]);
    expect(sink.submits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/scan/worker-scan`.

- [ ] **Step 3: Implement `worker-scan.ts`**

`core/src/scan/worker-scan.ts`:

```ts
import { basename } from 'node:path';
import type { Marker } from '../model/types';
import type { Enumerator } from '../scanner/enumerator';
import { isMtimeTrackedChild, scanDirectory } from '../scanner/dir-scan';
import type { DirOpen } from './protocol';

export interface WorkerScanContext {
  enumerator: Enumerator;
  isExcluded: (absPath: string) => boolean;
  shouldAbort: () => boolean;
  splitAfterEntries: number;
  openDir: (open: DirOpen) => void;
  submitTasks: (paths: string[]) => void;
  marker: (marker: Marker) => void;
  progress: (contribution: { entries: 1; files: 0 | 1; bytes: number; path: string }) => void;
}

export function scanTask(taskPath: string, isRoot: boolean, ctx: WorkerScanContext): void {
  let budget = ctx.splitAfterEntries;

  const walk = (dir: string, root: boolean, trackMtime: boolean): void => {
    if (ctx.shouldAbort()) return;

    const result = scanDirectory(dir, trackMtime, {
      enumerator: ctx.enumerator,
      isExcluded: ctx.isExcluded,
      shouldAbort: ctx.shouldAbort,
      onEntry: (contribution) => ctx.progress(contribution),
    });

    for (const marker of result.markers) ctx.marker(marker);

    ctx.openDir({
      path: dir,
      isRoot: root,
      directBytes: result.directBytes,
      directFileCount: result.directFileCount,
      linkCount: result.linkCount,
      errorCount: result.errorCount,
      newestMtimeMs: result.newestMtimeMs,
      partial: result.partial,
      childDirs: result.childDirs,
    });

    budget -= result.entryCount;
    if (budget <= 0 && result.childDirs.length > 0) {
      ctx.submitTasks(result.childDirs);
      return;
    }

    for (const child of result.childDirs) {
      if (ctx.shouldAbort()) return;
      walk(child, false, trackMtime && isMtimeTrackedChild(basename(child)));
    }
  };

  walk(taskPath, isRoot, true);
}
```

Note: `worker-runtime.ts` from Task 2 currently contains its own inline traversal. Delete its `runTask` implementation and call `scanTask` instead, wiring the runtime buffers into the `WorkerScanContext`: `openDir` → push `dirOpens` (and `errors += open.errorCount`), `submitTasks` → push `submits`, `marker` → push `markers`, `progress` → `filesSeen += contribution.files; bytesSeen += contribution.bytes; currentPath = contribution.path; maybeAutoFlush()`. Remove the now-unused `isMtimeTrackedChild`/`scanDirectory`/`basename` imports from the runtime. The Task 2 tests must stay green after this swap.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS — `worker-scan.test.ts` plus all Task 2 runtime tests (the runtime now delegates to `scanTask`; its batch contents are unchanged).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scan/worker-scan.ts core/src/scan/worker-runtime.ts core/test/worker-scan.test.ts
git commit -m "feat(core): add budgeted worker traversal with task splitting"
```

---

### Task 4: Coordinator — scheduling, aggregation, post-order emission

**Files:**
- Create: `core/src/scan/coordinator.ts`
- Test: `core/test/coordinator.test.ts`

**Interfaces:**
- Consumes: `FolderRecord`, `Marker`, `ProgressUpdate`; `DirOpen`, `PoolLimits`, `WorkerCommand`, `WorkerEvent`; `WorkerTransport` from `core/src/scan/node-worker.ts` (Task 5 — for this task, declare and use the interface via a type-only import from a new file; see Step 3 note), `scanTask` (test only).
- Produces: `CoordinatorOptions`, `CoordinatorResult { rootRecord, filesScanned, bytesSeen, errors, markers, aborted }`, `class ScanCoordinator { constructor(options), run(): Promise<CoordinatorResult>, cancel(): void }`.

**Note on the transport interface:** create `core/src/scan/node-worker.ts` in this task with ONLY the `WorkerTransport` interface and `NodeTransportOptions` type (the `worker_threads` implementation lands in Task 5). This keeps `coordinator.ts` importable and unit-testable now.

- [ ] **Step 1: Write the failing tests**

`core/test/coordinator.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanCoordinator } from '../src/scan/coordinator';
import type { WorkerTransport } from '../src/scan/node-worker';
import type { DirOpen, WorkerCommand, WorkerEvent } from '../src/scan/protocol';
import type { FolderRecord } from '../src/model/types';
import { Fixture } from './fixtures';

class FakeTransport implements WorkerTransport {
  readonly sent: WorkerCommand[] = [];
  terminated = false;
  private messageHandler: ((event: WorkerEvent) => void) | null = null;
  private exitHandler: ((code: number) => void) | null = null;

  postMessage(command: WorkerCommand): void {
    this.sent.push(command);
  }

  onMessage(handler: (event: WorkerEvent) => void): void {
    this.messageHandler = handler;
  }

  onExit(handler: (code: number) => void): void {
    this.exitHandler = handler;
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }

  emit(event: WorkerEvent): void {
    this.messageHandler?.(event);
  }

  exit(code: number): void {
    this.exitHandler?.(code);
  }

  lastTask(): { path: string; isRoot: boolean } | null {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const command = this.sent[i]!;
      if (command.type === 'task') return { path: command.path, isRoot: command.isRoot };
    }
    return null;
  }
}

function open(path: string, isRoot: boolean, overrides: Partial<DirOpen> = {}): DirOpen {
  return {
    path,
    isRoot,
    directBytes: 0,
    directFileCount: 0,
    linkCount: 0,
    errorCount: 0,
    newestMtimeMs: 0,
    partial: false,
    childDirs: [],
    ...overrides,
  };
}

function batch(dirOpens: DirOpen[], extra: Partial<{ submits: string[]; markers: Array<{ kind: 'package-json'; path: string }> }> = {}): WorkerEvent {
  return {
    type: 'batch',
    batch: { dirOpens, markers: extra.markers ?? [], submits: extra.submits ?? [], progress: null },
  };
}

interface Harness {
  transports: FakeTransport[];
  folders: FolderRecord[];
  progress: unknown[];
  make: () => ScanCoordinator;
}

function harness(workerCount = 1): Harness {
  const transports: FakeTransport[] = [];
  const folders: FolderRecord[] = [];
  const progress: unknown[] = [];
  const root = 'F:\\synthetic';
  const make = (): ScanCoordinator =>
    new ScanCoordinator({
      root,
      workerCount,
      limits: { splitAfterEntries: 20_000, batchIntervalMs: 200, batchMaxItems: 500 },
      abortFlag: new Int32Array(new SharedArrayBuffer(4)),
      createTransport: () => {
        const transport = new FakeTransport();
        transports.push(transport);
        return transport;
      },
      onFolder: (record) => folders.push(record),
      onProgress: (update) => progress.push(update),
    });
  return { transports, folders, progress, make };
}

const ROOT = 'F:\\synthetic';

describe('ScanCoordinator', () => {
  it('assigns the root task when a worker reports ready', async () => {
    const h = harness();
    const run = h.make().run();
    h.transports[0]!.emit({ type: 'ready' });
    expect(h.transports[0]!.lastTask()).toEqual({ path: ROOT, isRoot: true });
    h.transports[0]!.emit(batch([open(ROOT, true)]));
    const result = await run;
    expect(result.rootRecord.path).toBe(ROOT);
  });

  it('finalizes children before parents and never streams the root record', async () => {
    const h = harness();
    const order: string[] = [];
    const coordinator = new ScanCoordinator({
      root: ROOT,
      workerCount: 1,
      limits: { splitAfterEntries: 20_000, batchIntervalMs: 200, batchMaxItems: 500 },
      abortFlag: new Int32Array(new SharedArrayBuffer(4)),
      createTransport: () => {
        const transport = new FakeTransport();
        h.transports.push(transport);
        return transport;
      },
      onFolder: (record) => order.push(record.path),
    });
    const run = coordinator.run();
    const t = h.transports[0]!;
    t.emit({ type: 'ready' });
    t.emit(batch([open(ROOT, true, { childDirs: [join(ROOT, 'a')], directBytes: 1 })]));
    t.emit(batch([open(join(ROOT, 'a'), false, { directBytes: 5, directFileCount: 1, childDirs: [join(ROOT, 'a', 'b')] })]));
    t.emit(batch([open(join(ROOT, 'a', 'b'), false, { directBytes: 7, directFileCount: 1 })]));

    const result = await run;
    expect(order).toEqual([join(ROOT, 'a', 'b'), join(ROOT, 'a')]);
    expect(result.rootRecord).toMatchObject({
      path: ROOT,
      bytes: 13,
      fileCount: 2,
      folderCount: 2,
      partial: false,
    });
  });

  it('waits for every child before finalizing a parent', async () => {
    // Root has children a and b; a arrives complete first, root must wait for b.
    const h = harness();
    const coordinator = new ScanCoordinator({
      root: ROOT,
      workerCount: 1,
      limits: { splitAfterEntries: 20_000, batchIntervalMs: 200, batchMaxItems: 500 },
      abortFlag: new Int32Array(new SharedArrayBuffer(4)),
      createTransport: () => {
        const transport = new FakeTransport();
        h.transports.push(transport);
        return transport;
      },
      onFolder: (record) => h.folders.push(record),
    });
    const run = coordinator.run();
    const t = h.transports[0]!;
    t.emit({ type: 'ready' });
    t.emit(batch([open(ROOT, true, { childDirs: [join(ROOT, 'a'), join(ROOT, 'b')] })]));
    t.emit(batch([open(join(ROOT, 'a'), false, { directBytes: 2 })]));
    expect(h.folders.map((f) => f.path)).toEqual([join(ROOT, 'a')]);
    t.emit(batch([open(join(ROOT, 'b'), false, { directBytes: 3 })]));
    const result = await run;
    expect(h.folders.map((f) => f.path)).toEqual([join(ROOT, 'a'), join(ROOT, 'b')]);
    expect(result.rootRecord.bytes).toBe(5);
  });

  it('handles a child that finalizes before its parent has been opened', async () => {
    const h = harness();
    const coordinator = new ScanCoordinator({
      root: ROOT,
      workerCount: 1,
      limits: { splitAfterEntries: 20_000, batchIntervalMs: 200, batchMaxItems: 500 },
      abortFlag: new Int32Array(new SharedArrayBuffer(4)),
      createTransport: () => {
        const transport = new FakeTransport();
        h.transports.push(transport);
        return transport;
      },
      onFolder: (record) => h.folders.push(record),
    });
    const run = coordinator.run();
    const t = h.transports[0]!;
    t.emit({ type: 'ready' });
    t.emit(batch([open(join(ROOT, 'late'), false, { directBytes: 4 })]));
    t.emit(batch([open(ROOT, true, { childDirs: [join(ROOT, 'late')] })]));
    const result = await run;
    expect(result.rootRecord.bytes).toBe(4);
    expect(h.folders.map((f) => f.path)).toEqual([join(ROOT, 'late')]);
  });

  it('queues submitted tasks and dispatches to idle workers', async () => {
    const h = harness(2);
    const coordinator = h.make();
    const run = coordinator.run();
    const [w0, w1] = h.transports;
    w0!.emit({ type: 'ready' });
    w0!.emit(batch([open(ROOT, true, { childDirs: [join(ROOT, 'a'), join(ROOT, 'b')] })], { submits: [join(ROOT, 'a'), join(ROOT, 'b')] }));
    // w0 stays busy with the root task; the idle w1 claims the first queued task.
    w1!.emit({ type: 'ready' });
    expect(w1!.lastTask()?.path).toBe(join(ROOT, 'a'));

    w1!.emit(batch([open(join(ROOT, 'a'), false, { directBytes: 1 })]));
    w1!.emit({ type: 'ready' });
    expect(w1!.lastTask()?.path).toBe(join(ROOT, 'b'));

    w1!.emit(batch([open(join(ROOT, 'b'), false, { directBytes: 1 })]));
    const result = await run;
    expect(result.rootRecord.bytes).toBe(2);
  });

  it('forwards markers and aggregates progress', async () => {
    const h = harness();
    const coordinator = h.make();
    const run = coordinator.run();
    const t = h.transports[0]!;
    t.emit({ type: 'ready' });
    t.emit({
      type: 'batch',
      batch: {
        dirOpens: [open(ROOT, true)],
        markers: [{ kind: 'package-json', path: join(ROOT, 'package.json') }],
        submits: [],
        progress: { filesSeen: 3, bytesSeen: 30, errors: 1, currentPath: ROOT },
      },
    });
    const result = await run;
    expect(result.markers).toEqual([{ kind: 'package-json', path: join(ROOT, 'package.json') }]);
    expect(result.filesScanned).toBe(3);
    expect(result.bytesSeen).toBe(30);
    expect(result.errors).toBe(1);
  });

  it('terminates transports once the root record is final', async () => {
    const h = harness();
    const coordinator = h.make();
    const run = coordinator.run();
    h.transports[0]!.emit({ type: 'ready' });
    h.transports[0]!.emit(batch([open(ROOT, true)]));
    await run;
    expect(h.transports[0]!.terminated).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/scan/coordinator`.

- [ ] **Step 3: Implement the transport interface and the coordinator**

`core/src/scan/node-worker.ts` (interface only for now):

```ts
import type { WorkerCommand, WorkerEvent } from './protocol';

export interface WorkerTransport {
  postMessage(command: WorkerCommand): void;
  onMessage(handler: (event: WorkerEvent) => void): void;
  onExit(handler: (code: number) => void): void;
  terminate(): Promise<number>;
}

export interface NodeTransportOptions {
  workerPath?: URL | string;
  execArgv?: string[];
}
```

`core/src/scan/coordinator.ts`:

```ts
import { dirname } from 'node:path';
import type { FolderRecord, Marker, ProgressUpdate } from '../model/types';
import type { WorkerTransport } from './node-worker';
import type { DirOpen, PoolLimits, WorkerCommand, WorkerEvent } from './protocol';

export interface CoordinatorOptions {
  root: string;
  workerCount: number;
  limits: PoolLimits;
  abortFlag: Int32Array;
  createTransport: (workerId: number) => WorkerTransport;
  onFolder?: (record: FolderRecord) => void;
  onMarker?: (marker: Marker) => void;
  onProgress?: (update: ProgressUpdate) => void;
}

export interface CoordinatorResult {
  rootRecord: FolderRecord;
  filesScanned: number;
  bytesSeen: number;
  errors: number;
  markers: Marker[];
  aborted: boolean;
}

interface Task {
  path: string;
  isRoot: boolean;
}

interface Accumulator {
  path: string;
  isRoot: boolean;
  opened: boolean;
  finalized: boolean;
  directBytes: number;
  directFileCount: number;
  linkCount: number;
  errorCount: number;
  newestMtimeMs: number;
  partial: boolean;
  childDirs: string[];
  finalizedChildren: Set<string>;
  sumBytes: number;
  sumFiles: number;
  sumFolders: number;
  sumLinks: number;
  sumErrors: number;
  sumNewest: number;
  childPartial: boolean;
}

export class ScanCoordinator {
  private readonly accumulators = new Map<string, Accumulator>();
  private readonly queue: Task[] = [];
  private readonly idle: number[] = [];
  private readonly inflight = new Map<number, Task>();
  private readonly transports = new Map<number, WorkerTransport>();
  private stopping = false;
  private aborted = false;
  private rootRecord: FolderRecord | null = null;
  private resolveRun: ((result: CoordinatorResult) => void) | null = null;
  private filesScanned = 0;
  private bytesSeen = 0;
  private errors = 0;
  private finalizedCount = 0;
  private readonly markers: Marker[] = [];

  constructor(private readonly options: CoordinatorOptions) {}

  run(): Promise<CoordinatorResult> {
    return new Promise<CoordinatorResult>((resolve) => {
      this.resolveRun = resolve;
      this.queue.push({ path: this.options.root, isRoot: true });
      for (let workerId = 0; workerId < this.options.workerCount; workerId += 1) {
        this.spawn(workerId);
      }
    });
  }

  cancel(): void {
    if (this.aborted || this.rootRecord) return;
    this.aborted = true;
    Atomics.store(this.options.abortFlag, 0, 1);
    for (const transport of this.transports.values()) {
      transport.postMessage({ type: 'abort' });
    }
  }

  private spawn(workerId: number): void {
    const transport = this.options.createTransport(workerId);
    transport.onMessage((event) => this.onEvent(workerId, event));
    transport.onExit((code) => this.onExit(workerId, code));
    this.transports.set(workerId, transport);
  }

  private onEvent(workerId: number, event: WorkerEvent): void {
    if (event.type === 'batch') {
      this.onBatch(event);
      return;
    }
    if (event.type === 'fatal') {
      this.onExit(workerId, 1);
      return;
    }
    this.inflight.delete(workerId);
    if (this.stopping || this.aborted) {
      this.send(workerId, { type: 'stop' });
      return;
    }
    this.assign(workerId);
  }

  private onBatch(event: Extract<WorkerEvent, { type: 'batch' }>): void {
    for (const open of event.batch.dirOpens) this.onDirOpen(open);
    for (const marker of event.batch.markers) {
      this.markers.push(marker);
      this.options.onMarker?.(marker);
    }
    if (!this.aborted) {
      for (const path of event.batch.submits) this.enqueue({ path, isRoot: false });
    }
    if (event.batch.progress) {
      const update = event.batch.progress;
      this.filesScanned += update.filesSeen;
      this.bytesSeen += update.bytesSeen;
      this.errors += update.errors;
      this.options.onProgress?.({
        filesScanned: this.filesScanned,
        bytesSeen: this.bytesSeen,
        currentPath: update.currentPath,
        dirsCompleted: this.finalizedCount,
        errors: this.errors,
      });
    }
  }

  private onDirOpen(open: DirOpen): void {
    const accumulator = this.ensure(open.path);
    if (!accumulator.opened) {
      accumulator.opened = true;
      accumulator.isRoot = open.isRoot;
      accumulator.directBytes = open.directBytes;
      accumulator.directFileCount = open.directFileCount;
      accumulator.linkCount = open.linkCount;
      accumulator.errorCount = open.errorCount;
      accumulator.newestMtimeMs = open.newestMtimeMs;
      accumulator.partial = open.partial;
      accumulator.childDirs = open.childDirs;
    }
    this.tryFinalize(open.path);
  }

  private assign(workerId: number): void {
    const task = this.queue.shift();
    if (task) {
      this.inflight.set(workerId, task);
      this.send(workerId, { type: 'task', path: task.path, isRoot: task.isRoot });
      return;
    }
    if (!this.idle.includes(workerId)) this.idle.push(workerId);
    if (this.queue.length === 0 && this.inflight.size === 0) {
      this.stopAll();
    }
  }

  private enqueue(task: Task): void {
    this.queue.push(task);
    while (this.queue.length > 0 && this.idle.length > 0) {
      const workerId = this.idle.shift()!;
      const next = this.queue.shift()!;
      this.inflight.set(workerId, next);
      this.send(workerId, { type: 'task', path: next.path, isRoot: next.isRoot });
    }
  }

  private tryFinalize(path: string): void {
    let current: string | null = path;
    while (current) {
      const accumulator = this.ensure(current);
      if (!accumulator.opened || accumulator.finalized) return;
      const pending = accumulator.childDirs.filter((child) => !accumulator.finalizedChildren.has(child));
      if (pending.length > 0) return;

      accumulator.finalized = true;
      this.finalizedCount += 1;
      const record = this.buildRecord(accumulator);

      if (accumulator.isRoot) {
        this.rootRecord = record;
        this.finish();
        return;
      }

      this.options.onFolder?.(record);
      const parent = this.ensure(dirname(accumulator.path));
      parent.finalizedChildren.add(accumulator.path);
      parent.sumBytes += record.bytes;
      parent.sumFiles += record.fileCount;
      parent.sumFolders += record.folderCount;
      parent.sumLinks += record.linkCount;
      parent.sumErrors += record.errorCount;
      parent.sumNewest = Math.max(parent.sumNewest, record.newestMtimeMs);
      if (record.partial) parent.childPartial = true;
      current = parent.path;
    }
  }

  private buildRecord(accumulator: Accumulator): FolderRecord {
    return {
      path: accumulator.path,
      bytes: accumulator.directBytes + accumulator.sumBytes,
      fileCount: accumulator.directFileCount + accumulator.sumFiles,
      folderCount: accumulator.childDirs.length + accumulator.sumFolders,
      linkCount: accumulator.linkCount + accumulator.sumLinks,
      newestMtimeMs: Math.max(accumulator.newestMtimeMs, accumulator.sumNewest),
      errorCount: accumulator.errorCount + accumulator.sumErrors,
      partial: accumulator.partial || accumulator.childPartial,
    };
  }

  private ensure(path: string): Accumulator {
    const existing = this.accumulators.get(path);
    if (existing) return existing;
    const accumulator: Accumulator = {
      path,
      isRoot: false,
      opened: false,
      finalized: false,
      directBytes: 0,
      directFileCount: 0,
      linkCount: 0,
      errorCount: 0,
      newestMtimeMs: 0,
      partial: false,
      childDirs: [],
      finalizedChildren: new Set(),
      sumBytes: 0,
      sumFiles: 0,
      sumFolders: 0,
      sumLinks: 0,
      sumErrors: 0,
      sumNewest: 0,
      childPartial: false,
    };
    this.accumulators.set(path, accumulator);
    return accumulator;
  }

  private send(workerId: number, command: WorkerCommand): void {
    this.transports.get(workerId)?.postMessage(command);
  }

  private stopAll(): void {
    if (this.stopping) return;
    this.stopping = true;
    for (const [workerId, transport] of this.transports) {
      transport.postMessage({ type: 'stop' });
      void transport.terminate();
      this.transports.delete(workerId);
    }
  }

  private finish(): void {
    const resolve = this.resolveRun;
    if (!resolve || !this.rootRecord) return;
    this.resolveRun = null;
    this.stopAll();
    resolve({
      rootRecord: this.rootRecord,
      filesScanned: this.filesScanned,
      bytesSeen: this.bytesSeen,
      errors: this.errors,
      markers: [...this.markers],
      aborted: this.aborted,
    });
  }

  private onExit(workerId: number, _code: number): void {
    const transport = this.transports.get(workerId);
    if (!transport) return;
    this.transports.delete(workerId);
    const idleIndex = this.idle.indexOf(workerId);
    if (idleIndex >= 0) this.idle.splice(idleIndex, 1);
  }
}
```

Note: this task implements the happy path only — `onExit` cleans up bookkeeping and nothing else. Crash recovery (restart cap, partial synthesis) and cancellation draining arrive in Task 5, where their failure tests go red first.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scan/coordinator.ts core/src/scan/node-worker.ts core/test/coordinator.test.ts
git commit -m "feat(core): add scan coordinator with post-order aggregation"
```

---

### Task 5: Coordinator crash recovery and cancellation

**Files:**
- Modify: `core/src/scan/coordinator.ts`
- Test: `core/test/coordinator-failure.test.ts`

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: no new exports — the coordinator's crash/cancel behavior is hardened and pinned by tests.

- [ ] **Step 1: Write the failing tests**

`core/test/coordinator-failure.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScanCoordinator } from '../src/scan/coordinator';
import type { WorkerTransport } from '../src/scan/node-worker';
import type { DirOpen, WorkerCommand, WorkerEvent } from '../src/scan/protocol';

class FakeTransport implements WorkerTransport {
  readonly sent: WorkerCommand[] = [];
  terminated = false;
  private messageHandler: ((event: WorkerEvent) => void) | null = null;
  private exitHandler: ((code: number) => void) | null = null;

  postMessage(command: WorkerCommand): void {
    this.sent.push(command);
  }

  onMessage(handler: (event: WorkerEvent) => void): void {
    this.messageHandler = handler;
  }

  onExit(handler: (code: number) => void): void {
    this.exitHandler = handler;
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }

  emit(event: WorkerEvent): void {
    this.messageHandler?.(event);
  }

  exit(code: number): void {
    this.exitHandler?.(code);
  }

  taskCount(): number {
    return this.sent.filter((c) => c.type === 'task').length;
  }
}

const ROOT = 'F:\\synthetic';

function open(path: string, isRoot: boolean, childDirs: string[] = []): DirOpen {
  return {
    path,
    isRoot,
    directBytes: 0,
    directFileCount: 0,
    linkCount: 0,
    errorCount: 0,
    newestMtimeMs: 0,
    partial: false,
    childDirs,
  };
}

function makeHarness(workerCount: number) {
  const transports: FakeTransport[] = [];
  const abortFlag = new Int32Array(new SharedArrayBuffer(4));
  const coordinator = new ScanCoordinator({
    root: ROOT,
    workerCount,
    limits: { splitAfterEntries: 20_000, batchIntervalMs: 200, batchMaxItems: 500 },
    abortFlag,
    createTransport: () => {
      const transport = new FakeTransport();
      transports.push(transport);
      return transport;
    },
  });
  return { coordinator, transports, abortFlag };
}

describe('ScanCoordinator failure handling', () => {
  it('restarts a crashed worker once and re-queues its task', async () => {
    const h = makeHarness(1);
    const run = h.coordinator.run();
    const first = h.transports[0]!;
    first.emit({ type: 'ready' });
    first.emit({ type: 'batch', batch: { dirOpens: [open(join(ROOT, 'a'), false)], markers: [], submits: [], progress: null } });
    first.emit({ type: 'batch', batch: { dirOpens: [open(ROOT, true, [join(ROOT, 'a'), join(ROOT, 'b')])], markers: [], submits: [join(ROOT, 'b')], progress: null } });
    first.exit(1);

    expect(h.transports).toHaveLength(2);
    const replacement = h.transports[1]!;
    replacement.emit({ type: 'ready' });
    // The crashed worker's in-flight task (the root) is re-queued at the front.
    expect(replacement.sent.find((c) => c.type === 'task')).toMatchObject({ type: 'task', path: ROOT, isRoot: true });

    replacement.emit({ type: 'ready' });
    expect(replacement.sent.filter((c) => c.type === 'task').at(-1)).toMatchObject({ type: 'task', path: join(ROOT, 'b') });
    replacement.emit({ type: 'batch', batch: { dirOpens: [open(join(ROOT, 'b'), false)], markers: [], submits: [], progress: null } });
    const result = await run;
    expect(result.rootRecord.partial).toBe(false);
  }, 5_000);

  it('marks the subtree partial when the same worker crashes twice', async () => {
    const h = makeHarness(1);
    const run = h.coordinator.run();
    const first = h.transports[0]!;
    first.emit({ type: 'ready' });
    first.emit({ type: 'batch', batch: { dirOpens: [open(ROOT, true, [join(ROOT, 'lost')])], markers: [], submits: [], progress: null } });
    first.exit(1);
    const second = h.transports[1]!;
    second.emit({ type: 'ready' });
    second.exit(1);

    const result = await run;
    expect(result.rootRecord.partial).toBe(true);
    expect(result.rootRecord.errorCount).toBeGreaterThan(0);
  }, 5_000);

  it('aborts running workers, stops them, and returns a partial cancelled result', async () => {
    const h = makeHarness(2);
    const run = h.coordinator.run();
    const [w0, w1] = h.transports;
    w0!.emit({ type: 'ready' });
    w1!.emit({ type: 'ready' });
    w0!.emit({ type: 'batch', batch: { dirOpens: [open(ROOT, true, [join(ROOT, 'a'), join(ROOT, 'b')])], markers: [], submits: [join(ROOT, 'a'), join(ROOT, 'b')], progress: null } });

    h.coordinator.cancel();
    expect(Atomics.load(h.abortFlag, 0)).toBe(1);
    expect(w0!.sent.some((c) => c.type === 'abort')).toBe(true);
    expect(w1!.sent.some((c) => c.type === 'abort')).toBe(true);

    w0!.emit({ type: 'ready' });
    w1!.emit({ type: 'ready' });

    const result = await run;
    expect(result.aborted).toBe(true);
    expect(result.rootRecord.partial).toBe(true);
    expect(result.rootRecord.path).toBe(ROOT);
  }, 5_000);

  it('stops idle workers without waiting for a crash when work is exhausted', async () => {
    const h = makeHarness(1);
    const run = h.coordinator.run();
    h.transports[0]!.emit({ type: 'ready' });
    h.transports[0]!.emit({ type: 'batch', batch: { dirOpens: [open(ROOT, true)], markers: [], submits: [], progress: null } });
    await run;
    expect(h.transports[0]!.terminated).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — the restart test fails its `toHaveLength(2)` assertion (no restart implemented yet), and the double-crash and cancel tests time out at 5 s (no synthesis and no drain). The idle-stop test passes. If a test passes that should fail, it is not exercising what it claims — fix the test.

- [ ] **Step 3: Implement crash recovery and cancellation draining**

In `core/src/scan/coordinator.ts`:

1. Add the restart map beside the other maps:

```ts
  private readonly restarts = new Map<number, number>();
```

2. Replace `cancel()` with:

```ts
  cancel(): void {
    if (this.aborted || this.rootRecord) return;
    this.aborted = true;
    Atomics.store(this.options.abortFlag, 0, 1);
    for (const transport of this.transports.values()) {
      transport.postMessage({ type: 'abort' });
    }
    if (this.inflight.size === 0) {
      this.forceFinalizeAll();
    }
  }
```

3. Make the aborted `ready` path drain: in `onEvent`, the `if (this.stopping || this.aborted)` branch becomes:

```ts
    if (this.stopping || this.aborted) {
      this.send(workerId, { type: 'stop' });
      this.checkDrained();
      return;
    }
```

4. Replace the minimal `onExit` with the restart-cap version:

```ts
  private onExit(workerId: number, _code: number): void {
    const transport = this.transports.get(workerId);
    if (!transport) return;
    this.transports.delete(workerId);
    const idleIndex = this.idle.indexOf(workerId);
    if (idleIndex >= 0) this.idle.splice(idleIndex, 1);
    if (this.stopping || this.resolveRun === null) return;

    const task = this.inflight.get(workerId);
    this.inflight.delete(workerId);
    const restarts = this.restarts.get(workerId) ?? 0;

    if (restarts < 1) {
      this.restarts.set(workerId, restarts + 1);
      if (task) this.queue.unshift(task);
      this.spawn(workerId);
      return;
    }

    if (task) {
      const accumulator = this.ensure(task.path);
      if (!accumulator.opened) accumulator.opened = true;
      accumulator.partial = true;
      accumulator.errorCount += 1;
      this.tryFinalize(task.path);
    }

    if (this.transports.size === 0 || (this.queue.length === 0 && this.inflight.size === 0)) {
      if (!this.aborted && !this.rootRecord) this.forceFinalize(this.options.root);
      this.stopAll();
    }
  }
```

5. Add the drain/synthesis helpers before `finish()`:

```ts
  private checkDrained(): void {
    if (this.inflight.size === 0) this.forceFinalizeAll();
  }

  private forceFinalizeAll(): void {
    if (!this.aborted || this.rootRecord) return;
    this.forceFinalize(this.options.root);
  }

  private forceFinalize(path: string): void {
    const accumulator = this.ensure(path);
    if (accumulator.finalized) return;
    for (const child of accumulator.childDirs) {
      if (!accumulator.finalizedChildren.has(child)) this.forceFinalize(child);
    }
    accumulator.opened = true;
    accumulator.partial = true;
    this.tryFinalize(path);
  }
```

6. Guard a zero-worker configuration in `run()`, after the spawn loop:

```ts
      if (this.options.workerCount === 0) {
        this.forceFinalize(this.options.root);
      }
```

Note on crash double-processing: re-queuing a crashed task can re-list directories that were already opened; `onDirOpen` ignores an already-opened accumulator, so the duplicate work is wasted bytes of I/O but can never double-count.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS — `coordinator-failure.test.ts` plus Task 4's tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scan/coordinator.ts core/test/coordinator-failure.test.ts
git commit -m "feat(core): harden coordinator crash recovery and cancellation"
```

---

### Task 6: Real worker transport, worker entry, and real-thread parity

**Files:**
- Modify: `core/src/scan/node-worker.ts` (add the `worker_threads` implementation)
- Create: `core/src/scan/worker-entry.ts`
- Modify: `core/package.json` (add `tsx` devDependency)
- Test: `core/test/pool-integration.test.ts`

**Interfaces:**
- Consumes: `WorkerInit`, `WorkerCommand`, `WorkerEvent`, `PoolLimits`; `createWorkerRuntime`; `NodeFsEnumerator`; `createExclusionPredicate`; `ScanCoordinator`; `scanTree` (parity reference).
- Produces: `createNodeWorkerTransport(init: WorkerInit, options?: NodeTransportOptions): WorkerTransport`.

- [ ] **Step 1: Add `tsx` to `core/package.json`**

Append to `devDependencies`:

```json
"tsx": "^4.0.0"
```

Then run `npm install` from the repo root.

- [ ] **Step 2: Write the failing integration test**

`core/test/pool-integration.test.ts`:

```ts
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanCoordinator } from '../src/scan/coordinator';
import { createNodeWorkerTransport } from '../src/scan/node-worker';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { createExclusionPredicate } from '../src/scanner/exclusions';
import { scanTree } from '../src/scanner/scanner';
import { DEFAULT_POOL_LIMITS } from '../src/scan/limits';
import { Fixture } from './fixtures';

const workerPath = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'scan', 'worker-entry.ts');

describe('pool integration (real worker threads)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('produces the same aggregate tree as the single-threaded walker', async () => {
    fixture.file('project/package.json', '{}');
    fixture.file('project/src/index.ts', 'xxxx');
    fixture.file('project/node_modules/dep/a.js', 'yyyyyy');
    fixture.file('project/node_modules/dep/node_modules/inner/b.js', 'zz');
    fixture.file('other/data.txt', 'q');
    fixture.file('other/deep/nested/file.bin', '0123456789', 1_750_000_000_000);

    const legacy = scanTree({
      root: fixture.root,
      enumerator: new NodeFsEnumerator(),
      isExcluded: createExclusionPredicate(),
    });

    const abortFlag = new Int32Array(new SharedArrayBuffer(4));
    const coordinator = new ScanCoordinator({
      root: fixture.root,
      workerCount: 2,
      limits: DEFAULT_POOL_LIMITS,
      abortFlag,
      createTransport: (workerId) =>
        createNodeWorkerTransport(
          {
            workerId,
            root: fixture.root,
            exclusions: {},
            limits: DEFAULT_POOL_LIMITS,
            abortFlag: abortFlag.buffer,
          },
          { workerPath, execArgv: ['--import', 'tsx'] },
        ),
    });

    const pooled = await coordinator.run();

    expect(pooled.rootRecord).toEqual(legacy.rootRecord);
    expect(new Set(pooled.markers.map((m) => `${m.kind}:${m.path}`))).toEqual(
      new Set(legacy.markers.map((m) => `${m.kind}:${m.path}`)),
    );
    expect(pooled.filesScanned).toBe(legacy.filesScanned);
    expect(pooled.bytesSeen).toBe(legacy.bytesSeen);
  }, 30_000);

  it('splits large trees into multiple tasks without changing the result', async () => {
    for (let d = 0; d < 12; d += 1) {
      for (let f = 0; f < 10; f += 1) {
        fixture.file(`dir-${d}/file-${f}.txt`, 'abc');
      }
    }

    const legacy = scanTree({
      root: fixture.root,
      enumerator: new NodeFsEnumerator(),
      isExcluded: createExclusionPredicate(),
    });

    const limits = { ...DEFAULT_POOL_LIMITS, splitAfterEntries: 8 };
    const abortFlag = new Int32Array(new SharedArrayBuffer(4));
    const coordinator = new ScanCoordinator({
      root: fixture.root,
      workerCount: 2,
      limits,
      abortFlag,
      createTransport: (workerId) =>
        createNodeWorkerTransport(
          {
            workerId,
            root: fixture.root,
            exclusions: {},
            limits,
            abortFlag: abortFlag.buffer,
          },
          { workerPath, execArgv: ['--import', 'tsx'] },
        ),
    });

    const pooled = await coordinator.run();
    expect(pooled.rootRecord).toEqual(legacy.rootRecord);
  }, 30_000);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -w core`
Expected: FAIL — `../src/scan/node-worker` has no `createNodeWorkerTransport` (or the worker entry does not exist).

- [ ] **Step 4: Implement the transport and the worker entry**

Modify `core/src/scan/node-worker.ts`: change the existing protocol import to `import type { WorkerCommand, WorkerEvent, WorkerInit } from './protocol';`, add `import { Worker } from 'node:worker_threads';` as the first import, and append this function:

```ts
export function createNodeWorkerTransport(init: WorkerInit, options: NodeTransportOptions = {}): WorkerTransport {
  const workerPath = options.workerPath ?? new URL('./worker-entry.ts', import.meta.url);
  const worker = new Worker(workerPath, {
    workerData: init,
    execArgv: options.execArgv ?? [],
  });
  return {
    postMessage: (command) => worker.postMessage(command),
    onMessage: (handler) => worker.on('message', handler),
    onExit: (handler) => worker.on('exit', (code) => handler(code)),
    terminate: () => worker.terminate(),
  };
}
```

`core/src/scan/worker-entry.ts`:

```ts
import { parentPort, workerData } from 'node:worker_threads';
import { NodeFsEnumerator } from '../scanner/enumerator';
import { createExclusionPredicate } from '../scanner/exclusions';
import type { WorkerCommand, WorkerInit } from './protocol';
import { createWorkerRuntime } from './worker-runtime';

const port = parentPort;
if (!port) throw new Error('worker-entry must run inside a worker thread');

const init = workerData as WorkerInit;
const abortFlag = new Int32Array(init.abortFlag);
const isExcluded = createExclusionPredicate(init.exclusions);

const runtime = createWorkerRuntime({
  send: (event) => port.postMessage(event),
  enumerator: new NodeFsEnumerator(),
  isExcluded,
  shouldAbort: () => Atomics.load(abortFlag, 0) === 1,
  splitAfterEntries: init.limits.splitAfterEntries,
  batchIntervalMs: init.limits.batchIntervalMs,
  batchMaxItems: init.limits.batchMaxItems,
});

port.on('message', (command: WorkerCommand) => {
  if (command.type === 'stop') {
    runtime.flush();
    runtime.dispose();
    port.close();
    process.exit(0);
  }
  runtime.handleCommand(command);
});

// Surface an unhandled crash to the host before the thread dies.
process.on('uncaughtException', (error) => {
  try {
    port.postMessage({ type: 'fatal', message: String(error) });
  } finally {
    process.exit(1);
  }
});

runtime.start();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -w core`
Expected: PASS. If the worker fails to load (`Cannot find module 'tsx'`), run `npm install` from the repo root; if it still fails, the execArgv loader is unavailable in this environment — report BLOCKED with the exact error rather than changing the test.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scan/node-worker.ts core/src/scan/worker-entry.ts core/package.json package-lock.json core/test/pool-integration.test.ts
git commit -m "feat(core): add real worker transport and thread parity coverage"
```

---

### Task 7: Session integration — pool by default, cancellation, options

**Files:**
- Modify: `core/src/scanner/session.ts`
- Modify: `core/src/index.ts`
- Modify: `core/test/session.test.ts` (add `pool: false` to the three existing sessions)
- Modify: `core/test/pipeline.test.ts` (add `pool: false` to the two existing sessions)
- Test: `core/test/session-pool.test.ts`

**Interfaces:**
- Consumes: `ScanCoordinator`, `createNodeWorkerTransport`, `DEFAULT_POOL_LIMITS`, `defaultWorkerCount`, `PoolLimits`.
- Produces: `PoolOptions { workers?, splitAfterEntries?, batchIntervalMs?, batchMaxItems?, workerPath?, execArgv? }`; `SessionOptions.pool?: false | PoolOptions`; public exports of `PoolOptions` and `CoordinatorResult`-adjacent types from `core/src/index.ts`. Session rule: the pool is used when `pool !== false` AND no `enumerator` is injected; an injected enumerator (test seam) always selects the legacy path.

- [ ] **Step 1: Write the failing tests**

`core/test/session-pool.test.ts`:

```ts
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanSession } from '../src/scanner/session';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { Fixture } from './fixtures';

const workerPath = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'scan', 'worker-entry.ts');
const poolOptions = { workers: 2, workerPath, execArgv: ['--import', 'tsx'] };

describe('ScanSession with the worker pool', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('returns the same tree as the legacy path', async () => {
    fixture.file('a.txt', 'aaaaa');
    fixture.file('node_modules/dep/index.js', 'bb');
    fixture.file('package.json', '{}');

    const pooled = await new ScanSession({ root: fixture.root, pool: poolOptions }).start();
    const legacy = await new ScanSession({ root: fixture.root, pool: false }).start();

    expect(pooled.status).toBe('complete');
    expect(pooled.tree.get(fixture.root)).toEqual(legacy.tree.get(fixture.root));
    expect(pooled.filesScanned).toBe(legacy.filesScanned);
    expect(pooled.bytesSeen).toBe(legacy.bytesSeen);
  }, 30_000);

  it('uses the legacy path when an enumerator is injected', async () => {
    fixture.file('a.txt', 'aaaaa');
    const enumerator = new NodeFsEnumerator();
    const result = await new ScanSession({ root: fixture.root, enumerator }).start();
    expect(result.status).toBe('complete');
  });

  it('cancels a pooled scan and keeps partial results', async () => {
    for (let d = 0; d < 40; d += 1) {
      for (let f = 0; f < 40; f += 1) {
        fixture.file(`dir-${d}/file-${f}.txt`, 'x');
      }
    }
    const session = new ScanSession({ root: fixture.root, pool: poolOptions });
    let cancelled = false;
    const result = await session.start();
    expect(result.status).toBe('complete');

    const second = new ScanSession({
      root: fixture.root,
      pool: poolOptions,
      onFolder: () => {
        if (!cancelled) {
          cancelled = true;
          second.cancel();
        }
      },
    });
    const cancelledResult = await second.start();
    expect(cancelledResult.status).toBe('cancelled');
    expect(cancelledResult.tree.get(fixture.root)).toBeDefined();
  }, 30_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — `pool` is not a known option; pooled paths are not implemented.

- [ ] **Step 3: Implement the session pool path**

In `core/src/scanner/session.ts`:

- Add imports:

```ts
import { DEFAULT_POOL_LIMITS, defaultWorkerCount } from '../scan/limits';
import { createNodeWorkerTransport } from '../scan/node-worker';
import { ScanCoordinator } from '../scan/coordinator';
```

- Extend `SessionOptions` with:

```ts
export interface PoolOptions {
  workers?: number;
  splitAfterEntries?: number;
  batchIntervalMs?: number;
  batchMaxItems?: number;
  workerPath?: URL | string;
  execArgv?: string[];
}
```

and in `SessionOptions` add `pool?: false | PoolOptions;` after `exclusions`.

- Add private fields and cancel wiring:

```ts
export class ScanSession {
  private readonly controller = new AbortController();
  private coordinator: ScanCoordinator | null = null;

  // constructor unchanged

  cancel(): void {
    this.controller.abort();
    this.coordinator?.cancel();
  }
```

- Replace the body of `start()` with:

```ts
  async start(): Promise<ScanResult> {
    const startedAt = Date.now();
    const tree = new AggregateTree();
    const isExcluded = createExclusionPredicate(this.options.exclusions);

    if (this.options.pool === false || this.options.enumerator) {
      return this.startLegacy(startedAt, tree, isExcluded);
    }

    const pool = this.options.pool ?? {};
    const limits = {
      splitAfterEntries: pool.splitAfterEntries ?? DEFAULT_POOL_LIMITS.splitAfterEntries,
      batchIntervalMs: pool.batchIntervalMs ?? DEFAULT_POOL_LIMITS.batchIntervalMs,
      batchMaxItems: pool.batchMaxItems ?? DEFAULT_POOL_LIMITS.batchMaxItems,
    };
    const abortFlag = new Int32Array(new SharedArrayBuffer(4));

    const coordinator = new ScanCoordinator({
      root: this.options.root,
      workerCount: pool.workers ?? defaultWorkerCount(),
      limits,
      abortFlag,
      createTransport: (workerId) =>
        createNodeWorkerTransport(
          {
            workerId,
            root: this.options.root,
            exclusions: this.options.exclusions ?? {},
            limits,
            abortFlag: abortFlag.buffer,
          },
          { workerPath: pool.workerPath, execArgv: pool.execArgv },
        ),
      onFolder: (record) => {
        tree.addFolder(record);
        this.options.onFolder?.(record);
      },
      onMarker: this.options.onMarker,
      onProgress: this.options.onProgress,
    });
    this.coordinator = coordinator;

    const pooled = await coordinator.run();
    tree.addFolder(pooled.rootRecord);

    return {
      root: this.options.root,
      status: pooled.aborted ? 'cancelled' : 'complete',
      tree,
      startedAt,
      finishedAt: Date.now(),
      filesScanned: pooled.filesScanned,
      bytesSeen: pooled.bytesSeen,
      errors: pooled.errors,
      markers: pooled.markers,
    };
  }

  private startLegacy(startedAt: number, tree: AggregateTree, isExcluded: (absPath: string) => boolean): ScanResult {
    const stats = scanTree({
      root: this.options.root,
      enumerator: this.options.enumerator ?? new NodeFsEnumerator(),
      isExcluded,
      progressEvery: this.options.progressEvery,
      signal: this.controller.signal,
      onFolder: (record) => {
        tree.addFolder(record);
        this.options.onFolder?.(record);
      },
      onMarker: (marker) => {
        this.options.onMarker?.(marker);
      },
      onProgress: (update) => {
        this.options.onProgress?.(update);
      },
    });

    tree.addFolder(stats.rootRecord);

    return {
      root: this.options.root,
      status: stats.aborted ? 'cancelled' : 'complete',
      tree,
      startedAt,
      finishedAt: Date.now(),
      filesScanned: stats.filesScanned,
      bytesSeen: stats.bytesSeen,
      errors: stats.errors,
      markers: stats.markers,
    };
  }
```

- In `core/src/index.ts`, add:

```ts
export type { PoolOptions } from './scanner/session';
export type { PoolLimits } from './scan/protocol';
export { defaultWorkerCount, DEFAULT_POOL_LIMITS } from './scan/limits';
```

- In `core/test/session.test.ts`, add `pool: false,` to the three `new ScanSession({...})` calls; in `core/test/pipeline.test.ts`, add `pool: false,` to the two `new ScanSession({...})` calls. These tests pin legacy-path semantics; the pool's equivalence is covered by `session-pool.test.ts` and `pool-integration.test.ts`.

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npm run test -w core`
Expected: PASS — all suites, including the new pooled session tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scanner/session.ts core/src/index.ts core/test/session.test.ts core/test/pipeline.test.ts core/test/session-pool.test.ts
git commit -m "feat(core): make the worker pool the default scan path"
```

---

### Task 8: Benchmark harness and gated performance test

**Files:**
- Create: `core/scripts/bench-scan.ts`
- Modify: `core/package.json` (add `"bench": "tsx scripts/bench-scan.ts"` to `scripts`)
- Test: `core/test/perf.test.ts` (gated by `DUST_PERF=1`)

**Interfaces:**
- Consumes: `ScanSession`, `PoolOptions` from `core/src/index.ts`.
- Produces: a runnable benchmark + a gated perf test. The real-disk run (spec §8 validation spike) is a manual command documented in the script's header.

- [ ] **Step 1: Write the gated perf test**

`core/test/perf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ScanSession } from '../src/scanner/session';
import { Fixture } from './fixtures';

const enabled = process.env.DUST_PERF === '1';

describe.skipIf(!enabled)('performance (gated: set DUST_PERF=1)', () => {
  it('scans a 200k-file synthetic tree within budget and prints throughput', async () => {
    const fixture = new Fixture();
    try {
      const dirs = 200;
      const filesPerDir = 1000;
      for (let d = 0; d < dirs; d += 1) {
        for (let f = 0; f < filesPerDir; f += 1) {
          fixture.file(`dir-${d}/file-${f}.txt`, '');
        }
      }
      const startedAt = Date.now();
      const result = await new ScanSession({ root: fixture.root }).start();
      const elapsedMs = Date.now() - startedAt;
      const filesPerSecond = Math.round((result.filesScanned / elapsedMs) * 1000);
      // eslint-disable-next-line no-console
      console.log(`200k files: ${elapsedMs} ms (${filesPerSecond} files/sec) via ${result.filesScanned} files`);
      expect(result.status).toBe('complete');
      expect(elapsedMs).toBeLessThan(90_000);
    } finally {
      fixture.cleanup();
    }
  }, 180_000);
});
```

- [ ] **Step 2: Write the benchmark script**

`core/scripts/bench-scan.ts`:

```ts
// Benchmark harness for the Dust scan engine.
//
// Synthetic mode (default):
//   npx tsx scripts/bench-scan.ts --files 200000 [--workers 8] [--split 20000] [--legacy]
// Real-disk mode (the spec section 8 validation spike):
//   npx tsx scripts/bench-scan.ts --root "C:\\" [--workers 8] [--split 20000]
//
// The real-disk run must be executed on the developer machine (2-4M entries)
// with Windows Defender enabled, before any UI investment. If the budget
// (1M files < 45 s target, 60 s acceptable) is missed, the levers in order
// are: worker-count tuning, split-size tuning, native enumerator.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScanSession } from '../src/index';

interface Args {
  files: number;
  root: string | null;
  workers: number | undefined;
  split: number | undefined;
  legacy: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { files: 200_000, root: null, workers: undefined, split: undefined, legacy: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--files' && value) args.files = Number(value);
    else if (flag === '--root' && value) args.root = value;
    else if (flag === '--workers' && value) args.workers = Number(value);
    else if (flag === '--split' && value) args.split = Number(value);
    else if (flag === '--legacy') args.legacy = true;
  }
  return args;
}

function createSyntheticTree(files: number): string {
  const root = mkdtempSync(join(tmpdir(), 'dust-bench-'));
  const dirCount = 200;
  const perDir = Math.ceil(files / dirCount);
  for (let d = 0; d < dirCount; d += 1) {
    const dir = join(root, `dir-${d}`);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < perDir; f += 1) {
      writeFileSync(join(dir, `file-${f}.txt`), '');
    }
  }
  return root;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let root = args.root;
  let synthetic: string | null = null;
  if (!root) {
    synthetic = createSyntheticTree(args.files);
    root = synthetic;
  }

  const startedAt = Date.now();
  const session = new ScanSession({
    root,
    pool: args.legacy
      ? false
      : {
          workers: args.workers,
          splitAfterEntries: args.split,
          workerPath: join(import.meta.dirname, '..', 'src', 'scan', 'worker-entry.ts'),
          execArgv: ['--import', 'tsx'],
        },
  });
  const result = await session.start();
  const elapsedMs = Date.now() - startedAt;

  const filesPerSecond = elapsedMs > 0 ? Math.round((result.filesScanned / elapsedMs) * 1000) : 0;
  console.log(
    JSON.stringify(
      {
        root,
        mode: args.legacy ? 'legacy' : 'pool',
        workers: args.legacy ? 1 : (args.workers ?? 'default'),
        splitAfterEntries: args.split ?? 'default',
        status: result.status,
        files: result.filesScanned,
        bytes: result.bytesSeen,
        folders: result.tree.size(),
        errors: result.errors,
        elapsedMs,
        filesPerSecond,
      },
      null,
      2,
    ),
  );

  if (synthetic) rmSync(synthetic, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Add the bench script to `core/package.json`**

In `core/package.json` `scripts`, add:

```json
"bench": "tsx scripts/bench-scan.ts"
```

- [ ] **Step 4: Run the gated test and a small benchmark to verify the harness works**

Run (fast smoke): `npm run bench -w core -- --files 5000 --workers 4`
Expected: JSON summary with `"status": "complete"`, non-zero `files`, and a plausible `filesPerSecond`.

Run (gated full check): `$env:DUST_PERF='1'; npm run test -w core -- test/perf.test.ts; Remove-Item Env:DUST_PERF`
Expected: PASS with the printed throughput line (200k files). A machine that does not finish 200k files in 90 s fails — report it with numbers instead of loosening the threshold without discussion.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/scripts/bench-scan.ts core/test/perf.test.ts core/package.json
git commit -m "feat(core): add benchmark harness and gated perf test"
```

---

## Plan Self-Review Notes

- Spec coverage: worker pool + sync fs per worker (§4.2), directory-level producer/consumer queue with pulling (§4.2), 200 ms batching with completed-dir records/markers/progress (§4.2), cancellation with partial results (§4.2, §8 contract), one crash restart (§4.2), records streamed post-order and root added last (§4.2/§4.5 invariants from Plan 1), 4-8 workers (§4.2), Enumerator seam preserved (§4.3), budget validation spike + levers (§8), per-entry error handling unchanged (§9). Snapshot, rules, cleaner, IPC, and UI remain in Plans 3-9.
- Deferred to Plan 7: bundling the TS worker entry into the Electron build (esbuild) and IPC throttling to ~10 fps — today's transport takes `execArgv`/`workerPath` explicitly.
- Known limitation carried from Plan 1's final review: cloud placeholder behavior can only be verified on a real OneDrive-configured disk; the real-disk benchmark run is that check.
- Type consistency: `DirOpen` fields are produced by `worker-scan.ts`, buffered by `worker-runtime.ts`, consumed by `coordinator.ts`; `WorkerTransport` is defined in `node-worker.ts` and consumed by `coordinator.ts` and the tests.
