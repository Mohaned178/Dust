# Cleaner, Quick Clean & Dev Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the deletion half of the MVP: plan-token-gated cleanup wired through the app — row-level Clean, the global Quick Clean flow, and Dev Cleanup — with explicit confirmation, mandatory acknowledgement for irreversible items, the Recycle Bin's "open in Explorer" step, an elevation escape hatch, immediate post-cleanup tree/category/snapshot updates, and session-only "Recently cleaned" restore commands.

**Architecture:** `core/` gains `ItemResult.plannedBytes` and a pure `pruneSnapshotAfterCleanup(snapshot, report, nowTs)` that removes cleaned folders/matches/projects and shrinks the rest, delegating category math and `cleanedAt` to the existing `applyCleanupReport`. The Electron-free host gains a cleanup layer: `targeted.ts` measures rule candidate paths without a full scan, `cleanup.ts` scopes rules to quick/dev/row and maps plans/reports, `dev-cleanup.ts` groups projects and rebuilds rules from persisted project records, `cleanup-rows.ts` applies a report to retained live rows, and `engine-host.ts` owns one `Cleaner`, retires the live context after cleaning, prunes the saved snapshot, and emits `clean-item`/`cleaned` events. The renderer gains `CleanPlan`/`CleanSummary`/`RowCleanDialog`, a `QuickCleanView`, and a `DevCleanupView`. Nothing deletes without a preview and explicit confirmation; plan tokens stay single-use and in-memory in the main process.

**Tech Stack:** TypeScript (strict, ESM), Electron 44, React 19, Vite 7, Tailwind 4, vitest 3 (node + jsdom projects), `@testing-library/react` 16, `@tanstack/react-table` 8, `@tanstack/react-virtual` 3, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-17-dust-mvp-design.md` (Sections 3 #4/#6/#9-#12, 5.2-5.5, 6.3-6.4, 7.2-7.3, 7.5-7.6, 9, 10)

## Global Constraints

- **Base branch:** `plan-8-results-view` at `bdbe7a3` (contains Plans 1-8). If it has merged to `master` by execution time, branch from `master` instead — whichever tree contains `app/src/main/host/results.ts` and `app/src/main/host/engine-host.ts` with `getResults`. Create the worktree per the `superpowers:using-git-worktrees` skill: `git -C F:\Dust worktree add .worktrees/cleaner-flows -b plan-9-cleaner-flows plan-8-results-view`, then run `npm install` inside the worktree. This plan document lives on the master working tree at `F:\Dust\docs\superpowers\plans\2026-09-22-cleaner-quick-clean-dev-cleanup.md`; copy it into the worktree (`Copy-Item F:\Dust\docs\superpowers\plans\2026-09-22-cleaner-quick-clean-dev-cleanup.md .\docs\superpowers\plans\`) so the branch carries it.
- Platform: Windows first; commands run in PowerShell 7 from the worktree root. Node >= 20.19. TypeScript strict. ESM everywhere (`"type": "module"`).
- **`core/` stays Electron-free** and runs under vitest in plain Node. `core/` is the only module that touches the filesystem for deletion; the renderer touches no filesystem and reaches the engine only through `window.dust`.
- **Safety invariants (spec §5.4, binding):** no automatic deletion ever; every plan comes from `Cleaner.preview` and executes only with its single-use token; red/danger and unknown paths never enter a plan (plans are built only from rule matches); every plan item carries a non-empty recovery statement; review-grade items require explicit acknowledgement passed to `Cleaner.execute`. The renderer never constructs plan items — it sends scope + paths and renders what the host returns.
- **Quick Clean never includes `npm-projects`** (spec §7.3). Project cleanup only happens through Dev Cleanup with Analyze evidence.
- One global scan lock (`ScanLock`) covers Analyze, Quick Clean preview and cleanup execution. A conflicting operation surfaces as `{ ok: false, reason: 'busy' }`.
- Recycle Bin keeps its yellow irreversible treatment: the plan shows "open in Explorer" and requires the acknowledgement checkbox before emptying.
- `C:\Windows\Temp` items carry `adminRequired: true`; the plan offers "Relaunch as Administrator" (relaunches the app elevated; the user re-runs the cleanup). No in-process elevation.
- Post-cleanup state updates immediately: live rows/categories in the host, `cleanedAt` + pruned folders/matches/projects in the saved snapshot, and a `cleaned` event the renderer refetches on.
- Renderer security is not negotiable: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the renderer imports **no Node built-ins**.
- No comments in source files. Keep code self-describing; rationale lives in this plan.
- Do not add or upgrade dependencies. Pin `@tanstack/react-table` to v8 and `@tanstack/react-virtual` to v3 as already installed.
- Commit after every task. Before each commit run the relevant suite and the workspace typecheck: `npm run test -w core` + `npm run typecheck -w core` for Task 1; `npm run test -w app` + `npm run typecheck -w app` for app tasks; `npm run test` + `npm run typecheck` (both workspaces) before the final commit.

---

## File Structure

**Modified in `core/`:**

- `core/src/cleaner/executor.ts` — **modify**: `ItemResult.plannedBytes`, `baseResult` returns it.
- `core/src/cleaner/cleaner.ts` — **modify**: the `RULE-NOT-IN-PLAN` result carries `plannedBytes`.
- `core/src/snapshot/prune.ts` — **create**: `pruneSnapshotAfterCleanup(snapshot, report, nowTs): SnapshotData`.
- `core/src/index.ts` — **modify**: export `pruneSnapshotAfterCleanup`.
- `core/test/snapshot-prune.test.ts` — **create**; `core/test/executor.test.ts` — **modify** (plannedBytes assertion).

**New/modified in `app/`:**

- `app/src/shared/ipc.ts` — **modify**: `IPC.cleanPreview`/`cleanExecute`/`devCleanupGet`/`pinsSet`/`relaunchElevated`, cleanup/dev-cleanup types, `ScanEvent` `clean-item`/`cleaned` variants, five new `DustApi` methods.
- `app/src/main/host/targeted.ts` — **create**: `measurePath`, `measureDirectories`.
- `app/src/main/host/cleanup.ts` — **create**: path helpers, `needsElevation`, `filterRuleMatches`, `scopeRules`, plan/report DTO mapping, `snapshotRules`, `subtractCategories`.
- `app/src/main/host/dev-cleanup.ts` — **create**: `toDevProjects`, `groupDevProjects`, `projectNameOf`.
- `app/src/main/host/cleanup-rows.ts` — **create**: `applyCleanReport`.
- `app/src/main/host/results.ts` — **modify**: export `pathKey`.
- `app/src/main/host/engine-host.ts` — **modify**: retained live run, `Cleaner`, `previewClean`/`executeClean`/`getDevCleanup`/`setPin`, snapshot pruning, `clean-item`/`cleaned` events, recently-cleaned memory.
- `app/src/main/elevation.ts` — **create**: `buildElevationCommand`.
- `app/src/main/ipc.ts` — **modify**: register the five new channels, parse untrusted payloads, `ShellActions.relaunchElevated`.
- `app/src/main/index.ts` — **modify**: pass the PowerShell elevation action.
- `app/src/preload/index.ts` — **modify**: bridge the new methods.
- `app/renderer/src/clean.ts` — **create**: `newCleanId`, `cleanErrorMessage`, `recoveryText`, `groupItemsByCategory`.
- `app/renderer/src/components/CleanPlan.tsx`, `components/CleanSummary.tsx`, `components/RowCleanDialog.tsx` — **create**.
- `app/renderer/src/components/TreeTable.tsx` — **modify**: Clean button for rule-matched rows, `onClean` prop.
- `app/renderer/src/pages/ResultsView.tsx` — **modify**: row Clean dialog, `cleaned` refetch, Dev Cleanup entry from the `npm-projects` strip row.
- `app/renderer/src/pages/QuickCleanView.tsx`, `pages/DevCleanupView.tsx` — **create**.
- `app/renderer/src/pages/Dashboard.tsx`, `components/DiskCard.tsx`, `App.tsx` — **modify**: Quick Clean button and routing.
- `app/test/*.test.ts` — **create**: `targeted.test.ts`, `cleanup.test.ts`, `dev-cleanup.test.ts`, `cleanup-rows.test.ts`, `elevation.test.ts`; **modify**: `engine-host.test.ts`, `ipc.test.ts`, `ipc-contract.test.ts`, `renderer/fakes.ts`.
- `app/test/renderer/*.test.tsx` — **create**: `clean-plan.test.tsx`, `clean-summary.test.tsx`, `quick-clean-view.test.tsx`, `dev-cleanup-view.test.tsx`; **modify**: `tree-table.test.tsx`, `results-view.test.tsx`, `dashboard.test.tsx`, `app.test.tsx`.
- `app/README.md` — **modify**: smoke checklist items 14-19.

---

### Task 1: Core — planned bytes and snapshot pruning after cleanup

**Files:**
- Modify: `core/src/cleaner/executor.ts`, `core/src/cleaner/cleaner.ts`, `core/src/index.ts`
- Create: `core/src/snapshot/prune.ts`, `core/test/snapshot-prune.test.ts`
- Modify tests: `core/test/executor.test.ts`

**Interfaces:**
- Consumes: `CleanupReport`/`ItemResult` from `core/src/cleaner/`, `applyCleanupReport` from `core/src/snapshot/build.ts`, `SnapshotData`/`SnapshotFolder`/`SnapshotMatch` from `core/src/snapshot/schema.ts`, `ProjectRecord` from `core/src/projects/types.ts`.
- Produces: `ItemResult.plannedBytes: number`; `pruneSnapshotAfterCleanup(snapshot: SnapshotData, report: CleanupReport, nowTs: number): SnapshotData`.

- [ ] **Step 1: Write the failing prune test**

`core/test/snapshot-prune.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CleanupReport } from '../src/cleaner/cleaner';
import type { ItemResult } from '../src/cleaner/executor';
import type { ProjectRecord } from '../src/projects/types';
import { SNAPSHOT_SCHEMA_VERSION } from '../src/snapshot/schema';
import type { SnapshotData, SnapshotFolder } from '../src/snapshot/schema';
import { pruneSnapshotAfterCleanup } from '../src/snapshot/prune';

function folder(
  path: string,
  bytes: number,
  allocatedBytes: number,
  fileCount: number,
  folderCount: number,
  childCount: number,
): SnapshotFolder {
  return {
    path,
    name: path,
    bytes,
    allocatedBytes,
    fileCount,
    folderCount,
    newestMtimeMs: 5,
    errorCount: 0,
    partial: false,
    complete: true,
    childCount,
  };
}

function item(overrides: Partial<ItemResult> & { path: string }): ItemResult {
  return {
    ruleId: 'system-temp',
    action: 'delete-path',
    status: 'done',
    plannedBytes: 0,
    deletedBytes: 0,
    skippedLocked: 0,
    errors: [],
    ...overrides,
  };
}

function report(items: ItemResult[]): CleanupReport {
  return {
    planId: 'plan-1',
    startedAt: 10,
    finishedAt: 20,
    items,
    deletedBytes: items.reduce((sum, entry) => sum + entry.deletedBytes, 0),
    skippedLocked: items.reduce((sum, entry) => sum + entry.skippedLocked, 0),
    itemErrors: items.reduce((sum, entry) => sum + entry.errors.length, 0),
  };
}

function project(path: string, nodeModulesPath: string, bytes: number): ProjectRecord {
  return {
    path,
    name: 'proj',
    kind: 'project',
    packageManager: 'npm',
    pinned: false,
    workspaceCount: 0,
    nodeModules: { paths: [{ path: nodeModulesPath, bytes }], bytes },
    activity: { ms: 100, source: 'files' },
    recency: 'dead',
    restorability: { grade: 'green', reasons: [], restoreCommand: 'npm ci' },
    offered: true,
    evidence: ['npm'],
  };
}

function snapshot(overrides: Partial<SnapshotData> = {}): SnapshotData {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    rulesVersion: '1',
    root: 'C:\\',
    startedAt: 1,
    finishedAt: 2,
    status: 'complete',
    cleanedAt: null,
    disks: [],
    categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 30, items: 2 }],
    matches: [
      { path: 'C:\\Temp', ruleId: 'system-temp', category: 'temp', bytes: 10, grade: 'safe', evidence: 'temp' },
      { path: 'C:\\Temp\\deep', ruleId: 'system-temp', category: 'temp', bytes: 20, grade: 'safe', evidence: 'deep' },
    ],
    projects: [],
    folders: [
      folder('C:\\', 30, 8192, 2, 1, 1),
      folder('C:\\Temp', 30, 8192, 2, 1, 1),
      folder('C:\\Temp\\deep', 20, 4096, 1, 0, 0),
    ],
    ...overrides,
  };
}

describe('pruneSnapshotAfterCleanup', () => {
  it('removes a fully deleted subtree, deducts ancestors and prunes matches', () => {
    const result = pruneSnapshotAfterCleanup(
      snapshot(),
      report([item({ path: 'C:\\Temp', plannedBytes: 30, deletedBytes: 30, status: 'done' })]),
      20,
    );

    expect(result.cleanedAt).toBe(20);
    expect(result.folders.map((entry) => entry.path)).toEqual(['C:\\']);
    expect(result.folders[0]).toMatchObject({ bytes: 0, allocatedBytes: 0, fileCount: 0, folderCount: 0, childCount: 0 });
    expect(result.matches).toEqual([]);
    expect(result.categories).toEqual([{ ruleId: 'system-temp', category: 'temp', bytes: 0, items: 0 }]);
  });

  it('keeps partial items and shrinks their folders and matches', () => {
    const result = pruneSnapshotAfterCleanup(
      snapshot(),
      report([item({ path: 'C:\\Temp\\deep', plannedBytes: 20, deletedBytes: 5, status: 'partial' })]),
      20,
    );

    expect(result.folders.find((entry) => entry.path === 'C:\\Temp')?.bytes).toBe(25);
    expect(result.folders.find((entry) => entry.path === 'C:\\Temp')?.allocatedBytes).toBe(8192);
    expect(result.folders.find((entry) => entry.path === 'C:\\Temp\\deep')?.bytes).toBe(15);
    expect(result.matches.find((match) => match.path === 'C:\\Temp\\deep')?.bytes).toBe(15);
    expect(result.matches.find((match) => match.path === 'C:\\Temp')?.bytes).toBe(10);
    expect(result.categories).toEqual([{ ruleId: 'system-temp', category: 'temp', bytes: 25, items: 2 }]);
  });

  it('deducts planned bytes when the exact folder is outside the depth-limited map', () => {
    const base = snapshot({
      folders: [folder('C:\\', 30, 8192, 2, 1, 1), folder('C:\\Temp', 30, 8192, 2, 1, 0)],
    });
    const result = pruneSnapshotAfterCleanup(
      base,
      report([item({ path: 'C:\\Temp\\deep', plannedBytes: 20, deletedBytes: 0, status: 'already-gone' })]),
      20,
    );

    expect(result.folders.map((entry) => entry.path)).toEqual(['C:\\', 'C:\\Temp']);
    expect(result.folders.find((entry) => entry.path === 'C:\\')?.bytes).toBe(10);
    expect(result.folders.find((entry) => entry.path === 'C:\\Temp')?.bytes).toBe(10);
    expect(result.matches.map((match) => match.path)).toEqual(['C:\\Temp']);
    expect(result.categories).toEqual([{ ruleId: 'system-temp', category: 'temp', bytes: 10, items: 1 }]);
  });

  it('drops fully cleaned projects and shrinks partially cleaned ones', () => {
    const base = snapshot({
      projects: [
        project('C:\\a', 'C:\\a\\node_modules', 15),
        project('C:\\b', 'C:\\b\\node_modules', 25),
      ],
    });
    const result = pruneSnapshotAfterCleanup(
      base,
      report([
        item({ path: 'C:\\a\\node_modules', plannedBytes: 15, deletedBytes: 15, status: 'done' }),
        item({ path: 'C:\\b\\node_modules', plannedBytes: 25, deletedBytes: 5, status: 'partial' }),
      ]),
      20,
    );

    expect(result.projects.map((entry) => entry.path)).toEqual(['C:\\b']);
    expect(result.projects[0]?.nodeModules.bytes).toBe(20);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w core -- test/snapshot-prune.test.ts`
Expected: FAIL — `Failed to resolve import "../src/snapshot/prune"`.

- [ ] **Step 3: Add `plannedBytes` to `ItemResult`**

`core/src/cleaner/executor.ts` — add `plannedBytes: number;` to `ItemResult` after `action`, and change `baseResult` to:

```ts
function baseResult(item: PlanItem): Pick<ItemResult, 'ruleId' | 'path' | 'plannedBytes'> {
  return { ruleId: item.ruleId, path: item.path, plannedBytes: item.bytes };
}
```

`core/src/cleaner/cleaner.ts` — in the `RULE-NOT-IN-PLAN` result literal add `plannedBytes: item.bytes,` after `action: item.action.kind,`.

- [ ] **Step 4: Create `core/src/snapshot/prune.ts`**

```ts
import { dirname } from 'node:path';
import type { CleanupReport } from '../cleaner/cleaner';
import type { ProjectRecord } from '../projects/types';
import { applyCleanupReport } from './build';
import type { SnapshotData, SnapshotFolder, SnapshotMatch } from './schema';

interface Deduction {
  key: string;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
}

export function pruneSnapshotAfterCleanup(
  snapshot: SnapshotData,
  report: CleanupReport,
  nowTs: number,
): SnapshotData {
  const folderByKey = new Map(snapshot.folders.map((entry) => [pathKey(entry.path), entry]));
  const gonePaths: string[] = [];
  const removedKeys: string[] = [];
  const partialFreed = new Map<string, number>();
  const deductions: Deduction[] = [];

  for (const item of report.items) {
    const key = pathKey(item.path);
    if (item.status === 'done' || item.status === 'already-gone') {
      const entry = folderByKey.get(key);
      gonePaths.push(item.path);
      removedKeys.push(key);
      deductions.push({
        key,
        bytes: entry?.bytes ?? item.plannedBytes,
        allocatedBytes: entry?.allocatedBytes ?? item.plannedBytes,
        fileCount: entry?.fileCount ?? 0,
        folderCount: entry?.folderCount ?? 0,
      });
    } else if (item.status === 'partial') {
      partialFreed.set(key, (partialFreed.get(key) ?? 0) + item.deletedBytes);
      deductions.push({
        key,
        bytes: item.deletedBytes,
        allocatedBytes: item.deletedBytes,
        fileCount: 0,
        folderCount: 0,
      });
    }
  }

  const isGone = (path: string): boolean => {
    const key = pathKey(path);
    return removedKeys.some((removed) => isSameOrUnder(key, removed));
  };

  const removedChildren = new Map<string, number>();
  for (const path of gonePaths) {
    const parentKey = pathKey(dirname(path));
    removedChildren.set(parentKey, (removedChildren.get(parentKey) ?? 0) + 1);
  }

  const folders: SnapshotFolder[] = snapshot.folders
    .filter((entry) => !isGone(entry.path))
    .map((entry) => {
      const key = pathKey(entry.path);
      let next = entry;
      for (const deduction of deductions) {
        if (!isSameOrUnder(deduction.key, key)) continue;
        next = {
          ...next,
          bytes: Math.max(next.bytes - deduction.bytes, 0),
          allocatedBytes: Math.max(next.allocatedBytes - deduction.allocatedBytes, 0),
          fileCount: Math.max(next.fileCount - deduction.fileCount, 0),
          folderCount: Math.max(next.folderCount - deduction.folderCount, 0),
        };
      }
      const removed = removedChildren.get(key) ?? 0;
      if (removed > 0) next = { ...next, childCount: Math.max(next.childCount - removed, 0) };
      return next;
    });

  const matches: SnapshotMatch[] = [];
  for (const match of snapshot.matches) {
    if (isGone(match.path)) continue;
    const freed = partialFreed.get(pathKey(match.path));
    matches.push(freed === undefined ? match : { ...match, bytes: Math.max(match.bytes - freed, 0) });
  }

  const projects: ProjectRecord[] = [];
  for (const entry of snapshot.projects) {
    const locations = entry.nodeModules.paths;
    if (locations.length > 0 && locations.every((location) => isGone(location.path))) continue;
    let bytes = entry.nodeModules.bytes;
    let changed = false;
    for (const location of locations) {
      const freed = partialFreed.get(pathKey(location.path));
      if (freed !== undefined) {
        bytes -= freed;
        changed = true;
      }
    }
    projects.push(
      changed ? { ...entry, nodeModules: { ...entry.nodeModules, bytes: Math.max(bytes, 0) } } : entry,
    );
  }

  const categoryMap: Record<string, string> = {};
  for (const entry of snapshot.categories) categoryMap[entry.ruleId] = entry.category;
  const withCategories = applyCleanupReport(snapshot, report, categoryMap, nowTs);
  const categories = withCategories.categories.map((entry) => {
    const removed = report.items.filter(
      (item) => item.ruleId === entry.ruleId && (item.status === 'done' || item.status === 'already-gone'),
    ).length;
    return removed === 0 ? entry : { ...entry, items: Math.max(entry.items - removed, 0) };
  });

  return { ...withCategories, categories, folders, matches, projects };
}

function isSameOrUnder(key: string, rootKey: string): boolean {
  if (key === rootKey) return true;
  const base = rootKey.endsWith('\\') ? rootKey : `${rootKey}\\`;
  return key.startsWith(base) || key.startsWith(`${rootKey}/`);
}

function pathKey(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}
```

- [ ] **Step 5: Export the pruner and assert `plannedBytes`**

`core/src/index.ts` — add the pruner export directly after the existing snapshot builder export line:

```ts
export { pruneSnapshotAfterCleanup } from './snapshot/prune';
```

`core/test/executor.test.ts` — in `executes a delete-path item`, change the item to carry bytes and assert the new field:

```ts
    const result = executeItem(item(dir, { bytes: 3 }));
    expect(result).toMatchObject({ status: 'done', deletedBytes: 3, plannedBytes: 3, action: 'delete-path' });
```

If any other core test compares a whole `ItemResult` with `toEqual`, add `plannedBytes: <the plan item's bytes>` to the expected literal.

- [ ] **Step 6: Run the core suite and typecheck**

Run: `npm run test -w core` then `npm run typecheck -w core`
Expected: all core tests pass (the four prune tests included); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add core
git commit -m "feat(core): prune snapshots after cleanup with planned-byte reporting"
```

---

### Task 2: App shared contract — cleanup IPC, types and test fakes

**Files:**
- Modify: `app/src/shared/ipc.ts`, `app/src/preload/index.ts`, `app/test/ipc-contract.test.ts`, `app/test/renderer/fakes.ts`

**Interfaces:**
- Consumes: type-only `ActionGrade`, `CategoryId` from `@dust/core`.
- Produces: `IPC.cleanPreview`/`cleanExecute`/`devCleanupGet`/`pinsSet`/`relaunchElevated`; `CleanScope`, `CleanPreviewRequest`, `CleanRecovery`, `CleanItemPreview`, `CleanPlanTotals`, `CleanPreview`, `CleanPreviewResult`, `CleanExecuteRequest`, `CleanItemResult`, `CleanReport`, `CleanExecuteResult`, `DevProject`, `DevGroup`, `RecentlyCleanedProject`, `DevCleanupState`, `SetPinResult`; `ScanEvent` `clean-item`/`cleaned`; `DustApi.previewClean`/`executeClean`/`getDevCleanup`/`setPin`/`relaunchElevated`. Test fakes gain `makeCleanPreview`, `makeCleanReport`, `makeDevProject`, `makeDevCleanupState`.

- [ ] **Step 1: Extend the shared IPC contract**

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
  cleanPreview: 'dust:clean:preview',
  cleanExecute: 'dust:clean:execute',
  devCleanupGet: 'dust:dev-cleanup:get',
  pinsSet: 'dust:pins:set',
  relaunchElevated: 'dust:app:relaunch-elevated',
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

export type CleanScope = 'quick' | 'dev' | 'row';

export type CleanPreviewRequest =
  | { scope: 'quick' }
  | { scope: 'dev'; root: string; paths: string[] }
  | { scope: 'row'; root: string; paths: string[] };

export interface CleanRecovery {
  kind: 'regenerate' | 'junk';
  text: string;
}

export interface CleanItemPreview {
  ruleId: string;
  category: CategoryId;
  path: string;
  name: string;
  bytes: number;
  grade: ActionGrade;
  recovery: CleanRecovery;
  evidence: string;
  action: 'delete-path' | 'empty-recycle-bin';
  adminRequired: boolean;
}

export interface CleanPlanTotals {
  bytes: number;
  items: number;
  reviewBytes: number;
  reviewItems: number;
}

export interface CleanPreview {
  planId: string;
  createdAt: number;
  root: string;
  source: 'live' | 'snapshot' | 'targeted';
  scanAgeMs: number | null;
  items: CleanItemPreview[];
  totals: CleanPlanTotals;
  refused: Array<{ ruleId: string; path: string; reason: string }>;
}

export type CleanPreviewResult =
  | { ok: true; preview: CleanPreview }
  | { ok: false; reason: 'busy'; running: ScanKind }
  | { ok: false; reason: 'empty-selection' | 'invalid-root'; message: string }
  | { ok: false; reason: 'failed'; message: string };

export interface CleanExecuteRequest {
  cleanId: string;
  planId: string;
  acknowledge?: string[];
}

export interface CleanItemResult {
  ruleId: string;
  path: string;
  category: CategoryId;
  action: 'delete-path' | 'empty-recycle-bin';
  status: 'done' | 'partial' | 'failed' | 'already-gone';
  plannedBytes: number;
  deletedBytes: number;
  skippedLocked: number;
  errorCount: number;
  restoreCommand: string | null;
}

export interface CleanReport {
  planId: string;
  scope: CleanScope;
  root: string;
  startedAt: number;
  finishedAt: number;
  items: CleanItemResult[];
  deletedBytes: number;
  skippedLocked: number;
  itemErrors: number;
  remainingReclaimableBytes: number;
  cleanedAt: number;
}

export type CleanExecuteResult =
  | { ok: true; report: CleanReport }
  | { ok: false; reason: 'busy'; running: ScanKind }
  | {
      ok: false;
      reason: 'unknown-plan' | 'consumed-plan' | 'unacknowledged-review' | 'rule-not-in-plan';
    }
  | { ok: false; reason: 'failed'; message: string };

export interface DevProject {
  path: string;
  name: string;
  kind: 'project' | 'monorepo' | 'orphaned-node-modules';
  packageManager: string;
  recency: 'active' | 'occasional' | 'dead' | 'unknown';
  pinned: boolean;
  offered: boolean;
  nodeModulesBytes: number;
  nodeModulesPaths: string[];
  activityMs: number | null;
  activitySource: 'files' | 'git-reflog' | 'manifest' | 'unknown';
  grade: 'green' | 'yellow' | 'not-offered';
  reasons: string[];
  restoreCommand: string | null;
  workspaceCount: number;
}

export interface DevGroup {
  id: 'dead' | 'occasional' | 'active' | 'orphaned' | 'pinned';
  label: string;
  projects: DevProject[];
}

export interface RecentlyCleanedProject {
  root: string;
  path: string;
  name: string;
  bytes: number;
  restoreCommand: string | null;
  cleanedAt: number;
}

export interface DevCleanupState {
  source: 'live' | 'snapshot' | 'empty';
  root: string;
  finishedAt: number | null;
  groups: DevGroup[];
  recentlyCleaned: RecentlyCleanedProject[];
}

export type SetPinResult = { ok: true; pins: string[] } | { ok: false; message: string };

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
  | { type: 'failed'; runId: string; message: string }
  | { type: 'clean-item'; cleanId: string; item: CleanItemResult }
  | { type: 'cleaned'; cleanId: string; root: string };

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
  previewClean(request: CleanPreviewRequest): Promise<CleanPreviewResult>;
  executeClean(request: CleanExecuteRequest): Promise<CleanExecuteResult>;
  getDevCleanup(root: string): Promise<DevCleanupState>;
  setPin(path: string, pinned: boolean): Promise<SetPinResult>;
  relaunchElevated(): Promise<void>;
  onScanEvent(handler: (event: ScanEvent) => void): () => void;
}
```

- [ ] **Step 2: Update the preload bridge**

Replace `app/src/preload/index.ts` with:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  CleanExecuteRequest,
  CleanExecuteResult,
  CleanPreviewRequest,
  CleanPreviewResult,
  DashboardState,
  DevCleanupState,
  DustApi,
  ResultsState,
  ScanEvent,
  SetPinResult,
  StartAnalyzeResult,
} from '../shared/ipc';

const api: DustApi = {
  getDashboard: () => ipcRenderer.invoke(IPC.dashboardGet) as Promise<DashboardState>,
  startAnalyze: (volume: string) => ipcRenderer.invoke(IPC.scanStart, volume) as Promise<StartAnalyzeResult>,
  cancelScan: () => ipcRenderer.invoke(IPC.scanCancel) as Promise<void>,
  getResults: (root: string) => ipcRenderer.invoke(IPC.resultsGet, root) as Promise<ResultsState>,
  revealPath: (path: string) => ipcRenderer.invoke(IPC.revealPath, path) as Promise<void>,
  previewClean: (request: CleanPreviewRequest) =>
    ipcRenderer.invoke(IPC.cleanPreview, request) as Promise<CleanPreviewResult>,
  executeClean: (request: CleanExecuteRequest) =>
    ipcRenderer.invoke(IPC.cleanExecute, request) as Promise<CleanExecuteResult>,
  getDevCleanup: (root: string) => ipcRenderer.invoke(IPC.devCleanupGet, root) as Promise<DevCleanupState>,
  setPin: (path: string, pinned: boolean) => ipcRenderer.invoke(IPC.pinsSet, path, pinned) as Promise<SetPinResult>,
  relaunchElevated: () => ipcRenderer.invoke(IPC.relaunchElevated) as Promise<void>,
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

- [ ] **Step 3: Update the IPC contract test**

`app/test/ipc-contract.test.ts` — change `expect(channels).toHaveLength(6);` to `expect(channels).toHaveLength(11);`.

- [ ] **Step 4: Extend the renderer test fakes**

Replace `app/test/renderer/fakes.ts` with:

```ts
import type {
  CategorySummaryRow,
  CleanPreview,
  CleanReport,
  DashboardState,
  DevCleanupState,
  DevProject,
  DustApi,
  ResultRow,
  ResultsState,
} from '../../src/shared/ipc';

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
      childCount: 3,
      grade: 'danger',
      gradeReason: 'System-critical - read-only',
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
      gradeReason: 'Unrecognized folder - review before deleting',
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
      gradeReason: 'Unrecognized folder - review before deleting',
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
      gradeReason: 'Temporary files - apps recreate them as needed',
      action: {
        ruleId: 'system-temp',
        category: 'temp',
        grade: 'safe',
        evidence: 'User TEMP directory - junk by definition',
      },
    },
    {
      path: 'C:\\Windows',
      name: 'Windows',
      parent: root,
      bytes: 768 * 1024,
      allocatedBytes: 1024 * 1024,
      fileCount: 12,
      folderCount: 3,
      linkCount: 0,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: false,
      complete: true,
      childCount: 0,
      grade: 'danger',
      gradeReason: 'System-critical - read-only',
      action: null,
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

export function makeCleanPreview(overrides: Partial<CleanPreview> = {}): CleanPreview {
  return {
    planId: 'plan-1',
    createdAt: 1,
    root: 'C:\\',
    source: 'live',
    scanAgeMs: 60_000,
    items: [
      {
        ruleId: 'system-temp',
        category: 'temp',
        path: 'C:\\Users\\x\\AppData\\Local\\Temp',
        name: 'Temp',
        bytes: 10_000,
        grade: 'safe',
        recovery: { kind: 'junk', text: 'Temporary files are recreated by the apps that need them' },
        evidence: 'User TEMP directory - junk by definition',
        action: 'delete-path',
        adminRequired: false,
      },
    ],
    totals: { bytes: 10_000, items: 1, reviewBytes: 0, reviewItems: 0 },
    refused: [],
    ...overrides,
  };
}

export function makeCleanReport(overrides: Partial<CleanReport> = {}): CleanReport {
  return {
    planId: 'plan-1',
    scope: 'quick',
    root: 'C:\\',
    startedAt: 1,
    finishedAt: 2,
    items: [
      {
        ruleId: 'system-temp',
        path: 'C:\\Users\\x\\AppData\\Local\\Temp',
        category: 'temp',
        action: 'delete-path',
        status: 'done',
        plannedBytes: 10_000,
        deletedBytes: 10_000,
        skippedLocked: 0,
        errorCount: 0,
        restoreCommand: null,
      },
    ],
    deletedBytes: 10_000,
    skippedLocked: 0,
    itemErrors: 0,
    remainingReclaimableBytes: 0,
    cleanedAt: 2,
    ...overrides,
  };
}

export function makeDevProject(overrides: Partial<DevProject> = {}): DevProject {
  return {
    path: 'C:\\dev\\dead-app',
    name: 'dead-app',
    kind: 'project',
    packageManager: 'npm',
    recency: 'dead',
    pinned: false,
    offered: true,
    nodeModulesBytes: 512 * 1024,
    nodeModulesPaths: ['C:\\dev\\dead-app\\node_modules'],
    activityMs: Date.UTC(2025, 0, 1),
    activitySource: 'git-reflog',
    grade: 'green',
    reasons: [],
    restoreCommand: 'npm ci',
    workspaceCount: 0,
    ...overrides,
  };
}

export function makeDevCleanupState(overrides: Partial<DevCleanupState> = {}): DevCleanupState {
  const project = makeDevProject();
  return {
    source: 'snapshot',
    root: 'C:\\',
    finishedAt: Date.UTC(2026, 0, 2),
    groups: [
      { id: 'dead', label: 'Dead (more than 180 days)', projects: [project] },
      { id: 'occasional', label: 'Occasional (31-180 days)', projects: [] },
      { id: 'active', label: 'Active (30 days or less)', projects: [] },
      { id: 'orphaned', label: 'Orphaned node_modules', projects: [] },
      { id: 'pinned', label: 'Pinned', projects: [] },
    ],
    recentlyCleaned: [],
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
    getResults: async (root) => makeResultsState({ root }),
    revealPath: async () => {},
    previewClean: async () => ({ ok: true, preview: makeCleanPreview() }),
    executeClean: async () => ({ ok: true, report: makeCleanReport() }),
    getDevCleanup: async (root) => makeDevCleanupState({ root }),
    setPin: async () => ({ ok: true, pins: [] }),
    relaunchElevated: async () => {},
    onScanEvent: () => () => {},
    ...overrides,
  };
}
```

- [ ] **Step 5: Run typecheck and the contract test**

Run: `npm run typecheck -w app` then `npm run test -w app -- test/ipc-contract.test.ts`
Expected: typecheck clean (the preload bridge satisfies `DustApi`); contract test PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/shared/ipc.ts app/src/preload/index.ts app/test/ipc-contract.test.ts app/test/renderer/fakes.ts
git commit -m "feat(app): add cleanup IPC contract and renderer fakes"
```

---

### Task 3: Targeted measurement without a full scan

**Files:**
- Create: `app/src/main/host/targeted.ts`, `app/test/targeted.test.ts`

**Interfaces:**
- Consumes: `AggregateTree`, `NodeFsEnumerator`, `scanTree` (values) and `FolderRecord` (type) from `@dust/core`.
- Produces: `measurePath(path: string): FolderRecord | null`; `measureDirectories(paths: readonly string[], measure?: (path: string) => FolderRecord | null): AggregateTree`.

- [ ] **Step 1: Write the failing tests**

`app/test/targeted.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measureDirectories, measurePath } from '../src/main/host/targeted';
import { TempTree } from './fixtures';

describe('measureDirectories', () => {
  it('measures unique directories, keeps order, and skips missing paths', () => {
    const calls: string[] = [];
    const tree = measureDirectories(['C:\\a', 'c:\\a', 'C:\\b'], (path) => {
      calls.push(path);
      if (path.toLowerCase() === 'c:\\b') return null;
      return {
        path,
        bytes: 5,
        allocatedBytes: 4096,
        fileCount: 1,
        folderCount: 0,
        linkCount: 0,
        newestMtimeMs: 7,
        errorCount: 0,
        partial: false,
      };
    });

    expect(calls).toEqual(['C:\\a', 'C:\\b']);
    expect(tree.get('C:\\a')?.bytes).toBe(5);
    expect(tree.get('C:\\a')?.allocatedBytes).toBe(4096);
    expect(tree.get('C:\\b')).toBeUndefined();
  });
});

describe('measurePath', () => {
  let fixture: TempTree;

  beforeEach(() => {
    fixture = new TempTree();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('measures a real directory tree including nested files', () => {
    fixture.file('temp/a.bin', 'abcde');
    fixture.file('temp/deep/b.bin', '0123456789');

    const record = measurePath(join(fixture.root, 'temp'));

    expect(record?.bytes).toBe(15);
    expect(record?.fileCount).toBe(2);
    expect(record?.folderCount).toBe(1);
  });

  it('returns null for missing paths and for files', () => {
    const file = fixture.file('one.bin', 'x');
    expect(measurePath(join(fixture.root, 'missing'))).toBeNull();
    expect(measurePath(file)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/targeted.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/host/targeted"`.

- [ ] **Step 3: Create `app/src/main/host/targeted.ts`**

```ts
import { lstatSync } from 'node:fs';
import { AggregateTree, NodeFsEnumerator, scanTree } from '@dust/core';
import type { FolderRecord } from '@dust/core';

export function measurePath(path: string): FolderRecord | null {
  try {
    if (!lstatSync(path).isDirectory()) return null;
  } catch {
    return null;
  }
  try {
    return scanTree({ root: path, enumerator: new NodeFsEnumerator(), isExcluded: () => false }).rootRecord;
  } catch {
    return null;
  }
}

export function measureDirectories(
  paths: readonly string[],
  measure: (path: string) => FolderRecord | null = measurePath,
): AggregateTree {
  const tree = new AggregateTree();
  const seen = new Set<string>();
  for (const path of paths) {
    const key = path.replace(/[\\/]+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const record = measure(path);
    if (record !== null) tree.addFolder(record);
  }
  return tree;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w app -- test/targeted.test.ts` then `npm run typecheck -w app`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/host/targeted.ts app/test/targeted.test.ts
git commit -m "feat(app): add targeted directory measurement for quick clean"
```

### Task 4: Cleanup plan model — scopes, DTOs, snapshot rules

**Files:**
- Create: `app/src/main/host/cleanup.ts`, `app/test/cleanup.test.ts`

**Interfaces:**
- Consumes: `CategoryId`, `CleanupPlan`, `ItemResult`, `PlanItem`, `ProjectRecord`, `Recovery`, `Rule`, `RuleMatch`, `SnapshotCategory`, `SnapshotData`, `SnapshotMatch` from `@dust/core`; `isCategoryId` from `../../shared/categories`; cleanup DTO types from `../../shared/ipc`.
- Produces: `CleanupEnv { windowsDir?: string }`; `canonicalKey`, `samePath`, `isUnderAny`, `needsElevation`, `filterRuleMatches`, `scopeRules`, `defaultRecovery`, `snapshotRules`, `toCleanItem`, `toCleanPreview`, `toCleanItemResult`, `toCleanReport`, `subtractCategories`.

- [ ] **Step 1: Write the failing tests**

`app/test/cleanup.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/cleanup.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/host/cleanup"`.

- [ ] **Step 3: Create `app/src/main/host/cleanup.ts`**

```ts
import { basename } from 'node:path';
import type {
  CategoryId,
  CleanupPlan,
  CleanupReport,
  ItemResult,
  PlanItem,
  ProjectRecord,
  Recovery,
  Rule,
  SnapshotCategory,
  SnapshotData,
  SnapshotMatch,
} from '@dust/core';
import { isCategoryId } from '../../shared/categories';
import type {
  CleanItemPreview,
  CleanItemResult,
  CleanPlanTotals,
  CleanPreview,
  CleanReport,
  CleanScope,
} from '../../shared/ipc';

export interface CleanupEnv {
  windowsDir?: string;
}

export function canonicalKey(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return canonicalKey(a) === canonicalKey(b);
}

export function isUnderAny(path: string, roots: readonly string[]): boolean {
  const key = canonicalKey(path);
  return roots.some((root) => {
    const base = canonicalKey(root);
    if (key === base) return true;
    const prefix = base.endsWith('\\') ? base : `${base}\\`;
    return key.startsWith(prefix) || key.startsWith(`${base}/`);
  });
}

export function needsElevation(path: string, env: CleanupEnv): boolean {
  return env.windowsDir !== undefined && env.windowsDir.length > 0 && isUnderAny(path, [env.windowsDir]);
}

export function filterRuleMatches(rule: Rule, predicate: ((path: string) => boolean) | null): Rule {
  if (predicate === null) return rule;
  return {
    ...rule,
    match: async (ctx) => (await rule.match(ctx)).filter((entry) => predicate(entry.path)),
  };
}

export function scopeRules(rules: Rule[], scope: CleanScope, paths: readonly string[]): Rule[] {
  if (scope === 'quick') return rules.filter((rule) => rule.category !== 'npm-projects');
  if (paths.length === 0) return [];
  if (scope === 'row') {
    const target = paths[0]!;
    return rules.map((rule) => filterRuleMatches(rule, (path) => samePath(path, target)));
  }
  const roots = [...paths];
  return rules.map((rule) => filterRuleMatches(rule, (path) => isUnderAny(path, roots)));
}

export function defaultRecovery(ruleId: string): Recovery {
  switch (ruleId) {
    case 'system-temp':
      return { kind: 'junk', reason: 'Temporary files are recreated by the apps that need them' };
    case 'recycle-bin':
      return { kind: 'junk', reason: 'Emptied items are permanently gone' };
    case 'npm-cache':
      return { kind: 'junk', reason: 'Download cache; npm re-downloads packages on demand' };
    case 'npm-project-modules':
      return { kind: 'junk', reason: 'No manifest found - node_modules cannot be recreated' };
    default:
      return ruleId.startsWith('cache-')
        ? { kind: 'junk', reason: 'Cache is re-downloaded on next use' }
        : { kind: 'junk', reason: `Matched by rule ${ruleId}` };
  }
}

function recoveryForMatch(match: SnapshotMatch, projects: ProjectRecord[]): Recovery {
  if (match.ruleId === 'npm-project-modules') {
    const entry = projects.find((candidate) => isUnderAny(match.path, [candidate.path]));
    if (entry?.restorability.restoreCommand) {
      return { kind: 'regenerate', command: entry.restorability.restoreCommand };
    }
  }
  return defaultRecovery(match.ruleId);
}

export function snapshotRules(snapshot: SnapshotData, pins: readonly string[]): Rule[] {
  const pinned = new Set(pins.map(canonicalKey));
  const offered = snapshot.projects.filter(
    (entry) => entry.offered && !pinned.has(canonicalKey(entry.path)),
  );

  const byRuleId = new Map<string, SnapshotMatch[]>();
  for (const match of snapshot.matches) {
    if (
      match.ruleId === 'npm-project-modules' &&
      !offered.some((entry) => isUnderAny(match.path, [entry.path]))
    ) {
      continue;
    }
    const entries = byRuleId.get(match.ruleId) ?? [];
    entries.push(match);
    byRuleId.set(match.ruleId, entries);
  }

  const rules: Rule[] = [];
  for (const [ruleId, matches] of [...byRuleId.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const raw = matches[0]!.category;
    const category: CategoryId = isCategoryId(raw) ? raw : 'temp';
    rules.push({
      id: ruleId,
      category,
      title: ruleId,
      action: ruleId === 'recycle-bin' ? { kind: 'empty-recycle-bin' } : { kind: 'delete-path' },
      match: () =>
        matches.map((entry) => ({
          path: entry.path,
          bytes: entry.bytes,
          grade: entry.grade,
          recovery: recoveryForMatch(entry, offered),
          evidence: entry.evidence,
        })),
    });
  }
  return rules;
}

export function toCleanItem(item: PlanItem, env: CleanupEnv): CleanItemPreview {
  return {
    ruleId: item.ruleId,
    category: item.category,
    path: item.path,
    name: basename(item.path),
    bytes: item.bytes,
    grade: item.grade,
    recovery:
      item.recovery.kind === 'regenerate'
        ? { kind: 'regenerate', text: item.recovery.command }
        : { kind: 'junk', text: item.recovery.reason },
    evidence: item.evidence,
    action: item.action.kind,
    adminRequired: item.action.kind === 'delete-path' && needsElevation(item.path, env),
  };
}

export function toCleanPreview(
  plan: CleanupPlan,
  source: CleanPreview['source'],
  root: string,
  scanAgeMs: number | null,
  env: CleanupEnv,
): CleanPreview {
  const totals: CleanPlanTotals = {
    bytes: plan.totals.bytes,
    items: plan.totals.items,
    reviewBytes: plan.totals.bytesByGrade.review,
    reviewItems: plan.totals.itemsByGrade.review,
  };
  return {
    planId: plan.id,
    createdAt: plan.createdAt,
    root,
    source,
    scanAgeMs,
    items: plan.items.map((item) => toCleanItem(item, env)),
    totals,
    refused: plan.refused.map((entry) => ({ ruleId: entry.ruleId, path: entry.path, reason: entry.reason })),
  };
}

export function toCleanItemResult(plan: CleanupPlan, result: ItemResult): CleanItemResult {
  const source = plan.items.find((item) => item.path === result.path && item.ruleId === result.ruleId);
  return {
    ruleId: result.ruleId,
    path: result.path,
    category: source?.category ?? 'temp',
    action: result.action,
    status: result.status,
    plannedBytes: result.plannedBytes,
    deletedBytes: result.deletedBytes,
    skippedLocked: result.skippedLocked,
    errorCount: result.errors.length,
    restoreCommand: source?.recovery.kind === 'regenerate' ? source.recovery.command : null,
  };
}

export function toCleanReport(
  plan: CleanupPlan,
  scope: CleanScope,
  root: string,
  report: CleanupReport,
  remainingReclaimableBytes: number,
): CleanReport {
  return {
    planId: report.planId,
    scope,
    root,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    items: report.items.map((item) => toCleanItemResult(plan, item)),
    deletedBytes: report.deletedBytes,
    skippedLocked: report.skippedLocked,
    itemErrors: report.itemErrors,
    remainingReclaimableBytes,
    cleanedAt: report.finishedAt,
  };
}

export function subtractCategories(categories: SnapshotCategory[], report: CleanReport): SnapshotCategory[] {
  const bytesByRule = new Map<string, number>();
  const itemsByRule = new Map<string, number>();
  for (const item of report.items) {
    bytesByRule.set(item.ruleId, (bytesByRule.get(item.ruleId) ?? 0) + item.deletedBytes);
    if (item.status === 'done' || item.status === 'already-gone') {
      itemsByRule.set(item.ruleId, (itemsByRule.get(item.ruleId) ?? 0) + 1);
    }
  }
  return categories.map((entry) => ({
    ...entry,
    bytes: Math.max(entry.bytes - (bytesByRule.get(entry.ruleId) ?? 0), 0),
    items: Math.max(entry.items - (itemsByRule.get(entry.ruleId) ?? 0), 0),
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w app -- test/cleanup.test.ts` then `npm run typecheck -w app`
Expected: PASS (9 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/host/cleanup.ts app/test/cleanup.test.ts
git commit -m "feat(app): add cleanup scope rules and plan/report mapping"
```

---

### Task 5: Dev project records and groups

**Files:**
- Create: `app/src/main/host/dev-cleanup.ts`, `app/test/dev-cleanup.test.ts`

**Interfaces:**
- Consumes: `ProjectRecord` from `@dust/core`; `canonicalKey` from `./cleanup`; `DevGroup`, `DevProject` from `../../shared/ipc`.
- Produces: `projectNameOf(path: string): string`; `toDevProjects(projects, pins): DevProject[]`; `groupDevProjects(projects): DevGroup[]` (fixed order Dead / Occasional / Active / Orphaned / Pinned; `pinned` wins; `orphaned-node-modules` kind wins over recency; `unknown` recency falls into Occasional; sorted by node_modules bytes descending).

- [ ] **Step 1: Write the failing tests**

`app/test/dev-cleanup.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/dev-cleanup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/src/main/host/dev-cleanup.ts`**

```ts
import { basename, dirname } from 'node:path';
import type { ProjectRecord } from '@dust/core';
import { canonicalKey } from './cleanup';
import type { DevGroup, DevProject } from '../../shared/ipc';

export function projectNameOf(path: string): string {
  return basename(path).toLowerCase() === 'node_modules' ? basename(dirname(path)) : basename(path);
}

export function toDevProjects(projects: ProjectRecord[], pins: readonly string[]): DevProject[] {
  const pinned = new Set(pins.map(canonicalKey));
  return projects.map((entry) => {
    const isPinned = entry.pinned || pinned.has(canonicalKey(entry.path));
    return {
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      packageManager: entry.packageManager,
      recency: entry.recency,
      pinned: isPinned,
      offered: entry.offered && !isPinned,
      nodeModulesBytes: entry.nodeModules.bytes,
      nodeModulesPaths: entry.nodeModules.paths.map((location) => location.path),
      activityMs: entry.activity.ms,
      activitySource: entry.activity.source,
      grade: entry.restorability.grade,
      reasons: entry.restorability.reasons,
      restoreCommand: entry.restorability.restoreCommand,
      workspaceCount: entry.workspaceCount,
    };
  });
}

const GROUP_ORDER: Array<{ id: DevGroup['id']; label: string }> = [
  { id: 'dead', label: 'Dead (more than 180 days)' },
  { id: 'occasional', label: 'Occasional (31-180 days)' },
  { id: 'active', label: 'Active (30 days or less)' },
  { id: 'orphaned', label: 'Orphaned node_modules' },
  { id: 'pinned', label: 'Pinned' },
];

export function groupDevProjects(projects: DevProject[]): DevGroup[] {
  const groups: DevGroup[] = GROUP_ORDER.map((entry) => ({ ...entry, projects: [] }));
  const byId = new Map(groups.map((group) => [group.id, group]));

  for (const project of projects) {
    const id: DevGroup['id'] = project.pinned
      ? 'pinned'
      : project.kind === 'orphaned-node-modules'
        ? 'orphaned'
        : project.recency === 'dead'
          ? 'dead'
          : project.recency === 'active'
            ? 'active'
            : 'occasional';
    byId.get(id)!.projects.push(project);
  }

  for (const group of groups) {
    group.projects.sort(
      (a, b) => b.nodeModulesBytes - a.nodeModulesBytes || a.path.localeCompare(b.path),
    );
  }
  return groups;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w app -- test/dev-cleanup.test.ts` then `npm run typecheck -w app`
Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/host/dev-cleanup.ts app/test/dev-cleanup.test.ts
git commit -m "feat(app): add dev cleanup project grouping"
```

---

### Task 6: Applying a cleanup report to retained live rows

**Files:**
- Create: `app/src/main/host/cleanup-rows.ts`, `app/test/cleanup-rows.test.ts`
- Modify: `app/src/main/host/results.ts` (export `pathKey`)

**Interfaces:**
- Consumes: `CleanReport`, `ResultRow` from `../../shared/ipc`; `pathKey` from `./results`.
- Produces: `applyCleanReport(rows: ResultRow[], report: CleanReport): ResultRow[]` — removes `done`/`already-gone` subtrees, deducts their bytes/counts from ancestors, subtracts `deletedBytes` for `partial` items, and flags the partially cleaned row `partial: true`.

- [ ] **Step 1: Write the failing tests**

`app/test/cleanup-rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyCleanReport } from '../src/main/host/cleanup-rows';
import type { CleanReport, ResultRow } from '../src/shared/ipc';

function row(path: string, parent: string | null, overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    path,
    name: path,
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
    gradeReason: 'fixture',
    action: null,
    ...overrides,
  };
}

function report(items: CleanReport['items']): CleanReport {
  return {
    planId: 'plan-1',
    scope: 'quick',
    root: 'C:\\',
    startedAt: 1,
    finishedAt: 2,
    items,
    deletedBytes: items.reduce((sum, item) => sum + item.deletedBytes, 0),
    skippedLocked: 0,
    itemErrors: 0,
    remainingReclaimableBytes: 0,
    cleanedAt: 2,
  };
}

describe('applyCleanReport', () => {
  const rows = [
    row('C:\\', null, { bytes: 1000, allocatedBytes: 2000, fileCount: 10, folderCount: 2 }),
    row('C:\\Temp', 'C:\\', { bytes: 300, allocatedBytes: 300, fileCount: 3, folderCount: 1 }),
    row('C:\\Temp\\deep', 'C:\\Temp', { bytes: 100, allocatedBytes: 100, fileCount: 1, folderCount: 0 }),
    row('C:\\Other', 'C:\\', { bytes: 700, allocatedBytes: 700, fileCount: 6, folderCount: 1 }),
  ];

  it('removes the subtree and deducts bytes and counts from ancestors', () => {
    const result = applyCleanReport(
      rows,
      report([
        {
          ruleId: 'system-temp',
          path: 'C:\\Temp',
          category: 'temp',
          action: 'delete-path',
          status: 'done',
          plannedBytes: 300,
          deletedBytes: 300,
          skippedLocked: 0,
          errorCount: 0,
          restoreCommand: null,
        },
      ]),
    );

    expect(result.map((entry) => entry.path)).toEqual(['C:\\', 'C:\\Other']);
    expect(result[0]).toMatchObject({ bytes: 700, allocatedBytes: 1700, fileCount: 7, folderCount: 1 });
  });

  it('shrinks partially cleaned rows and flags them', () => {
    const result = applyCleanReport(
      rows,
      report([
        {
          ruleId: 'system-temp',
          path: 'C:\\Temp\\deep',
          category: 'temp',
          action: 'delete-path',
          status: 'partial',
          plannedBytes: 100,
          deletedBytes: 40,
          skippedLocked: 1,
          errorCount: 0,
          restoreCommand: null,
        },
      ]),
    );

    const deep = result.find((entry) => entry.path === 'C:\\Temp\\deep');
    const temp = result.find((entry) => entry.path === 'C:\\Temp');
    expect(deep).toMatchObject({ bytes: 60, partial: true });
    expect(temp).toMatchObject({ bytes: 260, partial: false });
    expect(result[0]?.bytes).toBe(960);
  });

  it('leaves failed and already-gone-without-row items alone', () => {
    const result = applyCleanReport(
      rows,
      report([
        {
          ruleId: 'system-temp',
          path: 'C:\\Missing',
          category: 'temp',
          action: 'delete-path',
          status: 'already-gone',
          plannedBytes: 5,
          deletedBytes: 0,
          skippedLocked: 0,
          errorCount: 0,
          restoreCommand: null,
        },
        {
          ruleId: 'system-temp',
          path: 'C:\\Locked',
          category: 'temp',
          action: 'delete-path',
          status: 'failed',
          plannedBytes: 5,
          deletedBytes: 0,
          skippedLocked: 0,
          errorCount: 1,
          restoreCommand: null,
        },
      ]),
    );

    expect(result.map((entry) => entry.path)).toEqual(['C:\\', 'C:\\Temp', 'C:\\Temp\\deep', 'C:\\Other']);
    expect(result[0]?.bytes).toBe(1000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/cleanup-rows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Export `pathKey` from `results.ts`**

`app/src/main/host/results.ts` — change `function pathKey(path: string): string {` to `export function pathKey(path: string): string {`.

- [ ] **Step 4: Create `app/src/main/host/cleanup-rows.ts`**

```ts
import type { CleanReport, ResultRow } from '../../shared/ipc';
import { pathKey } from './results';

interface Deduction {
  key: string;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
  linkCount: number;
  partial: boolean;
}

export function applyCleanReport(rows: ResultRow[], report: CleanReport): ResultRow[] {
  const byKey = new Map(rows.map((row) => [pathKey(row.path), row]));
  const goneKeys = new Set<string>();
  const deductions: Deduction[] = [];

  for (const item of report.items) {
    const key = pathKey(item.path);
    if (item.status === 'done' || item.status === 'already-gone') {
      goneKeys.add(key);
    } else if (item.status === 'partial') {
      deductions.push({
        key,
        bytes: item.deletedBytes,
        allocatedBytes: item.deletedBytes,
        fileCount: 0,
        folderCount: 0,
        linkCount: 0,
        partial: true,
      });
    }
  }

  const removed = new Set<string>();
  for (const key of goneKeys) {
    const row = byKey.get(key);
    if (row) {
      deductions.push({
        key,
        bytes: row.bytes,
        allocatedBytes: row.allocatedBytes,
        fileCount: row.fileCount,
        folderCount: row.folderCount,
        linkCount: row.linkCount,
        partial: false,
      });
    }
    for (const candidate of rows) {
      const candidateKey = pathKey(candidate.path);
      if (isSameOrUnder(candidateKey, key)) removed.add(candidateKey);
    }
  }

  const out: ResultRow[] = [];
  for (const row of rows) {
    const key = pathKey(row.path);
    if (removed.has(key)) continue;
    let next = row;
    for (const deduction of deductions) {
      if (!isSameOrUnder(deduction.key, key)) continue;
      next = {
        ...next,
        bytes: Math.max(next.bytes - deduction.bytes, 0),
        allocatedBytes: Math.max(next.allocatedBytes - deduction.allocatedBytes, 0),
        fileCount: Math.max(next.fileCount - deduction.fileCount, 0),
        folderCount: Math.max(next.folderCount - deduction.folderCount, 0),
        linkCount: Math.max(next.linkCount - deduction.linkCount, 0),
        partial: next.partial || (deduction.partial && deduction.key === key),
      };
    }
    out.push(next);
  }
  return out;
}

function isSameOrUnder(key: string, rootKey: string): boolean {
  if (key === rootKey) return true;
  const base = rootKey.endsWith('\\') ? rootKey : `${rootKey}\\`;
  return key.startsWith(base) || key.startsWith(`${rootKey}/`);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w app -- test/cleanup-rows.test.ts` then `npm run typecheck -w app`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add app/src/main/host/cleanup-rows.ts app/src/main/host/results.ts app/test/cleanup-rows.test.ts
git commit -m "feat(app): apply cleanup reports to retained live rows"
```

---

### Task 7: Engine host — preview, execute, dev state and pinning

**Files:**
- Modify: `app/src/main/host/engine-host.ts`
- Modify tests: `app/test/engine-host.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-6; `Cleaner`, `PlanTokenError`, `pruneSnapshotAfterCleanup`, `CleanupPlan`, `CleanupReport`, `ProjectRecord`, `SnapshotCategory`, `SnapshotData` from `@dust/core`; shared cleanup types.
- Produces: `EngineHost.previewClean(request): Promise<CleanPreviewResult>`; `EngineHost.executeClean(request): Promise<CleanExecuteResult>`; `EngineHost.getDevCleanup(root): DevCleanupState`; `EngineHost.setPin(path, pinned): SetPinResult`; `EngineHostDeps.createCleaner?`, `EngineHostDeps.quickRoot?`; retained live run retired after cleanup; `clean-item` and `cleaned` events.

- [ ] **Step 1: Write the failing tests**

Add to `app/test/engine-host.test.ts` (imports: add `existsSync` from `node:fs` at the top):

```ts
  it('previews and executes a quick clean from live results', async () => {
    tree.file('temp/junk.bin', 'abcdefghij');
    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [tempRule(tree.root)],
      now: () => 1000,
    });

    const finished = nextEvent(host, 'finished');
    await host.startAnalyze(tree.root);
    await finished;

    const preview = await host.previewClean({ scope: 'quick' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.source).toBe('live');
    expect(preview.preview.items.map((entry) => entry.path)).toEqual([join(tree.root, 'temp')]);
    expect(preview.preview.totals.bytes).toBe(10);
    expect(preview.preview.items[0]?.recovery.kind).toBe('junk');

    const result = await host.executeClean({ cleanId: 'clean-1', planId: preview.preview.planId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.deletedBytes).toBe(10);
    expect(result.report.items[0]).toMatchObject({ status: 'done', category: 'temp' });
    expect(existsSync(join(tree.root, 'temp'))).toBe(false);

    const loaded = store.load();
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.snapshot.cleanedAt).toBe(1000);
    expect(loaded.snapshot.categories[0]).toMatchObject({ ruleId: 'fixture-temp', bytes: 0, items: 0 });
    expect(loaded.snapshot.folders.some((folder) => folder.path === join(tree.root, 'temp'))).toBe(false);

    const live = host.getResults(tree.root);
    expect(live.rows.some((row) => row.path === join(tree.root, 'temp'))).toBe(false);
  });

  it('refuses a cleanup while a scan holds the lock', async () => {
    const fake = new FakeSession({ root: tree.root });
    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [tempRule(tree.root)],
      createSession: () => fake,
    });

    const finished = nextEvent(host, 'finished');
    await host.startAnalyze(tree.root);
    expect(await host.previewClean({ scope: 'quick' })).toEqual({ ok: false, reason: 'busy', running: 'analyze' });

    fake.finish(emptyScanResult(tree.root, 'cancelled'));
    await finished;
  });

  it('cleans selected projects from a snapshot and records recently cleaned', async () => {
    const projectDir = tree.dir('proj');
    tree.file('proj/package.json', '{}');
    tree.file('proj/node_modules/dep/index.js', '0123456789');
    const nodeModules = join(projectDir, 'node_modules');

    store.save({
      schemaVersion: 2,
      rulesVersion: '1',
      root: tree.root,
      startedAt: 1,
      finishedAt: 2,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [{ ruleId: 'npm-project-modules', category: 'npm-projects', bytes: 10, items: 1 }],
      matches: [
        {
          path: nodeModules,
          ruleId: 'npm-project-modules',
          category: 'npm-projects',
          bytes: 10,
          grade: 'safe',
          evidence: 'Project',
        },
      ],
      projects: [
        {
          path: projectDir,
          name: 'proj',
          kind: 'project',
          packageManager: 'npm',
          pinned: false,
          workspaceCount: 0,
          nodeModules: { paths: [{ path: nodeModules, bytes: 10 }], bytes: 10 },
          activity: { ms: 100, source: 'files' },
          recency: 'dead',
          restorability: { grade: 'green', reasons: [], restoreCommand: 'npm ci' },
          offered: true,
          evidence: ['npm'],
        },
      ],
      folders: [
        { path: tree.root, name: tree.root, bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 1, newestMtimeMs: 5, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: projectDir, name: 'proj', bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 1, newestMtimeMs: 5, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: nodeModules, name: 'node_modules', bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 0, newestMtimeMs: 5, errorCount: 0, partial: false, complete: true, childCount: 0 },
      ],
    });

    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
      now: () => 1000,
    });

    const dev = host.getDevCleanup(tree.root);
    expect(dev.source).toBe('snapshot');
    expect(dev.groups.find((group) => group.id === 'dead')?.projects.map((entry) => entry.path)).toEqual([
      projectDir,
    ]);

    const preview = await host.previewClean({ scope: 'dev', root: tree.root, paths: [projectDir] });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.totals.bytes).toBe(10);

    const executed = await host.executeClean({ cleanId: 'clean-2', planId: preview.preview.planId });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.report.items[0]).toMatchObject({ status: 'done', restoreCommand: 'npm ci' });
    expect(existsSync(nodeModules)).toBe(false);

    const after = host.getDevCleanup(tree.root);
    expect(after.recentlyCleaned.map((entry) => [entry.path, entry.restoreCommand])).toEqual([
      [projectDir, 'npm ci'],
    ]);
    expect(after.groups.flatMap((group) => group.projects)).toEqual([]);

    const loaded = store.load();
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.snapshot.projects).toEqual([]);
    expect(loaded.snapshot.matches).toEqual([]);
  });

  it('previews a row clean from the saved snapshot', async () => {
    const temp = tree.dir('temp');
    tree.file('temp/junk.bin', '0123456789');

    store.save({
      schemaVersion: 2,
      rulesVersion: '1',
      root: tree.root,
      startedAt: 1,
      finishedAt: 2,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 10, items: 1 }],
      matches: [
        { path: temp, ruleId: 'system-temp', category: 'temp', bytes: 10, grade: 'safe', evidence: 'temp' },
      ],
      projects: [],
      folders: [
        { path: tree.root, name: tree.root, bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 1, newestMtimeMs: 5, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: temp, name: 'temp', bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 0, newestMtimeMs: 5, errorCount: 0, partial: false, complete: true, childCount: 0 },
      ],
    });

    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
    });

    const preview = await host.previewClean({ scope: 'row', root: tree.root, paths: [temp] });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.source).toBe('snapshot');

    const executed = await host.executeClean({ cleanId: 'clean-3', planId: preview.preview.planId });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.report.items[0]).toMatchObject({ ruleId: 'system-temp', deletedBytes: 10 });
    expect(existsSync(temp)).toBe(false);
  });

  it('requires an acknowledgement for review-grade project matches', async () => {
    const appPath = join(tree.root, 'ghost-app');
    const nodeModules = join(appPath, 'node_modules');
    store.save({
      schemaVersion: 2,
      rulesVersion: '1',
      root: tree.root,
      startedAt: 1,
      finishedAt: 2,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [{ ruleId: 'npm-project-modules', category: 'npm-projects', bytes: 5, items: 1 }],
      matches: [
        {
          path: nodeModules,
          ruleId: 'npm-project-modules',
          category: 'npm-projects',
          bytes: 5,
          grade: 'review',
          evidence: 'no lockfile',
        },
      ],
      projects: [
        {
          path: appPath,
          name: 'app',
          kind: 'project',
          packageManager: 'npm',
          pinned: false,
          workspaceCount: 0,
          nodeModules: { paths: [{ path: nodeModules, bytes: 5 }], bytes: 5 },
          activity: { ms: 100, source: 'files' },
          recency: 'dead',
          restorability: { grade: 'yellow', reasons: ['no lockfile'], restoreCommand: 'npm install' },
          offered: true,
          evidence: ['npm'],
        },
      ],
      folders: [],
    });

    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
    });

    const preview = await host.previewClean({ scope: 'dev', root: tree.root, paths: [appPath] });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.totals.reviewItems).toBe(1);

    expect(await host.executeClean({ cleanId: 'clean-4', planId: preview.preview.planId })).toEqual({
      ok: false,
      reason: 'unacknowledged-review',
    });

    const acknowledged = await host.executeClean({
      cleanId: 'clean-4',
      planId: preview.preview.planId,
      acknowledge: [nodeModules],
    });
    expect(acknowledged.ok).toBe(true);
    if (!acknowledged.ok) return;
    expect(acknowledged.report.items[0]?.status).toBe('already-gone');
  });
```

Note: the yellow project's recovery comes from `restoreCommand: 'npm install'` (regenerate) but the match grade is `review` → the acknowledgement gate still applies (grade, not recovery, drives the gate). Good.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/engine-host.test.ts`
Expected: FAIL — `host.previewClean is not a function`.

- [ ] **Step 3: Modify `app/src/main/host/engine-host.ts`**

**Imports.** Add to the `@dust/core` value import list: `Cleaner`, `PlanTokenError`, `pruneSnapshotAfterCleanup`. Add to the `@dust/core` type import list: `CleanupPlan`, `CleanupReport as CoreCleanupReport`, `ProjectRecord`, `SnapshotCategory`, `SnapshotData`. Add to the shared type import list: `CleanExecuteRequest`, `CleanExecuteResult`, `CleanPreview`, `CleanPreviewRequest`, `CleanPreviewResult`, `CleanReport`, `CleanScope`, `DevCleanupState`, `RecentlyCleanedProject`, `SetPinResult`. Add after the existing `./results` import:

```ts
import { applyCleanReport } from './cleanup-rows';
import {
  isUnderAny,
  samePath,
  scopeRules,
  snapshotRules,
  subtractCategories,
  toCleanItemResult,
  toCleanPreview,
  toCleanReport,
} from './cleanup';
import { groupDevProjects, projectNameOf, toDevProjects } from './dev-cleanup';
import { measureDirectories } from './targeted';
```

**Module-level types** above `createEngineHost` (next to `guardEnv`):

```ts
interface PlanSource {
  source: CleanPreview['source'];
  root: string;
  scanAgeMs: number | null;
  rules: Rule[];
  ctx: RuleContext;
}

interface PendingPlan {
  plan: CleanupPlan;
  scope: CleanScope;
  root: string;
  selection: string[];
}
```

**Deps and interface.** Add to `EngineHostDeps` after `createRules`:

```ts
  createCleaner?: () => Cleaner;
  quickRoot?: () => string;
```

Add to the `EngineHost` interface after `getResults`:

```ts
  previewClean(request: CleanPreviewRequest): Promise<CleanPreviewResult>;
  executeClean(request: CleanExecuteRequest): Promise<CleanExecuteResult>;
  getDevCleanup(root: string): DevCleanupState;
  setPin(path: string, pinned: boolean): SetPinResult;
```

**Retained state.** After the existing `let lastResults ... = null;` add:

```ts
  let lastRun: {
    root: string;
    tree: AggregateTree;
    markers: Marker[];
    probe: RuleContext['probe'];
    rules: Rule[];
    projects: ProjectRecord[];
    ruleCategories: SnapshotCategory[];
    finishedAt: number;
  } | null = null;

  let recentlyCleaned: RecentlyCleanedProject[] = [];
  const pendingPlans = new Map<string, PendingPlan>();
  const cleaner =
    deps.createCleaner?.() ??
    new Cleaner({
      guard: {
        systemRoot: env.windowsDir || undefined,
        programData: env.programData || undefined,
        userProfile: env.userProfile || undefined,
      },
      now,
    });
```

**Plan source helpers.** Insert after `getDashboard` and before `startAnalyze`:

```ts
  function liveSource(): PlanSource | null {
    if (lastRun === null) return null;
    return {
      source: 'live',
      root: lastRun.root,
      scanAgeMs: Math.max(now() - lastRun.finishedAt, 0),
      rules: lastRun.rules,
      ctx: { root: lastRun.root, tree: lastRun.tree, markers: lastRun.markers, probe: lastRun.probe },
    };
  }

  function snapshotSource(snapshot: SnapshotData): PlanSource {
    return {
      source: 'snapshot',
      root: snapshot.root,
      scanAgeMs: Math.max(now() - snapshot.finishedAt, 0),
      rules: snapshotRules(snapshot, deps.store.getPins()),
      ctx: { root: snapshot.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() },
    };
  }

  function quickCleanRoot(): string {
    if (lastRun !== null) return lastRun.root;
    const loaded = deps.store.load();
    if (loaded.kind === 'ok') return loaded.snapshot.root;
    return (
      deps.quickRoot?.() ??
      volumeRootOf(env.userProfile || env.windowsDir || env.temp) ??
      volumeRootOf(process.cwd()) ??
      'C:\\'
    );
  }

  async function targetedSource(root: string): Promise<PlanSource> {
    const probe = createNodeFsProbe();
    const rules = createRules(
      env,
      { pins: deps.store.getPins(), isExternal: createExternalPredicate(listVolumesFn()), now },
      { recycleBin: { enumerate: () => defaultRecycleBinEnumeration() } },
    );
    const actions = new Map(rules.map((rule) => [rule.id, rule.action.kind]));
    const discovery = await collectRuleMatches(scopeRules(rules, 'quick', []), {
      root,
      tree: new AggregateTree(),
      markers: [],
      probe,
    });
    const tree = measureDirectories(
      discovery
        .filter((match) => actions.get(match.ruleId) !== 'empty-recycle-bin')
        .map((match) => match.path),
    );
    return { source: 'targeted', root, scanAgeMs: null, rules, ctx: { root, tree, markers: [], probe } };
  }

  async function resolveQuickSource(): Promise<PlanSource> {
    const live = liveSource();
    if (live !== null) return live;
    const loaded = deps.store.load();
    if (loaded.kind === 'ok') return snapshotSource(loaded.snapshot);
    return targetedSource(quickCleanRoot());
  }

  async function resolveRootSource(root: string): Promise<PlanSource | null> {
    const live = liveSource();
    if (live !== null && sameRoot(live.root, root)) return live;
    const loaded = deps.store.load();
    if (loaded.kind === 'ok' && sameRoot(loaded.snapshot.root, root)) return snapshotSource(loaded.snapshot);
    return null;
  }

  async function previewClean(request: CleanPreviewRequest): Promise<CleanPreviewResult> {
    const scope = request.scope;
    if (scope !== 'quick' && request.paths.length === 0) {
      return { ok: false, reason: 'empty-selection', message: 'Select at least one item to clean' };
    }
    const lockRoot = scope === 'quick' ? quickCleanRoot() : request.root;
    const acquired = lock.acquire('quick-clean', lockRoot, now());
    if (!acquired.ok) return { ok: false, reason: 'busy', running: acquired.holder.kind };
    try {
      const base = scope === 'quick' ? await resolveQuickSource() : await resolveRootSource(request.root);
      if (base === null) {
        return {
          ok: false,
          reason: 'invalid-root',
          message: `No scan data for ${request.root} - run an Analyze first`,
        };
      }
      const selection = scope === 'quick' ? [] : request.paths;
      const plan = await cleaner.preview(scopeRules(base.rules, scope, selection), base.ctx);
      if (plan.items.length === 0) {
        return { ok: false, reason: 'empty-selection', message: 'Nothing to clean here' };
      }
      pendingPlans.set(plan.id, { plan, scope, root: base.root, selection: [...selection] });
      return {
        ok: true,
        preview: toCleanPreview(plan, base.source, base.root, base.scanAgeMs, {
          windowsDir: env.windowsDir || undefined,
        }),
      };
    } catch (error) {
      return { ok: false, reason: 'failed', message: messageOf(error) };
    } finally {
      lock.release();
    }
  }

  function applyCleanupEffects(pending: PendingPlan, coreReport: CoreCleanupReport): number {
    const loaded = deps.store.load();
    const baseCategories: SnapshotCategory[] =
      lastRun !== null && sameRoot(lastRun.root, pending.root)
        ? lastRun.ruleCategories
        : loaded.kind === 'ok' && sameRoot(loaded.snapshot.root, pending.root)
          ? loaded.snapshot.categories
          : [];

    const report = toCleanReport(pending.plan, pending.scope, pending.root, coreReport, 0);

    if (lastResults !== null && sameRoot(lastResults.root, pending.root)) {
      lastResults = {
        ...lastResults,
        rows: applyCleanReport(lastResults.rows, report),
        categories: summarizeCategories(subtractCategories(baseCategories, report)),
      };
    }

    if (loaded.kind === 'ok' && sameRoot(loaded.snapshot.root, pending.root)) {
      deps.store.save(pruneSnapshotAfterCleanup(loaded.snapshot, coreReport, now()));
    }

    lastRun = null;
    return summarizeCategories(subtractCategories(baseCategories, report)).reduce(
      (sum, row) => sum + row.bytes,
      0,
    );
  }

  function recordRecentlyCleaned(pending: PendingPlan, report: CleanReport): void {
    const byProject = new Map<string, RecentlyCleanedProject>();
    for (const item of report.items) {
      if (item.ruleId !== 'npm-project-modules' || item.deletedBytes <= 0) continue;
      const projectPath = pending.selection
        .filter((path) => isUnderAny(item.path, [path]))
        .sort((a, b) => b.length - a.length)[0];
      if (projectPath === undefined) continue;
      const existing = byProject.get(projectPath);
      if (existing) {
        existing.bytes += item.deletedBytes;
        continue;
      }
      byProject.set(projectPath, {
        root: pending.root,
        path: projectPath,
        name: projectNameOf(projectPath),
        bytes: item.deletedBytes,
        restoreCommand: item.restoreCommand,
        cleanedAt: report.finishedAt,
      });
    }
    for (const entry of byProject.values()) {
      recentlyCleaned = [entry, ...recentlyCleaned.filter((row) => !samePath(row.path, entry.path))];
    }
  }

  async function executeClean(request: CleanExecuteRequest): Promise<CleanExecuteResult> {
    const pending = pendingPlans.get(request.planId);
    if (!pending) return { ok: false, reason: 'unknown-plan' };
    const acquired = lock.acquire('quick-clean', pending.root, now());
    if (!acquired.ok) return { ok: false, reason: 'busy', running: acquired.holder.kind };
    try {
      let coreReport: CoreCleanupReport;
      try {
        coreReport = await cleaner.execute(request.planId, {
          acknowledge: request.acknowledge,
          onItem: (result) =>
            emit({
              type: 'clean-item',
              cleanId: request.cleanId,
              item: toCleanItemResult(pending.plan, result),
            }),
        });
      } catch (error) {
        if (error instanceof PlanTokenError) return { ok: false, reason: error.code };
        return { ok: false, reason: 'failed', message: messageOf(error) };
      }
      pendingPlans.delete(request.planId);
      const remaining = applyCleanupEffects(pending, coreReport);
      const report = toCleanReport(pending.plan, pending.scope, pending.root, coreReport, remaining);
      if (pending.scope === 'dev') recordRecentlyCleaned(pending, report);
      emit({ type: 'cleaned', cleanId: request.cleanId, root: pending.root });
      return { ok: true, report };
    } finally {
      lock.release();
    }
  }

  function getDevCleanup(root: string): DevCleanupState {
    const pins = deps.store.getPins();
    let source: DevCleanupState['source'] = 'empty';
    let finishedAt: number | null = null;
    let projects: ProjectRecord[] = [];

    if (lastRun !== null && sameRoot(lastRun.root, root)) {
      source = 'live';
      finishedAt = lastRun.finishedAt;
      projects = lastRun.projects;
    } else {
      const loaded = deps.store.load();
      if (loaded.kind === 'ok' && sameRoot(loaded.snapshot.root, root)) {
        source = 'snapshot';
        finishedAt = loaded.snapshot.finishedAt;
        projects = loaded.snapshot.projects;
      }
    }

    const cleaned = recentlyCleaned.filter((entry) => sameRoot(entry.root, root));
    const visible = toDevProjects(projects, pins).filter(
      (entry) => !cleaned.some((candidate) => samePath(candidate.path, entry.path)),
    );
    return { source, root, finishedAt, groups: groupDevProjects(visible), recentlyCleaned: cleaned };
  }

  function setPin(path: string, pinned: boolean): SetPinResult {
    const current = deps.store.getPins();
    const remaining = current.filter((pin) => !samePath(pin, path));
    const next = pinned ? [...remaining, path] : remaining;
    const saved = deps.store.setPins(next);
    return saved.ok ? { ok: true, pins: next } : { ok: false, message: saved.error ?? 'could not save pins' };
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
```

**Reset per run.** In `startAnalyze`, where `lastResults = null;` appears, replace it with:

```ts
    lastResults = null;
    lastRun = null;
    pendingPlans.clear();
    recentlyCleaned = [];
```

**Retain the run at finalize.** In `finalize`, immediately after the existing `lastResults = { ... };` assignment add:

```ts
    lastRun = {
      root: result.root,
      tree: result.tree,
      markers: result.markers,
      probe,
      rules,
      projects: analysis.projects,
      ruleCategories,
      finishedAt,
    };
```

**Return the new methods.** Change the final return to:

```ts
  return {
    getDashboard,
    startAnalyze,
    cancelScan,
    getResults,
    previewClean,
    executeClean,
    getDevCleanup,
    setPin,
    onEvent,
    dispose,
  };
```

- [ ] **Step 4: Run the app suite and typecheck**

Run: `npm run test -w app` then `npm run typecheck -w app`
Expected: all green. The existing `passes pins and an external-drive predicate into rule creation` test still sees exactly one `createRules` call per analyze.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/host/engine-host.ts app/test/engine-host.test.ts
git commit -m "feat(app): wire preview, execute and dev cleanup state into the engine host"
```

### Task 8: IPC wiring and the elevation action

**Files:**
- Modify: `app/src/main/ipc.ts`, `app/src/main/index.ts`
- Create: `app/src/main/elevation.ts`, `app/test/elevation.test.ts`
- Modify tests: `app/test/ipc.test.ts`

**Interfaces:**
- Consumes: Task 7 host methods; `IPC.cleanPreview`/`cleanExecute`/`devCleanupGet`/`pinsSet`/`relaunchElevated`.
- Produces: `registerIpcHandlers` registers all eleven channels; `parseCleanPreviewRequest(value): CleanPreviewRequest`; `parseCleanExecuteRequest(value): CleanExecuteRequest`; `ShellActions { revealPath; relaunchElevated }`; `buildElevationCommand(execPath, args): string`.

- [ ] **Step 1: Write the failing elevation test**

`app/test/elevation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildElevationCommand } from '../src/main/elevation';

describe('buildElevationCommand', () => {
  it('builds a Start-Process command without arguments', () => {
    expect(buildElevationCommand('C:\\Apps\\Dust\\Dust.exe', [])).toBe(
      "Start-Process -FilePath 'C:\\Apps\\Dust\\Dust.exe' -Verb RunAs",
    );
  });

  it('quotes arguments and doubles embedded quotes', () => {
    expect(buildElevationCommand('C:\\Dust.exe', ["C:\\it's here"])).toBe(
      "Start-Process -FilePath 'C:\\Dust.exe' -ArgumentList 'C:\\it''s here' -Verb RunAs",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w app -- test/elevation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/src/main/elevation.ts`**

```ts
export function buildElevationCommand(execPath: string, args: string[]): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const file = quote(execPath);
  if (args.length === 0) return `Start-Process -FilePath ${file} -Verb RunAs`;
  return `Start-Process -FilePath ${file} -ArgumentList ${args.map(quote).join(',')} -Verb RunAs`;
}
```

- [ ] **Step 4: Replace `app/src/main/ipc.ts`**

```ts
import { IPC } from '../shared/ipc';
import type { CleanExecuteRequest, CleanPreviewRequest, ScanEvent } from '../shared/ipc';
import type { EngineHost } from './host/engine-host';

export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface EventSender {
  send(channel: string, payload: unknown): void;
}

export interface ShellActions {
  revealPath(path: string): Promise<void>;
  relaunchElevated(): Promise<void>;
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
  registrar.handle(IPC.cleanPreview, (_event, request) => host.previewClean(parseCleanPreviewRequest(request)));
  registrar.handle(IPC.cleanExecute, (_event, request) => host.executeClean(parseCleanExecuteRequest(request)));
  registrar.handle(IPC.devCleanupGet, (_event, root) => host.getDevCleanup(typeof root === 'string' ? root : ''));
  registrar.handle(IPC.pinsSet, (_event, path, pinned) =>
    host.setPin(typeof path === 'string' ? path : '', pinned === true),
  );
  registrar.handle(IPC.relaunchElevated, () => shell.relaunchElevated());
  return host.onEvent((event: ScanEvent) => sender.send(IPC.scanEvent, event));
}

export function parseCleanPreviewRequest(value: unknown): CleanPreviewRequest {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.scope === 'quick') return { scope: 'quick' };
    if ((record.scope === 'dev' || record.scope === 'row') && typeof record.root === 'string') {
      const paths = Array.isArray(record.paths)
        ? record.paths.filter((entry): entry is string => typeof entry === 'string')
        : [];
      return { scope: record.scope, root: record.root, paths };
    }
  }
  return { scope: 'quick' };
}

export function parseCleanExecuteRequest(value: unknown): CleanExecuteRequest {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const acknowledge = Array.isArray(record.acknowledge)
    ? record.acknowledge.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    cleanId: typeof record.cleanId === 'string' ? record.cleanId : '',
    planId: typeof record.planId === 'string' ? record.planId : '',
    acknowledge,
  };
}
```

- [ ] **Step 5: Wire the elevation action in `app/src/main/index.ts`**

Add imports:

```ts
import { spawn } from 'node:child_process';
import { buildElevationCommand } from './elevation';
```

Replace the `{ revealPath: async (path) => { shell.showItemInFolder(path); } }` argument with:

```ts
    {
      revealPath: async (path) => {
        shell.showItemInFolder(path);
      },
      relaunchElevated: async () => {
        if (process.platform !== 'win32') return;
        const args = app.isPackaged ? [] : [app.getAppPath()];
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-Command', buildElevationCommand(process.execPath, args)],
          { detached: true, stdio: 'ignore' },
        );
        child.unref();
        app.quit();
      },
    },
```

- [ ] **Step 6: Update `app/test/ipc.test.ts`**

Replace the `registerIpcHandlers(...)` call's shell argument with:

```ts
    const relaunched: number[] = [];
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
        relaunchElevated: async () => {
          relaunched.push(1);
        },
      },
    );
```

Add before `unsubscribe();`:

```ts
    expect(await registrar.invoke(IPC.cleanPreview, { scope: 'quick' })).toEqual({
      ok: false,
      reason: 'empty-selection',
      message: 'Nothing to clean here',
    });
    expect(await registrar.invoke(IPC.cleanPreview, { scope: 'row', root: 'T:\\', paths: ['T:\\Temp'] })).toEqual({
      ok: false,
      reason: 'invalid-root',
      message: 'No scan data for T:\\ - run an Analyze first',
    });
    expect(await registrar.invoke(IPC.cleanExecute, { cleanId: 'c1', planId: 'nope' })).toEqual({
      ok: false,
      reason: 'unknown-plan',
    });
    expect((await registrar.invoke(IPC.devCleanupGet, 'T:\\')) as { source: string }).toMatchObject({
      source: 'empty',
    });
    expect(await registrar.invoke(IPC.pinsSet, 'T:\\dev\\app', true)).toEqual({
      ok: true,
      pins: ['T:\\dev\\app'],
    });
    await registrar.invoke(IPC.relaunchElevated);
    expect(relaunched).toEqual([1]);
```

- [ ] **Step 7: Run the app suite and typecheck**

Run: `npm run test -w app` then `npm run typecheck -w app`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add app/src/main/ipc.ts app/src/main/index.ts app/src/main/elevation.ts app/test/elevation.test.ts app/test/ipc.test.ts
git commit -m "feat(app): route cleanup IPC and add the elevation relaunch action"
```

---

### Task 9: CleanPlan and CleanSummary components

**Files:**
- Create: `app/renderer/src/clean.ts`, `app/renderer/src/components/CleanPlan.tsx`, `app/renderer/src/components/CleanSummary.tsx`
- Create tests: `app/test/renderer/clean-plan.test.tsx`, `app/test/renderer/clean-summary.test.tsx`

**Interfaces:**
- Consumes: `CleanPreview`/`CleanItemPreview`/`CleanReport` from `../../../src/shared/ipc`; `CATEGORY_LABELS` from `../../../src/shared/categories`; `formatBytes`/`formatRelativeTime` from `../format`.
- Produces: `newCleanId()`, `cleanErrorMessage(result)`, `recoveryText(item)`, `groupItemsByCategory(items)` (clean.ts); `CleanPlan({ preview, acknowledge, onAcknowledge, onConfirm, onCancel, onReveal, onRelaunchElevated?, busy })`; `CleanSummary({ report, onDone, doneLabel? })`.

- [ ] **Step 1: Write the failing tests**

`app/test/renderer/clean-plan.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CleanPlan } from '../../renderer/src/components/CleanPlan';
import type { CleanItemPreview } from '../../src/shared/ipc';
import { makeCleanPreview } from './fakes';

function reviewItem(overrides: Partial<CleanItemPreview> = {}): CleanItemPreview {
  return {
    ruleId: 'npm-project-modules',
    category: 'npm-projects',
    path: 'C:\\dev\\app\\node_modules',
    name: 'node_modules',
    bytes: 5000,
    grade: 'review',
    recovery: { kind: 'regenerate', text: 'npm install' },
    evidence: 'no lockfile - dependency versions may drift',
    action: 'delete-path',
    adminRequired: false,
    ...overrides,
  };
}

function setup(previewOverrides = {}, props: { acknowledge?: boolean; busy?: boolean } = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const onReveal = vi.fn();
  const onAcknowledge = vi.fn();
  const onRelaunchElevated = vi.fn();
  const preview = makeCleanPreview(previewOverrides);
  const view = render(
    <CleanPlan
      preview={preview}
      acknowledge={props.acknowledge ?? false}
      onAcknowledge={onAcknowledge}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onReveal={onReveal}
      onRelaunchElevated={onRelaunchElevated}
      busy={props.busy ?? false}
    />,
  );
  return { onConfirm, onCancel, onReveal, onAcknowledge, onRelaunchElevated, view, preview };
}

describe('CleanPlan', () => {
  it('shows the totals, the recovery statement and the scan source', () => {
    setup();

    expect(screen.getByText(/Using Analyze data from/)).toBeInTheDocument();
    expect(screen.getByText('9.8 KB')).toBeInTheDocument();
    expect(screen.getByText(/across 1 item/)).toBeInTheDocument();
    expect(screen.getByText('Temporary files are recreated by the apps that need them')).toBeInTheDocument();
    expect(screen.getByText('User TEMP directory - junk by definition')).toBeInTheDocument();
  });

  it('confirms and cancels', () => {
    const { onConfirm, onCancel } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('blocks confirmation until review items are acknowledged', () => {
    const preview = makeCleanPreview({
      items: [reviewItem()],
      totals: { bytes: 5000, items: 1, reviewBytes: 5000, reviewItems: 1 },
    });
    const onAcknowledge = vi.fn();
    const { rerender } = render(
      <CleanPlan
        preview={preview}
        acknowledge={false}
        onAcknowledge={onAcknowledge}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onReveal={vi.fn()}
        busy={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    expect(screen.getByText(/1 item cannot be restored/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /cannot be restored/ }));
    expect(onAcknowledge).toHaveBeenCalledWith(true);

    rerender(
      <CleanPlan
        preview={preview}
        acknowledge
        onAcknowledge={onAcknowledge}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onReveal={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeEnabled();
  });

  it('offers Explorer for the Recycle Bin and relaunch for admin items', () => {
    const recycle: CleanItemPreview = {
      ruleId: 'recycle-bin',
      category: 'recycle-bin',
      path: 'C:\\$Recycle.Bin',
      name: '$Recycle.Bin',
      bytes: 100,
      grade: 'review',
      recovery: { kind: 'junk', text: 'Emptied items are permanently gone' },
      evidence: '3 items on C:',
      action: 'empty-recycle-bin',
      adminRequired: false,
    };
    const admin = reviewItem({
      ruleId: 'system-temp',
      category: 'temp',
      path: 'C:\\Windows\\Temp',
      name: 'Temp',
      grade: 'safe',
      adminRequired: true,
      recovery: { kind: 'junk', text: 'Temporary files are recreated by the apps that need them' },
    });
    const { onReveal, onRelaunchElevated } = setup({
      items: [recycle, admin],
      totals: { bytes: 5100, items: 2, reviewBytes: 100, reviewItems: 1 },
    });

    fireEvent.click(screen.getByRole('button', { name: /Open the Recycle Bin in Explorer first/ }));
    expect(onReveal).toHaveBeenCalledWith('C:\\$Recycle.Bin');

    fireEvent.click(screen.getByRole('button', { name: 'Relaunch as Administrator' }));
    expect(onRelaunchElevated).toHaveBeenCalledTimes(1);
  });
});
```

`app/test/renderer/clean-summary.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CleanSummary } from '../../renderer/src/components/CleanSummary';
import { makeCleanReport } from './fakes';

describe('CleanSummary', () => {
  it('reports freed bytes, remaining reclaimable space and restore commands', () => {
    const onDone = vi.fn();
    render(
      <CleanSummary
        report={makeCleanReport({
          deletedBytes: 2048,
          remainingReclaimableBytes: 4096,
          items: [
            {
              ruleId: 'npm-project-modules',
              path: 'C:\\dev\\app\\node_modules',
              category: 'npm-projects',
              action: 'delete-path',
              status: 'done',
              plannedBytes: 2048,
              deletedBytes: 2048,
              skippedLocked: 0,
              errorCount: 0,
              restoreCommand: 'npm ci',
            },
          ],
        })}
        onDone={onDone}
      />,
    );

    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText(/4.0 KB still reclaimable/)).toBeInTheDocument();
    expect(screen.getByText('npm ci')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View updated disk' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reports locked files as partially cleaned', () => {
    render(
      <CleanSummary
        report={makeCleanReport({
          skippedLocked: 2,
          remainingReclaimableBytes: 0,
          items: [
            {
              ruleId: 'system-temp',
              path: 'C:\\Temp',
              category: 'temp',
              action: 'delete-path',
              status: 'partial',
              plannedBytes: 100,
              deletedBytes: 60,
              skippedLocked: 2,
              errorCount: 0,
              restoreCommand: null,
            },
          ],
        })}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByText(/Partially cleaned: 2 file\(s\) in use were skipped\./)).toBeInTheDocument();
    expect(screen.getByText(/partially cleaned: 2 file\(s\) in use/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/renderer/clean-plan.test.tsx test/renderer/clean-summary.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `app/renderer/src/clean.ts`**

```ts
import type { CategoryId } from '@dust/core';
import { CATEGORY_ORDER } from '../../src/shared/categories';
import type { CleanItemPreview } from '../../src/shared/ipc';

export function newCleanId(): string {
  return `clean-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cleanErrorMessage(result: { reason: string; message?: string }): string {
  switch (result.reason) {
    case 'busy':
      return 'A scan is already running. Cancel it first.';
    case 'empty-selection':
      return result.message ?? 'Nothing to clean here.';
    case 'invalid-root':
      return result.message ?? 'No scan data for this volume - run an Analyze first.';
    case 'unknown-plan':
      return 'This plan expired - close and try again.';
    case 'consumed-plan':
      return 'This plan was already executed.';
    case 'unacknowledged-review':
      return 'Acknowledge the irreversible items before deleting.';
    case 'rule-not-in-plan':
      return 'The plan no longer matches the rule set.';
    default:
      return result.message ?? 'Cleanup failed.';
  }
}

export function recoveryText(item: CleanItemPreview): string {
  return item.recovery.kind === 'regenerate' ? `Rebuild with: ${item.recovery.text}` : item.recovery.text;
}

export function groupItemsByCategory(items: CleanItemPreview[]): Array<[CategoryId, CleanItemPreview[]]> {
  return CATEGORY_ORDER.map((category): [CategoryId, CleanItemPreview[]] => [
    category,
    items.filter((item) => item.category === category),
  ]).filter(([, entries]) => entries.length > 0);
}
```

- [ ] **Step 4: Create `app/renderer/src/components/CleanPlan.tsx`**

```tsx
import type { CleanPreview } from '../../../src/shared/ipc';
import { CATEGORY_LABELS } from '../../../src/shared/categories';
import { formatBytes, formatRelativeTime } from '../format';
import { groupItemsByCategory, recoveryText } from '../clean';

export interface CleanPlanProps {
  preview: CleanPreview;
  acknowledge: boolean;
  onAcknowledge: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onReveal: (path: string) => void;
  onRelaunchElevated?: () => void;
  busy: boolean;
}

export function CleanPlan({
  preview,
  acknowledge,
  onAcknowledge,
  onConfirm,
  onCancel,
  onReveal,
  onRelaunchElevated,
  busy,
}: CleanPlanProps) {
  const needsAck = preview.totals.reviewItems > 0;
  const adminItems = preview.items.filter((item) => item.adminRequired);
  const sourceText =
    preview.source === 'live'
      ? `Using Analyze data from ${formatRelativeTime(Date.now() - (preview.scanAgeMs ?? 0))}.`
      : preview.source === 'snapshot'
        ? `Using the saved scan from ${formatRelativeTime(Date.now() - (preview.scanAgeMs ?? 0))}.`
        : 'Measured just now.';
  const itemWord = preview.totals.items === 1 ? 'item' : 'items';

  return (
    <section aria-label="Cleanup plan" className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-lg font-medium text-neutral-100">Review what will be deleted</h2>
      <p className="mt-1 text-sm text-neutral-400">{sourceText}</p>
      <p className="mt-2 text-sm text-neutral-300">
        {formatBytes(preview.totals.bytes)} across {preview.totals.items} {itemWord}.
        {needsAck && (
          <span className="ml-1 text-amber-300">
            {preview.totals.reviewItems} {preview.totals.reviewItems === 1 ? 'item' : 'items'} cannot be restored.
          </span>
        )}
      </p>

      <ul className="mt-4 space-y-3">
        {groupItemsByCategory(preview.items).map(([category, items]) => (
          <li key={category}>
            <p className="text-xs uppercase tracking-wide text-neutral-500">{CATEGORY_LABELS[category]}</p>
            <ul className="mt-1 space-y-1">
              {items.map((item) => (
                <li
                  key={`${item.ruleId}:${item.path}`}
                  className="rounded-lg border border-neutral-800 p-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-neutral-200" title={item.path}>
                      {item.path}
                    </span>
                    <span className="shrink-0 tabular-nums text-neutral-400">{formatBytes(item.bytes)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded px-2 py-0.5 font-medium ${
                        item.grade === 'safe'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-amber-500/15 text-amber-300'
                      }`}
                    >
                      {item.grade === 'safe' ? 'Green' : 'Yellow'}
                    </span>
                    <span className="text-neutral-400">{recoveryText(item)}</span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{item.evidence}</p>
                  {item.adminRequired && <p className="mt-1 text-xs text-amber-300">Needs administrator rights.</p>}
                  {item.action === 'empty-recycle-bin' && (
                    <button
                      type="button"
                      onClick={() => onReveal(item.path)}
                      className="mt-1 text-xs text-emerald-300 underline"
                    >
                      Open the Recycle Bin in Explorer first
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {adminItems.length > 0 && onRelaunchElevated !== undefined && (
        <button
          type="button"
          onClick={onRelaunchElevated}
          className="mt-4 rounded-md border border-amber-700 px-3 py-1.5 text-sm text-amber-200"
        >
          Relaunch as Administrator
        </button>
      )}

      {needsAck && (
        <label className="mt-4 flex items-start gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={acknowledge}
            onChange={(event) => onAcknowledge(event.target.checked)}
          />
          I understand that {preview.totals.reviewItems} {preview.totals.reviewItems === 1 ? 'item' : 'items'} cannot
          be restored after deletion.
        </label>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || (needsAck && !acknowledge)}
          onClick={onConfirm}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Delete permanently
        </button>
      </div>
    </section>
  );
}
```

The plan test checks the checkbox accessible name `/cannot be restored/` — the label text includes "cannot be restored after deletion", good.

- [ ] **Step 5: Create `app/renderer/src/components/CleanSummary.tsx`**

```tsx
import type { CleanReport } from '../../../src/shared/ipc';
import { formatBytes } from '../format';

export interface CleanSummaryProps {
  report: CleanReport;
  onDone: () => void;
  doneLabel?: string;
}

export function CleanSummary({ report, onDone, doneLabel = 'View updated disk' }: CleanSummaryProps) {
  const issues = report.items.filter((item) => item.status !== 'done');
  const commands = report.items.filter((item) => item.restoreCommand !== null);

  return (
    <section aria-label="Cleanup summary" className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-lg font-medium text-neutral-100">Cleanup complete</h2>
      <p className="mt-2 text-sm text-neutral-300">
        Freed <span className="font-medium text-emerald-300">{formatBytes(report.deletedBytes)}</span> -{' '}
        {formatBytes(report.remainingReclaimableBytes)} still reclaimable.
      </p>
      {report.skippedLocked > 0 && (
        <p className="mt-1 text-sm text-amber-300">
          Partially cleaned: {report.skippedLocked} file(s) in use were skipped.
        </p>
      )}
      {report.itemErrors > 0 && (
        <p className="mt-1 text-sm text-red-300">{report.itemErrors} error(s) - see the item list below.</p>
      )}

      {issues.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {issues.map((item) => (
            <li key={`${item.ruleId}:${item.path}`} className="rounded-lg border border-neutral-800 p-2">
              <p className="break-all text-xs text-neutral-400">{item.path}</p>
              <p className="mt-1 text-neutral-300">
                {item.status === 'partial'
                  ? `partially cleaned: ${item.skippedLocked} file(s) in use`
                  : item.status === 'already-gone'
                    ? 'already gone'
                    : 'could not be cleaned'}
              </p>
            </li>
          ))}
        </ul>
      )}

      {commands.length > 0 && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Restore commands</p>
          <ul className="mt-2 space-y-2 text-sm">
            {commands.map((item) => (
              <li key={`${item.ruleId}:${item.path}`} className="rounded-lg border border-neutral-800 p-2">
                <p className="break-all text-xs text-neutral-400">{item.path}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="text-neutral-200">{item.restoreCommand}</code>
                  <button
                    type="button"
                    aria-label={`Copy command for ${item.path}`}
                    onClick={() => {
                      void navigator.clipboard?.writeText(item.restoreCommand ?? '').catch(() => {});
                    }}
                    className="shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
                  >
                    Copy
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-4 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
      >
        {doneLabel}
      </button>
    </section>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w app -- test/renderer/clean-plan.test.tsx test/renderer/clean-summary.test.tsx` then `npm run typecheck -w app`
Expected: PASS (6 tests); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add app/renderer/src/clean.ts app/renderer/src/components/CleanPlan.tsx app/renderer/src/components/CleanSummary.tsx app/test/renderer/clean-plan.test.tsx app/test/renderer/clean-summary.test.tsx
git commit -m "feat(app): add cleanup plan and summary components"
```

---

### Task 10: Row-level Clean in the Tree Table and Results view

**Files:**
- Create: `app/renderer/src/components/RowCleanDialog.tsx`
- Modify: `app/renderer/src/components/TreeTable.tsx`, `app/renderer/src/pages/ResultsView.tsx`
- Modify tests: `app/test/renderer/tree-table.test.tsx`, `app/test/renderer/results-view.test.tsx`

**Interfaces:**
- Consumes: `CleanPlan`/`CleanSummary` (Task 9), `newCleanId`/`cleanErrorMessage` (Task 9), `sameRoot` from `renderer/src/tree`, `DustApi.previewClean`/`executeClean`.
- Produces: `TreeTableProps.onClean(path)`; `RowCleanDialog({ api, root, path, onClose })`; `ResultsViewProps.onOpenDevCleanup?`; ResultsView refetches on the `cleaned` event and routes the `npm-projects` strip row to Dev Cleanup when the prop is present.

- [ ] **Step 1: Write the failing tests**

Add to `app/test/renderer/tree-table.test.tsx`: add `const onClean = vi.fn();` to `setup`, pass `onClean={onClean}` to `<TreeTable ...>`, return it, and add:

```tsx
  it('offers Clean only for rule-matched rows', () => {
    const { onClean } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Clean Temp' }));
    expect(onClean).toHaveBeenCalledWith('C:\\Temp');
    expect(screen.queryByRole('button', { name: 'Clean Users' })).toBeNull();
  });
```

Add to `app/test/renderer/results-view.test.tsx`:

```tsx
  it('opens a row cleanup dialog and executes the host plan', async () => {
    const executeClean = vi.fn(async () => ({
      ok: true as const,
      report: {
        planId: 'plan-1',
        scope: 'row' as const,
        root: 'C:\\',
        startedAt: 1,
        finishedAt: 2,
        items: [],
        deletedBytes: 1024,
        skippedLocked: 0,
        itemErrors: 0,
        remainingReclaimableBytes: 0,
        cleanedAt: 2,
      },
    }));
    const api = makeApi({ getResults: async () => makeResultsState(), executeClean });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Clean Temp' }));

    const dialog = await screen.findByRole('dialog', { name: 'Clean C:\\Temp' });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(executeClean).toHaveBeenCalledTimes(1));
    expect(executeClean.mock.calls[0]?.[0]).toMatchObject({ planId: 'plan-1' });
    expect(await screen.findByText('Cleanup complete')).toBeInTheDocument();
  });

  it('refetches results after a cleaned event', async () => {
    const getResults = vi.fn(async () => makeResultsState());
    const handlers: Array<(event: ScanEvent) => void> = [];
    const api = makeApi({
      getResults,
      onScanEvent: (handler) => {
        handlers.push(handler);
        return () => {};
      },
    });
    render(<ResultsView api={api} root="C:\\" runId={null} />);
    await screen.findByText('Users');
    expect(getResults).toHaveBeenCalledTimes(1);

    await act(async () => {
      handlers[0]?.({ type: 'cleaned', cleanId: 'clean-1', root: 'C:\\' });
    });
    await waitFor(() => expect(getResults).toHaveBeenCalledTimes(2));
  });

  it('opens Dev Cleanup from the npm projects category', async () => {
    const onOpenDevCleanup = vi.fn();
    const categories = makeCategories().map((row) =>
      row.category === 'npm-projects' ? { ...row, bytes: 4096, items: 1, ruleIds: ['npm-project-modules'] } : row,
    );
    const api = makeApi({ getResults: async () => makeResultsState({ categories }) });
    render(<ResultsView api={api} root="C:\\" runId={null} onOpenDevCleanup={onOpenDevCleanup} />);

    fireEvent.click(await screen.findByRole('button', { name: /npm projects/ }));
    expect(onOpenDevCleanup).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Users')).not.toBeNull();
  });
```

`makeCategories` must be imported in the results-view test: change the import line to `import { makeApi, makeCategories, makeResultsState } from './fakes';`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/renderer/tree-table.test.tsx test/renderer/results-view.test.tsx`
Expected: FAIL — `onClean` prop missing / Clean button absent / no dialog.

- [ ] **Step 3: Add the Clean button to `TreeTable`**

`app/renderer/src/components/TreeTable.tsx` — add `onClean: (path: string) => void;` to `TreeTableProps` after `onSelect`, destructure it, replace the `action` column cell with:

```tsx
      columnHelper.display({
        id: 'action',
        header: 'Action',
        cell: (info) => {
          const row = info.row.original.row;
          return (
            <div className="flex gap-1">
              {row.action !== null && (
                <button
                  type="button"
                  aria-label={`Clean ${row.name}`}
                  onClick={() => onClean(row.path)}
                  className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white"
                >
                  Clean
                </button>
              )}
              <button
                type="button"
                onClick={() => onReveal(row.path)}
                className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
              >
                Explore
              </button>
            </div>
          );
        },
      }),
```

and add `onClean` to the `columns` `useMemo` dependency array (`[expanded, onClean, onReveal, onSelect, onToggle, totalBytes]`).

- [ ] **Step 4: Create `app/renderer/src/components/RowCleanDialog.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { CleanPreview, CleanReport, DustApi } from '../../../src/shared/ipc';
import { CleanPlan } from './CleanPlan';
import { CleanSummary } from './CleanSummary';
import { cleanErrorMessage, newCleanId } from '../clean';

export interface RowCleanDialogProps {
  api: DustApi;
  root: string;
  path: string;
  onClose: () => void;
}

export function RowCleanDialog({ api, root, path, onClose }: RowCleanDialogProps) {
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setReport(null);
    setError(null);
    setAcknowledge(false);
    api
      .previewClean({ scope: 'row', root, paths: [path] })
      .then((result) => {
        if (!active) return;
        if (result.ok) setPreview(result.preview);
        else setError(cleanErrorMessage(result));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [api, root, path]);

  const confirm = useCallback(async () => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.executeClean({
        cleanId: newCleanId(),
        planId: preview.planId,
        acknowledge: preview.items.filter((item) => item.grade === 'review').map((item) => item.path),
      });
      if (result.ok) setReport(result.report);
      else setError(cleanErrorMessage(result));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [api, preview]);

  return (
    <div
      role="dialog"
      aria-label={`Clean ${path}`}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6"
    >
      <div className="max-h-full w-[560px] overflow-auto rounded-xl border border-neutral-700 bg-neutral-950 p-4">
        {error !== null && <p className="mb-3 text-sm text-red-300">{error}</p>}
        {report !== null ? (
          <CleanSummary report={report} onDone={onClose} doneLabel="Close" />
        ) : preview === null ? (
          <p className="text-sm text-neutral-400">Building the plan...</p>
        ) : (
          <CleanPlan
            preview={preview}
            acknowledge={acknowledge}
            onAcknowledge={setAcknowledge}
            onConfirm={() => void confirm()}
            onCancel={onClose}
            onReveal={(target) => {
              void api.revealPath(target).catch(() => {});
            }}
            onRelaunchElevated={() => {
              void api.relaunchElevated().catch(() => {});
            }}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire ResultsView**

`app/renderer/src/pages/ResultsView.tsx`:

1. Add `sameRoot` to the `../tree` import list and add `import { RowCleanDialog } from '../components/RowCleanDialog';` after the TreeTable import.
2. Extend the props:

```tsx
export interface ResultsViewProps {
  api: DustApi;
  root: string;
  runId: string | null;
  onOpenDevCleanup?: () => void;
}
```

and destructure `onOpenDevCleanup` in the component signature.
3. Add `const [cleanPath, setCleanPath] = useState<string | null>(null);` next to `selected`.
4. Replace both `useEffect` blocks (the `getResults` loader and the live event subscription) with:

```tsx
  const reload = useCallback(() => {
    api
      .getResults(root)
      .then((next) => {
        storeRef.current = createRowStore(root);
        upsertRows(storeRef.current, next.rows);
        setState(next);
        setVersion((value) => value + 1);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [api, root]);

  useEffect(() => {
    if (runId !== null) return;
    storeRef.current = createRowStore(root);
    setState(null);
    setError(null);
    setExpanded(new Set());
    setFilter(null);
    setSelected(null);
    reload();
  }, [reload, root, runId]);

  useEffect(() => {
    return api.onScanEvent((next) => {
      if (next.type === 'cleaned') {
        if (sameRoot(next.root, root)) reload();
        return;
      }
      if (runId === null || !('runId' in next) || next.runId !== runId) return;
      if (next.type === 'folders') {
        const affectsVisible = next.folders.some((row) => isRowVisible(row.parent, root, expandedRef.current));
        upsertRows(storeRef.current, next.folders);
        if (affectsVisible) setVersion((value) => value + 1);
      } else if (next.type === 'categories') {
        setLiveCategories(next.categories);
      } else if (next.type === 'matches') {
        mergeMatches(storeRef.current, next.matches);
        setVersion((value) => value + 1);
      }
    });
  }, [api, root, runId, reload]);
```

5. Add the category router next to `toggle`:

```tsx
  const selectCategory = useCallback(
    (category: CategoryId | null) => {
      if (category === 'npm-projects' && onOpenDevCleanup !== undefined) {
        onOpenDevCleanup();
        return;
      }
      setFilter(category);
    },
    [onOpenDevCleanup],
  );
```

and change `<CategoryStrip categories={categories} active={filter} onSelect={setFilter} />` to `onSelect={selectCategory}`.
6. Pass `onClean={setCleanPath}` to `<TreeTable ...>` (add after `onReveal={reveal}`).
7. Before the closing `</section>`, after the grid `</div>`, add:

```tsx
      {cleanPath !== null && (
        <RowCleanDialog api={api} root={root} path={cleanPath} onClose={() => setCleanPath(null)} />
      )}
```

- [ ] **Step 6: Run the renderer tests and typecheck**

Run: `npm run test -w app -- test/renderer/tree-table.test.tsx test/renderer/results-view.test.tsx` then `npm run typecheck -w app`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add app/renderer/src/components/TreeTable.tsx app/renderer/src/components/RowCleanDialog.tsx app/renderer/src/pages/ResultsView.tsx app/test/renderer/tree-table.test.tsx app/test/renderer/results-view.test.tsx
git commit -m "feat(app): add row-level Clean with a plan-token dialog"
```

### Task 11: Quick Clean view, dashboard button and routing

**Files:**
- Create: `app/renderer/src/pages/QuickCleanView.tsx`, `app/test/renderer/quick-clean-view.test.tsx`
- Modify: `app/renderer/src/pages/Dashboard.tsx`, `app/renderer/src/App.tsx`
- Modify tests: `app/test/renderer/dashboard.test.tsx`, `app/test/renderer/app.test.tsx`

**Interfaces:**
- Consumes: `CleanPlan`/`CleanSummary`/`cleanErrorMessage`/`newCleanId` (Task 9); `DustApi`.
- Produces: `QuickCleanView({ api, onDone, onViewResults })`; `DashboardProps.onQuickClean: () => void`; App routes `{ name: 'quick-clean' }`.

- [ ] **Step 1: Write the failing Quick Clean view test**

`app/test/renderer/quick-clean-view.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickCleanView } from '../../renderer/src/pages/QuickCleanView';
import { makeApi, makeCleanReport } from './fakes';

describe('QuickCleanView', () => {
  it('previews, confirms and shows the summary', async () => {
    const executeClean = vi.fn(async () => ({
      ok: true as const,
      report: makeCleanReport({ deletedBytes: 2048, remainingReclaimableBytes: 1024 }),
    }));
    const api = makeApi({ executeClean });
    const onDone = vi.fn();
    const onViewResults = vi.fn();
    render(<QuickCleanView api={api} onDone={onDone} onViewResults={onViewResults} />);

    expect(await screen.findByRole('region', { name: 'Cleanup plan' })).toBeInTheDocument();
    expect(screen.getByText('C:\\Users\\x\\AppData\\Local\\Temp')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(executeClean).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Cleanup complete')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View updated disk' }));
    expect(onViewResults).toHaveBeenCalledWith('C:\\');

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('surfaces when a scan holds the lock', async () => {
    const api = makeApi({ previewClean: async () => ({ ok: false, reason: 'busy', running: 'analyze' }) });
    render(<QuickCleanView api={api} onDone={vi.fn()} onViewResults={vi.fn()} />);

    expect(await screen.findByText('A scan is already running. Cancel it first.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w app -- test/renderer/quick-clean-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/renderer/src/pages/QuickCleanView.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { CleanPreview, CleanReport, DustApi } from '../../../src/shared/ipc';
import { CleanPlan } from '../components/CleanPlan';
import { CleanSummary } from '../components/CleanSummary';
import { cleanErrorMessage, newCleanId } from '../clean';

export interface QuickCleanViewProps {
  api: DustApi;
  onDone: () => void;
  onViewResults: (root: string) => void;
}

export function QuickCleanView({ api, onDone, onViewResults }: QuickCleanViewProps) {
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setError(null);
    api
      .previewClean({ scope: 'quick' })
      .then((result) => {
        if (!active) return;
        if (result.ok) setPreview(result.preview);
        else setError(cleanErrorMessage(result));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [api]);

  const confirm = useCallback(async () => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.executeClean({
        cleanId: newCleanId(),
        planId: preview.planId,
        acknowledge: preview.items.filter((item) => item.grade === 'review').map((item) => item.path),
      });
      if (result.ok) setReport(result.report);
      else setError(cleanErrorMessage(result));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [api, preview]);

  return (
    <main className="mx-auto max-w-3xl px-8 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-100">Quick Clean</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {preview !== null
            ? preview.root
            : 'Safe system cleanup - projects are never touched here.'}
        </p>
      </header>

      {error !== null && (
        <p className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-200">{error}</p>
      )}

      {report !== null ? (
        <CleanSummary report={report} onDone={() => onViewResults(report.root)} doneLabel="View updated disk" />
      ) : preview === null ? (
        error === null && <p className="text-sm text-neutral-400">Building the cleanup plan.</p>
      ) : (
        <CleanPlan
          preview={preview}
          acknowledge={acknowledge}
          onAcknowledge={setAcknowledge}
          onConfirm={() => void confirm()}
          onCancel={onDone}
          onReveal={(target) => {
            void api.revealPath(target).catch(() => {});
          }}
          onRelaunchElevated={() => {
            void api.relaunchElevated().catch(() => {});
          }}
          busy={busy}
        />
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-6 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200"
      >
        Back to dashboard
      </button>
    </main>
  );
}
```

- [ ] **Step 4: Add the Dashboard button**

`app/renderer/src/pages/Dashboard.tsx`:

1. Add `onQuickClean: () => void;` to `DashboardProps` and destructure it in the component signature.
2. Replace the header block with:

```tsx
      <header className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-100">Dust</h1>
            <p className="mt-1 text-sm text-neutral-400">Find what is safe to delete.</p>
          </div>
          <button
            type="button"
            disabled={state.scan !== null || state.volumes.length === 0}
            onClick={onQuickClean}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Quick Clean
          </button>
        </div>
      </header>
```

3. Every `render(<Dashboard ... />)` in `app/test/renderer/dashboard.test.tsx` gains `onQuickClean={vi.fn()}`; add the test:

```tsx
  it('opens quick clean from the dashboard', async () => {
    const onQuickClean = vi.fn();
    render(
      <Dashboard api={makeApi()} onAnalyze={okAnalyze()} onViewResults={vi.fn()} onQuickClean={onQuickClean} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Quick Clean' }));
    expect(onQuickClean).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 5: Route Quick Clean in `App.tsx`**

Replace `app/renderer/src/App.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { DustApi, ScanEvent, StartAnalyzeResult } from '../../src/shared/ipc';
import { Dashboard } from './pages/Dashboard';
import { QuickCleanView } from './pages/QuickCleanView';
import { ResultsView } from './pages/ResultsView';
import { ScanView } from './pages/ScanView';

export interface AppProps {
  api: DustApi;
}

type View =
  | { name: 'dashboard' }
  | { name: 'scan'; root: string; runId: string }
  | { name: 'results'; root: string }
  | { name: 'quick-clean' };

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
  if (view.name === 'quick-clean') {
    return (
      <QuickCleanView api={api} onDone={back} onViewResults={(root) => setView({ name: 'results', root })} />
    );
  }
  if (view.name === 'results') {
    return (
      <main className="mx-auto max-w-6xl px-8 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-100">Results</h1>
          <p className="mt-1 text-sm text-neutral-400">{view.root}</p>
        </header>
        <ResultsView api={api} root={view.root} runId={null} />
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
  return (
    <Dashboard
      api={api}
      onAnalyze={analyze}
      onViewResults={(root) => setView({ name: 'results', root })}
      onQuickClean={() => setView({ name: 'quick-clean' })}
    />
  );
}
```

Add to `app/test/renderer/app.test.tsx`:

```tsx
  it('opens Quick Clean from the dashboard', async () => {
    const api = makeApi();
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Quick Clean' }));
    expect(await screen.findByRole('heading', { name: 'Quick Clean' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dust' })).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run the renderer suite and typecheck**

Run: `npm run test -w app` then `npm run typecheck -w app`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add app/renderer/src/pages/QuickCleanView.tsx app/renderer/src/pages/Dashboard.tsx app/renderer/src/App.tsx app/test/renderer/quick-clean-view.test.tsx app/test/renderer/dashboard.test.tsx app/test/renderer/app.test.tsx
git commit -m "feat(app): add the Quick Clean flow"
```

---

### Task 12: Dev Cleanup view, category entry, routing and smoke docs

**Files:**
- Create: `app/renderer/src/pages/DevCleanupView.tsx`, `app/test/renderer/dev-cleanup-view.test.tsx`
- Modify: `app/renderer/src/App.tsx`, `app/README.md`
- Modify tests: `app/test/renderer/app.test.tsx`

**Interfaces:**
- Consumes: `CleanPlan`/`CleanSummary` (Task 9); `DustApi.getDevCleanup`/`previewClean`/`executeClean`/`setPin`/`onScanEvent`; `ResultsViewProps.onOpenDevCleanup` (Task 10).
- Produces: `DevCleanupView({ api, root, onBack, onViewResults })`; App routes `{ name: 'dev-cleanup'; root }` from the results strip.

- [ ] **Step 1: Write the failing Dev Cleanup view tests**

`app/test/renderer/dev-cleanup-view.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DevCleanupView } from '../../renderer/src/pages/DevCleanupView';
import { makeApi, makeCleanReport, makeDevCleanupState } from './fakes';

describe('DevCleanupView', () => {
  it('renders groups and selects all dead green projects', async () => {
    const api = makeApi({ getDevCleanup: async () => makeDevCleanupState() });
    render(<DevCleanupView api={api} root="C:\\" onBack={vi.fn()} onViewResults={vi.fn()} />);

    expect(await screen.findByText('dead-app')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select all Dead + green' }));
    expect(screen.getByText('1 selected · 512 KB')).toBeInTheDocument();
  });

  it('reviews and executes the selected projects with restore commands', async () => {
    const executeClean = vi.fn(async () => ({
      ok: true as const,
      report: makeCleanReport({
        scope: 'dev',
        deletedBytes: 512,
        items: [
          {
            ruleId: 'npm-project-modules',
            path: 'C:\\dev\\dead-app\\node_modules',
            category: 'npm-projects',
            action: 'delete-path',
            status: 'done',
            plannedBytes: 512,
            deletedBytes: 512,
            skippedLocked: 0,
            errorCount: 0,
            restoreCommand: 'npm ci',
          },
        ],
      }),
    }));
    const api = makeApi({ getDevCleanup: async () => makeDevCleanupState(), executeClean });
    render(<DevCleanupView api={api} root="C:\\" onBack={vi.fn()} onViewResults={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select all Dead + green' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review cleanup' }));

    expect(await screen.findByRole('region', { name: 'Cleanup plan' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(executeClean).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Cleanup complete')).toBeInTheDocument();
    expect(screen.getByText('npm ci')).toBeInTheDocument();
  });

  it('pins a project through the api and reloads', async () => {
    const setPin = vi.fn(async () => ({ ok: true as const, pins: ['C:\\dev\\dead-app'] }));
    const getDevCleanup = vi.fn(async () => makeDevCleanupState());
    const api = makeApi({ getDevCleanup, setPin });
    render(<DevCleanupView api={api} root="C:\\" onBack={vi.fn()} onViewResults={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Keep dead-app' }));
    await waitFor(() => expect(setPin).toHaveBeenCalledWith('C:\\dev\\dead-app', true));
    await waitFor(() => expect(getDevCleanup).toHaveBeenCalledTimes(2));
  });

  it('shows the session-only recently cleaned group', async () => {
    const api = makeApi({
      getDevCleanup: async () =>
        makeDevCleanupState({
          recentlyCleaned: [
            {
              root: 'C:\\',
              path: 'C:\\dev\\old',
              name: 'old',
              bytes: 2048,
              restoreCommand: 'npm ci',
              cleanedAt: Date.UTC(2026, 0, 3),
            },
          ],
        }),
    });
    render(<DevCleanupView api={api} root="C:\\" onBack={vi.fn()} onViewResults={vi.fn()} />);

    expect(await screen.findByText('Recently cleaned (1)')).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w app -- test/renderer/dev-cleanup-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/renderer/src/pages/DevCleanupView.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CleanItemResult,
  CleanPreview,
  CleanReport,
  DevCleanupState,
  DevProject,
  DustApi,
} from '../../../src/shared/ipc';
import { CleanPlan } from '../components/CleanPlan';
import { CleanSummary } from '../components/CleanSummary';
import { cleanErrorMessage, newCleanId } from '../clean';
import { formatBytes, formatRelativeTime } from '../format';

export interface DevCleanupViewProps {
  api: DustApi;
  root: string;
  onBack: () => void;
  onViewResults: (root: string) => void;
}

export function DevCleanupView({ api, root, onBack, onViewResults }: DevCleanupViewProps) {
  const [state, setState] = useState<DevCleanupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleanId, setCleanId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CleanItemResult[]>([]);

  const load = useCallback(() => {
    api
      .getDevCleanup(root)
      .then(setState)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [api, root]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (cleanId === null) return;
    return api.onScanEvent((event) => {
      if (event.type === 'clean-item' && event.cleanId === cleanId) {
        setProgress((current) => [...current, event.item]);
      }
    });
  }, [api, cleanId]);

  const projects = useMemo(
    () => (state === null ? [] : state.groups.flatMap((group) => group.projects)),
    [state],
  );
  const selectedBytes = useMemo(
    () =>
      projects
        .filter((project) => selected.has(project.path))
        .reduce((sum, project) => sum + project.nodeModulesBytes, 0),
    [projects, selected],
  );

  const toggle = useCallback((path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectDeadGreen = useCallback(() => {
    if (state === null) return;
    const dead = state.groups.find((group) => group.id === 'dead');
    const paths = (dead?.projects ?? [])
      .filter((project) => project.offered && project.grade === 'green')
      .map((project) => project.path);
    setSelected(new Set(paths));
  }, [state]);

  const setPin = useCallback(
    async (path: string, pinned: boolean) => {
      const result = await api.setPin(path, pinned);
      if (result.ok) load();
      else setError(result.message);
    },
    [api, load],
  );

  const review = useCallback(async () => {
    setError(null);
    const result = await api.previewClean({ scope: 'dev', root, paths: [...selected] });
    if (result.ok) {
      setPreview(result.preview);
      setAcknowledge(false);
    } else {
      setError(cleanErrorMessage(result));
    }
  }, [api, root, selected]);

  const confirm = useCallback(async () => {
    if (preview === null) return;
    const id = newCleanId();
    setBusy(true);
    setError(null);
    setCleanId(id);
    setProgress([]);
    try {
      const result = await api.executeClean({
        cleanId: id,
        planId: preview.planId,
        acknowledge: preview.items.filter((item) => item.grade === 'review').map((item) => item.path),
      });
      if (result.ok) {
        setReport(result.report);
        setPreview(null);
        setSelected(new Set());
        load();
      } else {
        setError(cleanErrorMessage(result));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setCleanId(null);
    }
  }, [api, load, preview]);

  if (state === null) {
    return (
      <main className="mx-auto max-w-4xl px-8 py-10 text-sm text-neutral-400">
        {error ?? 'Loading projects.'}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-100">Dev Cleanup</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {root}
          {state.finishedAt !== null && ` · analyzed ${formatRelativeTime(state.finishedAt)}`}
        </p>
      </header>

      {state.source === 'empty' ? (
        <p className="text-sm text-neutral-400">
          No scan data for this volume - run an Analyze from the dashboard first.
        </p>
      ) : report !== null ? (
        <CleanSummary
          report={report}
          onDone={() => {
            setReport(null);
            load();
          }}
          doneLabel="Back to projects"
        />
      ) : preview !== null ? (
        <CleanPlan
          preview={preview}
          acknowledge={acknowledge}
          onAcknowledge={setAcknowledge}
          onConfirm={() => void confirm()}
          onCancel={() => setPreview(null)}
          onReveal={(target) => {
            void api.revealPath(target).catch(() => {});
          }}
          busy={busy}
        />
      ) : (
        <>
          {error !== null && <p className="mb-4 text-sm text-red-300">{error}</p>}
          {busy && progress.length > 0 && (
            <ul role="status" className="mb-4 space-y-1 text-sm text-neutral-300">
              {progress.map((item) => (
                <li key={item.path}>
                  {item.path} - {item.status}
                </li>
              ))}
            </ul>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={selectDeadGreen}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
            >
              Select all Dead + green
            </button>
            <span className="text-sm text-neutral-400">
              {selected.size} selected · {formatBytes(selectedBytes)}
            </span>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => void review()}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Review cleanup
            </button>
          </div>

          <div className="space-y-6">
            {state.groups.map((group) => (
              <section key={group.id} aria-label={group.label}>
                <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
                  {group.label} ({group.projects.length})
                </h2>
                {group.projects.length === 0 ? (
                  <p className="mt-1 text-sm text-neutral-600">None.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {group.projects.map((project) => (
                      <li key={project.path} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${project.name}`}
                            checked={selected.has(project.path)}
                            disabled={!project.offered || busy}
                            onChange={() => toggle(project.path)}
                            className="mt-1"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-neutral-100" title={project.path}>
                              {project.name}
                            </p>
                            <p className="break-all text-xs text-neutral-500">{project.path}</p>
                            <p className="mt-1 text-xs text-neutral-400">
                              {formatBytes(project.nodeModulesBytes)} · {describeActivity(project)} ·{' '}
                              {project.packageManager}
                              {project.kind === 'monorepo' ? ` · ${project.workspaceCount} packages` : ''}
                            </p>
                            {project.reasons.length > 0 && (
                              <p className="mt-1 text-xs text-amber-300">{project.reasons.join(' · ')}</p>
                            )}
                            {project.restoreCommand !== null && (
                              <p className="mt-1 text-xs text-neutral-500">Rebuild: {project.restoreCommand}</p>
                            )}
                          </div>
                          <span
                            className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                              project.grade === 'green'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            {project.grade === 'green' ? 'Green' : project.grade === 'yellow' ? 'Yellow' : 'Not offered'}
                          </span>
                          <button
                            type="button"
                            aria-label={`${project.pinned ? 'Unpin' : 'Keep'} ${project.name}`}
                            onClick={() => void setPin(project.path, !project.pinned)}
                            className="shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
                          >
                            {project.pinned ? 'Unpin' : 'Keep'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          {state.recentlyCleaned.length > 0 && (
            <details className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <summary className="cursor-pointer text-sm text-neutral-300">
                Recently cleaned ({state.recentlyCleaned.length})
              </summary>
              <ul className="mt-3 space-y-2 text-sm">
                {state.recentlyCleaned.map((entry) => (
                  <li key={entry.path} className="rounded-lg border border-neutral-800 p-2">
                    <p className="text-neutral-200">{entry.name}</p>
                    <p className="break-all text-xs text-neutral-500">{entry.path}</p>
                    <p className="mt-1 text-xs text-neutral-400">
                      {formatBytes(entry.bytes)} freed {formatRelativeTime(entry.cleanedAt)}
                      {entry.restoreCommand !== null && ` · rebuild with ${entry.restoreCommand}`}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mt-6 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200"
      >
        Back to dashboard
      </button>
      <button
        type="button"
        onClick={() => onViewResults(root)}
        className="mt-6 ml-2 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
      >
        View results
      </button>
    </main>
  );
}

function describeActivity(project: DevProject): string {
  if (project.activityMs === null) return 'activity unknown';
  return `${formatRelativeTime(project.activityMs)} (${project.activitySource})`;
}
```

- [ ] **Step 4: Route Dev Cleanup from `App.tsx`**

`app/renderer/src/App.tsx`:

1. Add `import { DevCleanupView } from './pages/DevCleanupView';`.
2. Extend the `View` union with `| { name: 'dev-cleanup'; root: string }`.
3. Add before the `results` branch:

```tsx
  if (view.name === 'dev-cleanup') {
    return (
      <DevCleanupView
        api={api}
        root={view.root}
        onBack={back}
        onViewResults={(root) => setView({ name: 'results', root })}
      />
    );
  }
```

4. In the `results` branch, pass the category entry point:

```tsx
        <ResultsView
          api={api}
          root={view.root}
          runId={null}
          onOpenDevCleanup={() => setView({ name: 'dev-cleanup', root: view.root })}
        />
```

- [ ] **Step 5: Add the App navigation test**

Add to `app/test/renderer/app.test.tsx` (extend the imports from `./fakes` to include `makeCategories` and `makeResultsState`):

```tsx
  it('opens Dev Cleanup from the results category strip', async () => {
    const categories = makeCategories().map((row) =>
      row.category === 'npm-projects'
        ? { ...row, bytes: 4096, items: 1, ruleIds: ['npm-project-modules'] }
        : row,
    );
    const api = makeApi({ getResults: async (root) => makeResultsState({ root, categories }) });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View results for C:\\' }));
    fireEvent.click(await screen.findByRole('button', { name: /npm projects/ }));

    expect(await screen.findByRole('heading', { name: 'Dev Cleanup' })).toBeInTheDocument();
    expect(await screen.findByText('dead-app')).toBeInTheDocument();
  });
```

- [ ] **Step 6: Update the README smoke checklist**

Append to `app/README.md`:

```markdown
14. Click `Clean` on a rule-matched row (green badge): the plan dialog lists the path, its recovery statement and evidence. `Cancel` closes it without deleting; `Delete permanently` removes the folder and the row disappears from the tree while parent sizes shrink.
15. Click `Clean` on a yellow/review row (or the Recycle Bin row): the confirmation is disabled until the acknowledgement checkbox is ticked. The Recycle Bin row offers `Open the Recycle Bin in Explorer first`.
16. Click `Quick Clean` on the Dashboard: the plan shows per-category items with recovery notes and totals. Confirm; the summary reports freed bytes, remaining reclaimable space and (for partial items) "N files in use". Back on the Dashboard the card shows `Last cleaned`.
17. With `C:\Windows\Temp` present, the Quick Clean plan marks that row `Needs administrator rights` and shows `Relaunch as Administrator`; clicking it relaunches the app elevated and the window closes.
18. From Results click the `npm projects` strip row: Dev Cleanup opens with Dead / Occasional / Active / Orphaned / Pinned groups. `Select all Dead + green` then `Review cleanup` shows the plan with rebuild commands; confirming cleans the node_modules directories and the summary lists the copyable commands. The collapsed `Recently cleaned` group keeps them for the session; relaunching clears it.
19. Click `Keep` on a project: it moves to the Pinned group and is never selectable; `Unpin` restores it. Locked files are skipped with "partially cleaned: N files in use" and never fail the batch.
```

- [ ] **Step 7: Run everything and commit**

Run: `npm run test` then `npm run typecheck` from the worktree root
Expected: all green across `core` and `app`.

```bash
git add app/renderer/src/pages/DevCleanupView.tsx app/renderer/src/App.tsx app/test/renderer/dev-cleanup-view.test.tsx app/test/renderer/app.test.tsx app/README.md
git commit -m "feat(app): add the Dev Cleanup flow with pins and recent cleanups"
```

---

## Deliberately deferred (recorded so the executor does not invent it)

- **Full-tree persistence after cleanup:** the snapshot stays depth-4 + top contributors; `pruneSnapshotAfterCleanup` adjusts what is persisted. A later Analyze rebuilds everything.
- **Per-action elevation helper:** "Relaunch as Administrator" relaunches the whole app elevated; the user re-runs Quick Clean. A dedicated helper that performs only the admin item is an implementation-time decision left for post-MVP (spec §9/§11).
- **Item-level checkboxes inside the Quick Clean plan:** the spec requires plan → explicit confirmation, not per-item toggling; the standalone row Clean covers single-item deletion.
- **Cleanup progress percentage:** the Dev Cleanup view streams `clean-item` events as a list; a progress bar is polish, not required.
- **`applyCleanupReport` itself is unchanged.** `pruneSnapshotAfterCleanup` calls it for category bytes and `cleanedAt`, then layers folder/match/project pruning and item-count adjustments on top.
- **Renderer virtualization is still covered only by the manual smoke checklist.**


