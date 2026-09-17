# Core Scan Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@dust/core` — a pure-TypeScript scan engine that walks a directory tree with one stat per file, aggregates folder totals, streams folder records and progress, detects npm/git markers, and supports cancellation.

**Architecture:** Synchronous fs walk behind an `Enumerator` seam (single-threaded in this plan; the worker pool is Plan 2). The walker emits `FolderRecord`s post-order (children before parents) and an `AggregateTree` stitches them into a navigable folder map. Markers (`package.json`, `node_modules`, `.git`) are emitted during the walk for later project classification. Zero Electron imports; everything runs under vitest in plain Node.

**Tech Stack:** TypeScript (strict, ESM), Node >= 20, vitest, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-17-dust-mvp-design.md` (Sections 4.1–4.5, 6.1, 8)

## Global Constraints

- Platform: Windows first; commands below run in PowerShell 7 from the repo root (`F:\Dust`).
- Node >= 20. TypeScript strict. ESM everywhere (`"type": "module"`).
- `core/` must have zero Electron imports and runs under vitest in plain Node (spec §4.1).
- Exactly one stat per file is the irreducible cost — never add stats for directories or links (spec §4.2). Directory and link entries carry `size: 0, mtimeMs: 0`.
- Symlinks and junctions are detected via Dirent and never followed; they contribute 0 bytes and are not recursed (spec §4.2, §4.4).
- Hard exclusions: `pagefile.sys`, `hiberfil.sys`, `swapfile.sys`, `System Volume Information`, `$Recycle.Bin`, plus all reparse points (spec §4.4). Dust's own install dir arrives later as `exclusions.paths`.
- Folder records are emitted post-order; the root record is added last, by the session (spec §4.1–4.2).
- File-size accounting, except the two named ones: `node_modules` and `.git` subtrees are measured for bytes but their mtimes never feed `newestMtimeMs` (spec §6.3).
- Commit after every task. Before each commit run: `npm run test -w core` and `npm run typecheck -w core`.

---

## File Structure

- `package.json` — workspace root; workspaces list grows to include `app` in Plan 7.
- `tsconfig.base.json` — shared strict TS options.
- `core/package.json`, `core/tsconfig.json`, `core/vitest.config.ts` — package scaffold.
- `core/src/index.ts` — public API surface (finalized in Task 7).
- `core/src/model/types.ts` — `Entry`, `FolderRecord`, `Marker`, `ProgressUpdate`.
- `core/src/model/tree.ts` — `AggregateTree`, `TreeNode`.
- `core/src/scanner/enumerator.ts` — `Enumerator` interface, `ListResult`, `NodeFsEnumerator`.
- `core/src/scanner/exclusions.ts` — `ExclusionConfig`, `createExclusionPredicate`.
- `core/src/scanner/scanner.ts` — `scanTree` walk with markers, progress, cancellation.
- `core/src/scanner/session.ts` — `ScanSession`, `ScanResult`, `SessionOptions`.
- `core/test/fixtures.ts` — fixture-tree builder for tests.
- `core/test/*.test.ts` — one test file per unit plus an integration test.

---

### Task 1: Workspace scaffold + core package

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `core/package.json`
- Create: `core/tsconfig.json`
- Create: `core/vitest.config.ts`
- Create: `core/src/index.ts`
- Test: `core/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (repo currently contains only `docs/` and `.gitignore`).
- Produces: workspace scripts `npm run test -w core`, `npm run typecheck -w core`; export `CORE_PACKAGE` from `core/src/index.ts` (removed in Task 7).

- [ ] **Step 1: Create the workspace and package configs**

`package.json`:

```json
{
  "name": "dust",
  "private": true,
  "type": "module",
  "workspaces": ["core"],
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true
  }
}
```

`core/package.json`:

```json
{
  "name": "@dust/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

`core/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

`core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Write the failing smoke test**

`core/test/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CORE_PACKAGE } from '../src/index';

describe('core package', () => {
  it('is importable', () => {
    expect(CORE_PACKAGE).toBe('@dust/core');
  });
});
```

- [ ] **Step 3: Install and run the test to verify it fails**

Run: `npm install` then `npm run test -w core`
Expected: FAIL — cannot resolve `../src/index`.

- [ ] **Step 4: Create the minimal entry point**

`core/src/index.ts`:

```ts
export const CORE_PACKAGE = '@dust/core';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -w core`
Expected: PASS (1 test).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w core`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json core
git commit -m "chore: scaffold core workspace"
```

---

### Task 2: Model types + AggregateTree

**Files:**
- Create: `core/src/model/types.ts`
- Create: `core/src/model/tree.ts`
- Test: `core/test/tree.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Entry`, `FolderRecord`, `Marker`, `ProgressUpdate` from `core/src/model/types.ts`; `AggregateTree` with `addFolder(record: FolderRecord): TreeNode`, `get(path: string): TreeNode | undefined`, `children(path: string): TreeNode[]`, `roots(): TreeNode[]`, `size(): number` from `core/src/model/tree.ts`.

- [ ] **Step 1: Write the failing tests**

`core/test/tree.test.ts`:

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AggregateTree } from '../src/model/tree';
import type { FolderRecord } from '../src/model/types';

const base = join(tmpdir(), 'dust-tree-fixture');
const parent = join(base, 'a');
const child = join(parent, 'b');

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

describe('AggregateTree', () => {
  it('links a child record to a stub parent added later', () => {
    const tree = new AggregateTree();
    tree.addFolder(record(child, { bytes: 5, fileCount: 1 }));

    const stub = tree.get(parent);
    expect(stub).toBeDefined();
    expect(stub?.complete).toBe(false);
    expect(stub?.children).toEqual([child]);
    expect(tree.get(child)?.complete).toBe(true);
  });

  it('merges the real parent record without losing children', () => {
    const tree = new AggregateTree();
    tree.addFolder(record(child, { bytes: 5, fileCount: 1 }));
    tree.addFolder(record(parent, { bytes: 10, fileCount: 2, folderCount: 1 }));

    const merged = tree.get(parent);
    expect(merged?.complete).toBe(true);
    expect(merged?.bytes).toBe(10);
    expect(merged?.children).toEqual([child]);
    expect(tree.children(parent)).toHaveLength(1);
  });

  it('reports a single root node for the drive-ancestor chain', () => {
    const tree = new AggregateTree();
    tree.addFolder(record(child));
    tree.addFolder(record(parent));
    tree.addFolder(record(base));

    const roots = tree.roots();
    expect(roots).toHaveLength(1);
    expect(roots[0]?.path).not.toBe(base);
  });

  it('updates a node on duplicate add without duplicating children', () => {
    const tree = new AggregateTree();
    tree.addFolder(record(child));
    tree.addFolder(record(base, { folderCount: 2 }));
    tree.addFolder(record(base, { folderCount: 3 }));

    expect(tree.get(base)?.folderCount).toBe(3);
    expect(tree.get(base)?.children).toEqual([parent]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/model/tree`.

- [ ] **Step 3: Implement types and tree**

`core/src/model/types.ts`:

```ts
export type NodeKind = 'file' | 'dir' | 'link';

export interface Entry {
  name: string;
  kind: NodeKind;
  size: number;
  mtimeMs: number;
}

export interface FolderRecord {
  path: string;
  bytes: number;
  fileCount: number;
  folderCount: number;
  linkCount: number;
  newestMtimeMs: number;
  errorCount: number;
  partial: boolean;
}

export interface Marker {
  kind: 'package-json' | 'node-modules' | 'git-dir';
  path: string;
}

export interface ProgressUpdate {
  filesScanned: number;
  bytesSeen: number;
  currentPath: string;
  dirsCompleted: number;
  errors: number;
}
```

`core/src/model/tree.ts`:

```ts
import { dirname } from 'node:path';
import type { FolderRecord } from './types';

export interface TreeNode extends FolderRecord {
  parent: string | null;
  complete: boolean;
  children: string[];
}

export class AggregateTree {
  private readonly nodes = new Map<string, TreeNode>();

  addFolder(record: FolderRecord): TreeNode {
    const node = this.ensure(record.path);
    node.bytes = record.bytes;
    node.fileCount = record.fileCount;
    node.folderCount = record.folderCount;
    node.linkCount = record.linkCount;
    node.newestMtimeMs = record.newestMtimeMs;
    node.errorCount = record.errorCount;
    node.partial = record.partial;
    node.complete = true;
    return node;
  }

  get(path: string): TreeNode | undefined {
    return this.nodes.get(path);
  }

  children(path: string): TreeNode[] {
    const node = this.nodes.get(path);
    if (!node) return [];
    const out: TreeNode[] = [];
    for (const childPath of node.children) {
      const child = this.nodes.get(childPath);
      if (child) out.push(child);
    }
    return out;
  }

  roots(): TreeNode[] {
    const out: TreeNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.parent === null) out.push(node);
    }
    return out;
  }

  size(): number {
    return this.nodes.size;
  }

  private ensure(path: string): TreeNode {
    const existing = this.nodes.get(path);
    if (existing) return existing;

    const parentPath = parentOf(path);
    const node: TreeNode = {
      path,
      bytes: 0,
      fileCount: 0,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: false,
      parent: parentPath,
      complete: false,
      children: [],
    };
    this.nodes.set(path, node);

    if (parentPath !== null) {
      const parentNode = this.ensure(parentPath);
      parentNode.children.push(path);
    }
    return node;
  }
}

function parentOf(path: string): string | null {
  const parent = dirname(path);
  if (parent === path || parent === '.') return null;
  return parent;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w core`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add core/src/model core/test/tree.test.ts
git commit -m "feat(core): add model types and aggregate tree"
```

---

### Task 3: Enumerator + NodeFsEnumerator

**Files:**
- Create: `core/src/scanner/enumerator.ts`
- Test: `core/test/enumerator.test.ts`

**Interfaces:**
- Consumes: `Entry` from `core/src/model/types.ts`.
- Produces: `ListResult { entries: Entry[]; entryErrors: number }`; `Enumerator { list(dir: string): ListResult }`; `class NodeFsEnumerator implements Enumerator`.

- [ ] **Step 1: Write the failing tests**

`core/test/fixtures.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export class Fixture {
  readonly root: string;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'dust-fixture-'));
  }

  dir(rel: string): string {
    const path = join(this.root, rel);
    mkdirSync(path, { recursive: true });
    return path;
  }

  file(rel: string, content = '', mtimeMs?: number): string {
    const path = join(this.root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    if (mtimeMs !== undefined) {
      const seconds = mtimeMs / 1000;
      utimesSync(path, seconds, seconds);
    }
    return path;
  }

  link(rel: string, target: string): string {
    const path = join(this.root, rel);
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
    return path;
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
```

`core/test/enumerator.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { Fixture } from './fixtures';

describe('NodeFsEnumerator', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('lists files with size and mtime, directories with zeros', () => {
    fixture.file('a.txt', 'hello', 1_700_000_000_000);
    fixture.dir('sub');
    const result = new NodeFsEnumerator().list(fixture.root);

    const file = result.entries.find((e) => e.name === 'a.txt');
    expect(file).toMatchObject({ kind: 'file', size: 5, mtimeMs: 1_700_000_000_000 });
    const dir = result.entries.find((e) => e.name === 'sub');
    expect(dir).toMatchObject({ kind: 'dir', size: 0, mtimeMs: 0 });
    expect(result.entryErrors).toBe(0);
  });

  it('reports links as kind link with zero size and does not follow them', (ctx) => {
    fixture.file('real/inner.txt', '12345');
    try {
      fixture.link('linked', join(fixture.root, 'real'));
    } catch {
      ctx.skip();
      return;
    }
    const result = new NodeFsEnumerator().list(fixture.root);

    const link = result.entries.find((e) => e.name === 'linked');
    expect(link).toMatchObject({ kind: 'link', size: 0, mtimeMs: 0 });
  });

  it('throws for a missing directory', () => {
    expect(() => new NodeFsEnumerator().list(join(fixture.root, 'nope'))).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/scanner/enumerator`.

- [ ] **Step 3: Implement the enumerator**

`core/src/scanner/enumerator.ts`:

```ts
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Entry } from '../model/types';

export interface ListResult {
  entries: Entry[];
  entryErrors: number;
}

export interface Enumerator {
  list(dir: string): ListResult;
}

export class NodeFsEnumerator implements Enumerator {
  list(dir: string): ListResult {
    const entries: Entry[] = [];
    let entryErrors = 0;
    const dirents = readdirSync(dir, { withFileTypes: true });

    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        entries.push({ name: dirent.name, kind: 'dir', size: 0, mtimeMs: 0 });
      } else if (dirent.isSymbolicLink()) {
        entries.push({ name: dirent.name, kind: 'link', size: 0, mtimeMs: 0 });
      } else {
        try {
          const stats = lstatSync(join(dir, dirent.name));
          entries.push({ name: dirent.name, kind: 'file', size: stats.size, mtimeMs: stats.mtimeMs });
        } catch {
          entryErrors += 1;
        }
      }
    }

    return { entries, entryErrors };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. The link test skips (counted as skipped, not passed) when the environment cannot create junctions; on Windows enable Developer Mode to run it.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scanner/enumerator.ts core/test/fixtures.ts core/test/enumerator.test.ts
git commit -m "feat(core): add enumerator seam and NodeFs implementation"
```

---

### Task 4: Hard exclusions

**Files:**
- Create: `core/src/scanner/exclusions.ts`
- Test: `core/test/exclusions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ExclusionConfig { names?: string[]; paths?: string[] }`; `createExclusionPredicate(config?: ExclusionConfig): (absPath: string) => boolean`.

- [ ] **Step 1: Write the failing tests**

`core/test/exclusions.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createExclusionPredicate } from '../src/scanner/exclusions';

describe('createExclusionPredicate', () => {
  const base = join('C:', 'scan');

  it('excludes default hard-exclusion names case-insensitively', () => {
    const isExcluded = createExclusionPredicate();
    expect(isExcluded(join(base, '$Recycle.Bin'))).toBe(true);
    expect(isExcluded(join(base, '$RECYCLE.BIN'))).toBe(true);
    expect(isExcluded(join(base, 'PAGEFILE.SYS'))).toBe(true);
    expect(isExcluded(join(base, 'hiberfil.sys'))).toBe(true);
    expect(isExcluded(join(base, 'swapfile.sys'))).toBe(true);
    expect(isExcluded(join(base, 'System Volume Information'))).toBe(true);
  });

  it('does not exclude ordinary files', () => {
    const isExcluded = createExclusionPredicate();
    expect(isExcluded(join(base, 'pagefile.sys.bak'))).toBe(false);
    expect(isExcluded(join(base, 'notes.txt'))).toBe(false);
  });

  it('excludes configured absolute paths and their descendants', () => {
    const own = join(base, 'DustInstall');
    const isExcluded = createExclusionPredicate({ paths: [own] });
    expect(isExcluded(own)).toBe(true);
    expect(isExcluded(join(own, 'app', 'index.js'))).toBe(true);
    expect(isExcluded(join(base, 'DustInstall2'))).toBe(false);
  });

  it('matches configured names case-insensitively', () => {
    const isExcluded = createExclusionPredicate({ names: ['MyJunk'] });
    expect(isExcluded(join(base, 'MYJUNK'))).toBe(true);
    expect(isExcluded(join(base, 'myjunk2'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/scanner/exclusions`.

- [ ] **Step 3: Implement the predicate**

`core/src/scanner/exclusions.ts`:

```ts
import { basename, normalize, sep } from 'node:path';

export interface ExclusionConfig {
  names?: string[];
  paths?: string[];
}

const DEFAULT_EXCLUDED_NAMES = [
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'system volume information',
  '$recycle.bin',
];

export function createExclusionPredicate(config: ExclusionConfig = {}): (absPath: string) => boolean {
  const names = new Set([...DEFAULT_EXCLUDED_NAMES, ...(config.names ?? []).map((n) => n.toLowerCase())]);
  const paths = (config.paths ?? []).map((p) => normalize(p).toLowerCase());

  return (absPath: string): boolean => {
    if (names.has(basename(absPath).toLowerCase())) return true;
    if (paths.length === 0) return false;
    const normalized = normalize(absPath).toLowerCase();
    const childSep = sep.toLowerCase();
    return paths.some((p) => normalized === p || normalized.startsWith(p + childSep));
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. If the configured-names test path fails on POSIX because of drive-letter semantics, keep the assertion platform-neutral by comparing against `basename` behavior — the predicate logic must not change.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scanner/exclusions.ts core/test/exclusions.test.ts
git commit -m "feat(core): add hard-exclusion predicate"
```

---

### Task 5: scanTree walk

**Files:**
- Create: `core/src/scanner/scanner.ts`
- Test: `core/test/scanner.test.ts`

**Interfaces:**
- Consumes: `Entry`, `FolderRecord`, `Marker`, `ProgressUpdate` from `core/src/model/types.ts`; `Enumerator` from `core/src/scanner/enumerator.ts`.
- Produces: `ScanConfig`, `ScanStats { rootRecord: FolderRecord; filesScanned: number; bytesSeen: number; errors: number; aborted: boolean; markers: Marker[] }`, `scanTree(config: ScanConfig): ScanStats`.

- [ ] **Step 1: Write the failing tests**

`core/test/scanner.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import type { Enumerator } from '../src/scanner/enumerator';
import { createExclusionPredicate } from '../src/scanner/exclusions';
import { scanTree } from '../src/scanner/scanner';
import type { FolderRecord, Marker, ProgressUpdate } from '../src/model/types';
import { Fixture } from './fixtures';

function run(root: string, overrides: Partial<Parameters<typeof scanTree>[0]> = {}) {
  return scanTree({
    root,
    enumerator: new NodeFsEnumerator(),
    isExcluded: createExclusionPredicate(),
    ...overrides,
  });
}

describe('scanTree', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('aggregates sizes and counts post-order', () => {
    fixture.file('a.txt', 'aaaaa');
    fixture.file('sub/b.txt', 'bbbbbbb');
    fixture.file('sub/deep/c.txt', 'ccccccccccc');

    const records: FolderRecord[] = [];
    const stats = run(fixture.root, { onFolder: (r) => records.push(r) });

    const order = records.map((r) => r.path);
    expect(order.indexOf(join(fixture.root, 'sub', 'deep'))).toBeLessThan(
      order.indexOf(join(fixture.root, 'sub')),
    );

    const sub = records.find((r) => r.path === join(fixture.root, 'sub'));
    expect(sub).toMatchObject({ bytes: 18, fileCount: 2, folderCount: 1 });
    expect(stats.rootRecord).toMatchObject({ bytes: 23, fileCount: 3, folderCount: 2 });
  });

  it('tracks the newest file mtime excluding node_modules and .git', () => {
    fixture.file('src/main.ts', 'x', 1_700_000_000_000);
    fixture.file('node_modules/pkg/index.js', 'yy', 1_800_000_000_000);
    fixture.file('.git/objects/aa', 'z', 1_900_000_000_000);

    const stats = run(fixture.root);
    expect(stats.rootRecord.newestMtimeMs).toBe(1_700_000_000_000);
    expect(stats.rootRecord.bytes).toBe(1 + 2 + 1);
  });

  it('emits package-json, node-modules and git-dir markers, suppressing nested manifests', () => {
    fixture.file('package.json', '{}');
    fixture.file('src/package.json', '{}');
    fixture.file('node_modules/dep/package.json', '{}');
    fixture.dir('node_modules');
    fixture.dir('.git');

    const markers: Marker[] = [];
    run(fixture.root, { onMarker: (m) => markers.push(m) });

    const manifestPaths = markers.filter((m) => m.kind === 'package-json').map((m) => m.path);
    expect(manifestPaths).toContain(join(fixture.root, 'package.json'));
    expect(manifestPaths).toContain(join(fixture.root, 'src', 'package.json'));
    expect(manifestPaths).not.toContain(join(fixture.root, 'node_modules', 'dep', 'package.json'));

    const kinds = markers.map((m) => m.kind);
    expect(kinds).toContain('node-modules');
    expect(kinds).toContain('git-dir');
  });

  it('skips hard-excluded files and directories entirely', () => {
    fixture.file('keep.txt', 'abc');
    fixture.file('pagefile.sys', 'should-not-count');
    fixture.file('$Recycle.Bin/old.txt', 'should-not-count');

    const records: FolderRecord[] = [];
    const stats = run(fixture.root, { onFolder: (r) => records.push(r) });

    expect(stats.rootRecord.bytes).toBe(3);
    expect(records.every((r) => !r.path.toLowerCase().includes('$recycle.bin'))).toBe(true);
  });

  it('counts per-entry errors from the enumerator', () => {
    const enumerator: Enumerator = {
      list: () => ({
        entries: [{ name: 'ok.txt', kind: 'file', size: 3, mtimeMs: 1000 }],
        entryErrors: 2,
      }),
    };
    const stats = run('F:\\synthetic', { enumerator });
    expect(stats.rootRecord.errorCount).toBe(2);
    expect(stats.errors).toBe(2);
  });

  it('marks a directory partial when listing throws and keeps scanning siblings', () => {
    const enumerator: Enumerator = {
      list: (dir) => {
        if (dir.endsWith('broken')) throw new Error('EACCES');
        return { entries: [{ name: 'broken', kind: 'dir', size: 0, mtimeMs: 0 }], entryErrors: 0 };
      },
    };
    const records: FolderRecord[] = [];
    const stats = run('F:\\synthetic', { enumerator, onFolder: (r) => records.push(r) });

    const broken = records.find((r) => r.path.endsWith('broken'));
    expect(broken?.partial).toBe(true);
    expect(broken?.errorCount).toBe(1);
    expect(stats.rootRecord.errorCount).toBe(1);
    expect(stats.errors).toBe(1);
  });

  it('stops when the signal is already aborted', () => {
    fixture.file('a.txt', 'aaaaa');
    const controller = new AbortController();
    controller.abort();

    const records: FolderRecord[] = [];
    const stats = run(fixture.root, { signal: controller.signal, onFolder: (r) => records.push(r) });

    expect(stats.aborted).toBe(true);
    expect(records).toHaveLength(0);
    expect(stats.rootRecord.partial).toBe(true);
  });

  it('emits progress updates every N entries', () => {
    fixture.file('a.txt', 'aa');
    fixture.file('b.txt', 'bbb');
    const updates: ProgressUpdate[] = [];
    run(fixture.root, { progressEvery: 1, onProgress: (u) => updates.push(u) });

    expect(updates.length).toBe(2);
    expect(updates[1]).toMatchObject({ filesScanned: 2, bytesSeen: 5 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/scanner/scanner`.

- [ ] **Step 3: Implement the walker**

`core/src/scanner/scanner.ts`:

```ts
import { join } from 'node:path';
import type { Entry, FolderRecord, Marker, ProgressUpdate } from '../model/types';
import type { Enumerator } from './enumerator';

export interface ScanConfig {
  root: string;
  enumerator: Enumerator;
  isExcluded: (absPath: string) => boolean;
  signal?: AbortSignal;
  progressEvery?: number;
  onFolder?: (record: FolderRecord) => void;
  onMarker?: (marker: Marker) => void;
  onProgress?: (update: ProgressUpdate) => void;
}

export interface ScanStats {
  rootRecord: FolderRecord;
  filesScanned: number;
  bytesSeen: number;
  errors: number;
  aborted: boolean;
  markers: Marker[];
}

interface ScanState {
  filesScanned: number;
  bytesSeen: number;
  errors: number;
  dirsCompleted: number;
  entriesSeen: number;
  aborted: boolean;
  markers: Marker[];
}

export function scanTree(config: ScanConfig): ScanStats {
  const state: ScanState = {
    filesScanned: 0,
    bytesSeen: 0,
    errors: 0,
    dirsCompleted: 0,
    entriesSeen: 0,
    aborted: false,
    markers: [],
  };
  const rootRecord = scanDir(config.root, true, config, state);
  return {
    rootRecord,
    filesScanned: state.filesScanned,
    bytesSeen: state.bytesSeen,
    errors: state.errors,
    aborted: state.aborted,
    markers: state.markers,
  };
}

function scanDir(dir: string, trackMtime: boolean, config: ScanConfig, state: ScanState): FolderRecord {
  if (config.signal?.aborted) {
    state.aborted = true;
    return emptyRecord(dir, true);
  }

  let entries: Entry[];
  let entryErrors: number;
  try {
    const listing = config.enumerator.list(dir);
    entries = listing.entries;
    entryErrors = listing.entryErrors;
  } catch {
    state.errors += 1;
    state.dirsCompleted += 1;
    return emptyRecord(dir, true, 1);
  }
  state.errors += entryErrors;

  let bytes = 0;
  let fileCount = 0;
  let folderCount = 0;
  let linkCount = 0;
  let newestMtimeMs = 0;
  let errorCount = entryErrors;
  let partial = false;

  for (const entry of entries) {
    if (config.signal?.aborted) {
      state.aborted = true;
      partial = true;
      break;
    }
    state.entriesSeen += 1;
    const abs = join(dir, entry.name);
    emitProgress(config, state, dir);

    if (config.isExcluded(abs)) continue;

    if (entry.kind === 'link') {
      linkCount += 1;
      continue;
    }

    if (entry.kind === 'file') {
      bytes += entry.size;
      fileCount += 1;
      state.filesScanned += 1;
      state.bytesSeen += entry.size;
      if (trackMtime && entry.mtimeMs > newestMtimeMs) newestMtimeMs = entry.mtimeMs;
      if (entry.name.toLowerCase() === 'package.json' && !pathHasNodeModules(dir)) {
        emitMarker(config, state, { kind: 'package-json', path: abs });
      }
      continue;
    }

    if (entry.name.toLowerCase() === 'node_modules') {
      emitMarker(config, state, { kind: 'node-modules', path: abs });
    }
    if (entry.name.toLowerCase() === '.git') {
      emitMarker(config, state, { kind: 'git-dir', path: abs });
    }

    const childTrackMtime =
      trackMtime && entry.name.toLowerCase() !== 'node_modules' && entry.name.toLowerCase() !== '.git';
    const child = scanDir(abs, childTrackMtime, config, state);

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
  return {
    path: dir,
    bytes,
    fileCount,
    folderCount,
    linkCount,
    newestMtimeMs,
    errorCount,
    partial: partial || state.aborted,
  };
}

function emptyRecord(path: string, partial: boolean, errorCount = 0): FolderRecord {
  return {
    path,
    bytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount,
    partial,
  };
}

function emitMarker(config: ScanConfig, state: ScanState, marker: Marker): void {
  state.markers.push(marker);
  config.onMarker?.(marker);
}

function emitProgress(config: ScanConfig, state: ScanState, currentPath: string): void {
  const every = config.progressEvery ?? 500;
  if (state.entriesSeen % every !== 0) return;
  config.onProgress?.({
    filesScanned: state.filesScanned,
    bytesSeen: state.bytesSeen,
    currentPath,
    dirsCompleted: state.dirsCompleted,
    errors: state.errors,
  });
}

function pathHasNodeModules(dir: string): boolean {
  return dir.toLowerCase().split(/[\\/]/).includes('node_modules');
}
```

`state.errors` counts enumerator-level errors only (`entryErrors` from listings plus thrown-listing errors); `FolderRecord.errorCount` is the per-record aggregate (`entryErrors` plus the sum of child records).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS (all scanner tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scanner/scanner.ts core/test/scanner.test.ts
git commit -m "feat(core): add directory walker with markers, progress and cancellation"
```

---

### Task 6: ScanSession public session API

**Files:**
- Create: `core/src/scanner/session.ts`
- Test: `core/test/session.test.ts`

**Interfaces:**
- Consumes: `AggregateTree`; `FolderRecord`, `Marker`, `ProgressUpdate`; `Enumerator`, `NodeFsEnumerator`; `createExclusionPredicate`, `ExclusionConfig`; `scanTree`.
- Produces: `SessionOptions`; `ScanResult { root: string; status: 'complete' | 'cancelled'; tree: AggregateTree; startedAt: number; finishedAt: number; filesScanned: number; bytesSeen: number; errors: number; markers: Marker[] }`; `class ScanSession { constructor(options: SessionOptions); cancel(): void; start(): Promise<ScanResult> }`.

- [ ] **Step 1: Write the failing tests**

`core/test/session.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Enumerator } from '../src/scanner/enumerator';
import { ScanSession } from '../src/scanner/session';
import { Fixture } from './fixtures';

describe('ScanSession', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('returns a complete result with an aggregated tree', async () => {
    fixture.file('a.txt', 'aaaaa');
    fixture.file('node_modules/dep/index.js', 'bb');
    fixture.file('package.json', '{}');

    const result = await new ScanSession({ root: fixture.root }).start();

    expect(result.status).toBe('complete');
    expect(result.tree.get(fixture.root)?.bytes).toBe(7);
    expect(result.tree.get(fixture.root)?.complete).toBe(true);
    expect(result.markers.some((m) => m.kind === 'package-json')).toBe(true);
    expect(result.markers.some((m) => m.kind === 'node-modules')).toBe(true);
    expect(result.finishedAt).toBeGreaterThanOrEqual(result.startedAt);
  });

  it('cancels mid-scan and returns a cancelled result with partial data', async () => {
    let session!: ScanSession;
    let calls = 0;
    const enumerator: Enumerator = {
      list: () => {
        calls += 1;
        if (calls === 2) session.cancel();
        return calls === 1
          ? { entries: [{ name: 'a', kind: 'dir', size: 0, mtimeMs: 0 }], entryErrors: 0 }
          : { entries: [{ name: 'x.txt', kind: 'file', size: 1, mtimeMs: 1000 }], entryErrors: 0 };
      },
    };
    session = new ScanSession({ root: 'F:\\synthetic', enumerator });

    const result = await session.start();

    expect(result.status).toBe('cancelled');
    expect(result.tree.size()).toBeGreaterThan(0);
  });

  it('forwards progress updates', async () => {
    fixture.file('a.txt', 'aa');
    const updates: string[] = [];
    await new ScanSession({
      root: fixture.root,
      progressEvery: 1,
      onProgress: (u) => updates.push(u.currentPath),
    }).start();
    expect(updates.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/scanner/session`.

- [ ] **Step 3: Implement the session**

`core/src/scanner/session.ts`:

```ts
import { AggregateTree } from '../model/tree';
import type { FolderRecord, Marker, ProgressUpdate } from '../model/types';
import { NodeFsEnumerator } from './enumerator';
import type { Enumerator } from './enumerator';
import { createExclusionPredicate } from './exclusions';
import type { ExclusionConfig } from './exclusions';
import { scanTree } from './scanner';

export interface SessionOptions {
  root: string;
  enumerator?: Enumerator;
  exclusions?: ExclusionConfig;
  progressEvery?: number;
  onFolder?: (record: FolderRecord) => void;
  onMarker?: (marker: Marker) => void;
  onProgress?: (update: ProgressUpdate) => void;
}

export interface ScanResult {
  root: string;
  status: 'complete' | 'cancelled';
  tree: AggregateTree;
  startedAt: number;
  finishedAt: number;
  filesScanned: number;
  bytesSeen: number;
  errors: number;
  markers: Marker[];
}

export class ScanSession {
  private readonly controller = new AbortController();

  constructor(private readonly options: SessionOptions) {}

  cancel(): void {
    this.controller.abort();
  }

  async start(): Promise<ScanResult> {
    const startedAt = Date.now();
    const tree = new AggregateTree();
    const isExcluded = createExclusionPredicate(this.options.exclusions);

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
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. If the cancel test reports `complete`, the enumerator mock aborted too late — the session must check the signal between directories; do not weaken the assertion.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/scanner/session.ts core/test/session.test.ts
git commit -m "feat(core): add ScanSession orchestration API"
```

---

### Task 7: Public API surface + integration test

**Files:**
- Modify: `core/src/index.ts`
- Modify: `core/test/smoke.test.ts`
- Test: `core/test/pipeline.test.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 2–6.
- Produces: the finalized public API of `@dust/core`: `AggregateTree`, `TreeNode`, `Entry`, `FolderRecord`, `Marker`, `ProgressUpdate`, `NodeFsEnumerator`, `Enumerator`, `ListResult`, `createExclusionPredicate`, `ExclusionConfig`, `ScanSession`, `ScanResult`, `SessionOptions`, `scanTree`, `ScanConfig`, `ScanStats`.

- [ ] **Step 1: Write the failing integration test**

`core/test/pipeline.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanSession } from '../src/scanner/session';
import { Fixture } from './fixtures';

describe('scan pipeline', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('produces a navigable tree with correct parent sizes after streaming child records', async () => {
    fixture.file('project/package.json', '{}');
    fixture.file('project/src/index.ts', 'xxxx');
    fixture.file('project/node_modules/dep/a.js', 'yyyyyy');
    fixture.file('other/data.txt', 'zz');

    let streamedFolders = 0;
    const result = await new ScanSession({
      root: fixture.root,
      onFolder: () => {
        streamedFolders += 1;
      },
    }).start();

    expect(result.status).toBe('complete');
    expect(streamedFolders).toBe(5);

    const project = result.tree.get(join(fixture.root, 'project'));
    expect(project?.bytes).toBe(2 + 4 + 6);
    expect(result.tree.children(join(fixture.root, 'project')).map((c) => c.path)).toContain(
      join(fixture.root, 'project', 'node_modules'),
    );
    expect(result.tree.get(fixture.root)?.bytes).toBe(14);
  });

  it('keeps junction rows inert: zero bytes, not followed, still linked in the tree', async (ctx) => {
    fixture.file('real/data.bin', '1234567890');
    try {
      fixture.link('alias', join(fixture.root, 'real'));
    } catch {
      ctx.skip();
      return;
    }

    const result = await new ScanSession({ root: fixture.root }).start();
    const alias = result.tree.get(join(fixture.root, 'alias'));

    expect(alias?.bytes).toBe(0);
    expect(result.tree.get(fixture.root)?.bytes).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — `pipeline.test.ts` fails because link folders are not added to the tree (`onFolder` is never called for links) and/or smoke test still expects `CORE_PACKAGE`.

- [ ] **Step 3: Support inert link rows and finalize the public API**

In `core/src/scanner/scanner.ts`, emit an inert record for links so the tree can render them:

```ts
    if (entry.kind === 'link') {
      linkCount += 1;
      config.onFolder?.({
        path: abs,
        bytes: 0,
        fileCount: 0,
        folderCount: 0,
        linkCount: 1,
        newestMtimeMs: 0,
        errorCount: 0,
        partial: false,
      });
      continue;
    }
```

The alias link row now streams through `onFolder` as an inert record; the existing `pipeline.test.ts` expectations stay as written — the link fixture is isolated to the second test.

Replace `core/src/index.ts` with:

```ts
export { AggregateTree } from './model/tree';
export type { TreeNode } from './model/tree';
export type { Entry, FolderRecord, Marker, ProgressUpdate } from './model/types';
export { NodeFsEnumerator } from './scanner/enumerator';
export type { Enumerator, ListResult } from './scanner/enumerator';
export { createExclusionPredicate } from './scanner/exclusions';
export type { ExclusionConfig } from './scanner/exclusions';
export { ScanSession } from './scanner/session';
export type { ScanResult, SessionOptions } from './scanner/session';
export { scanTree } from './scanner/scanner';
export type { ScanConfig, ScanStats } from './scanner/scanner';
```

Replace `core/test/smoke.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import * as core from '../src/index';

describe('core public API', () => {
  it('exposes the scan engine surface', () => {
    expect(typeof core.ScanSession).toBe('function');
    expect(typeof core.scanTree).toBe('function');
    expect(typeof core.AggregateTree).toBe('function');
    expect(typeof core.NodeFsEnumerator).toBe('function');
    expect(typeof core.createExclusionPredicate).toBe('function');
  });
});
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npm run test -w core`
Expected: PASS (all test files).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/index.ts core/src/scanner/scanner.ts core/test/smoke.test.ts core/test/pipeline.test.ts
git commit -m "feat(core): finalize public API with integration coverage"
```

---

## Plan Self-Review Notes

- Spec coverage for this plan's scope: enumerator seam (§4.3), sync one-stat-per-file walk and reparse handling (§4.2), batched streaming hooks and post-order records (§4.2), cancellation (§4.2), per-entry error handling (§9), hard exclusions (§4.4), marker discovery hooks for `package.json`/`node_modules`/`.git` (§6.1), mtime tracking rules for `node_modules`/`.git` (§6.3), aggregate tree consumed later by the Tree Table (§7.5). Worker pool, 200 ms batching, snapshot, rules, cleaner, and UI are explicitly deferred to Plans 2–9.
- Known debt carried to Plan 2: `ScanSession.start()` runs the walk synchronously inside the async wrapper; the worker pool replaces the host without changing this API.
- Platform caveat: junction tests require Windows Developer Mode (or admin); the plan does not paper over a failure.
