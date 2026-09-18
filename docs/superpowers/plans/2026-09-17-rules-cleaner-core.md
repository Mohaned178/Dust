# Rules & Cleaner Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the safety-critical deletion core of `@dust/core`: the `Rule`/`RuleMatch` contracts, rule validation, an injectable filesystem probe, the protected-path guard, a plan builder that turns rule matches into an acknowledged `CleanupPlan`, and a `Cleaner` that executes a plan exactly once behind a plan token — with locked files skipped and reported, never fatal.

**Architecture:** Pure-TypeScript modules under `core/src/rules/` (contracts, validation, node fs probe) and `core/src/cleaner/` (guard, plan builder, recursive executor, `Cleaner` with an in-memory plan-token store). No production rules ship in this plan — tests exercise the engine with fixture rules; Plan 4 adds the rule inventory (temp, recycle bin, npm cache, app caches) and the display-grade matcher on top of this engine. Everything runs in plain Node under vitest.

**Tech Stack:** TypeScript (strict, ESM), Node >= 20 (`node:fs`, `node:crypto`, `node:path`, `node:os`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-dust-mvp-design.md` (Sections 5.1–5.5, 9)

## Global Constraints

- **Base branch:** `plan-2-worker-pool` at `761c0c9` (Plan 2's branch, PR open at the time of writing). If that PR has merged to `master` by execution time, branch from `master` instead — whichever tree contains the worker pool. Never branch this plan from a tree without Plan 2's code.
- Platform: Windows first; commands run in PowerShell 7. Node >= 20. TypeScript strict. ESM everywhere. `core/` has zero Electron imports and runs under vitest in plain Node.
- Safety invariants (spec §5.4, binding): no automatic deletion ever; every deletion plan is explicitly confirmed by the user; danger/protected items never enter a plan; unknown paths never enter a plan (plans are built ONLY from rule matches); every plan item carries a non-empty recovery statement; plan tokens are single-use.
- Protected-path guard (spec §5.5): refuse volume roots, `C:\Windows`, Program Files, ProgramData, profile roots, user-document-class directories, Dust's install path, and any ancestor of those. A path *inside* a protected root is allowed only as a rule match against that exact path (exact-match exemption). Equal-to-protected is always refused, even with an exemption.
- Locked files anywhere: skipped and reported per action as "partially cleaned: N files in use" (spec §5.3); never a batch error.
- Recovery model (spec §5.3): `{ kind: 'regenerate'; command: string }` or `{ kind: 'junk'; reason: string }`; both must be non-empty strings.
- Action kinds (spec §5.1): `delete-path` (implemented here) and `empty-recycle-bin` (implemented with its rule in Plan 4; `executeItem` returns a defined, tested `UNSUPPORTED-ACTION` failure until then).
- Commit after every task. Before each commit run: `npm run test -w core` and `npm run typecheck -w core`.

---

## File Structure

- `core/src/rules/types.ts` — `CategoryId`, `ActionGrade`, `Recovery`, `Action`, `RuleMatch`, `FsProbe`, `RuleContext`, `Rule`.
- `core/src/rules/validate.ts` — `RuleValidationError`, `validateRules(rules)`.
- `core/src/rules/probe.ts` — `createNodeFsProbe(): FsProbe` (real lstat-based probe).
- `core/src/cleaner/guard.ts` — `GuardEnvironment`, `GuardOptions`, `GuardDenial`, `GuardResult`, `defaultProtectedPaths(env)`, `checkDeletable(target, options)`.
- `core/src/cleaner/plan.ts` — `PlanItem`, `RefusedMatch`, `PlanTotals`, `CleanupPlan`, `BuildPlanOptions`, `buildPlan(rules, ctx, options)`.
- `core/src/cleaner/executor.ts` — `DeleteError`, `DeleteOutcome`, `ItemResult`, `deletePathTree(target)`, `executeItem(item, options)`.
- `core/src/cleaner/cleaner.ts` — `PlanTokenError`, `CleanerOptions`, `ExecuteOptions`, `CleanupReport`, `class Cleaner`.
- `core/src/index.ts` — public exports (Task 6).
- `core/test/rule-fixtures.ts` — shared test helpers `makeMatch`, `makeRule` (not shipped logic).
- Tests: `rules-contracts.test.ts`, `guard.test.ts`, `plan.test.ts`, `executor.test.ts`, `cleaner.test.ts`, `cleaner-pipeline.test.ts`; `smoke.test.ts` extended in Task 6.

---

### Task 1: Rule contracts, validation, and the node fs probe

**Files:**
- Create: `core/src/rules/types.ts`
- Create: `core/src/rules/validate.ts`
- Create: `core/src/rules/probe.ts`
- Create: `core/test/rule-fixtures.ts`
- Test: `core/test/rules-contracts.test.ts`

**Interfaces:**
- Consumes: `AggregateTree` from `core/src/model/tree.ts`; `Marker` from `core/src/model/types.ts`; `Stats` from `node:fs`.
- Produces: `CategoryId`, `ActionGrade`, `Recovery`, `Action`, `RuleMatch`, `FsProbe`, `RuleContext`, `Rule` (types.ts); `RuleValidationError`, `validateRules(rules: Rule[]): void` (validate.ts); `createNodeFsProbe(): FsProbe` (probe.ts); test helpers `makeMatch`, `makeRule`.

- [ ] **Step 1: Write the failing tests**

`core/test/rule-fixtures.ts`:

```ts
import type { Rule, RuleMatch } from '../src/rules/types';

export function makeMatch(overrides: Partial<RuleMatch> & { path: string }): RuleMatch {
  return {
    bytes: 0,
    grade: 'safe',
    recovery: { kind: 'junk', reason: 'fixture junk' },
    evidence: 'fixture',
    ...overrides,
  };
}

export function makeRule(overrides: Partial<Rule> & { id: string; matches: RuleMatch[] }): Rule {
  const { matches, ...rest } = overrides;
  return {
    category: 'temp',
    title: `Fixture rule ${overrides.id}`,
    action: { kind: 'delete-path' },
    match: () => matches,
    ...rest,
  };
}
```

`core/test/rules-contracts.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import { RuleValidationError, validateRules } from '../src/rules/validate';
import { Fixture } from './fixtures';
import { makeRule } from './rule-fixtures';

describe('validateRules', () => {
  it('accepts distinct, non-empty rules', () => {
    expect(() =>
      validateRules([makeRule({ id: 'a', matches: [] }), makeRule({ id: 'b', matches: [] })]),
    ).not.toThrow();
  });

  it('rejects duplicate ids', () => {
    expect(() => validateRules([makeRule({ id: 'a', matches: [] }), makeRule({ id: 'a', matches: [] })])).toThrow(
      RuleValidationError,
    );
  });

  it('rejects empty ids and titles', () => {
    expect(() => validateRules([makeRule({ id: '  ', matches: [] })])).toThrow(RuleValidationError);
    expect(() => validateRules([makeRule({ id: 'a', title: '', matches: [] })])).toThrow(RuleValidationError);
  });
});

describe('createNodeFsProbe', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('reports existence and stats for real paths', () => {
    const file = fixture.file('a.txt', 'hello');
    const probe = createNodeFsProbe();
    expect(probe.exists(file)).toBe(true);
    expect(probe.stat(file)?.size).toBe(5);
    expect(probe.exists(join(fixture.root, 'missing.txt'))).toBe(false);
    expect(probe.stat(join(fixture.root, 'missing.txt'))).toBeNull();
  });

  it('does not follow links when statting', (ctx) => {
    fixture.file('real/inner.txt', '12345');
    try {
      fixture.link('linked', join(fixture.root, 'real'));
    } catch {
      ctx.skip();
      return;
    }
    const probe = createNodeFsProbe();
    expect(probe.stat(join(fixture.root, 'linked'))?.isSymbolicLink()).toBe(true);
  });
});

describe('RuleContext shape', () => {
  it('is satisfiable with a tree, markers and a probe', () => {
    const ctx: RuleContext = {
      root: 'F:\\synthetic',
      tree: new AggregateTree(),
      markers: [],
      probe: createNodeFsProbe(),
    };
    expect(ctx.tree.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/rules/probe` / `../src/rules/types` / `../src/rules/validate`.

- [ ] **Step 3: Implement the contracts, validation, and probe**

`core/src/rules/types.ts`:

```ts
import type { Stats } from 'node:fs';
import type { AggregateTree } from '../model/tree';
import type { Marker } from '../model/types';

export type CategoryId = 'temp' | 'recycle-bin' | 'npm-cache' | 'app-caches' | 'npm-projects';

export type ActionGrade = 'safe' | 'review';

export type Recovery =
  | { kind: 'regenerate'; command: string }
  | { kind: 'junk'; reason: string };

export type Action =
  | { kind: 'delete-path' }
  | { kind: 'empty-recycle-bin' };

export interface RuleMatch {
  path: string;
  bytes: number;
  grade: ActionGrade;
  recovery: Recovery;
  evidence: string;
}

export interface FsProbe {
  exists(path: string): boolean;
  stat(path: string): Stats | null;
}

export interface RuleContext {
  root: string;
  tree: AggregateTree;
  markers: Marker[];
  probe: FsProbe;
}

export interface Rule {
  id: string;
  category: CategoryId;
  title: string;
  action: Action;
  match(ctx: RuleContext): RuleMatch[] | Promise<RuleMatch[]>;
}
```

`core/src/rules/validate.ts`:

```ts
import type { Rule } from './types';

export class RuleValidationError extends Error {
  constructor(
    public readonly ruleId: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuleValidationError';
  }
}

export function validateRules(rules: Rule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!rule.id || rule.id.trim() === '') {
      throw new RuleValidationError(String(rule.id), 'rule id must be a non-empty string');
    }
    if (seen.has(rule.id)) {
      throw new RuleValidationError(rule.id, `duplicate rule id: ${rule.id}`);
    }
    seen.add(rule.id);
    if (!rule.title || rule.title.trim() === '') {
      throw new RuleValidationError(rule.id, `rule ${rule.id} must have a non-empty title`);
    }
  }
}
```

`core/src/rules/probe.ts`:

```ts
import { lstatSync } from 'node:fs';
import type { FsProbe } from './types';

export function createNodeFsProbe(): FsProbe {
  return {
    exists(path: string): boolean {
      try {
        lstatSync(path);
        return true;
      } catch {
        return false;
      }
    },
    stat(path: string) {
      try {
        return lstatSync(path);
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS (3 new test blocks; link test may skip only if junction creation is unprivileged).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/rules core/test/rule-fixtures.ts core/test/rules-contracts.test.ts
git commit -m "feat(core): add rule contracts, validation and fs probe"
```

---

### Task 2: Protected-path guard

**Files:**
- Create: `core/src/cleaner/guard.ts`
- Test: `core/test/guard.test.ts`

**Interfaces:**
- Consumes: nothing beyond `node:path`.
- Produces: `GuardEnvironment { systemRoot?, programFiles?, programData?, userProfile?, userFolders?, dustInstallPath? }`, `GuardOptions extends GuardEnvironment { extraProtected?: string[] }`, `GuardDenial = 'volume-root' | 'protected-root' | 'protected-ancestor' | 'inside-protected'`, `GuardResult { allowed: boolean; reason?: GuardDenial }`, `defaultProtectedPaths(env?: GuardOptions): string[]`, `checkDeletable(target: string, options?: GuardOptions & { exemptExact?: string[] }): GuardResult`.

- [ ] **Step 1: Write the failing tests**

`core/test/guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkDeletable, defaultProtectedPaths } from '../src/cleaner/guard';

const env = {
  systemRoot: 'C:\\Windows',
  programFiles: ['C:\\Program Files', 'C:\\Program Files (x86)'],
  programData: 'C:\\ProgramData',
  userProfile: 'C:\\Users\\x',
  userFolders: ['Documents', 'Desktop', 'Downloads'],
  dustInstallPath: 'C:\\Apps\\Dust',
};

describe('checkDeletable', () => {
  it('refuses volume roots', () => {
    expect(checkDeletable('C:\\', env)).toMatchObject({ allowed: false, reason: 'volume-root' });
    expect(checkDeletable('D:\\', env)).toMatchObject({ allowed: false, reason: 'volume-root' });
  });

  it('refuses protected roots and their ancestors', () => {
    expect(checkDeletable('C:\\Windows', env)).toMatchObject({ allowed: false, reason: 'protected-root' });
    expect(checkDeletable('C:\\Program Files', env)).toMatchObject({ allowed: false, reason: 'protected-root' });
    expect(checkDeletable('C:\\Users\\x', env)).toMatchObject({ allowed: false, reason: 'protected-root' });
    expect(checkDeletable('C:\\Users\\x\\Documents', env)).toMatchObject({
      allowed: false,
      reason: 'protected-root',
    });
    expect(checkDeletable('C:\\Users', env)).toMatchObject({ allowed: false, reason: 'protected-ancestor' });
  });

  it('refuses paths inside a protected root unless exempted exactly', () => {
    expect(checkDeletable('C:\\Windows\\Temp', env)).toMatchObject({
      allowed: false,
      reason: 'inside-protected',
    });
    expect(checkDeletable('C:\\Windows\\Temp', { ...env, exemptExact: ['C:\\Windows\\Temp'] })).toEqual({
      allowed: true,
    });
  });

  it('never allows an equal-to-protected path even with an exemption', () => {
    expect(checkDeletable('C:\\Windows', { ...env, exemptExact: ['C:\\Windows'] })).toMatchObject({
      allowed: false,
      reason: 'protected-root',
    });
    expect(checkDeletable('C:\\', { ...env, exemptExact: ['C:\\'] })).toMatchObject({
      allowed: false,
      reason: 'volume-root',
    });
  });

  it('allows ordinary paths outside protected areas, with or without exemption', () => {
    expect(checkDeletable('F:\\Tools\\junk', env)).toEqual({ allowed: true });
    expect(checkDeletable('F:\\Tools\\junk', { ...env, exemptExact: ['F:\\Tools\\junk'] })).toEqual({
      allowed: true,
    });
  });

  it('allows exempted paths inside the user profile (the temp/cache case)', () => {
    const temp = 'C:\\Users\\x\\AppData\\Local\\Temp';
    expect(checkDeletable(temp, env)).toMatchObject({ allowed: false, reason: 'inside-protected' });
    expect(checkDeletable(temp, { ...env, exemptExact: [temp] })).toEqual({ allowed: true });
  });

  it('is case-insensitive', () => {
    expect(checkDeletable('c:\\WINDOWS\\TEMP', { ...env, exemptExact: ['C:\\windows\\temp'] })).toEqual({
      allowed: true,
    });
    expect(checkDeletable('C:\\WINDOWS', env)).toMatchObject({ allowed: false, reason: 'protected-root' });
  });

  it('honors extraProtected and dustInstallPath', () => {
    expect(checkDeletable('F:\\Vault', { ...env, extraProtected: ['F:\\Vault'] })).toMatchObject({
      allowed: false,
      reason: 'protected-root',
    });
    expect(checkDeletable('C:\\Apps\\Dust', env)).toMatchObject({ allowed: false, reason: 'protected-root' });
  });
});

describe('defaultProtectedPaths', () => {
  it('lists the configured environment paths', () => {
    const paths = defaultProtectedPaths(env);
    expect(paths).toContain('C:\\Windows');
    expect(paths).toContain('C:\\Users\\x');
    expect(paths).toContain('C:\\Users\\x\\Documents');
    expect(paths).toContain('C:\\Apps\\Dust');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/cleaner/guard`.

- [ ] **Step 3: Implement the guard**

`core/src/cleaner/guard.ts`:

```ts
import { join, normalize, parse, sep } from 'node:path';

export interface GuardEnvironment {
  systemRoot?: string;
  programFiles?: string[];
  programData?: string;
  userProfile?: string;
  userFolders?: string[];
  dustInstallPath?: string;
}

export interface GuardOptions extends GuardEnvironment {
  extraProtected?: string[];
}

export type GuardDenial = 'volume-root' | 'protected-root' | 'protected-ancestor' | 'inside-protected';

export interface GuardResult {
  allowed: boolean;
  reason?: GuardDenial;
}

const DEFAULT_USER_FOLDERS = ['Documents', 'Desktop', 'Downloads', 'Pictures', 'Music', 'Videos', 'OneDrive'];

export function defaultProtectedPaths(env: GuardOptions = {}): string[] {
  const paths: string[] = [];
  const systemRoot = env.systemRoot ?? process.env.SystemRoot;
  if (systemRoot) paths.push(systemRoot);

  const programFiles =
    env.programFiles ??
    ([process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ) as string[]);
  paths.push(...programFiles);

  const programData = env.programData ?? process.env.ProgramData;
  if (programData) paths.push(programData);

  const profile = env.userProfile ?? process.env.USERPROFILE;
  if (profile) {
    paths.push(profile);
    for (const folder of env.userFolders ?? DEFAULT_USER_FOLDERS) {
      paths.push(join(profile, folder));
    }
  }

  if (env.dustInstallPath) paths.push(env.dustInstallPath);
  paths.push(...(env.extraProtected ?? []));

  return paths.map((path) => normalize(path)).filter((path) => path.length > 0);
}

export function checkDeletable(
  target: string,
  options: GuardOptions & { exemptExact?: string[] } = {},
): GuardResult {
  const candidate = normalize(target);
  const lowerCandidate = candidate.toLowerCase();
  const childSep = sep.toLowerCase();

  if (parse(candidate).root.toLowerCase() === lowerCandidate) {
    return { allowed: false, reason: 'volume-root' };
  }

  const protectedPaths = defaultProtectedPaths(options).map((path) => path.toLowerCase());
  if (protectedPaths.includes(lowerCandidate)) {
    return { allowed: false, reason: 'protected-root' };
  }

  const isAncestor = protectedPaths.some((path) => path.startsWith(lowerCandidate + childSep));
  if (isAncestor) {
    return { allowed: false, reason: 'protected-ancestor' };
  }

  const isInside = protectedPaths.some((path) => lowerCandidate.startsWith(path + childSep));
  if (isInside) {
    const exempt = (options.exemptExact ?? []).map((path) => normalize(path).toLowerCase());
    if (!exempt.includes(lowerCandidate)) {
      return { allowed: false, reason: 'inside-protected' };
    }
  }

  return { allowed: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. If the case-insensitivity test fails on a lowercase drive letter, the normalization is wrong in the guard — fix the guard, not the test.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/cleaner/guard.ts core/test/guard.test.ts
git commit -m "feat(core): add protected-path guard"
```

---

### Task 3: Plan builder

**Files:**
- Create: `core/src/cleaner/plan.ts`
- Test: `core/test/plan.test.ts`

**Interfaces:**
- Consumes: `validateRules` from `core/src/rules/validate.ts`; `Rule`, `RuleMatch`, `RuleContext`, `ActionGrade`, `GuardDenial` from Task 1/2; `checkDeletable`, `GuardOptions` from `core/src/cleaner/guard.ts`.
- Produces: `PlanItem { ruleId; category; path; bytes; grade; recovery; evidence; action }`, `RefusedMatch { ruleId; path; reason: RefusedReason }`, `PlanTotals { bytes; items; bytesByGrade: Record<ActionGrade, number>; itemsByGrade: Record<ActionGrade, number> }`, `CleanupPlan { id; createdAt; items; totals; refused }`, `BuildPlanOptions { guard?; now?; makeId? }`, `buildPlan(rules, ctx, options?): Promise<CleanupPlan>`.

- [ ] **Step 1: Write the failing tests**

`core/test/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/cleaner/plan';
import { RuleValidationError } from '../src/rules/validate';
import type { RuleContext } from '../src/rules/types';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import { makeMatch, makeRule } from './rule-fixtures';

const guard = {
  systemRoot: 'C:\\Windows',
  programFiles: ['C:\\Program Files'],
  programData: 'C:\\ProgramData',
  userProfile: 'C:\\Users\\x',
  userFolders: ['Documents'],
};

const ctx: RuleContext = {
  root: 'F:\\synthetic',
  tree: new AggregateTree(),
  markers: [],
  probe: createNodeFsProbe(),
};

function build(rules: Parameters<typeof buildPlan>[0]) {
  return buildPlan(rules, ctx, { guard, makeId: () => 'plan-1', now: () => 1000 });
}

describe('buildPlan', () => {
  it('accepts rule matches and computes totals', async () => {
    const plan = await build([
      makeRule({
        id: 'temp',
        matches: [
          makeMatch({ path: 'F:\\junk\\a', bytes: 5, grade: 'safe' }),
          makeMatch({ path: 'F:\\junk\\b', bytes: 7, grade: 'review', recovery: { kind: 'regenerate', command: 'npm ci' } }),
        ],
      }),
    ]);

    expect(plan.id).toBe('plan-1');
    expect(plan.createdAt).toBe(1000);
    expect(plan.items.map((item) => item.path)).toEqual(['F:\\junk\\a', 'F:\\junk\\b']);
    expect(plan.totals).toEqual({
      bytes: 12,
      items: 2,
      bytesByGrade: { safe: 5, review: 7 },
      itemsByGrade: { safe: 1, review: 1 },
    });
    expect(plan.refused).toEqual([]);
  });

  it('refuses duplicate and nested paths', async () => {
    const plan = await build([
      makeRule({
        id: 'one',
        matches: [
          makeMatch({ path: 'F:\\junk\\a', bytes: 1 }),
          makeMatch({ path: 'F:\\junk\\a', bytes: 1 }),
          makeMatch({ path: 'F:\\junk\\a\\child', bytes: 1 }),
        ],
      }),
    ]);

    expect(plan.items).toHaveLength(1);
    expect(plan.refused).toEqual([
      { ruleId: 'one', path: 'F:\\junk\\a', reason: 'duplicate' },
      { ruleId: 'one', path: 'F:\\junk\\a\\child', reason: 'nested' },
    ]);
  });

  it('refuses protected paths and records the guard reason', async () => {
    const plan = await build([
      makeRule({
        id: 'bad',
        matches: [
          makeMatch({ path: 'C:\\Windows', bytes: 1 }),
          makeMatch({ path: 'C:\\Users', bytes: 1 }),
        ],
      }),
    ]);

    expect(plan.items).toEqual([]);
    expect(plan.refused).toEqual([
      { ruleId: 'bad', path: 'C:\\Windows', reason: 'protected-root' },
      { ruleId: 'bad', path: 'C:\\Users', reason: 'protected-ancestor' },
    ]);
  });

  it('allows an exact rule match inside a protected root (temp case)', async () => {
    const plan = await build([
      makeRule({ id: 'temp', matches: [makeMatch({ path: 'C:\\Windows\\Temp\\sub', bytes: 3 })] }),
    ]);
    expect(plan.items).toHaveLength(1);
  });

  it('refuses invalid recovery statements', async () => {
    const plan = await build([
      makeRule({
        id: 'bad-recovery',
        matches: [
          makeMatch({ path: 'F:\\junk\\a', recovery: { kind: 'regenerate', command: '   ' } }),
          makeMatch({ path: 'F:\\junk\\b', recovery: { kind: 'junk', reason: '' } }),
        ],
      }),
    ]);

    expect(plan.items).toEqual([]);
    expect(plan.refused.map((r) => r.reason)).toEqual(['invalid-recovery', 'invalid-recovery']);
  });

  it('validates the rule set before matching', async () => {
    await expect(build([makeRule({ id: 'dup', matches: [] }), makeRule({ id: 'dup', matches: [] })])).rejects.toThrow(
      RuleValidationError,
    );
  });

  it('supports async match functions and sorts items parents-first', async () => {
    const plan = await build([
      makeRule({
        id: 'async',
        matches: [],
        match: async () => [
          makeMatch({ path: 'F:\\junk\\a\\deep\\child', bytes: 1 }),
          makeMatch({ path: 'F:\\junk\\a', bytes: 2 }),
        ],
      }),
    ]);

    expect(plan.items.map((item) => item.path)).toEqual(['F:\\junk\\a', 'F:\\junk\\a\\deep\\child']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/cleaner/plan`.

- [ ] **Step 3: Implement the plan builder**

`core/src/cleaner/plan.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { normalize, sep } from 'node:path';
import type { Action, ActionGrade, CategoryId, Recovery, Rule, RuleContext } from '../rules/types';
import { validateRules } from '../rules/validate';
import { checkDeletable } from './guard';
import type { GuardDenial, GuardOptions } from './guard';

export type RefusedReason = GuardDenial | 'duplicate' | 'nested' | 'invalid-recovery';

export interface PlanItem {
  ruleId: string;
  category: CategoryId;
  path: string;
  bytes: number;
  grade: ActionGrade;
  recovery: Recovery;
  evidence: string;
  action: Action;
}

export interface RefusedMatch {
  ruleId: string;
  path: string;
  reason: RefusedReason;
}

export interface PlanTotals {
  bytes: number;
  items: number;
  bytesByGrade: Record<ActionGrade, number>;
  itemsByGrade: Record<ActionGrade, number>;
}

export interface CleanupPlan {
  id: string;
  createdAt: number;
  items: PlanItem[];
  totals: PlanTotals;
  refused: RefusedMatch[];
}

export interface BuildPlanOptions {
  guard?: GuardOptions;
  now?: () => number;
  makeId?: () => string;
}

export async function buildPlan(
  rules: Rule[],
  ctx: RuleContext,
  options: BuildPlanOptions = {},
): Promise<CleanupPlan> {
  validateRules(rules);

  const items: PlanItem[] = [];
  const refused: RefusedMatch[] = [];
  const acceptedPaths: string[] = [];
  const childSep = sep.toLowerCase();

  for (const rule of rules) {
    const matches = await rule.match(ctx);
    for (const match of matches) {
      if (!isValidRecovery(match.recovery)) {
        refused.push({ ruleId: rule.id, path: match.path, reason: 'invalid-recovery' });
        continue;
      }

      const normalized = normalize(match.path);
      const lower = normalized.toLowerCase();

      if (acceptedPaths.includes(lower)) {
        refused.push({ ruleId: rule.id, path: match.path, reason: 'duplicate' });
        continue;
      }
      const overlaps = acceptedPaths.some(
        (accepted) => lower.startsWith(accepted + childSep) || accepted.startsWith(lower + childSep),
      );
      if (overlaps) {
        refused.push({ ruleId: rule.id, path: match.path, reason: 'nested' });
        continue;
      }

      const guardResult = checkDeletable(match.path, {
        ...(options.guard ?? {}),
        exemptExact: [match.path],
      });
      if (!guardResult.allowed) {
        refused.push({ ruleId: rule.id, path: match.path, reason: guardResult.reason ?? 'protected-root' });
        continue;
      }

      acceptedPaths.push(lower);
      items.push({
        ruleId: rule.id,
        category: rule.category,
        path: normalized,
        bytes: match.bytes,
        grade: match.grade,
        recovery: match.recovery,
        evidence: match.evidence,
        action: rule.action,
      });
    }
  }

  items.sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    id: (options.makeId ?? randomUUID)(),
    createdAt: (options.now ?? Date.now)(),
    items,
    totals: buildTotals(items),
    refused,
  };
}

function isValidRecovery(recovery: Recovery): boolean {
  return recovery.kind === 'regenerate' ? recovery.command.trim().length > 0 : recovery.reason.trim().length > 0;
}

function buildTotals(items: PlanItem[]): PlanTotals {
  const totals: PlanTotals = {
    bytes: 0,
    items: items.length,
    bytesByGrade: { safe: 0, review: 0 },
    itemsByGrade: { safe: 0, review: 0 },
  };
  for (const item of items) {
    totals.bytes += item.bytes;
    totals.bytesByGrade[item.grade] += item.bytes;
    totals.itemsByGrade[item.grade] += 1;
  }
  return totals;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/cleaner/plan.ts core/test/plan.test.ts
git commit -m "feat(core): add cleanup plan builder with guard and recovery validation"
```

---

### Task 4: Recursive delete executor

**Files:**
- Create: `core/src/cleaner/executor.ts`
- Test: `core/test/executor.test.ts`

**Interfaces:**
- Consumes: `checkDeletable`, `GuardOptions` from `core/src/cleaner/guard.ts`; `PlanItem` from `core/src/cleaner/plan.ts`.
- Produces: `DeleteError { path; code }`, `DeleteOutcome { status: 'done' | 'partial' | 'failed' | 'already-gone'; deletedBytes; skippedLocked; errors }`, `ItemResult { ruleId; path; action; status; deletedBytes; skippedLocked; errors }`, `deletePathTree(target: string): DeleteOutcome`, `executeItem(item: PlanItem, options?: { guard?: GuardOptions }): ItemResult`.

- [ ] **Step 1: Write the failing tests**

`core/test/executor.test.ts`:

```ts
import { closeSync, existsSync, openSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deletePathTree, executeItem } from '../src/cleaner/executor';
import type { PlanItem } from '../src/cleaner/plan';
import { Fixture } from './fixtures';

describe('deletePathTree', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('deletes a directory tree and reports the freed bytes', () => {
    fixture.file('junk/a.txt', 'aaaaa');
    fixture.file('junk/sub/b.txt', 'bbbbbbb');
    const outcome = deletePathTree(join(fixture.root, 'junk'));

    expect(outcome).toMatchObject({ status: 'done', deletedBytes: 12, skippedLocked: 0, errors: [] });
    expect(existsSync(join(fixture.root, 'junk'))).toBe(false);
  });

  it('deletes a single file', () => {
    const file = fixture.file('single.bin', '123456');
    const outcome = deletePathTree(file);
    expect(outcome).toMatchObject({ status: 'done', deletedBytes: 6 });
    expect(existsSync(file)).toBe(false);
  });

  it('skips locked files, deletes the rest, and reports partial', () => {
    const locked = fixture.file('junk/locked.txt', 'abc');
    fixture.file('junk/free.txt', 'defg');
    const handle = openSync(locked, 'r');
    try {
      const outcome = deletePathTree(join(fixture.root, 'junk'));
      expect(outcome.status).toBe('partial');
      expect(outcome.skippedLocked).toBe(1);
      expect(outcome.deletedBytes).toBe(4);
      expect(existsSync(locked)).toBe(true);
      expect(existsSync(join(fixture.root, 'junk', 'free.txt'))).toBe(false);
    } finally {
      closeSync(handle);
    }
  });

  it('never follows links and reports them as errors', (ctx) => {
    fixture.file('real/data.bin', '1234567890');
    fixture.file('junk/keep.txt', 'xx');
    try {
      fixture.link('junk/alias', join(fixture.root, 'real'));
    } catch {
      ctx.skip();
      return;
    }

    const outcome = deletePathTree(join(fixture.root, 'junk'));
    expect(outcome.errors.some((error) => error.code === 'ELINK')).toBe(true);
    expect(existsSync(join(fixture.root, 'real', 'data.bin'))).toBe(true);
    expect(existsSync(join(fixture.root, 'junk', 'keep.txt'))).toBe(false);
    expect(outcome.status).not.toBe('done');
  });

  it('reports already-gone for missing paths', () => {
    expect(deletePathTree(join(fixture.root, 'missing'))).toMatchObject({
      status: 'already-gone',
      deletedBytes: 0,
    });
  });

  it('refuses relative paths', () => {
    expect(isAbsolute('junk')).toBe(false);
    const outcome = deletePathTree('junk');
    expect(outcome.status).toBe('failed');
    expect(outcome.errors[0]?.code).toBe('RELATIVE-PATH');
  });
});

describe('executeItem', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function item(path: string, overrides: Partial<PlanItem> = {}): PlanItem {
    return {
      ruleId: 'fixture',
      category: 'temp',
      path,
      bytes: 0,
      grade: 'safe',
      recovery: { kind: 'junk', reason: 'fixture' },
      evidence: 'fixture',
      action: { kind: 'delete-path' },
      ...overrides,
    };
  }

  it('executes a delete-path item', () => {
    const dir = fixture.dir('junk');
    fixture.file('junk/a.txt', 'aaa');
    const result = executeItem(item(dir));
    expect(result).toMatchObject({ status: 'done', deletedBytes: 3, action: 'delete-path' });
    expect(existsSync(dir)).toBe(false);
  });

  it('refuses a protected path at execute time even when exempted', () => {
    const result = executeItem(item('C:\\Windows'), {
      guard: { systemRoot: 'C:\\Windows', userProfile: 'C:\\Users\\x', userFolders: [] },
    });
    expect(result.status).toBe('failed');
    expect(result.errors[0]?.code).toBe('GUARD-PROTECTED-ROOT');
  });

  it('returns a defined failure for actions not yet implemented', () => {
    const result = executeItem(item('F:\\anywhere', { action: { kind: 'empty-recycle-bin' } }));
    expect(result.status).toBe('failed');
    expect(result.errors[0]?.code).toBe('UNSUPPORTED-ACTION');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/cleaner/executor`.

- [ ] **Step 3: Implement the executor**

`core/src/cleaner/executor.ts`:

```ts
import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import type { PlanItem } from './plan';
import { checkDeletable } from './guard';
import type { GuardOptions } from './guard';

export interface DeleteError {
  path: string;
  code: string;
}

export interface DeleteOutcome {
  status: 'done' | 'partial' | 'failed' | 'already-gone';
  deletedBytes: number;
  skippedLocked: number;
  errors: DeleteError[];
}

export interface ItemResult extends DeleteOutcome {
  ruleId: string;
  path: string;
  action: PlanItem['action']['kind'];
}

const FILE_LOCKED_CODES = new Set(['EBUSY', 'EPERM']);

export function deletePathTree(target: string): DeleteOutcome {
  const outcome: DeleteOutcome = { status: 'done', deletedBytes: 0, skippedLocked: 0, errors: [] };

  if (!isAbsolute(target)) {
    outcome.errors.push({ path: target, code: 'RELATIVE-PATH' });
    outcome.status = 'failed';
    return outcome;
  }

  let rootStat;
  try {
    rootStat = lstatSync(normalize(target));
  } catch (error) {
    if (codeOf(error) === 'ENOENT') {
      return { status: 'already-gone', deletedBytes: 0, skippedLocked: 0, errors: [] };
    }
    outcome.errors.push({ path: target, code: codeOf(error) });
    outcome.status = 'failed';
    return outcome;
  }

  if (rootStat.isSymbolicLink()) {
    outcome.errors.push({ path: target, code: 'ELINK' });
    outcome.status = 'failed';
    return outcome;
  }

  if (rootStat.isDirectory()) {
    walkDirectory(normalize(target), outcome);
    try {
      rmdirSync(normalize(target));
    } catch (error) {
      const code = codeOf(error);
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
        outcome.errors.push({ path: target, code });
      }
    }
  } else {
    removeFile(normalize(target), rootStat.size, outcome);
  }

  outcome.status = deriveStatus(outcome);
  return outcome;
}

export function executeItem(item: PlanItem, options: { guard?: GuardOptions } = {}): ItemResult {
  if (item.action.kind !== 'delete-path') {
    return {
      ...baseResult(item),
      action: item.action.kind,
      status: 'failed',
      errors: [{ path: item.path, code: 'UNSUPPORTED-ACTION' }],
    };
  }

  const guardResult = checkDeletable(item.path, {
    ...(options.guard ?? {}),
    exemptExact: [item.path],
  });
  if (!guardResult.allowed) {
    return {
      ...baseResult(item),
      action: 'delete-path',
      status: 'failed',
      errors: [{ path: item.path, code: `GUARD-${(guardResult.reason ?? 'denied').toUpperCase()}` }],
    };
  }

  const outcome = deletePathTree(item.path);
  return { ...outcome, ...baseResult(item), action: 'delete-path' };
}

function baseResult(item: PlanItem): Pick<ItemResult, 'ruleId' | 'path'> {
  return { ruleId: item.ruleId, path: item.path };
}

function walkDirectory(dir: string, outcome: DeleteOutcome): void {
  let dirents;
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    outcome.errors.push({ path: dir, code: codeOf(error) });
    return;
  }

  for (const dirent of dirents) {
    const abs = join(dir, dirent.name);

    if (dirent.isSymbolicLink()) {
      outcome.errors.push({ path: abs, code: 'ELINK' });
      continue;
    }

    if (dirent.isDirectory()) {
      walkDirectory(abs, outcome);
      try {
        rmdirSync(abs);
      } catch (error) {
        const code = codeOf(error);
        if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
          outcome.errors.push({ path: abs, code });
        }
      }
      continue;
    }

    let size = 0;
    try {
      size = lstatSync(abs).size;
    } catch (error) {
      outcome.errors.push({ path: abs, code: codeOf(error) });
      continue;
    }
    removeFile(abs, size, outcome);
  }
}

function removeFile(abs: string, size: number, outcome: DeleteOutcome): void {
  try {
    unlinkSync(abs);
    outcome.deletedBytes += size;
  } catch (error) {
    const code = codeOf(error);
    if (FILE_LOCKED_CODES.has(code)) {
      outcome.skippedLocked += 1;
    } else {
      outcome.errors.push({ path: abs, code });
    }
  }
}

function deriveStatus(outcome: DeleteOutcome): DeleteOutcome['status'] {
  const hasFailures = outcome.skippedLocked > 0 || outcome.errors.length > 0;
  if (!hasFailures) return 'done';
  if (outcome.errors.length > 0 && outcome.deletedBytes === 0 && outcome.skippedLocked === 0) return 'failed';
  return 'partial';
}

function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}
```

Note: directory-removal failures (`ENOTEMPTY`, from locked children) intentionally do not increment `skippedLocked` — the locked files were already counted, and counting the directory too would double the "N files in use" figure.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS. The locked-file test requires the fixture file to stay open while `deletePathTree` runs; if the runner reports `skippedLocked: 0`, the file handle was closed early — fix the test's handle lifetime, not the executor.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/cleaner/executor.ts core/test/executor.test.ts
git commit -m "feat(core): add recursive delete executor with locked-file reporting"
```

---

### Task 5: Cleaner with plan tokens

**Files:**
- Create: `core/src/cleaner/cleaner.ts`
- Test: `core/test/cleaner.test.ts`

**Interfaces:**
- Consumes: `buildPlan`, `CleanupPlan`, `PlanItem` from Task 3; `executeItem`, `ItemResult` from Task 4; `GuardOptions` from Task 2; `Rule`, `RuleContext` from Task 1.
- Produces: `PlanTokenError { code: 'unknown-plan' | 'consumed-plan' | 'unacknowledged-review' | 'rule-not-in-plan' }`, `CleanerOptions { guard?; now?; makeId? }`, `ExecuteOptions { acknowledge?: string[]; onItem?: (result: ItemResult) => void }`, `CleanupReport { planId; startedAt; finishedAt; items: ItemResult[]; deletedBytes; skippedLocked; itemErrors }`, `class Cleaner { preview(rules, ctx): Promise<CleanupPlan>; execute(planId, options?): Promise<CleanupReport> }`.

- [ ] **Step 1: Write the failing tests**

`core/test/cleaner.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Cleaner } from '../src/cleaner/cleaner';
import type { RuleContext } from '../src/rules/types';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import { Fixture } from './fixtures';
import { makeMatch, makeRule } from './rule-fixtures';

describe('Cleaner', () => {
  let fixture: Fixture;
  let ctx: RuleContext;

  beforeEach(() => {
    fixture = new Fixture();
    ctx = { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function makeCleaner(): Cleaner {
    return new Cleaner({
      guard: { userProfile: 'C:\\Users\\x', userFolders: [] },
      makeId: () => 'plan-1',
      now: () => 1000,
    });
  }

  it('previews and executes a plan, deleting files and reporting bytes', async () => {
    const junk = fixture.dir('junk');
    fixture.file('junk/a.txt', 'aaaaa');
    fixture.file('junk/b.txt', 'bbbbbbb');

    const cleaner = makeCleaner();
    const rules = [makeRule({ id: 'fixture', matches: [makeMatch({ path: junk, bytes: 12 })] })];
    const plan = await cleaner.preview(rules, ctx);
    expect(plan.items).toHaveLength(1);

    const report = await cleaner.execute(plan.id);
    expect(report.deletedBytes).toBe(12);
    expect(report.skippedLocked).toBe(0);
    expect(report.items[0]).toMatchObject({ ruleId: 'fixture', status: 'done' });
    expect(existsSync(junk)).toBe(false);
  });

  it('rejects unknown and replayed plan tokens', async () => {
    const cleaner = makeCleaner();
    await expect(cleaner.execute('nope')).rejects.toMatchObject({ code: 'unknown-plan' });

    const junk = fixture.dir('junk');
    const rules = [makeRule({ id: 'fixture', matches: [makeMatch({ path: junk })] })];
    const plan = await cleaner.preview(rules, ctx);
    await cleaner.execute(plan.id);
    await expect(cleaner.execute(plan.id)).rejects.toMatchObject({ code: 'consumed-plan' });
  });

  it('requires an explicit acknowledge for review-grade items', async () => {
    const file = fixture.file('review.txt', 'abc');
    const cleaner = makeCleaner();
    const rules = [
      makeRule({
        id: 'reviewer',
        matches: [
          makeMatch({
            path: file,
            bytes: 3,
            grade: 'review',
            recovery: { kind: 'regenerate', command: 'npm ci' },
          }),
        ],
      }),
    ];
    const plan = await cleaner.preview(rules, ctx);

    await expect(cleaner.execute(plan.id)).rejects.toMatchObject({
      code: 'unacknowledged-review',
    });
    expect(existsSync(file)).toBe(true);

    const report = await cleaner.execute(plan.id, { acknowledge: [file] });
    expect(report.deletedBytes).toBe(3);
    expect(existsSync(file)).toBe(false);
  });

  it('reports already-gone items without failing the batch', async () => {
    const file = fixture.file('vanishing.txt', 'abcd');
    const cleaner = makeCleaner();
    const rules = [makeRule({ id: 'fixture', matches: [makeMatch({ path: file, bytes: 4 })] })];
    const plan = await cleaner.preview(rules, ctx);
    fixture.cleanup();
    fixture = new Fixture();
    ctx = { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };

    const report = await cleaner.execute(plan.id);
    expect(report.items[0]?.status).toBe('already-gone');
    expect(report.deletedBytes).toBe(0);
  });

  it('streams per-item results through onItem', async () => {
    const dir = fixture.dir('junk');
    fixture.file('junk/a.txt', 'aa');
    const cleaner = makeCleaner();
    const rules = [makeRule({ id: 'fixture', matches: [makeMatch({ path: dir, bytes: 2 })] })];
    const plan = await cleaner.preview(rules, ctx);

    const seen: string[] = [];
    await cleaner.execute(plan.id, { onItem: (result) => seen.push(`${result.ruleId}:${result.status}`) });
    expect(seen).toEqual(['fixture:done']);
  });

  it('does not execute an unacknowledged plan even partially', async () => {
    const first = fixture.file('first.txt', 'aa');
    const second = fixture.file('second.txt', 'bb');
    const cleaner = makeCleaner();
    const rules = [
      makeRule({
        id: 'mixed',
        matches: [
          makeMatch({ path: first, bytes: 2, grade: 'safe' }),
          makeMatch({ path: second, bytes: 2, grade: 'review', recovery: { kind: 'junk', reason: 'doomed' } }),
        ],
      }),
    ];
    const plan = await cleaner.preview(rules, ctx);
    await expect(cleaner.execute(plan.id)).rejects.toMatchObject({ code: 'unacknowledged-review' });
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — cannot resolve `../src/cleaner/cleaner`.

- [ ] **Step 3: Implement the Cleaner**

`core/src/cleaner/cleaner.ts`:

```ts
import { normalize } from 'node:path';
import type { Rule, RuleContext } from '../rules/types';
import { buildPlan } from './plan';
import type { BuildPlanOptions, CleanupPlan } from './plan';
import { executeItem } from './executor';
import type { ItemResult } from './executor';

export type PlanTokenErrorCode =
  | 'unknown-plan'
  | 'consumed-plan'
  | 'unacknowledged-review'
  | 'rule-not-in-plan';

export class PlanTokenError extends Error {
  constructor(
    public readonly code: PlanTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlanTokenError';
  }
}

export interface CleanerOptions extends BuildPlanOptions {}

export interface ExecuteOptions {
  acknowledge?: string[];
  onItem?: (result: ItemResult) => void;
}

export interface CleanupReport {
  planId: string;
  startedAt: number;
  finishedAt: number;
  items: ItemResult[];
  deletedBytes: number;
  skippedLocked: number;
  itemErrors: number;
}

interface PlanEntry {
  plan: CleanupPlan;
  ruleIds: Set<string>;
  consumed: boolean;
}

export class Cleaner {
  private readonly plans = new Map<string, PlanEntry>();

  constructor(private readonly options: CleanerOptions = {}) {}

  async preview(rules: Rule[], ctx: RuleContext): Promise<CleanupPlan> {
    const plan = await buildPlan(rules, ctx, this.options);
    this.plans.set(plan.id, { plan, ruleIds: new Set(rules.map((rule) => rule.id)), consumed: false });
    return plan;
  }

  async execute(planId: string, options: ExecuteOptions = {}): Promise<CleanupReport> {
    const entry = this.plans.get(planId);
    if (!entry) {
      throw new PlanTokenError('unknown-plan', `unknown plan token: ${planId}`);
    }
    if (entry.consumed) {
      throw new PlanTokenError('consumed-plan', `plan token already consumed: ${planId}`);
    }

    const acknowledged = new Set((options.acknowledge ?? []).map((path) => normalize(path).toLowerCase()));
    const missing = entry.plan.items
      .filter((item) => item.grade === 'review')
      .filter((item) => !acknowledged.has(normalize(item.path).toLowerCase()))
      .map((item) => item.path);
    if (missing.length > 0) {
      throw new PlanTokenError(
        'unacknowledged-review',
        `review-grade items require explicit acknowledgement: ${missing.join(', ')}`,
      );
    }

    entry.consumed = true;

    const startedAt = (this.options.now ?? Date.now)();
    const items: ItemResult[] = [];
    let deletedBytes = 0;
    let skippedLocked = 0;
    let itemErrors = 0;

    for (const item of entry.plan.items) {
      if (!entry.ruleIds.has(item.ruleId)) {
        const result: ItemResult = {
          ruleId: item.ruleId,
          path: item.path,
          action: item.action.kind,
          status: 'failed',
          deletedBytes: 0,
          skippedLocked: 0,
          errors: [{ path: item.path, code: 'RULE-NOT-IN-PLAN' }],
        };
        items.push(result);
        itemErrors += 1;
        options.onItem?.(result);
        continue;
      }

      const result = executeItem(item, { guard: this.options.guard });
      items.push(result);
      deletedBytes += result.deletedBytes;
      skippedLocked += result.skippedLocked;
      itemErrors += result.errors.length;
      options.onItem?.(result);
    }

    return {
      planId,
      startedAt,
      finishedAt: (this.options.now ?? Date.now)(),
      items,
      deletedBytes,
      skippedLocked,
      itemErrors,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w core`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/cleaner/cleaner.ts core/test/cleaner.test.ts
git commit -m "feat(core): add Cleaner with single-use plan tokens and acknowledgement"
```

---

### Task 6: Public exports and end-to-end pipeline test

**Files:**
- Modify: `core/src/index.ts`
- Modify: `core/test/smoke.test.ts`
- Test: `core/test/cleaner-pipeline.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: the public surface `Cleaner`, `PlanTokenError`, `buildPlan`, `checkDeletable`, `defaultProtectedPaths`, `createNodeFsProbe`, `validateRules`, `RuleValidationError`, plus types `Rule`, `RuleMatch`, `RuleContext`, `FsProbe`, `Action`, `ActionGrade`, `CategoryId`, `Recovery`, `CleanupPlan`, `PlanItem`, `RefusedMatch`, `PlanTotals`, `CleanupReport`, `ItemResult`, `DeleteOutcome`, `DeleteError`, `GuardOptions`, `GuardDenial`, `GuardResult`, `BuildPlanOptions`, `CleanerOptions`, `ExecuteOptions`.

- [ ] **Step 1: Write the failing integration test**

`core/test/cleaner-pipeline.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { Cleaner } from '../src/cleaner/cleaner';
import { AggregateTree } from '../src/model/tree';
import { createNodeFsProbe } from '../src/rules/probe';
import type { RuleContext } from '../src/rules/types';
import { Fixture } from './fixtures';
import { makeMatch, makeRule } from './rule-fixtures';

describe('cleaner pipeline (end to end)', () => {
  let fixture: Fixture;
  let ctx: RuleContext;

  beforeEach(() => {
    fixture = new Fixture();
    ctx = { root: fixture.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() };
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('previews, records refusals, executes and reports', async () => {
    const cache = fixture.dir('cache');
    fixture.file('cache/blob.bin', '0123456789');
    const staleFile = fixture.file('stale.tmp', 'abc');
    const fakeProfile = join(fixture.root, 'fake-profile');

    const cleaner = new Cleaner({
      guard: { userProfile: fakeProfile, userFolders: ['Documents'] },
      makeId: () => 'plan-e2e',
      now: () => 42,
    });

    const rules = [
      makeRule({
        id: 'cache',
        category: 'app-caches',
        matches: [
          makeMatch({
            path: cache,
            bytes: 10,
            recovery: { kind: 'junk', reason: 'cache is re-downloaded on demand' },
          }),
        ],
      }),
      makeRule({
        id: 'stale',
        category: 'temp',
        matches: [
          makeMatch({
            path: staleFile,
            bytes: 3,
            recovery: { kind: 'regenerate', command: 'rebuild output' },
          }),
        ],
      }),
      makeRule({
        id: 'forbidden',
        category: 'temp',
        matches: [makeMatch({ path: join(fakeProfile, 'Documents'), bytes: 999 })],
      }),
    ];

    const plan = await cleaner.preview(rules, ctx);
    expect(plan.id).toBe('plan-e2e');
    expect(plan.createdAt).toBe(42);
    expect(plan.items.map((item) => item.path).sort()).toEqual([cache, staleFile].sort());
    expect(plan.refused).toHaveLength(1);
    expect(plan.refused[0]).toMatchObject({ ruleId: 'forbidden', reason: 'protected-root' });
    expect(plan.totals.bytes).toBe(13);

    const report = await cleaner.execute(plan.id);
    expect(report.deletedBytes).toBe(13);
    expect(report.itemErrors).toBe(0);
    expect(report.skippedLocked).toBe(0);
    expect(existsSync(cache)).toBe(false);
    expect(existsSync(staleFile)).toBe(false);
    expect(existsSync(join(fakeProfile, 'Documents'))).toBe(false);
  });

  it('exposes the cleaner surface through the public index', () => {
    expect(typeof core.Cleaner).toBe('function');
    expect(typeof core.buildPlan).toBe('function');
    expect(typeof core.checkDeletable).toBe('function');
    expect(typeof core.createNodeFsProbe).toBe('function');
    expect(typeof core.validateRules).toBe('function');
    expect(typeof core.defaultProtectedPaths).toBe('function');
    expect(typeof core.PlanTokenError).toBe('function');
    expect(typeof core.RuleValidationError).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w core`
Expected: FAIL — `core.Cleaner` etc. are not exported from `../src/index`, and `cleaner-pipeline.test.ts` cannot resolve the public surface assertions.

- [ ] **Step 3: Extend the public surface**

Append to `core/src/index.ts`:

```ts
export { buildPlan } from './cleaner/plan';
export type {
  BuildPlanOptions,
  CleanupPlan,
  PlanItem,
  PlanTotals,
  RefusedMatch,
  RefusedReason,
} from './cleaner/plan';
export { checkDeletable, defaultProtectedPaths } from './cleaner/guard';
export type { GuardDenial, GuardOptions, GuardResult } from './cleaner/guard';
export { Cleaner, PlanTokenError } from './cleaner/cleaner';
export type { CleanerOptions, CleanupReport, ExecuteOptions, PlanTokenErrorCode } from './cleaner/cleaner';
export { deletePathTree, executeItem } from './cleaner/executor';
export type { DeleteError, DeleteOutcome, ItemResult } from './cleaner/executor';
export { createNodeFsProbe } from './rules/probe';
export { RuleValidationError, validateRules } from './rules/validate';
export type {
  Action,
  ActionGrade,
  CategoryId,
  FsProbe,
  Recovery,
  Rule,
  RuleContext,
  RuleMatch,
} from './rules/types';
```

Update `core/test/smoke.test.ts` by adding assertions for the new surface (keep the existing ones):

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

  it('exposes the rules and cleaner surface', () => {
    expect(typeof core.Cleaner).toBe('function');
    expect(typeof core.buildPlan).toBe('function');
    expect(typeof core.checkDeletable).toBe('function');
    expect(typeof core.createNodeFsProbe).toBe('function');
    expect(typeof core.validateRules).toBe('function');
    expect(typeof core.defaultProtectedPaths).toBe('function');
    expect(typeof core.PlanTokenError).toBe('function');
    expect(typeof core.RuleValidationError).toBe('function');
  });
});
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npm run test -w core`
Expected: PASS — all suites.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`

```bash
git add core/src/index.ts core/test/smoke.test.ts core/test/cleaner-pipeline.test.ts
git commit -m "feat(core): export rules and cleaner surface with end-to-end coverage"
```

---

## Plan Self-Review Notes

- Spec coverage: Rule interface and per-match recovery/evidence (§5.1), registry validation and the whitelist-by-construction guarantee (§5.1 — plans are built only from provided rules; the executor re-checks item rule ids and re-runs the guard), action grades passed through to plan items (§5.2 — display grade is Plan 4), per-category recovery model (§5.3 — types + validation; concrete recovery strings arrive with the rules), plan tokens and all five invariants (§5.4), protected-path guard with exact-match exemption (§5.5), locked-file skip-and-report (§5.3/§9), relative-path and link refusals in the executor (§9 defense-in-depth).
- Deliberately deferred: production rules, `empty-recycle-bin` execution (returns a tested `UNSUPPORTED-ACTION` result), elevation, display-grade matcher, snapshot of plans — Plans 4-6.
- Type consistency: `PlanItem.action` is the rule's `Action`; `executeItem` switches on `item.action.kind`; `RefusedReason` composes `GuardDenial` with plan-local reasons; `CleanerOptions` extends `BuildPlanOptions` so guard options flow from preview to execute unchanged.
- Path safety: the plan builder normalizes and lowercases for duplicate/nesting checks; the executor refuses relative paths and re-runs the guard at delete time using the same `exemptExact` semantics as preview.
