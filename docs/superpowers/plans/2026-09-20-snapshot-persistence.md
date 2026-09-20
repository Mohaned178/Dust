# Snapshot Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist scan results so the app reopens instantly: a versioned JSON snapshot (scan metadata, per-disk totals, per-category summaries, project records, a depth-4 folder map plus top contributors) plus a separate user-preferences store for pins, with corruption-proof loading and a disk-usage provider for the Dashboard.

**Architecture:** Pure-TypeScript modules under `core/src/snapshot/` (schema + loader validation, snapshot builder, atomic file store, pins store) and `core/src/system/volumes.ts` (per-volume usage with `statfs` first and a PowerShell fallback). The snapshot never re-walks anything: it is built from a scan result, classification output, and rule matches the caller already has. Plans 7-9 consume it read-only.

**Tech Stack:** TypeScript (strict, ESM), Node >= 20 (`node:fs`, `node:path`, `node:os`, `node:child_process`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-dust-mvp-design.md` (Sections 4.5, 7.1, 7.2, 7.5, 7.6, 9)

## Global Constraints

- **Base branch:** `plan-5-project-classification` at `ccce942` (Plan 5, stacked PR open at the time of writing). If Plans 2-5 have merged to `master` by execution time, branch from `master` instead — whichever tree contains Plans 1-5. Never branch this plan from a tree without the project classification.
- Platform: Windows first; commands run in PowerShell 7. Node >= 20. TypeScript strict. ESM everywhere. `core/` has zero Electron imports and runs under vitest in plain Node.
- Snapshot file layout per spec §4.5 (binding): `schemaVersion`, `rulesVersion`, scan root, `startedAt`, `finishedAt`, `status` (`complete` | `cancelled`), per-disk used/free totals, category summaries (bytes + item counts per rule), project records, folder map to depth 4 + top contributors. Plus `cleanedAt` (last successful cleanup) per the reviewed Section 7.6.
- Loading is corruption-proof (spec §9): missing file, unreadable file, invalid JSON, wrong shape, or wrong `schemaVersion` all produce a non-throwing result that tells the caller exactly what happened; a `rulesVersion` mismatch still loads (the UI banners "rescan for accuracy" later). Snapshot saving is atomic (temp file + rename) and never throws.
- Folder entries carry per-folder aggregates only (no raw file lists); tree navigation beyond depth 4 requires a fresh scan.
- Pins live in a separate user-preferences file so a new scan snapshot never wipes them; both stores tolerate corruption by falling back to empty state.
- Commit after every task. Before each commit run: `npm run test -w core` and `npm run typecheck -w core`.

---

## File Structure

- `core/src/rules/version.ts` — `RULES_VERSION` (stamps every snapshot; UI compares).
- `core/src/snapshot/schema.ts` — version constant, all snapshot types, `SnapshotCorruptError`, `parseSnapshot` validator.
- `core/src/snapshot/build.ts` — `buildSnapshot`, `buildFolderMap`, `applyCleanupReport` + input/option types.
- `core/src/snapshot/store.ts` — `StorePaths`, `UserPreferences`, `SaveResult`, `SnapshotStore` (load/save/pins, never throws).
- `core/src/system/volumes.ts` — `VolumeUsage`, `getVolumeUsage`, `listFixedVolumes`.
- `core/src/index.ts` — public exports (Task 5).
- Tests: `snapshot-schema.test.ts`, `snapshot-build.test.ts`, `snapshot-store.test.ts`, `volumes.test.ts`, `snapshot-pipeline.test.ts`; `smoke.test.ts` fifth block (Task 5).

---

### Task 1: Snapshot schema + validation + rules version

**Files:**
- Create: `core/src/snapshot/schema.ts`
- Create: `core/src/rules/version.ts`
- Test: `core/test/snapshot-schema.test.ts`

**Interfaces:**
- Consumes: `ProjectRecord` from `core/src/projects/types.ts`.
- Produces: `SNAPSHOT_SCHEMA_VERSION = 1` (schema.ts); `SnapshotDisk { volume; totalBytes: number | null; freeBytes: number | null }`; `SnapshotCategory { ruleId; category; bytes; items }`; `SnapshotFolder { path; name; bytes; fileCount; folderCount; newestMtimeMs; errorCount; partial; complete; childCount }`; `SnapshotData { schemaVersion; rulesVersion; root; startedAt; finishedAt; status: 'complete' | 'cancelled'; cleanedAt: number | null; disks; categories; projects; folders }`; `SnapshotCorruptError { reason: string }`; `parseSnapshot(raw: string): SnapshotData` (throws `SnapshotCorruptError`); `RULES_VERSION = '1'` (rules/version.ts).

- [ ] **Step 1: Write the failing tests**

`core/test/snapshot-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_SCHEMA_VERSION, SnapshotCorruptError, parseSnapshot } from '../src/snapshot/schema';
import type { SnapshotData } from '../src/snapshot/schema';

function validSnapshot(): SnapshotData {
  return {
    schemaVersion: 1,
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
        fileCount: 2,
        folderCount: 0,
        newestMtimeMs: 3000,
        errorCount: 0,
        partial: false,
        complete: true,
        childCount: 0,
      },
    ],
  };
}

describe('parseSnapshot', () => {
  it('accepts a complete valid snapshot', () => {
    expect(parseSnapshot(JSON.stringify(validSnapshot()))).toEqual(validSnapshot());
  });

  it('rejects garbage, wrong shapes and the wrong schema version', () => {
    for (const raw of ['{oops', '5', 'null', '[]', '{}', '{"schemaVersion": 2}']) {
      expect(() => parseSnapshot(raw), raw).toThrow(SnapshotCorruptError);
    }
    const wrongVersion = { ...validSnapshot(), schemaVersion: 2 };
    expect(() => parseSnapshot(JSON.stringify(wrongVersion))).toThrow(SnapshotCorruptError);
  });

  it('rejects entries with bad field types', () => {
    const badDisks = { ...validSnapshot(), disks: [{ volume: 'F:\\', totalBytes: 'lots', freeBytes: 1 }] };
    expect(() => parseSnapshot(JSON.stringify(badDisks))).toThrow(SnapshotCorruptError);
    const badStatus = { ...validSnapshot(), status: 'running' };
    expect(() => parseSnapshot(JSON.stringify(badStatus))).toThrow(SnapshotCorruptError);
    const badFolders = { ...validSnapshot(), folders: [{ path: 'F:\\x' }] };
    expect(() => parseSnapshot(JSON.stringify(badFolders))).toThrow(SnapshotCorruptError);
  });

  it('accepts a foreign rulesVersion — the loader does not pin rules', () => {
    const foreign = { ...validSnapshot(), rulesVersion: '999' };
    expect(parseSnapshot(JSON.stringify(foreign)).rulesVersion).toBe('999');
  });

  it('accepts a cancelled scan snapshot with no folders', () => {
    const cancelled = { ...validSnapshot(), status: 'cancelled' as const, folders: [], cleanedAt: 1500 };
    expect(parseSnapshot(JSON.stringify(cancelled)).status).toBe('cancelled');
  });

  it('exposes the current schema version constant', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/snapshot/schema`.

- [ ] **Step 3: Implement the schema module and the rules version**

`core/src/rules/version.ts`:

```ts
export const RULES_VERSION = '1';
```

`core/src/snapshot/schema.ts`:

```ts
import type { ProjectRecord } from '../projects/types';

export const SNAPSHOT_SCHEMA_VERSION = 1;

export type ScanStatus = 'complete' | 'cancelled';

export interface SnapshotDisk {
  volume: string;
  totalBytes: number | null;
  freeBytes: number | null;
}

export interface SnapshotCategory {
  ruleId: string;
  category: string;
  bytes: number;
  items: number;
}

export interface SnapshotFolder {
  path: string;
  name: string;
  bytes: number;
  fileCount: number;
  folderCount: number;
  newestMtimeMs: number;
  errorCount: number;
  partial: boolean;
  complete: boolean;
  childCount: number;
}

export interface SnapshotData {
  schemaVersion: number;
  rulesVersion: string;
  root: string;
  startedAt: number;
  finishedAt: number;
  status: ScanStatus;
  cleanedAt: number | null;
  disks: SnapshotDisk[];
  categories: SnapshotCategory[];
  projects: ProjectRecord[];
  folders: SnapshotFolder[];
}

export class SnapshotCorruptError extends Error {
  constructor(public readonly reason: string) {
    super(`corrupt snapshot: ${reason}`);
    this.name = 'SnapshotCorruptError';
  }
}

export function parseSnapshot(raw: string): SnapshotData {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SnapshotCorruptError('invalid-json');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotCorruptError('not-an-object');
  }
  const object = value as Record<string, unknown>;

  if (object.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotCorruptError('schema-version');
  }
  if (typeof object.root !== 'string' || !isFiniteNumber(object.startedAt) || !isFiniteNumber(object.finishedAt)) {
    throw new SnapshotCorruptError('scan-metadata');
  }
  if (object.status !== 'complete' && object.status !== 'cancelled') {
    throw new SnapshotCorruptError('scan-status');
  }
  if (object.cleanedAt !== null && !isFiniteNumber(object.cleanedAt)) {
    throw new SnapshotCorruptError('cleaned-at');
  }
  if (typeof object.rulesVersion !== 'string') {
    throw new SnapshotCorruptError('rules-version');
  }
  if (!Array.isArray(object.disks) || !object.disks.every(isSnapshotDisk)) {
    throw new SnapshotCorruptError('disks');
  }
  if (!Array.isArray(object.categories) || !object.categories.every(isSnapshotCategory)) {
    throw new SnapshotCorruptError('categories');
  }
  if (!Array.isArray(object.projects) || !object.projects.every(isProjectRecord)) {
    throw new SnapshotCorruptError('projects');
  }
  if (!Array.isArray(object.folders) || !object.folders.every(isSnapshotFolder)) {
    throw new SnapshotCorruptError('folders');
  }

  return value as SnapshotData;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSnapshotDisk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.volume === 'string' &&
    (value.totalBytes === null || isFiniteNumber(value.totalBytes)) &&
    (value.freeBytes === null || isFiniteNumber(value.freeBytes))
  );
}

function isSnapshotCategory(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.ruleId === 'string' &&
    typeof value.category === 'string' &&
    isFiniteNumber(value.bytes) &&
    isFiniteNumber(value.items)
  );
}

function isProjectRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.path === 'string' && typeof value.name === 'string';
}

function isSnapshotFolder(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    typeof value.name === 'string' &&
    isFiniteNumber(value.bytes) &&
    isFiniteNumber(value.fileCount) &&
    isFiniteNumber(value.folderCount) &&
    isFiniteNumber(value.newestMtimeMs) &&
    isFiniteNumber(value.errorCount) &&
    typeof value.partial === 'boolean' &&
    typeof value.complete === 'boolean' &&
    isFiniteNumber(value.childCount)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/snapshot/schema.ts core/src/rules/version.ts core/test/snapshot-schema.test.ts
git commit -m "feat(core): add snapshot schema and validation"
```

---

### Task 2: Snapshot builder — metadata, folder map, cleanup rollup

**Files:**
- Create: `core/src/snapshot/build.ts`
- Test: `core/test/snapshot-build.test.ts`

**Interfaces:**
- Consumes: `AggregateTree` and `TreeNode` from `core/src/model/tree.ts`; `ProjectRecord` from `core/src/projects/types.ts`; `CleanupReport` from `core/src/cleaner/cleaner.ts`; `RULES_VERSION` + schema types from Tasks 1.
- Produces: `SnapshotInput { root; startedAt; finishedAt; status; tree; projects; categories; disks; rulesVersion?; priorCleanedAt?; maxDepth?; topContributors? }`; `FolderMapOptions { maxDepth?; topContributors? }`; `buildSnapshot(input: SnapshotInput): SnapshotData`; `buildFolderMap(tree, root, options?): SnapshotFolder[]`; `applyCleanupReport(snapshot, report, categoriesByRuleId: Record<string, string>, nowTs: number): SnapshotData`.

- [ ] **Step 1: Write the failing tests**

`core/test/snapshot-build.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFolderMap, buildSnapshot, applyCleanupReport } from '../src/snapshot/build';
import { AggregateTree } from '../src/model/tree';
import { ScanSession } from '../src/scanner/session';
import type { FolderRecord } from '../src/model/types';
import { Fixture } from './fixtures';

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

describe('buildFolderMap', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  async function scannedTree(): Promise<AggregateTree> {
    fixture.file('a/f1.txt', '0123456789');
    fixture.file('b/f1.txt', '01234');
    fixture.file('c/d/f1.txt', '01234567890123456789');
    fixture.file('e/f1.txt', '0');
    const result = await new ScanSession({ root: fixture.root, pool: false }).start();
    return result.tree;
  }

  it('includes all folders to maxDepth plus top contributors, with child counts', async () => {
    const tree = await scannedTree();
    const folders = buildFolderMap(tree, fixture.root, { maxDepth: 1, topContributors: 1 });
    const byPath = new Map(folders.map((folder) => [folder.path, folder]));

    for (const name of ['a', 'b', 'c', 'e']) {
      expect(byPath.has(join(fixture.root, name))).toBe(true);
    }
    expect(byPath.has(join(fixture.root, 'c', 'd'))).toBe(true);
    expect(byPath.get(fixture.root)).toMatchObject({ childCount: 4, complete: true });
    expect(byPath.get(join(fixture.root, 'c'))!.childCount).toBe(1);
    expect(folders.every((folder) => typeof folder.name === 'string' && folder.name.length > 0)).toBe(true);
  });

  it('cuts the map exactly at maxDepth when no top contributors are allowed', async () => {
    const tree = await scannedTree();
    const folders = buildFolderMap(tree, fixture.root, { maxDepth: 1, topContributors: 0 });
    const byPath = new Map(folders.map((folder) => [folder.path, folder]));
    expect(byPath.has(join(fixture.root, 'c', 'd'))).toBe(false);
    expect(folders).toHaveLength(5);
  });

  it('returns an empty map for an unscanned root', async () => {
    const tree = new AggregateTree();
    expect(buildFolderMap(tree, fixture.root)).toEqual([]);
  });
});

describe('buildSnapshot', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('assembles the full schema from scan artifacts and preserves priorCleanedAt', async () => {
    fixture.file('a/f1.txt', '0123456789');
    const result = await new ScanSession({ root: fixture.root, pool: false }).start();
    const snapshot = buildSnapshot({
      root: fixture.root,
      startedAt: 1000,
      finishedAt: 2000,
      status: 'complete',
      tree: result.tree,
      projects: [],
      categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 10, items: 1 }],
      disks: [{ volume: 'F:\\', totalBytes: 100, freeBytes: 40 }],
      priorCleanedAt: 1500,
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      rulesVersion: '1',
      root: fixture.root,
      status: 'complete',
      cleanedAt: 1500,
    });
    expect(snapshot.folders.some((folder) => folder.path === fixture.root)).toBe(true);
    expect(snapshot.folders.some((folder) => folder.path === join(fixture.root, 'a'))).toBe(true);
  });
});

describe('applyCleanupReport', () => {
  it('stamps cleanedAt, decrements the matching categories and clamps at zero', async () => {
    const fixture = new Fixture();
    try {
      const base = buildSnapshot({
        root: fixture.root,
        startedAt: 1,
        finishedAt: 2,
        status: 'complete',
        tree: new AggregateTree(),
        projects: [],
        categories: [
          { ruleId: 'system-temp', category: 'temp', bytes: 10, items: 1 },
          { ruleId: 'npm-cache', category: 'npm-cache', bytes: 3, items: 1 },
        ],
        disks: [],
      });
      const report = {
        planId: 'plan-1',
        startedAt: 3,
        finishedAt: 4,
        items: [
          {
            ruleId: 'system-temp',
            path: 'F:\\junk',
            action: 'delete-path' as const,
            status: 'done' as const,
            deletedBytes: 10,
            skippedLocked: 0,
            errors: [],
          },
          {
            ruleId: 'npm-cache',
            path: 'F:\\cache',
            action: 'delete-path' as const,
            status: 'done' as const,
            deletedBytes: 99,
            skippedLocked: 0,
            errors: [],
          },
        ],
        deletedBytes: 109,
        skippedLocked: 0,
        itemErrors: 0,
      };
      const updated = applyCleanupReport(base, report, { 'system-temp': 'temp', 'npm-cache': 'npm-cache' }, 7777);
      expect(updated.cleanedAt).toBe(7777);
      expect(updated.categories.find((entry) => entry.ruleId === 'system-temp')!.bytes).toBe(0);
      expect(updated.categories.find((entry) => entry.ruleId === 'npm-cache')!.bytes).toBe(0);
      expect(base.categories.find((entry) => entry.ruleId === 'system-temp')!.bytes).toBe(10);
    } finally {
      fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/snapshot/build`.

- [ ] **Step 3: Implement the builder**

`core/src/snapshot/build.ts`:

```ts
import { basename, isAbsolute, relative, sep } from 'node:path';
import { RULES_VERSION } from '../rules/version';
import { AggregateTree } from '../model/tree';
import type { TreeNode } from '../model/tree';
import type { ProjectRecord } from '../projects/types';
import type { CleanupReport } from '../cleaner/cleaner';
import type {
  ScanStatus,
  SnapshotCategory,
  SnapshotData,
  SnapshotDisk,
  SnapshotFolder,
} from './schema';
import { SNAPSHOT_SCHEMA_VERSION } from './schema';

export interface SnapshotInput {
  root: string;
  startedAt: number;
  finishedAt: number;
  status: ScanStatus;
  tree: AggregateTree;
  projects: ProjectRecord[];
  categories: SnapshotCategory[];
  disks: SnapshotDisk[];
  rulesVersion?: string;
  priorCleanedAt?: number | null;
  maxDepth?: number;
  topContributors?: number;
}

export interface FolderMapOptions {
  maxDepth?: number;
  topContributors?: number;
}

export function buildSnapshot(input: SnapshotInput): SnapshotData {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    rulesVersion: input.rulesVersion ?? RULES_VERSION,
    root: input.root,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    status: input.status,
    cleanedAt: input.priorCleanedAt ?? null,
    disks: input.disks,
    categories: input.categories,
    projects: input.projects,
    folders: buildFolderMap(input.tree, input.root, {
      maxDepth: input.maxDepth,
      topContributors: input.topContributors,
    }),
  };
}

export function applyCleanupReport(
  snapshot: SnapshotData,
  report: CleanupReport,
  categoriesByRuleId: Record<string, string>,
  nowTs: number,
): SnapshotData {
  const freedByRule = new Map<string, number>();
  for (const item of report.items) {
    freedByRule.set(item.ruleId, (freedByRule.get(item.ruleId) ?? 0) + item.deletedBytes);
  }
  void categoriesByRuleId;
  const categories = snapshot.categories.map((entry) => {
    const freed = freedByRule.get(entry.ruleId) ?? 0;
    return { ...entry, bytes: Math.max(entry.bytes - freed, 0) };
  });
  return { ...snapshot, cleanedAt: nowTs, categories };
}

export function buildFolderMap(tree: AggregateTree, root: string, options: FolderMapOptions = {}): SnapshotFolder[] {
  const maxDepth = options.maxDepth ?? 4;
  const topCount = options.topContributors ?? 50;

  const rootNode = tree.get(root);
  if (!rootNode) return [];

  const all = new Map<string, TreeNode>();
  const queue: TreeNode[] = [rootNode];
  let head = 0;
  while (head < queue.length) {
    const node = queue[head]!;
    head += 1;
    if (all.has(node.path)) continue;
    all.set(node.path, node);
    for (const child of tree.children(node.path)) {
      queue.push(child);
    }
  }

  const included = new Set<string>();
  for (const path of all.keys()) {
    if (depthFrom(root, path) <= maxDepth) included.add(path);
  }
  const byBytes = [...all.values()]
    .filter((node) => !included.has(node.path))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, Math.max(topCount, 0));
  for (const node of byBytes) included.add(node.path);

  return [...included].sort().map((path) => {
    const node = all.get(path)!;
    return {
      path,
      name: basename(node.path),
      bytes: node.bytes,
      fileCount: node.fileCount,
      folderCount: node.folderCount,
      newestMtimeMs: node.newestMtimeMs,
      errorCount: node.errorCount,
      partial: node.partial,
      complete: node.complete,
      childCount: tree.children(path).length,
    };
  });
}

function depthFrom(root: string, path: string): number {
  if (path === root) return 0;
  const relativePath = relative(root, path);
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return Number.POSITIVE_INFINITY;
  }
  return relativePath.split(sep).length;
}
```

Note for the implementer: `applyCleanupReport` intentionally keys freed bytes by `ruleId` only (snapshot categories carry one entry per rule). The unused `categoriesByRuleId` parameter documents the mapping the UI already holds; it is read for future multi-rule categories and otherwise ignored. Do not remove it — Plan 9 wires rule metadata through it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/snapshot/build.ts core/test/snapshot-build.test.ts
git commit -m "feat(core): add snapshot builder with folder map and cleanup rollup"
```

---

### Task 3: Atomic store + pins + corruption handling

**Files:**
- Create: `core/src/snapshot/store.ts`
- Test: `core/test/snapshot-store.test.ts`

**Interfaces:**
- Consumes: `parseSnapshot`, `SnapshotCorruptError`, `SnapshotData` from Task 1; a Task-2-built snapshot object for roundtrips.
- Produces: `StorePaths { snapshotPath; userPath }`; `UserPreferences { pins: string[] }`; `SaveResult { ok: boolean; error?: string }`; `SnapshotLoadResult = { kind: 'ok'; snapshot: SnapshotData } | { kind: 'missing' } | { kind: 'corrupt'; reason: string }`; `class SnapshotStore { constructor(paths: StorePaths); load(): SnapshotLoadResult; save(snapshot: SnapshotData): SaveResult; getPins(): string[]; setPins(pins: string[]): SaveResult }`. None of these methods ever throw.

- [ ] **Step 1: Write the failing tests**

`core/test/snapshot-store.test.ts`:

```ts
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotStore } from '../src/snapshot/store';
import { buildSnapshot } from '../src/snapshot/build';
import { AggregateTree } from '../src/model/tree';
import { ScanSession } from '../src/scanner/session';
import type { SnapshotData } from '../src/snapshot/schema';
import { Fixture } from './fixtures';

describe('SnapshotStore', () => {
  let dir: string;
  let store: SnapshotStore;

  beforeEach(() => {
    dir = join(tmpdir(), `dust-store-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    mkdirSync(dir, { recursive: true });
    store = new SnapshotStore({
      snapshotPath: join(dir, 'snapshot.json'),
      userPath: join(dir, 'user.json'),
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function scannedSnapshot(): Promise<SnapshotData> {
    const fixture = new Fixture();
    try {
      fixture.file('a/f1.txt', '0123456789');
      const result = await new ScanSession({ root: fixture.root, pool: false }).start();
      return buildSnapshot({
        root: fixture.root,
        startedAt: 1,
        finishedAt: 2,
        status: 'complete',
        tree: result.tree,
        projects: [],
        categories: [],
        disks: [],
      });
    } finally {
      fixture.cleanup();
    }
  }

  it('reports missing for a fresh store and roundtrips a snapshot', async () => {
    expect(store.load()).toEqual({ kind: 'missing' });

    const snapshot = await scannedSnapshot();
    expect(store.save(snapshot)).toEqual({ ok: true });
    const loaded = store.load();
    expect(loaded).toEqual({ kind: 'ok', snapshot });
  });

  it('reports corrupt for garbage and for wrong shapes without throwing', () => {
    writeFileSync(join(dir, 'snapshot.json'), '{oops');
    expect(store.load()).toEqual({ kind: 'corrupt', reason: 'invalid-json' });

    writeFileSync(join(dir, 'snapshot.json'), JSON.stringify({ schemaVersion: 999 }));
    const versioned = store.load();
    expect(versioned).toEqual({ kind: 'corrupt', reason: 'schema-version' });

    writeFileSync(join(dir, 'snapshot.json'), '5');
    expect(store.load()).toEqual({ kind: 'corrupt', reason: 'not-an-object' });
  });

  it('reports save failure instead of throwing when the path is unusable', () => {
    const blocked = new SnapshotStore({
      snapshotPath: join(dir, 'unwritable'),
      userPath: join(dir, 'user.json'),
    });
    mkdirSync(join(dir, 'unwritable'));
    const result = blocked.save({
      schemaVersion: 1,
      rulesVersion: '1',
      root: 'F:\\x',
      startedAt: 0,
      finishedAt: 0,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [],
      projects: [],
      folders: [],
    });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('stores pins separately so rescans never wipe them', async () => {
    expect(store.getPins()).toEqual([]);
    expect(store.setPins(['C:\\dev\\old'])).toEqual({ ok: true });
    expect(store.getPins()).toEqual(['C:\\dev\\old']);

    const snapshot = await scannedSnapshot();
    expect(store.save(snapshot)).toEqual({ ok: true });
    expect(store.getPins()).toEqual(['C:\\dev\\old']);
  });

  it('returns empty pins for missing or corrupt preference files', () => {
    expect(store.getPins()).toEqual([]);
    writeFileSync(join(dir, 'user.json'), '{oops');
    expect(store.getPins()).toEqual([]);
    writeFileSync(join(dir, 'user.json'), JSON.stringify({ pins: 'not-an-array' }));
    expect(store.getPins()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/snapshot/store`.

- [ ] **Step 3: Implement the store**

`core/src/snapshot/store.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SnapshotCorruptError, parseSnapshot } from './schema';
import type { SnapshotData } from './schema';

export interface StorePaths {
  snapshotPath: string;
  userPath: string;
}

export interface UserPreferences {
  pins: string[];
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export type SnapshotLoadResult =
  | { kind: 'ok'; snapshot: SnapshotData }
  | { kind: 'missing' }
  | { kind: 'corrupt'; reason: string };

export class SnapshotStore {
  constructor(private readonly paths: StorePaths) {}

  load(): SnapshotLoadResult {
    let raw: string;
    try {
      if (!existsSync(this.paths.snapshotPath)) return { kind: 'missing' };
      raw = readFileSync(this.paths.snapshotPath, 'utf8');
    } catch {
      return { kind: 'corrupt', reason: 'read-error' };
    }
    try {
      return { kind: 'ok', snapshot: parseSnapshot(raw) };
    } catch (error) {
      if (error instanceof SnapshotCorruptError) {
        return { kind: 'corrupt', reason: error.reason };
      }
      return { kind: 'corrupt', reason: 'unknown' };
    }
  }

  save(snapshot: SnapshotData): SaveResult {
    try {
      mkdirSync(dirname(this.paths.snapshotPath), { recursive: true });
      const tmp = `${this.paths.snapshotPath}.tmp`;
      writeFileSync(tmp, JSON.stringify(snapshot));
      renameSync(tmp, this.paths.snapshotPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  getPins(): string[] {
    try {
      if (!existsSync(this.paths.userPath)) return [];
      const parsed: unknown = JSON.parse(readFileSync(this.paths.userPath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) return [];
      const pins = (parsed as { pins?: unknown }).pins;
      if (!Array.isArray(pins)) return [];
      return pins.filter((pin): pin is string => typeof pin === 'string');
    } catch {
      return [];
    }
  }

  setPins(pins: string[]): SaveResult {
    try {
      mkdirSync(dirname(this.paths.userPath), { recursive: true });
      const tmp = `${this.paths.userPath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ pins } satisfies UserPreferences));
      renameSync(tmp, this.paths.userPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'unknown error';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. The save-failure test relies on `writeFileSync` + `renameSync` failing when the target path is an existing directory — deterministic on Windows and POSIX.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/snapshot/store.ts core/test/snapshot-store.test.ts
git commit -m "feat(core): add atomic snapshot store and pins with safe loading"
```

---

### Task 4: Disk usage provider with PowerShell fallback

**Files:**
- Create: `core/src/system/volumes.ts`
- Test: `core/test/volumes.test.ts`

**Interfaces:**
- Consumes: `node:fs` (`statfsSync`), `node:child_process` (`execFileSync`).
- Produces: `VolumeUsage { volume: string; label: string | null; totalBytes: number | null; freeBytes: number | null }`; `getVolumeUsage(volumes: string[]): VolumeUsage[]` (statfs first, PowerShell fallback per volume, nulls when both fail); `listFixedVolumes(): string[]` (PowerShell `Get-Volume` filtering `DriveType -eq 'Fixed'`, drive-letter roots like `C:\`; `[]` on non-Windows or any failure).

- [ ] **Step 1: Write the failing tests**

`core/test/volumes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getVolumeUsage, listFixedVolumes } from '../src/system/volumes';

describe('getVolumeUsage', () => {
  it('reports real numbers for the system drive', (ctx) => {
    if (process.platform !== 'win32') {
      ctx.skip();
      return;
    }
    const [usage] = getVolumeUsage(['C:\\']);
    expect(usage).toBeDefined();
    expect(typeof usage!.totalBytes).toBe('number');
    expect(typeof usage!.freeBytes).toBe('number');
    expect(usage!.totalBytes!).toBeGreaterThanOrEqual(usage!.freeBytes!);
  });

  it('returns nulls for a volume that cannot exist', (ctx) => {
    if (process.platform !== 'win32') {
      ctx.skip();
      return;
    }
    const [usage] = getVolumeUsage(['\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\']);
    expect(usage).toEqual({ volume: '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\', label: null, totalBytes: null, freeBytes: null });
  });
});

describe('listFixedVolumes', () => {
  it('lists fixed drive roots in drive-letter form', (ctx) => {
    if (process.platform !== 'win32') {
      ctx.skip();
      return;
    }
    const volumes = listFixedVolumes();
    expect(volumes.length).toBeGreaterThan(0);
    for (const volume of volumes) {
      expect(volume).toMatch(/^[A-Za-z]:\\$/);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/system/volumes`.

- [ ] **Step 3: Implement the provider**

`core/src/system/volumes.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';

export interface VolumeUsage {
  volume: string;
  label: string | null;
  totalBytes: number | null;
  freeBytes: number | null;
}

export function getVolumeUsage(volumes: string[]): VolumeUsage[] {
  return volumes.map((volume) => {
    try {
      const stats = statfsSync(volume);
      return {
        volume,
        label: null,
        totalBytes: stats.blocks * stats.bsize,
        freeBytes: stats.bavail * stats.bsize,
      };
    } catch {
      return powershellVolumeUsage(volume);
    }
  });
}

export function listFixedVolumes(): string[] {
  if (process.platform !== 'win32') return [];
  try {
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Volume | Where-Object { $_.DriveType -eq 'Fixed' -and $_.DriveLetter } | ForEach-Object { "$($_.DriveLetter):\\" }`,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    return raw
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Za-z]:\\$/.test(line));
  } catch {
    return [];
  }
}

function powershellVolumeUsage(volume: string): VolumeUsage {
  const fallback: VolumeUsage = { volume, label: null, totalBytes: null, freeBytes: null };
  if (process.platform !== 'win32') return fallback;
  const letterMatch = /^([A-Za-z]):/.exec(volume);
  if (!letterMatch) return fallback;
  try {
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Volume -DriveLetter ${letterMatch[1]} | Select-Object -First 1 | ConvertTo-Json -Compress`,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    const parsed = JSON.parse(raw) as { FileSystemLabel?: unknown; Size?: unknown; SizeRemaining?: unknown };
    return {
      volume,
      label: typeof parsed.FileSystemLabel === 'string' ? parsed.FileSystemLabel : null,
      totalBytes: numberOrNull(parsed.Size),
      freeBytes: numberOrNull(parsed.SizeRemaining),
    };
  } catch {
    return fallback;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. The missing-volume test pins a GUID volume path that cannot exist — `statfsSync` fails, PowerShell `Get-Volume` finds nothing, so the result is all-nulls.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/system/volumes.ts core/test/volumes.test.ts
git commit -m "feat(core): add disk usage provider with PowerShell fallback"
```

---

### Task 5: End-to-end pipeline + public exports

**Files:**
- Modify: `core/src/index.ts`
- Modify: `core/test/smoke.test.ts`
- Test: `core/test/snapshot-pipeline.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4; `createInventoryRules` + `RuleEnv` (Plan 4); `Cleaner` (Plan 3); `classifyProjects` (Plan 5); `ScanSession` (Plan 1).
- Produces: public exports — `SNAPSHOT_SCHEMA_VERSION`, `RULES_VERSION`, `parseSnapshot`, `SnapshotCorruptError`, `buildSnapshot`, `buildFolderMap`, `applyCleanupReport`, `SnapshotStore`, `getVolumeUsage`, `listFixedVolumes`, and all snapshot/schema/store/volume/project-cleanup types.

- [ ] **Step 1: Write the failing integration test**

`core/test/snapshot-pipeline.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { ScanSession } from '../src/scanner/session';
import { Fixture } from './fixtures';

describe('snapshot pipeline (scan, classify, rule, clean, persist)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('persists accurate state across a scan-clean-rescan cycle', async () => {
    fixture.file('temp/junk.tmp', 'abcdefghij');
    fixture.file('proj/package.json', JSON.stringify({ name: 'proj' }));
    fixture.file('proj/package-lock.json', '{}');
    fixture.file('proj/node_modules/dep/index.js', '0123');

    const env = {
      temp: join(fixture.root, 'temp'),
      localAppData: join(fixture.root, 'local'),
      appData: join(fixture.root, 'roaming'),
      userProfile: join(fixture.root, 'profile'),
      windowsDir: join(fixture.root, 'windows'),
      programData: join(fixture.root, 'program-data'),
    };

    const scan = await new ScanSession({ root: fixture.root, pool: false }).start();
    const analysis = core.classifyProjects({
      root: fixture.root,
      tree: scan.tree,
      markers: scan.markers,
      probe: core.createNodeFsProbe(),
    });

    const rules = core.createInventoryRules(env, {
      recycleBin: {
        enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null }),
      },
    });
    const matches = (await Promise.all(rules.map((rule) => rule.match({
      root: fixture.root,
      tree: scan.tree,
      markers: scan.markers,
      probe: core.createNodeFsProbe(),
    })))).flat();
    const tempMatches = matches.filter((match) => match.path === env.temp);
    const categories = tempMatches.map((match) => ({ ruleId: 'system-temp', category: 'temp', bytes: match.bytes, items: 1 }));

    const disks = core.getVolumeUsage([fixture.root]);
    expect(disks[0]!.totalBytes).not.toBeNull();

    const snapshot = core.buildSnapshot({
      root: fixture.root,
      startedAt: 100,
      finishedAt: 200,
      status: 'complete',
      tree: scan.tree,
      projects: analysis.projects,
      categories,
      disks,
    });
    expect(snapshot.projects.map((project) => project.name)).toContain('proj');
    expect(snapshot.categories).toHaveLength(1);

    const userDir = fixture.dir('user-data');
    const store = new core.SnapshotStore({
      snapshotPath: join(userDir, 'snapshot.json'),
      userPath: join(userDir, 'user.json'),
    });
    expect(store.save(snapshot)).toEqual({ ok: true });
    expect(store.setPins(['C:\\dev\\old'])).toEqual({ ok: true });

    const loaded = store.load();
    expect(loaded).toEqual({ kind: 'ok', snapshot });

    const cleaner = new core.Cleaner({ guard: { userProfile: env.userProfile, userFolders: [] } });
    const plan = await cleaner.preview(rules, {
      root: fixture.root,
      tree: scan.tree,
      markers: scan.markers,
      probe: core.createNodeFsProbe(),
    });
    const report = await cleaner.execute(plan.id, {
      acknowledge: plan.items.filter((item) => item.grade === 'review').map((item) => item.path),
    });
    const updated = core.applyCleanupReport(snapshot, report, { 'system-temp': 'temp' }, 999);
    expect(updated.cleanedAt).toBe(999);
    expect(updated.categories.find((entry) => entry.ruleId === 'system-temp')!.bytes).toBe(0);
    expect(store.getPins()).toEqual(['C:\\dev\\old']);

    const rescan = await new ScanSession({ root: fixture.root, pool: false }).start();
    const rescanned = core.buildSnapshot({
      root: fixture.root,
      startedAt: 300,
      finishedAt: 400,
      status: 'complete',
      tree: rescan.tree,
      projects: [],
      categories: [],
      disks,
      priorCleanedAt: updated.cleanedAt,
    });
    expect(rescanned.cleanedAt).toBe(999);
    expect(loaded).toEqual({ kind: 'ok', snapshot });
  });

  it('exposes the snapshot, volumes and cleanup surface through the public index', () => {
    expect(typeof core.buildSnapshot).toBe('function');
    expect(typeof core.buildFolderMap).toBe('function');
    expect(typeof core.applyCleanupReport).toBe('function');
    expect(typeof core.SnapshotStore).toBe('function');
    expect(typeof core.getVolumeUsage).toBe('function');
    expect(typeof core.listFixedVolumes).toBe('function');
    expect(typeof core.SnapshotCorruptError).toBe('function');
    expect(core.SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(core.RULES_VERSION).toBe('1');
    expect(typeof core.parseSnapshot).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — `core.buildSnapshot` etc. are not exported from `../src/index`.

- [ ] **Step 3: Extend the public surface**

Append to `core/src/index.ts`:

```ts
export { SNAPSHOT_SCHEMA_VERSION, parseSnapshot, SnapshotCorruptError } from './snapshot/schema';
export type {
  ScanStatus,
  SnapshotCategory,
  SnapshotData,
  SnapshotDisk,
  SnapshotFolder,
} from './snapshot/schema';
export { applyCleanupReport, buildFolderMap, buildSnapshot } from './snapshot/build';
export type { FolderMapOptions, SnapshotInput } from './snapshot/build';
export { SnapshotStore } from './snapshot/store';
export type { SaveResult, SnapshotLoadResult, StorePaths, UserPreferences } from './snapshot/store';
export { RULES_VERSION } from './rules/version';
export { getVolumeUsage, listFixedVolumes } from './system/volumes';
export type { VolumeUsage } from './system/volumes';
```

Add a fifth `it(...)` block to `core/test/smoke.test.ts` (keep the existing four):

```ts
  it('exposes the snapshot and volumes surface', () => {
    expect(typeof core.buildSnapshot).toBe('function');
    expect(typeof core.buildFolderMap).toBe('function');
    expect(typeof core.applyCleanupReport).toBe('function');
    expect(typeof core.SnapshotStore).toBe('function');
    expect(typeof core.getVolumeUsage).toBe('function');
    expect(typeof core.listFixedVolumes).toBe('function');
    expect(typeof core.SnapshotCorruptError).toBe('function');
    expect(core.SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(core.RULES_VERSION).toBe('1');
    expect(typeof core.parseSnapshot).toBe('function');
  });
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npm run test -w core`
Expected: PASS — all suites. The pipeline test is the first to drive scan → classify → rule → plan → execute → snapshot → persist in one flow; if byte totals mismatch, recount fixture sizes (a.tmp 10, blob.bin 4 → temp match bytes 10) before touching the rules.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/index.ts core/test/smoke.test.ts core/test/snapshot-pipeline.test.ts
git commit -m "feat(core): export snapshot and volumes surface with end-to-end coverage"
```

---

## Plan Self-Review Notes

- Spec coverage: snapshot schema contents and single-file location (§4.5), version mismatch → loadable-with-banner-data (§4.5), depth-4 map + top contributors and no full-tree persistence (§4.5, SQLite deferred), instant-relaunch + fresh-scan-beyond-depth-4 semantics (§4.5 — the depth cap and age data are in the document), `cleanedAt` + immediate post-cleanup snapshot update (§7.6), Dashboard disk bars and "Last analyzed/cleaned" data (§7.1), per-category strip totals (§7.5), corruption/missing/version rules (§9), pins surviving rescans (§6.4 via the separate user-preferences file).
- Determinism: builders are pure functions of their inputs; `RULES_VERSION`/`SNAPSHOT_SCHEMA_VERSION` are constants; `priorCleanedAt` is an explicit input (no hidden merge); apply is non-mutating; store roundtrips are `toEqual`-exact.
- Type consistency: `SnapshotInput.tree`/`projects`/`categories`/`disks` feed `SnapshotData` verbatim; `CleanupReport` comes straight from Plan 3's cleaner; `SnapshotLoadResult` is a discriminated union the UI switches on exhaustively; `VolumeUsage.totalBytes/freeBytes` nulls flow into `SnapshotDisk` without conversion (both nullable).
- Test determinism: hand-built schema/store cases plus real scans of small fixtures with `pool: false`; the only machine-dependent assertions are `getVolumeUsage(C:\)` numeric sanity and `listFixedVolumes` shape, both skipped off Windows; the `Q:`-style missing volume uses an impossible GUID path; lockfile/plan-file pollution risk: none — fixture trees only.
