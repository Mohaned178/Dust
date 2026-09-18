# Rule Inventory & Display Grades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the MVP rule inventory — system temp, Recycle Bin, npm download cache, and a five-app Cache Registry (Chrome, Edge, Firefox, Discord, Slack) — as self-contained rule files on Plan 3's engine, plus the informational display-grade matcher that powers the Tree Table's Safety column.

**Architecture:** A `core/src/rules/inventory/` directory where each rule is one self-contained file exporting a `Rule` (Plan 3's contract). Shared helpers live in `core/src/rules/paths.ts` (Windows env path resolution, profile wildcards, per-user cache location discovery) so every rule file stays ~10-45 lines and adding a Phase 2 cache is a new file, not an engine change. Display grades are a separate pure matcher (`core/src/display/display-grade.ts`) computed from Tree Table paths and rows — never used by the cleaner.

**Tech Stack:** TypeScript (strict, ESM), Node >= 20 (`node:fs`, `node:path`, `node:os`, `node:child_process` for Recycle Bin enumeration), vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-dust-mvp-design.md` (Sections 5.1–5.3, 5.2 display grades, 6.2 best-effort lockfile evidence out of scope here, 7.5 Safety column, 10)

## Global Constraints

- **Base branch:** `plan-3-rules-cleaner` at `2d2642f` (Plan 3, stacked PR open at the time of writing). If Plan 2/3 have merged to `master` by execution time, branch from `master` instead — whichever tree contains Plans 1-3. Never branch this plan from a tree without the rules/cleaner engine.
- Platform: Windows first; commands run in PowerShell 7. Node >= 20. TypeScript strict. ESM everywhere. `core/` has zero Electron imports and runs under vitest in plain Node.
- Rules are data + pure logic only: a rule's `match(ctx)` returns `RuleMatch[]` and NEVER touches the filesystem for deletion; size accounting comes from `ctx.tree` (the scan) or from `ctx.probe` for existence. The Cleaner owns all deletion.
- Every rule module exports a `Rule` whose `id` matches its filename (`cache-chrome.ts` → id `cache-chrome`); `validateRules` (Plan 3) rejects duplicates.
- Grade discipline (spec §5.2/5.3): temp, npm cache and app caches are `safe` (permanent, junk-by-definition / re-downloadable); the Recycle Bin is `review` (irreversible). Recovery text is mandatory and non-empty for every match.
- Cache rules render only when the cache directory exists (`ctx.probe.exists`); no empty rows for absent apps.
- Display grade is informational only: `safe | review | danger`, default `review` for unknown, `danger` for the system-critical list; it never creates an action and must never be consulted by `Cleaner`/`buildPlan` (verified by import-boundary test).
- Path resolution is fully injectable (`RuleEnv`) so tests never depend on the machine's real Chrome/Slack/Firefox installs or on `%TEMP%`.
- Deletion of cache contents while apps run is expected; locked files are skipped and counted by Plan 3's executor — rules do not check for running processes.
- Commit after every task. Before each commit run: `npm run test -w core` and `npm run typecheck -w core`.

---

## File Structure

- `core/src/rules/paths.ts` — `RuleEnv`, `defaultRuleEnv()`, `expandProfileWildcard`.
- `core/src/rules/inventory/system-temp.ts` — `systemTempRule`.
- `core/src/rules/inventory/recycle-bin.ts` — `recycleBinRule` (PowerShell-backed enumeration + `empty-recycle-bin` action).
- `core/src/rules/inventory/npm-cache.ts` — `npmCacheRule`.
- `core/src/rules/inventory/cache-registry.ts` — `cacheRegistryRules(env): Rule[]` composing the five cache rule files.
- `core/src/rules/inventory/cache-chrome.ts`, `cache-edge.ts`, `cache-firefox.ts`, `cache-discord.ts`, `cache-slack.ts` — one small rule each.
- `core/src/rules/inventory/index.ts` — `createInventoryRules(env: RuleEnv): Rule[]`.
- `core/src/cleaner/executor.ts` — extend `executeItem` to execute the `empty-recycle-bin` action (this plan is where that rule first exists).
- `core/src/display/display-grade.ts` — `DisplayGrade`, `DisplayGradeReason`, `classifyDisplayGrade(path, options?)`.
- `core/src/index.ts` — public exports (Task 7).
- Tests: `rules-paths.test.ts`, `rule-system-temp.test.ts`, `rule-recycle-bin.test.ts`, `rule-npm-cache.test.ts`, `rule-cache-registry.test.ts`, `executor-recycle-bin.test.ts`, `display-grade.test.ts`, `inventory-pipeline.test.ts`; `smoke.test.ts` extended in Task 7.

---

### Task 1: Rule environment + path helpers

**Files:**
- Create: `core/src/rules/paths.ts`
- Test: `core/test/rules-paths.test.ts`

**Interfaces:**
- Consumes: nothing (Node builtins only).
- Produces: `RuleEnv { temp: string; localAppData: string; appData: string; userProfile: string; windowsDir: string; programData: string; }`; `defaultRuleEnv(): RuleEnv`; `expandProfileWildcard(base: string, pattern: string, probe: FsProbe): string[]` (resolves `*` at the profile level only; returns existing matches, sorted).

- [ ] **Step 1: Write the failing tests**

`core/test/rules-paths.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultRuleEnv, expandProfileWildcard } from '../src/rules/paths';
import { createNodeFsProbe } from '../src/rules/probe';
import { Fixture } from './fixtures';

describe('defaultRuleEnv', () => {
  it('reads Windows environment variables with sensible fallbacks', () => {
    const env = defaultRuleEnv();
    expect(env.temp).toBe(process.env.TEMP ?? process.env.TMP ?? '');
    expect(typeof env.localAppData).toBe('string');
    expect(typeof env.appData).toBe('string');
    expect(typeof env.userProfile).toBe('string');
    expect(typeof env.windowsDir).toBe('string');
    expect(typeof env.programData).toBe('string');
  });
});

describe('expandProfileWildcard', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('returns existing wildcard matches sorted, ignoring missing ones', () => {
    fixture.dir('User Data/Default/Cache');
    fixture.dir('User Data/Profile 1/Cache');
    const probe = createNodeFsProbe();

    const matches = expandProfileWildcard(fixture.root, 'User Data/*/Cache', probe);
    expect(matches).toEqual([
      join(fixture.root, 'User Data', 'Default', 'Cache'),
      join(fixture.root, 'User Data', 'Profile 1', 'Cache'),
    ]);
  });

  it('returns an empty array when the wildcard parent does not exist', () => {
    const probe = createNodeFsProbe();
    expect(expandProfileWildcard(fixture.root, 'Missing/*/Cache', probe)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/rules/paths`.

- [ ] **Step 3: Implement the helpers**

`core/src/rules/paths.ts`:

```ts
import { join } from 'node:path';
import type { FsProbe } from './types';

export interface RuleEnv {
  temp: string;
  localAppData: string;
  appData: string;
  userProfile: string;
  windowsDir: string;
  programData: string;
}

export function defaultRuleEnv(): RuleEnv {
  return {
    temp: process.env.TEMP ?? process.env.TMP ?? '',
    localAppData: process.env.LOCALAPPDATA ?? '',
    appData: process.env.APPDATA ?? '',
    userProfile: process.env.USERPROFILE ?? '',
    windowsDir: process.env.SystemRoot ?? process.env.windir ?? '',
    programData: process.env.ProgramData ?? '',
  };
}

export function expandProfileWildcard(base: string, pattern: string, probe: FsProbe): string[] {
  const segments = pattern.split(/[\\/]+/).filter((segment) => segment.length > 0);
  let candidates: string[] = [base];

  for (const segment of segments) {
    if (segment === '*') {
      const next: string[] = [];
      for (const candidate of candidates) {
        for (const entry of listDirectories(candidate, probe)) {
          next.push(join(candidate, entry));
        }
      }
      candidates = next;
    } else {
      candidates = candidates.map((candidate) => join(candidate, segment));
    }
  }

  return candidates.filter((candidate) => probe.exists(candidate)).sort();
}

function listDirectories(dir: string, probe: FsProbe): string[] {
  if (!probe.exists(dir)) return [];
  try {
    return probe
      .listDirectory(dir)
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
```

Note: `FsProbe` currently has only `exists`/`stat`. Extend it (and `createNodeFsProbe`) with `listDirectory(dir: string): Dirent[]` using `readdirSync(dir, { withFileTypes: true })`; update `core/src/rules/types.ts` accordingly. This is additive and no existing consumer breaks.

- [ ] **Step 4: Extend the probe**

In `core/src/rules/types.ts`:

```ts
import type { Dirent, Stats } from 'node:fs';

export interface FsProbe {
  exists(path: string): boolean;
  stat(path: string): Stats | null;
  listDirectory(path: string): Dirent[];
}
```

In `core/src/rules/probe.ts` add to the returned object:

```ts
    listDirectory(path: string) {
      return readdirSync(path, { withFileTypes: true });
    },
```

(and import `readdirSync` from `node:fs`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/rules/paths.ts core/src/rules/types.ts core/src/rules/probe.ts core/test/rules-paths.test.ts
git commit -m "feat(core): add rule environment and path helpers"
```

---

### Task 2: System temp rule

**Files:**
- Create: `core/src/rules/inventory/system-temp.ts`
- Test: `core/test/rule-system-temp.test.ts`

**Interfaces:**
- Consumes: `Rule`, `RuleContext`, `RuleMatch` from `core/src/rules/types.ts`; `RuleEnv` from `core/src/rules/paths.ts`; `AggregateTree` from `core/src/model/tree.ts`.
- Produces: `systemTempRule(env: RuleEnv): Rule` — id `system-temp`, category `temp`, action `delete-path`. Matches: `%TEMP%` (safe) and `%SystemRoot%\Temp` (safe). Bytes come from the scan tree when the path was scanned (else 0). Evidence distinguishes which of the two paths matched.

- [ ] **Step 1: Write the failing tests**

`core/test/rule-system-temp.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { systemTempRule } from '../src/rules/inventory/system-temp';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
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

describe('systemTempRule', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('matches the user temp dir and the windows temp dir with scan sizes', async () => {
    const userTemp = fixture.dir('user-temp');
    const windowsTemp = fixture.dir('win-temp');
    const tree = new AggregateTree();
    tree.addFolder(record(userTemp, { bytes: 1234 }));
    tree.addFolder(record(windowsTemp, { bytes: 5678 }));

    const rule = systemTempRule({ temp: userTemp, windowsDir: fixture.root });
    const ctx: RuleContext = { root: fixture.root, tree, markers: [], probe: createNodeFsProbe() };
    // windowsDir/Temp must exist for the rule to match it:
    fixture.dir('Temp');

    const matches = await rule.match(ctx);
    expect(matches.map((m) => m.path).sort()).toEqual([userTemp, `${fixture.root}\\Temp`].sort());
    const userMatch = matches.find((m) => m.path === userTemp)!;
    expect(userMatch.bytes).toBe(1234);
    expect(userMatch.grade).toBe('safe');
    expect(userMatch.recovery.kind).toBe('junk');
    expect(userMatch.evidence).toContain('TEMP');
  });

  it('skips paths that do not exist', async () => {
    const rule = systemTempRule({ temp: `${fixture.root}\\missing`, windowsDir: `${fixture.root}\\missing-win` });
    const ctx: RuleContext = {
      root: fixture.root,
      tree: new AggregateTree(),
      markers: [],
      probe: createNodeFsProbe(),
    };
    expect(await rule.match(ctx)).toEqual([]);
  });

  it('does not match the same path twice when TEMP and SystemRoot\\Temp coincide', async () => {
    const shared = fixture.dir('shared-temp');
    const tree = new AggregateTree();
    tree.addFolder(record(shared, { bytes: 11 }));
    const rule = systemTempRule({ temp: shared, windowsDir: `${fixture.root}\\missing` });
    const ctx: RuleContext = { root: fixture.root, tree, markers: [], probe: createNodeFsProbe() };
    const matches = await rule.match(ctx);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.bytes).toBe(11);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/rules/inventory/system-temp`.

- [ ] **Step 3: Write minimal implementation**

`core/src/rules/inventory/system-temp.ts`:

```ts
import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';

interface Candidate {
  path: string;
  evidence: string;
}

export function systemTempRule(env: Pick<RuleEnv, 'temp' | 'windowsDir'>): Rule {
  return {
    id: 'system-temp',
    category: 'temp',
    title: 'System temporary files',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      const candidates: Candidate[] = [];
      if (env.temp) candidates.push({ path: env.temp, evidence: 'User TEMP directory' });
      if (env.windowsDir) candidates.push({ path: join(env.windowsDir, 'Temp'), evidence: 'Windows Temp directory' });

      const seen = new Set<string>();
      const matches: RuleMatch[] = [];
      for (const candidate of candidates) {
        const key = candidate.path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!ctx.probe.exists(candidate.path)) continue;
        const node = ctx.tree.get(candidate.path);
        matches.push({
          path: candidate.path,
          bytes: node?.bytes ?? 0,
          grade: 'safe',
          recovery: { kind: 'junk', reason: 'Temporary files are recreated by the apps that need them' },
          evidence: `${candidate.evidence} — junk by definition`,
        });
      }
      return matches;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/rules/inventory/system-temp.ts core/test/rule-system-temp.test.ts
git commit -m "feat(core): add system temp rule"
```

---

### Task 3: npm cache rule

**Files:**
- Create: `core/src/rules/inventory/npm-cache.ts`
- Test: `core/test/rule-npm-cache.test.ts`

**Interfaces:**
- Consumes: `Rule`, `RuleContext`, `RuleMatch`; `RuleEnv`; `AggregateTree`.
- Produces: `npmCacheRule(env: RuleEnv, options?: { npmCacheDir?: string | null }): Rule` — id `npm-cache`, category `npm-cache`, action `delete-path`. Matches `env.localAppData%\npm-cache\_cacache` when it exists; `options.npmCacheDir` (an explicit `npm config get cache` result, caller-resolved) takes precedence when provided and existing. Grade `safe`; recovery `regenerate` is NOT used — the recovery kind is `junk` with the reason "Download cache; npm re-downloads packages on demand", because there is no user-facing command to restore it. Bytes from the scan tree (0 when unscanned).

- [ ] **Step 1: Write the failing tests**

`core/test/rule-npm-cache.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npmCacheRule } from '../src/rules/inventory/npm-cache';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import { Fixture } from './fixtures';

describe('npmCacheRule', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function ctxWith(tree: AggregateTree, probe = createNodeFsProbe()): RuleContext {
    return { root: fixture.root, tree, markers: [], probe };
  }

  it('matches localAppData\\npm-cache\\_cacache with its scan size', async () => {
    const cache = fixture.dir('npm-cache/_cacache');
    const tree = new AggregateTree();
    const rule = npmCacheRule({ localAppData: fixture.root });
    const matches = await rule.match(ctxWith(tree));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ path: cache, grade: 'safe' });
    expect(matches[0]!.recovery.kind).toBe('junk');
    expect(matches[0]!.evidence).toContain('re-download');
  });

  it('honors an explicit npm cache dir when it exists', async () => {
    const custom = fixture.dir('custom-cacache');
    const rule = npmCacheRule({ localAppData: `${fixture.root}\\missing` }, { npmCacheDir: custom });
    const matches = await rule.match(ctxWith(new AggregateTree()));
    expect(matches.map((m) => m.path)).toEqual([custom]);
  });

  it('returns nothing when no cache directory exists', async () => {
    const rule = npmCacheRule({ localAppData: `${fixture.root}\\missing` });
    expect(await rule.match(ctxWith(new AggregateTree()))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/rules/inventory/npm-cache`.

- [ ] **Step 3: Write minimal implementation**

`core/src/rules/inventory/npm-cache.ts`:

```ts
import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';

export function npmCacheRule(
  env: Pick<RuleEnv, 'localAppData'>,
  options: { npmCacheDir?: string | null } = {},
): Rule {
  return {
    id: 'npm-cache',
    category: 'npm-cache',
    title: 'npm download cache',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      const candidates: string[] = [];
      if (options.npmCacheDir) candidates.push(options.npmCacheDir);
      if (env.localAppData) candidates.push(join(env.localAppData, 'npm-cache', '_cacache'));

      const seen = new Set<string>();
      const matches: RuleMatch[] = [];
      for (const candidate of candidates) {
        const key = candidate.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!ctx.probe.exists(candidate)) continue;
        const node = ctx.tree.get(candidate);
        matches.push({
          path: candidate,
          bytes: node?.bytes ?? 0,
          grade: 'safe',
          recovery: { kind: 'junk', reason: 'Download cache; npm re-downloads packages on demand' },
          evidence: 'npm cache (content-addressed downloads, re-downloaded on demand)',
        });
      }
      return matches;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/rules/inventory/npm-cache.ts core/test/rule-npm-cache.test.ts
git commit -m "feat(core): add npm cache rule"
```

---

### Task 4: Cache Registry — five app cache rules

**Files:**
- Create: `core/src/rules/inventory/cache-chrome.ts`
- Create: `core/src/rules/inventory/cache-edge.ts`
- Create: `core/src/rules/inventory/cache-firefox.ts`
- Create: `core/src/rules/inventory/cache-discord.ts`
- Create: `core/src/rules/inventory/cache-slack.ts`
- Create: `core/src/rules/inventory/cache-registry.ts`
- Test: `core/test/rule-cache-registry.test.ts`

**Interfaces:**
- Consumes: `Rule`, `RuleContext`, `RuleMatch`; `RuleEnv`, `expandProfileWildcard`; `AggregateTree`.
- Produces: one factory per app, each `(env: RuleEnv): Rule`: `chromeCacheRule` (id `cache-chrome`), `edgeCacheRule` (`cache-edge`), `firefoxCacheRule` (`cache-firefox`), `discordCacheRule` (`cache-discord`), `slackCacheRule` (`cache-slack`). Plus `cacheRegistryRules(env: RuleEnv): Rule[]` returning them in that order. All: category `app-caches`, action `delete-path`, grade `safe`, recovery `junk` with reason `"[App] cache is re-downloaded on next use"`, evidence naming the app. Each rule resolves its own candidate paths (Chrome/Edge: `<localAppData>\<Vendor>\<Product>\User Data\*\Cache\Cache_Data` plus `*\Code Cache`; Firefox: `<localAppData>\Mozilla\Firefox\Profiles\*\cache2`; Discord: `<appData>\discord\<Cache|Code Cache|GPUCache>` and `<appData>\discordptb\...`/`discordcanary\...`; Slack: `<appData>\Slack\<Cache|Code Cache|GPUCache|Service Worker\CacheStorage>`), matching every existing candidate (multi-profile aware), skipping duplicates.

- [ ] **Step 1: Write the failing tests**

`core/test/rule-cache-registry.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cacheRegistryRules,
  chromeCacheRule,
  edgeCacheRule,
  firefoxCacheRule,
  discordCacheRule,
  slackCacheRule,
} from '../src/rules/inventory/cache-registry';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import type { RuleEnv } from '../src/rules/paths';
import { Fixture } from './fixtures';

describe('cache registry', () => {
  let fixture: Fixture;
  let env: RuleEnv;

  beforeEach(() => {
    fixture = new Fixture();
    env = {
      temp: fixture.dir('temp'),
      localAppData: fixture.dir('local'),
      appData: fixture.dir('roaming'),
      userProfile: fixture.dir('profile'),
      windowsDir: fixture.dir('windows'),
      programData: fixture.dir('program-data'),
    };
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function ctx(): RuleContext {
    return { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
  }

  it('registry returns the five app rules in stable order with correct ids', () => {
    const rules = cacheRegistryRules(env);
    expect(rules.map((rule) => rule.id)).toEqual([
      'cache-chrome',
      'cache-edge',
      'cache-firefox',
      'cache-discord',
      'cache-slack',
    ]);
    expect(rules.every((rule) => rule.category === 'app-caches')).toBe(true);
  });

  it('chrome matches every profile cache and code cache, and nothing when absent', async () => {
    const defaultCache = fixture.dir('local/Google/Chrome/User Data/Default/Cache/Cache_Data');
    const profileTwoCache = fixture.dir('local/Google/Chrome/User Data/Profile 1/Cache/Cache_Data');
    fixture.dir('local/Google/Chrome/User Data/Default/Code Cache');

    const matches = await chromeCacheRule(env).match(ctx());
    expect(matches.map((m) => m.path).sort()).toEqual(
      [
        defaultCache,
        profileTwoCache,
        join(env.localAppData, 'Google/Chrome/User Data/Default/Code Cache'),
      ].sort(),
    );
    expect(matches.every((m) => m.grade === 'safe')).toBe(true);
    expect(matches[0]!.recovery).toEqual({
      kind: 'junk',
      reason: 'Chrome cache is re-downloaded on next use',
    });

    const emptyEnv = { ...env, localAppData: `${fixture.root}\\missing` };
    expect(await chromeCacheRule(emptyEnv).match(ctx())).toEqual([]);
  });

  it('edge, firefox, discord and slack match their real subpaths', async () => {
    fixture.dir('local/Microsoft/Edge/User Data/Default/Cache/Cache_Data');
    fixture.dir('local/Mozilla/Firefox/Profiles/abc.default/cache2');
    fixture.dir('roaming/discord/Cache');
    fixture.dir('roaming/Slack/Cache');

    expect((await edgeCacheRule(env).match(ctx())).length).toBeGreaterThan(0);
    expect((await firefoxCacheRule(env).match(ctx())).length).toBeGreaterThan(0);
    const discord = await discordCacheRule(env).match(ctx());
    expect(discord.map((m) => m.path)).toEqual([join(env.appData, 'discord', 'Cache')]);
    const slack = await slackCacheRule(env).match(ctx());
    expect(slack.map((m) => m.path)).toEqual([join(env.appData, 'Slack', 'Cache')]);
  });

  it('discord matches its PTB and Canary variants too', async () => {
    fixture.dir('roaming/discordptb/GPUCache');
    fixture.dir('roaming/discordcanary/Code Cache');
    const matches = await discordCacheRule(env).match(ctx());
    expect(matches.map((m) => m.path).sort()).toEqual(
      [
        join(env.appData, 'discordptb', 'GPUCache'),
        join(env.appData, 'discordcanary', 'Code Cache'),
      ].sort(),
    );
  });

  it('slack matches Service Worker CacheStorage', async () => {
    fixture.dir('roaming/Slack/Service Worker/CacheStorage');
    const matches = await slackCacheRule(env).match(ctx());
    expect(matches.map((m) => m.path)).toContain(join(env.appData, 'Slack', 'Service Worker', 'CacheStorage'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/rules/inventory/cache-registry`.

- [ ] **Step 3: Write the five rule files and the registry**

`core/src/rules/inventory/cache-chrome.ts`:

```ts
import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';
import { expandProfileWildcard } from '../paths';

export function chromeCacheRule(env: Pick<RuleEnv, 'localAppData'>): Rule {
  return {
    id: 'cache-chrome',
    category: 'app-caches',
    title: 'Chrome cache',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      if (!env.localAppData) return [];
      const userData = join(env.localAppData, 'Google', 'Chrome', 'User Data');
      const candidates = [
        ...expandProfileWildcard(userData, '*/Cache/Cache_Data', ctx.probe),
        ...expandProfileWildcard(userData, '*/Code Cache', ctx.probe),
      ];
      return candidates.map((path) => ({
        path,
        bytes: ctx.tree.get(path)?.bytes ?? 0,
        grade: 'safe' as const,
        recovery: { kind: 'junk' as const, reason: 'Chrome cache is re-downloaded on next use' },
        evidence: 'Chrome profile cache directory',
      }));
    },
  };
}
```

`core/src/rules/inventory/cache-edge.ts` — same shape as Chrome: id `cache-edge`, title `Edge cache`, base `join(env.localAppData, 'Microsoft', 'Edge', 'User Data')`, reason `'Edge cache is re-downloaded on next use'`, evidence `'Edge profile cache directory'`.

`core/src/rules/inventory/cache-firefox.ts`:

```ts
import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';
import { expandProfileWildcard } from '../paths';

export function firefoxCacheRule(env: Pick<RuleEnv, 'localAppData'>): Rule {
  return {
    id: 'cache-firefox',
    category: 'app-caches',
    title: 'Firefox cache',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      if (!env.localAppData) return [];
      const profiles = join(env.localAppData, 'Mozilla', 'Firefox', 'Profiles');
      return expandProfileWildcard(profiles, '*/cache2', ctx.probe).map((path) => ({
        path,
        bytes: ctx.tree.get(path)?.bytes ?? 0,
        grade: 'safe' as const,
        recovery: { kind: 'junk' as const, reason: 'Firefox cache is re-downloaded on next use' },
        evidence: 'Firefox profile cache directory',
      }));
    },
  };
}
```

`core/src/rules/inventory/cache-discord.ts`:

```ts
import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';

const VARIANTS = ['discord', 'discordptb', 'discordcanary'];
const SUBDIRS = ['Cache', 'Code Cache', 'GPUCache'];

export function discordCacheRule(env: Pick<RuleEnv, 'appData'>): Rule {
  return {
    id: 'cache-discord',
    category: 'app-caches',
    title: 'Discord cache',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      if (!env.appData) return [];
      const matches: RuleMatch[] = [];
      for (const variant of VARIANTS) {
        for (const subdir of SUBDIRS) {
          const path = join(env.appData, variant, subdir);
          if (!ctx.probe.exists(path)) continue;
          matches.push({
            path,
            bytes: ctx.tree.get(path)?.bytes ?? 0,
            grade: 'safe',
            recovery: { kind: 'junk', reason: 'Discord cache is re-downloaded on next use' },
            evidence: `Discord (${variant}) cache directory`,
          });
        }
      }
      return matches;
    },
  };
}
```

`core/src/rules/inventory/cache-slack.ts`:

```ts
import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';

const SUBDIRS = [['Cache'], ['Code Cache'], ['GPUCache'], ['Service Worker', 'CacheStorage']];

export function slackCacheRule(env: Pick<RuleEnv, 'appData'>): Rule {
  return {
    id: 'cache-slack',
    category: 'app-caches',
    title: 'Slack cache',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      if (!env.appData) return [];
      const matches: RuleMatch[] = [];
      for (const subdir of SUBDIRS) {
        const path = join(env.appData, 'Slack', ...subdir);
        if (!ctx.probe.exists(path)) continue;
        matches.push({
          path,
          bytes: ctx.tree.get(path)?.bytes ?? 0,
          grade: 'safe',
          recovery: { kind: 'junk', reason: 'Slack cache is re-downloaded on next use' },
          evidence: 'Slack cache directory',
        });
      }
      return matches;
    },
  };
}
```

`core/src/rules/inventory/cache-registry.ts`:

```ts
import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import { chromeCacheRule } from './cache-chrome';
import { edgeCacheRule } from './cache-edge';
import { firefoxCacheRule } from './cache-firefox';
import { discordCacheRule } from './cache-discord';
import { slackCacheRule } from './cache-slack';

export { chromeCacheRule } from './cache-chrome';
export { edgeCacheRule } from './cache-edge';
export { firefoxCacheRule } from './cache-firefox';
export { discordCacheRule } from './cache-discord';
export { slackCacheRule } from './cache-slack';

export function cacheRegistryRules(env: RuleEnv): Rule[] {
  return [
    chromeCacheRule(env),
    edgeCacheRule(env),
    firefoxCacheRule(env),
    discordCacheRule(env),
    slackCacheRule(env),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. If Chrome's multi-profile expansion finds nothing, confirm the fixture tree matches `User Data/*/Cache/Cache_Data` exactly — the wildcard expands one level only.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/rules/inventory core/test/rule-cache-registry.test.ts
git commit -m "feat(core): add app cache registry with five cache rules"
```

---

### Task 5: Recycle Bin rule + `empty-recycle-bin` execution

**Files:**
- Create: `core/src/rules/inventory/recycle-bin.ts`
- Modify: `core/src/cleaner/executor.ts`
- Create: `core/src/rules/inventory/index.ts`
- Test: `core/test/rule-recycle-bin.test.ts`
- Test: `core/test/executor-recycle-bin.test.ts`

**Interfaces:**
- Consumes: `Rule`, `RuleContext`, `RuleMatch`; `PlanItem`, `ItemResult`, `DeleteError`; Plan 3's `executeItem`.
- Produces: `recycleBinRule(options?: { enumerate?: () => RecycleBinInfo | Promise<RecycleBinInfo> }): Rule` — id `recycle-bin`, category `recycle-bin`, action `{ kind: 'empty-recycle-bin' }`, grade `review`, recovery `junk` with reason `'Emptied items are permanently gone'`; `RecycleBinInfo { fileCount: number; bytes: number; oldestMs: number | null; newestMs: number | null; volume: string | null }`. Default enumeration runs PowerShell (`Clear-RecycleBin` is only for emptying; enumeration uses `Get-ChildItem -Force -Recurse` on `$Recycle.Bin` filtered to the current SID, with `-ErrorAction SilentlyContinue`). Evidence summarizes count/size/age. The match `path` is the bin container, `` join(`${volume}\\`, '$Recycle.Bin') `` (e.g. `C:\$Recycle.Bin`) — deliberately NOT the bare volume letter, because `path.parse('C:').root === 'C:'` makes a bare drive letter a guard-denied volume root. `recycleBinRule` returns NO matches when the bin is empty.
- `core/src/cleaner/executor.ts` gains an `empty-recycle-bin` branch: PowerShell `Clear-RecycleBin -Force -Confirm:$false -ErrorAction Stop` via `execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ...])`; non-zero exit → `failed` with code `RECYCLE-BIN-ERROR` (or `RECYCLE-BIN-UNSUPPORTED` when `process.platform !== 'win32'`); success → `done` with `deletedBytes` 0 (unknown; the plan's item bytes is the estimate) and a report note is impossible in `DeleteOutcome` — the item result carries `errors: []` and status `done`, and the Cleaner's report aggregates the plan's byte estimate separately. `executeItem` for this action performs the guard check first (same as delete-path).
- `core/src/rules/inventory/index.ts`: `createInventoryRules(env: RuleEnv, options?: { npmCacheDir?: string | null; recycleBin?: { enumerate?: ... } }): Rule[]` returning `[systemTempRule(env), recycleBinRule(options?.recycleBin), npmCacheRule(env, { npmCacheDir: options?.npmCacheDir }), ...cacheRegistryRules(env)]`.

**Interfaces note for implementers:** `DeleteOutcome` has no field for "estimated bytes"; per the interface above, `empty-recycle-bin` returns `deletedBytes: 0` and `status: 'done'`, and the estimate lives on the `PlanItem.bytes` (the UI uses it for the confirm screen and the report shows the plan estimate minus skips). Do not change Plan 3's `DeleteOutcome` shape.

- [ ] **Step 1: Write the failing tests**

`core/test/rule-recycle-bin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { recycleBinRule } from '../src/rules/inventory/recycle-bin';
import type { RuleContext } from '../src/rules/types';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';

function ctx(): RuleContext {
  return { root: 'F:\\synthetic', tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
}

describe('recycleBinRule', () => {
  it('matches with review grade and an irreversible recovery note when the bin has content', async () => {
    const rule = recycleBinRule({
      enumerate: () => ({ fileCount: 12, bytes: 4096, oldestMs: 1000, newestMs: 2000, volume: 'C:' }),
    });
    const matches = await rule.match(ctx());
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ path: 'C:\\$Recycle.Bin', grade: 'review', bytes: 4096 });
    expect(matches[0]!.recovery).toEqual({ kind: 'junk', reason: 'Emptied items are permanently gone' });
    expect(matches[0]!.evidence).toContain('12');
    expect(rule.action).toEqual({ kind: 'empty-recycle-bin' });
  });

  it('returns no matches when the bin is empty', async () => {
    const rule = recycleBinRule({
      enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: 'C:' }),
    });
    expect(await rule.match(ctx())).toEqual([]);
  });

  it('returns no matches when enumeration is unavailable', async () => {
    const rule = recycleBinRule({
      enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null }),
    });
    expect(await rule.match(ctx())).toEqual([]);
  });
});
```

`core/test/executor-recycle-bin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { executeItem } from '../src/cleaner/executor';
import type { PlanItem } from '../src/cleaner/plan';

function item(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    ruleId: 'recycle-bin',
    category: 'recycle-bin',
    path: 'F:\\synthetic\\recycle',
    bytes: 0,
    grade: 'review',
    recovery: { kind: 'junk', reason: 'Emptied items are permanently gone' },
    evidence: 'fixture',
    action: { kind: 'empty-recycle-bin' },
    ...overrides,
  };
}

describe('executeItem empty-recycle-bin', () => {
  it('reports a defined failure when the platform cannot empty the bin', () => {
    const result = executeItem(item(), {
      guard: { userProfile: 'C:\\Users\\x', userFolders: [] },
      runEmptyRecycleBin: () => ({ ok: false, code: 'RECYCLE-BIN-UNSUPPORTED' }),
    });
    expect(result).toMatchObject({
      action: 'empty-recycle-bin',
      status: 'failed',
      deletedBytes: 0,
    });
    expect(result.errors[0]?.code).toBe('RECYCLE-BIN-UNSUPPORTED');
  });

  it('reports done with zero deleted bytes when the empty call succeeds', () => {
    const result = executeItem(item(), {
      guard: { userProfile: 'C:\\Users\\x', userFolders: [] },
      runEmptyRecycleBin: () => ({ ok: true }),
    });
    expect(result).toMatchObject({ action: 'empty-recycle-bin', status: 'done', deletedBytes: 0 });
    expect(result.errors).toEqual([]);
  });

  it('reports failure with details when the empty call errors', () => {
    const result = executeItem(item(), {
      guard: { userProfile: 'C:\\Users\\x', userFolders: [] },
      runEmptyRecycleBin: () => ({ ok: false, code: 'RECYCLE-BIN-ERROR', detail: 'access denied' }),
    });
    expect(result.status).toBe('failed');
    expect(result.errors[0]?.code).toBe('RECYCLE-BIN-ERROR');
  });

  it('refuses a volume root for the recycle-bin action before running the empty call', () => {
    let called = false;
    const result = executeItem(item({ path: 'C:\\' }), {
      guard: { userProfile: 'C:\\Users\\x', userFolders: [] },
      runEmptyRecycleBin: () => {
        called = true;
        return { ok: true };
      },
    });
    expect(result.status).toBe('failed');
    expect(result.errors[0]?.code).toBe('GUARD-VOLUME-ROOT');
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/rules/inventory/recycle-bin`; `runEmptyRecycleBin` option unknown.

- [ ] **Step 3: Implement the recycle-bin rule and the executor hook**

`core/src/rules/inventory/recycle-bin.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';

export interface RecycleBinInfo {
  fileCount: number;
  bytes: number;
  oldestMs: number | null;
  newestMs: number | null;
  volume: string | null;
}

const ENUMERATE_SCRIPT = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '$items = Get-ChildItem -LiteralPath "$env:SystemDrive\\$Recycle.Bin" -Force -Recurse -File -ErrorAction SilentlyContinue',
  '$bytes = ($items | Measure-Object -Property Length -Sum).Sum',
  '$count = @($items).Count',
  '$oldest = ($items | Sort-Object LastWriteTime | Select-Object -First 1).LastWriteTime',
  '$newest = ($items | Sort-Object LastWriteTime | Select-Object -Last 1).LastWriteTime',
  '$oldestMs = if ($oldest) { [long]([DateTimeOffset]$oldest).ToUnixTimeMilliseconds() } else { 0 }',
  '$newestMs = if ($newest) { [long]([DateTimeOffset]$newest).ToUnixTimeMilliseconds() } else { 0 }',
  'ConvertTo-Json -Compress -InputObject @{ count = $count; bytes = [long]$bytes; oldestMs = $oldestMs; newestMs = $newestMs; volume = $env:SystemDrive }',
].join('\n');

export function defaultRecycleBinEnumeration(): RecycleBinInfo {
  if (process.platform !== 'win32') {
    return { fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null };
  }
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ENUMERATE_SCRIPT], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const parsed = JSON.parse(raw) as { count?: number; bytes?: number; oldestMs?: number; newestMs?: number; volume?: string };
    return {
      fileCount: parsed.count ?? 0,
      bytes: parsed.bytes ?? 0,
      oldestMs: parsed.oldestMs ? parsed.oldestMs : null,
      newestMs: parsed.newestMs ? parsed.newestMs : null,
      volume: parsed.volume ?? null,
    };
  } catch {
    return { fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null };
  }
}

export function recycleBinRule(
  options: { enumerate?: () => RecycleBinInfo | Promise<RecycleBinInfo> } = {},
): Rule {
  const enumerate = options.enumerate ?? defaultRecycleBinEnumeration;
  return {
    id: 'recycle-bin',
    category: 'recycle-bin',
    title: 'Recycle Bin',
    action: { kind: 'empty-recycle-bin' },
    async match(_ctx: RuleContext): Promise<RuleMatch[]> {
      const info = await enumerate();
      if (info.fileCount === 0 || !info.volume) return [];
      const oldest = info.oldestMs ? new Date(info.oldestMs).toISOString().slice(0, 10) : 'unknown';
      const newest = info.newestMs ? new Date(info.newestMs).toISOString().slice(0, 10) : 'unknown';
      return [
        {
          path: join(`${info.volume}\\`, '$Recycle.Bin'),
          bytes: info.bytes,
          grade: 'review',
          recovery: { kind: 'junk', reason: 'Emptied items are permanently gone' },
          evidence: `${info.fileCount} items, ${info.bytes} bytes, dated ${oldest} to ${newest}`,
        },
      ];
    },
  };
}
```

In `core/src/cleaner/executor.ts`:

- Extend the options type of `executeItem` to `{ guard?: GuardOptions; runEmptyRecycleBin?: () => EmptyRecycleBinResult }` where `export interface EmptyRecycleBinResult { ok: boolean; code?: string; detail?: string }`.
- Implement `defaultEmptyRecycleBin(): EmptyRecycleBinResult`:

```ts
export function defaultEmptyRecycleBin(): EmptyRecycleBinResult {
  if (process.platform !== 'win32') return { ok: false, code: 'RECYCLE-BIN-UNSUPPORTED' };
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -Confirm:$false -ErrorAction Stop'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, code: 'RECYCLE-BIN-ERROR', detail: codeOf(error) };
  }
}
```

- In `executeItem`, replace the current early `UNSUPPORTED-ACTION` return for non-`delete-path` with:

```ts
  if (item.action.kind === 'empty-recycle-bin') {
    const guardResult = checkDeletable(item.path, {
      ...(options.guard ?? {}),
      exemptExact: [item.path],
    });
    if (!guardResult.allowed) {
      return {
        ...baseResult(item),
        action: 'empty-recycle-bin',
        status: 'failed',
        deletedBytes: 0,
        skippedLocked: 0,
        errors: [{ path: item.path, code: `GUARD-${(guardResult.reason ?? 'denied').toUpperCase()}` }],
      };
    }
    const run = options.runEmptyRecycleBin ?? defaultEmptyRecycleBin;
    const result = run();
    if (result.ok) {
      return {
        ...baseResult(item),
        action: 'empty-recycle-bin',
        status: 'done',
        deletedBytes: 0,
        skippedLocked: 0,
        errors: [],
      };
    }
    return {
      ...baseResult(item),
      action: 'empty-recycle-bin',
      status: 'failed',
      deletedBytes: 0,
      skippedLocked: 0,
      errors: [{ path: item.path, code: result.code ?? 'RECYCLE-BIN-ERROR' }],
    };
  }
```

Note for the implementer: `path.parse('C:').root === 'C:'` (verified with Node), so a bare drive letter IS a volume root and would be refused by the guard. The rule therefore uses the `$Recycle.Bin` container path (`C:\$Recycle.Bin`), which passes the guard (not protected, not a root) while remaining truthful. The executor test file pins both behaviors: the container path passes, and `C:\` is refused with `GUARD-VOLUME-ROOT` before the empty call runs.

`core/src/rules/inventory/index.ts`:

```ts
import type { Rule } from '../types';
import type { RuleEnv } from '../paths';
import { systemTempRule } from './system-temp';
import { recycleBinRule } from './recycle-bin';
import { npmCacheRule } from './npm-cache';
import { cacheRegistryRules } from './cache-registry';
import type { RecycleBinInfo } from './recycle-bin';

export function createInventoryRules(
  env: RuleEnv,
  options: { npmCacheDir?: string | null; recycleBin?: { enumerate?: () => RecycleBinInfo | Promise<RecycleBinInfo> } } = {},
): Rule[] {
  return [
    systemTempRule(env),
    recycleBinRule(options.recycleBin),
    npmCacheRule(env, { npmCacheDir: options.npmCacheDir }),
    ...cacheRegistryRules(env),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/rules/inventory core/src/cleaner/executor.ts core/test/rule-recycle-bin.test.ts core/test/executor-recycle-bin.test.ts
git commit -m "feat(core): add recycle bin rule and empty-recycle-bin execution"
```

---

### Task 6: Display-grade matcher

**Files:**
- Create: `core/src/display/display-grade.ts`
- Test: `core/test/display-grade.test.ts`

**Interfaces:**
- Consumes: nothing (pure path logic); `GuardOptions` from `core/src/cleaner/guard.ts` for the protected list reuse.
- Produces: `DisplayGrade = 'safe' | 'review' | 'danger'`; `DisplayGradeReason { grade: DisplayGrade; reason: string }`; `classifyDisplayGrade(path: string, options?: { env?: Partial<GuardOptions> }): DisplayGradeReason`. Rules: known-safe path patterns (case-insensitive segment match): `\temp\`, `\cache\`, `cache_data`, `node_modules`, `$recycle.bin`, `.cache` → `safe` with a pattern-specific reason; system-critical (protected paths via `defaultProtectedPaths`, plus volume roots) → `danger` with `'System-critical — read-only'`; everything else → `review` with `'Unrecognized folder — review before deleting'`.

- [ ] **Step 1: Write the failing tests**

`core/test/display-grade.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyDisplayGrade } from '../src/display/display-grade';

const env = {
  systemRoot: 'C:\\Windows',
  programFiles: ['C:\\Program Files'],
  programData: 'C:\\ProgramData',
  userProfile: 'C:\\Users\\x',
  userFolders: ['Documents', 'Desktop'],
};

describe('classifyDisplayGrade', () => {
  it('grades known-safe path patterns as safe with pattern reasons', () => {
    expect(classifyDisplayGrade('C:\\Users\\x\\AppData\\Local\\Temp\\file.tmp', env)).toMatchObject({
      grade: 'safe',
    });
    expect(classifyDisplayGrade('C:\\Users\\x\\AppData\\Local\\SomeApp\\Cache\\data', env)).toMatchObject({
      grade: 'safe',
    });
    expect(classifyDisplayGrade('F:\\projects\\app\\node_modules\\pkg\\index.js', env)).toMatchObject({
      grade: 'safe',
    });
    expect(classifyDisplayGrade('C:\\$Recycle.Bin\\S-1-5-21\\file', env)).toMatchObject({ grade: 'safe' });
  });

  it('grades system-critical paths as danger with the read-only reason', () => {
    expect(classifyDisplayGrade('C:\\Windows\\System32', env)).toMatchObject({
      grade: 'danger',
      reason: 'System-critical — read-only',
    });
    expect(classifyDisplayGrade('C:\\Program Files\\App', env)).toMatchObject({ grade: 'danger' });
    expect(classifyDisplayGrade('C:\\Users\\x\\Documents\\report.docx', env)).toMatchObject({ grade: 'danger' });
    expect(classifyDisplayGrade('D:\\', env)).toMatchObject({ grade: 'danger' });
  });

  it('defaults unknown folders to review', () => {
    expect(classifyDisplayGrade('C:\\Users\\x\\RandomFolder', env)).toMatchObject({
      grade: 'review',
      reason: 'Unrecognized folder — review before deleting',
    });
    expect(classifyDisplayGrade('F:\\Vault', env)).toMatchObject({ grade: 'review' });
  });

  it('prefers safety: a temp-named folder inside Windows is still danger', () => {
    expect(classifyDisplayGrade('C:\\Windows\\Cache', env)).toMatchObject({ grade: 'danger' });
  });

  it('cannot leak into the cleaner (informational only)', () => {
    const cleanerDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'cleaner');
    for (const file of readdirSync(cleanerDir)) {
      const content = readFileSync(resolve(cleanerDir, file), 'utf8');
      expect(content).not.toContain('display/');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/display/display-grade`.

- [ ] **Step 3: Implement the matcher**

`core/src/display/display-grade.ts`:

```ts
import { parse, sep } from 'node:path';
import { canonicalizePath, defaultProtectedPaths } from '../cleaner/guard';
import type { GuardOptions } from '../cleaner/guard';

export type DisplayGrade = 'safe' | 'review' | 'danger';

export interface DisplayGradeReason {
  grade: DisplayGrade;
  reason: string;
}

const SAFE_PATTERNS: Array<{ segments: string[]; reason: string }> = [
  { segments: ['temp'], reason: 'Temporary files — apps recreate them as needed' },
  { segments: ['cache'], reason: 'Cache directory — re-downloaded on demand' },
  { segments: ['cache_data'], reason: 'Cache directory — re-downloaded on demand' },
  { segments: ['cache2'], reason: 'Cache directory — re-downloaded on demand' },
  { segments: ['node_modules'], reason: 'Installed dependencies — restorable with a package manager' },
  { segments: ['.cache'], reason: 'Cache directory — re-downloaded on demand' },
  { segments: ['$recycle.bin'], reason: 'Recycle Bin contents — already deleted by you' },
];

export function classifyDisplayGrade(
  path: string,
  options: { env?: Partial<GuardOptions> } = {},
): DisplayGradeReason {
  const canonical = canonicalizePath(path);
  const lower = canonical.toLowerCase();
  const root = parse(canonical).root.toLowerCase();

  if (lower === root) {
    return { grade: 'danger', reason: 'System-critical — read-only' };
  }

  const protectedPaths = defaultProtectedPaths(options.env ?? {}).map((entry) => entry.toLowerCase());
  const insideProtected = protectedPaths.some(
    (entry) => lower === entry || lower.startsWith(entry + sep.toLowerCase()),
  );
  if (insideProtected) {
    return { grade: 'danger', reason: 'System-critical — read-only' };
  }

  const segments = lower.split(/[\\/]+/).filter((segment) => segment.length > 0);
  for (const pattern of SAFE_PATTERNS) {
    const hit = pattern.segments.every((segment) => segments.includes(segment));
    if (hit) {
      return { grade: 'safe', reason: pattern.reason };
    }
  }

  return { grade: 'review', reason: 'Unrecognized folder — review before deleting' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. The `C:\Windows\Cache` test pins the precedence: protection beats safe patterns.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/display/display-grade.ts core/test/display-grade.test.ts
git commit -m "feat(core): add display grade matcher"
```

---

### Task 7: Inventory pipeline test + public exports

**Files:**
- Modify: `core/src/index.ts`
- Modify: `core/test/smoke.test.ts`
- Test: `core/test/inventory-pipeline.test.ts`

**Interfaces:**
- Consumes: `createInventoryRules`; `Cleaner`; `RuleEnv`; all Task 1-6 surfaces.
- Produces: public exports — `createInventoryRules`, `defaultRuleEnv`, `classifyDisplayGrade`; types `RuleEnv`, `DisplayGrade`, `DisplayGradeReason`, `RecycleBinInfo`, `EmptyRecycleBinResult`; individual rule factories (`systemTempRule`, `recycleBinRule`, `npmCacheRule`, `chromeCacheRule`, `edgeCacheRule`, `firefoxCacheRule`, `discordCacheRule`, `slackCacheRule`, `cacheRegistryRules`, `defaultEmptyRecycleBin`).

- [ ] **Step 1: Write the failing integration test**

`core/test/inventory-pipeline.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { Cleaner } from '../src/cleaner/cleaner';
import { createInventoryRules } from '../src/rules/inventory';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext, RuleEnv } from '../src/index';
import { Fixture } from './fixtures';

describe('inventory pipeline (end to end)', () => {
  let fixture: Fixture;
  let env: RuleEnv;
  let ctx: RuleContext;

  beforeEach(() => {
    fixture = new Fixture();
    env = {
      temp: fixture.dir('temp'),
      localAppData: fixture.dir('local'),
      appData: fixture.dir('roaming'),
      userProfile: fixture.dir('profile'),
      windowsDir: fixture.dir('windows'),
      programData: fixture.dir('program-data'),
    };
    ctx = { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('previews the whole inventory, executes it, and reports per item', async () => {
    fixture.file('temp/a.tmp', 'aaaa');
    fixture.file('temp/nested/b.tmp', 'bbbbbb');
    fixture.file('windows/Temp/c.tmp', 'cc');
    fixture.file('local/npm-cache/_cacache/blob', 'ddddd');
    fixture.file('local/Google/Chrome/User Data/Default/Cache/Cache_Data/x', 'eeeeee');
    fixture.file('roaming/discord/Cache/x', 'ffff');

    const cleaner = new Cleaner({ guard: { userProfile: env.userProfile, userFolders: [] } });
    const rules = createInventoryRules(env, {
      recycleBin: { enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null }) },
    });
    const plan = await cleaner.preview(rules, ctx);

    const ids = plan.items.map((item) => item.ruleId).sort();
    expect(ids).toEqual(['cache-chrome', 'cache-discord', 'npm-cache', 'system-temp', 'system-temp']);
    expect(plan.refused).toEqual([]);

    const report = await cleaner.execute(plan.id);
    expect(report.deletedBytes).toBe(4 + 6 + 2 + 5 + 6 + 4);
    expect(existsSync(join(env.temp, 'a.tmp'))).toBe(false);
    expect(existsSync(join(env.localAppData, 'npm-cache', '_cacache'))).toBe(false);
    expect(report.items.every((item) => item.status === 'done')).toBe(true);
  });

  it('records the recycle bin item as review and refuses to execute without acknowledgement', async () => {
    fixture.file('local/npm-cache/_cacache/blob', 'dd');
    const cleaner = new Cleaner({ guard: { userProfile: env.userProfile, userFolders: [] } });
    const rules = createInventoryRules(env, {
      recycleBin: {
        enumerate: () => ({ fileCount: 3, bytes: 999, oldestMs: 1000, newestMs: 2000, volume: 'C:' }),
      },
    });
    const plan = await cleaner.preview(rules, ctx);
    const recycle = plan.items.find((item) => item.ruleId === 'recycle-bin');
    expect(recycle).toMatchObject({ grade: 'review' });
    await expect(cleaner.execute(plan.id)).rejects.toMatchObject({ code: 'unacknowledged-review' });
  });

  it('emits cache rules only for apps that exist', async () => {
    fixture.file('local/npm-cache/_cacache/blob', 'x');
    const cleaner = new Cleaner({ guard: { userProfile: env.userProfile, userFolders: [] } });
    const rules = createInventoryRules(env, {
      recycleBin: { enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null }) },
    });
    const plan = await cleaner.preview(rules, ctx);
    expect(plan.items.map((item) => item.ruleId).sort()).toEqual(['npm-cache', 'system-temp']);
  });

  it('exposes the inventory and display surfaces through the public index', () => {
    expect(typeof core.createInventoryRules).toBe('function');
    expect(typeof core.defaultRuleEnv).toBe('function');
    expect(typeof core.classifyDisplayGrade).toBe('function');
    expect(typeof core.defaultEmptyRecycleBin).toBe('function');
    expect(typeof core.cacheRegistryRules).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — `core.createInventoryRules` etc. are not exported from `../src/index`.

- [ ] **Step 3: Extend the public surface**

Append to `core/src/index.ts`:

```ts
export { createInventoryRules } from './rules/inventory';
export { systemTempRule } from './rules/inventory/system-temp';
export { recycleBinRule, defaultRecycleBinEnumeration } from './rules/inventory/recycle-bin';
export type { RecycleBinInfo } from './rules/inventory/recycle-bin';
export { npmCacheRule } from './rules/inventory/npm-cache';
export {
  cacheRegistryRules,
  chromeCacheRule,
  edgeCacheRule,
  firefoxCacheRule,
  discordCacheRule,
  slackCacheRule,
} from './rules/inventory/cache-registry';
export { defaultRuleEnv, expandProfileWildcard } from './rules/paths';
export type { RuleEnv } from './rules/paths';
export { classifyDisplayGrade } from './display/display-grade';
export type { DisplayGrade, DisplayGradeReason } from './display/display-grade';
export { defaultEmptyRecycleBin } from './cleaner/executor';
export type { EmptyRecycleBinResult } from './cleaner/executor';
```

Add a third `it(...)` block to `core/test/smoke.test.ts` (keep the existing two):

```ts
  it('exposes the inventory and display surface', () => {
    expect(typeof core.createInventoryRules).toBe('function');
    expect(typeof core.defaultRuleEnv).toBe('function');
    expect(typeof core.classifyDisplayGrade).toBe('function');
    expect(typeof core.recycleBinRule).toBe('function');
    expect(typeof core.cacheRegistryRules).toBe('function');
    expect(typeof core.defaultEmptyRecycleBin).toBe('function');
  });
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npm run test -w core`
Expected: PASS — all suites. Note: this task is the only one that runs the full inventory through the Cleaner on a real fixture tree; if any bytes assertion mismatches, recount the fixture file sizes before touching the rules.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/index.ts core/test/smoke.test.ts core/test/inventory-pipeline.test.ts
git commit -m "feat(core): export inventory and display surface with end-to-end coverage"
```

---

## Plan Self-Review Notes

- Spec coverage: system temp rule (§5.3 `system-temp`), Recycle Bin rule with irreversible yellow treatment and count/bytes/oldest-newest evidence (§5.3, §7.3), npm cache (§5.3), Cache Registry with the five apps and presence-only rendering (§5.3, §2 scope item 6), `empty-recycle-bin` action execution (§5.1), display grades with safe/review/danger and "why" reasons (§5.2, §7.5 Safety column), the "no fourth color / unknown defaults to review" rule (§5.2), protection-beats-pattern precedence (spec §5.2 red list). Deliberately deferred: Quick Clean UI and elevation relaunch (Plan 9/7), npm project rules (Plan 5), snapshot (Plan 6), confirm/acknowledge UI (Plan 9).
- The Recycle Bin `path` is the volume (`C:`) not a filesystem path — the guard treats it as an ordinary path (not a volume root, not protected), which the executor test pins explicitly; emptying is confirmed via the `review` grade + acknowledgement gate rather than a path guard.
- `empty-recycle-bin` reports `deletedBytes: 0` by design (the true size is unknowable after the call); the plan item carries the byte estimate, and the confirm/report UI uses the estimate. `DeleteOutcome` was not modified.
- Type consistency: `RuleEnv` is produced by `defaultRuleEnv` and consumed by every rule factory and `createInventoryRules`; `RecycleBinInfo` flows rule→`createInventoryRules`→tests; `EmptyRecycleBinResult` is the executor's injected hook type; `DisplayGrade`/`DisplayGradeReason` are the UI contract.
- Test determinism: every rule receives paths through an injected `RuleEnv` built from fixtures; only `rules-paths.test.ts` reads real `process.env` (asserting the mapping, not machine values). No test depends on Chrome/Slack/Firefox being installed.
- Known limitation carried forward: display-grade segment matching is heuristic (a folder literally named `temp` inside a project is graded safe) — informational only, and the spec's default-to-review for unknowns keeps the conservative direction for real junk. Plan 8's Tree Table renders the reason verbatim.
