# Dust v1.0.0 Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Dust v1.0.0 as an unsigned Windows NSIS installer built by CI, on a hardened, linted codebase with the Deep Uninstall and Startup Manager features safely landed.

**Architecture:** Fix the Deep Uninstall security findings first (protected-path policy, malformed-path rejection, write-ahead journaling), then rebuild the elevated handoff so the elevated process re-derives the plan from an app id instead of trusting a file. After that, packaging (electron-builder + generated icon), CI/release workflows, and docs.

**Tech Stack:** Electron 44, TypeScript 5.9, Node 22, React 19, Vitest 3, electron-builder, ESLint 9 + Prettier, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-28-production-release-design.md`

## Global Constraints

- Windows-only; no cross-platform configuration. No signing certificate; do not add signing secrets or auto-update.
- Versions: app `1.0.0`; Node engines stay `^20.19.0 || >=22.12.0`; CI uses Node 22.
- `core/` must not import Electron; app tests run host suites in Node and renderer suites in jsdom.
- License MIT. package name/author identity: `Mohaned178`, appId `com.mohaned178.dust`.
- Every task ends green on `npm run typecheck -w core && npm run typecheck -w app` and the touched workspace's tests.
- Commits per task; never `git push`, never create tags, never publish releases.
- Security review findings referenced below come from the 2026-09-28 review; each fix starts with a failing test that reproduces the finding.

---

## Task 1: Uninstall path policy module

Reproduces review findings 1 and 2 (guard bypass, traversal). New pure module so plan and execute share one policy.

**Files:**
- Create: `core/src/uninstall/path-policy.ts`
- Test: `core/test/uninstall-path-policy.test.ts`
- Modify: `core/src/index.ts` (export the module)

**Interfaces:**
- Consumes: `checkDeletable(path: string): GuardResult` from `core/src/cleaner/guard.ts` (read it first; reuse its normalization semantics).
- Produces:
  - `normalizePlanPath(raw: string): string | null` — returns a normalized absolute path, or `null` for empty/relative/UNC/contains-`..` inputs.
  - `assertUninstallTarget(raw: string, opts: { roots: string[]; extraBlocked?: string[] }): { ok: true; path: string } | { ok: false; reason: string }` — target must normalize, must not equal a protected root, must be strictly inside one of `roots` (never equal), must not be a blocked personal folder.
  - `assertLeftoverNameComponent(name: string): boolean` — false for empty, `.`, `..`, or anything containing `/`, `\`, `:`, or NUL.
  - `ALLOWED_UNINSTALL_PARENTS` — computed from env: `ProgramFiles`, `ProgramFiles(x86)`, `ProgramData`, `LOCALAPPDATA`, `APPDATA`.

- [ ] **Step 1: Write failing tests** covering: `C:\Program Files\..` refused; `C:\Program Files\App` accepted; `C:\` refused (equal to nothing / volume root); `..\..` refused; forward-slash `C:/Program Files/App` normalized and accepted; UNC `\\server\share` refused; relative `App` refused; `%APPDATA%\..\Windows` refused; name components with separators refused; strictly-inside check refuses a parent root itself.
- [ ] **Step 2: Run** `npx vitest run test/uninstall-path-policy.test.ts -w core`; expect failures (module missing).
- [ ] **Step 3: Implement** using `node:path` `resolve`, case-insensitive `startsWith` on normalized paths with trailing-separator boundary, and `checkDeletable` for the protected list. No `..` may survive validation (reject if any segment equals `..` before resolution). Block personal folders by name (`Documents`, `Desktop`, `Downloads`, `Pictures`, `Videos`, `Music`, `OneDrive`) directly under the profile root.
- [ ] **Step 4: Run tests**; all pass. Run `npm test -w core` to confirm no regressions.
- [ ] **Step 5: Commit** `fix(core): add uninstall path policy with traversal and protected-root checks`.

---

## Task 2: Enforce policy during plan building

Reproduces findings 2, 7, 10, 13.

**Files:**
- Modify: `core/src/uninstall/leftovers.ts` (`canonical`, `underRoot`, install-location acceptance, leftover name construction)
- Modify: `core/src/uninstall/plan.ts` (startup matching, `defaultSelection`, `uninstallerRequiresAdmin`)
- Modify: `core/src/uninstall/command.ts` (bare executable names)
- Modify: `core/src/uninstall/apps.ts` (safe-grade evidence)
- Test: `core/test/uninstall-leftovers.test.ts`, `core/test/uninstall-plan.test.ts`, `core/test/uninstall-command.test.ts`, `core/test/uninstall-apps.test.ts`

**Interfaces:**
- Consumes: `assertUninstallTarget`, `normalizePlanPath`, `assertLeftoverNameComponent` from Task 1.
- Produces: plan items whose `path` is always the normalized absolute path (never the raw registry string).

- [ ] **Step 1: Add failing tests:** InstallLocation `C:\Program Files\..` yields no `install-dir` item; `C:\Program Files\App..` unchanged; leftover `%APPDATA%\..\Windows` never emitted; startup entry is default-selected only when its resolved executable sits inside the app footprint (exact path or directory-boundary prefix — not `internal.includes(installLocation)`); bare uninstaller name `uninstall.exe` is not marked launchable unless an absolute path resolved against the install dir exists; ProgramData/vendor-root leftovers grade `review`, never `safe`, without publisher+product evidence.
- [ ] **Step 2: Run each test file, confirm the relevant failure for each finding.**
- [ ] **Step 3: Implement** the checks. `canonical`/`underRoot` use `normalizePlanPath`; install-dir acceptance uses `assertUninstallTarget` with `ALLOWED_UNINSTALL_PARENTS`; `uninstallerRequiresAdmin` uses normalized paths; command resolution joins bare names to the install dir and requires the file to exist; startup match uses boundary-aware `path.relative` containment.
- [ ] **Step 4: Run `npm test -w core`** (all uninstall suites) — green.
- [ ] **Step 5: Commit** `fix(core): validate uninstall plan paths, commands, and startup matches`.

---

## Task 3: Guarded, journaled, recoverable execution

Reproduces findings 1, 4, 5, 6, 8, 17.

**Files:**
- Modify: `core/src/uninstall/execute.ts`
- Modify: `core/src/cleaner/recycle.ts` (lstat + reparse refusal)
- Modify: `core/src/uninstall/journal.ts` (fail-closed writes)
- Test: `core/test/uninstall-execute.test.ts`, `core/test/uninstall-recycle.test.ts`, `core/test/uninstall-journal.test.ts`

**Interfaces:**
- Consumes: `assertUninstallTarget` (Task 1), `checkDeletable` (guard), journal API.
- Produces: `executeRemoval` never calls a file remover before a successful per-item journal append; `user-data` class items always use recycle mode; `skippedWaiting` aborts before the deletion phase.

- [ ] **Step 1: Failing tests:** (a) a plan item with path `C:\Program Files\..` injected directly into `execute()` is refused without calling the injected remover; (b) a reparse-point/file-swap fixture is refused by recycle; (c) `user-data` item with grade `safe` executes as recycle, not permanent; (d) journal append failure throws before any removal call; (e) `skippedWaiting` + live uninstaller child results in verify-only, zero deletions; (f) `already-gone` items are counted separately from `deletedItems`.
- [ ] **Step 2: Run tests, confirm each fails for the right reason.**
- [ ] **Step 3: Implement:** execute-time `assertUninstallTarget` per item; journal write-ahead gate for the file phase; per-item journal records (path + mode) before removal; force recycle for `user-data`; abort before deletion when waiting was skipped and the child is alive; `lstat` reparse refusal in `stageToRecycleBin` and `removeFile`; separate `alreadyGone` counter.
- [ ] **Step 4: `npm test -w core`** green.
- [ ] **Step 5: Commit** `fix(core): guard and journal uninstall deletions`.

---

## Task 4: Cleaner TOCTOU reparse check

Reproduces finding 11. The main cleaner shares the walk; fix it once.

**Files:**
- Modify: `core/src/cleaner/executor.ts` (child descent)
- Test: `core/test/executor.test.ts`

- [ ] **Step 1: Failing test:** during tree removal, a directory entry swapped to a junction after `readdirSync` is not descended into (inject an `lstat` seam).
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: `lstat` each child before descending/removing; skip non-files and reparse points.**
- [ ] **Step 4: `npm test -w core` green.**
- [ ] **Step 5: Commit** `fix(core): re-check reparse points during tree removal`.

---

## Task 5: Backup filename collisions and journal failure gates

Reproduces findings 9, 16, 18.

**Files:**
- Modify: `core/src/uninstall/backup.ts` (filename uniqueness)
- Modify: `app/src/main/uninstall-launch.ts` (atomic write, TTL upper bound)
- Test: `core/test/uninstall-backup.test.ts`, `app/test/uninstall-launch.test.ts`

- [ ] **Step 1: Failing tests:** two backups in the same second produce distinct files; pending-uninstall file rejects a `createdAt` in the future or older than 15 minutes; file write is atomic (tmp + rename) and id is checked against the file's jobId.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement** millisecond + counter suffix on backup filenames; TTL window `[-5 min, +15 min]` around now; atomic write; `jobId` equality check helper exported for Task 6.
- [ ] **Step 4: Run `npm test -w core && npm test -w app`.**
- [ ] **Step 5: Commit** `fix(uninstall): unique backups and bounded pending-job handoff`.

---

## Task 6: Rebuild the elevated handoff (approved design)

Reproduces finding 3. The elevated process must re-derive the plan from the app id; the on-disk file carries only `{ jobId, appId, createdAt }`.

**Files:**
- Modify: `app/src/main/uninstall-launch.ts` (schema, parse/validate)
- Modify: `app/src/main/host/uninstall.ts` (replace `exportUninstallJob`/`adoptUninstallJob` plan payloads with `buildElevatedUninstallJob(appId): { plan } | null`)
- Modify: `app/src/main/host/engine-host.ts` (host API)
- Modify: `app/src/main/index.ts` (arg id must equal file jobId; rebuild from `appId`; execute rebuilt plan only)
- Test: `app/test/uninstall-host.test.ts`, `app/test/uninstall-launch.test.ts`

**Interfaces:**
- Produces: `host.buildElevatedUninstallJob(appId: string): RemovalPlan | null` — re-discovers installed apps in the current (elevated) process, rebuilds the plan, and returns null when the app is gone.
- Consumes: Task 5's bounded/atomic pending file and `jobId` check.

- [ ] **Step 1: Failing tests:** mismatched `--dust-uninstall=<id>` vs file jobId → no execution, stale notice; plan payload can no longer be smuggled through the file (schema rejects unknown fields); missing/renamed app → null → stale notice, no writes; happy path rebuilds and executes.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement** the schema (`appId` validated against the installed-app ids discovered at elevation time, never trusted from the file beyond lookup), the rebuild path, and the index wiring. Delete the raw-plan adoption code.
- [ ] **Step 4: Run `npm test -w app && npm run typecheck`** green.
- [ ] **Step 5: Commit** `fix(app): rebuild elevated uninstall plan from app id`.

---

## Task 7: Adopted-job report replay

Reproduces finding 14. Events fire before the renderer subscribes on an elevated launch.

**Files:**
- Modify: `app/src/main/host/uninstall.ts` (buffer latest report + status)
- Modify: `app/src/preload/index.ts` if a snapshot getter is needed (only if no existing channel covers it)
- Test: `app/test/uninstall-host.test.ts`, `app/test/renderer/uninstall-view.test.tsx`

- [ ] **Step 1: Failing test:** a job completes before any subscriber; a late subscriber receives the final report/status exactly once.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Buffer last report per job and replay on subscribe/launch hint.**
- [ ] **Step 4: `npm test -w app`** green.
- [ ] **Step 5: Commit** `fix(app): replay uninstall progress for late subscribers`.

---

## Task 8: Land the feature branch

**Files:** every modified/untracked file in the working tree; docs already written for Startup Manager/System Info.

- [ ] **Step 1:** `git status` + `git diff` — confirm only intended files; run `npm run typecheck && npm test` at root.
- [ ] **Step 2:** Commit in logical units: uninstall engine fixes (Tasks 1–5), app handoff/replay (6–7), remaining working-tree changes grouped by feature (`feat(app): ...`), and any test-only changes with their feature commit.
- [ ] **Step 3:** Verify `git status` clean.
- [ ] **Step 4:** Merge to `master`: `git switch master`, `git merge --ff-only feat/startup-manager`; if not fast-forward, merge commit `Merge branch 'feat/startup-manager' into master`. Run full `npm test` and `npm run typecheck` on `master`.
- [ ] **Step 5: Commit/merge complete** (no push).

---

## Task 9: Repo hygiene

**Files:**
- Create: `LICENSE`
- Create: `CHANGELOG.md`
- Modify: `package.json`, `core/package.json`, `app/package.json` (license; app version `1.0.0`)

- [ ] **Step 1:** Write MIT LICENSE (`Copyright (c) 2026 Mohaned178`).
- [ ] **Step 2:** Add `"license": "MIT"` to all three package.json files; set `app.version` to `1.0.0`.
- [ ] **Step 3:** Write `CHANGELOG.md` (Keep a Changelog; 1.0.0 entry listing Analyze, Results, Quick Clean, Dev Cleanup, Startup Manager, Deep Uninstall, System Info, snapshot persistence, scan lock; note unsigned installer/SmartScreen).
- [ ] **Step 4:** `npm run typecheck` sanity; commit `chore: add license, changelog, and 1.0.0 version`.

---

## Task 10: Prettier

**Files:** Create `.prettierrc.json`, `.prettierignore`; modify root `package.json` devDeps/scripts; format sweep.

- [ ] **Step 1:** `npm i -D prettier` at root (workspace-aware).
- [ ] **Step 2:** `.prettierrc.json`: `{ "singleQuote": true, "printWidth": 120, "semi": true, "trailingComma": "all" }`; `.prettierignore`: `dist`, `release`, `node_modules`, `package-lock.json`, `docs/superpowers`, `app/resources`.
- [ ] **Step 3:** Root scripts: `format`, `format:check`.
- [ ] **Step 4:** `npm run format`, then `npm run typecheck && npm test` — green.
- [ ] **Step 5:** Commit `chore: format with prettier`.

---

## Task 11: ESLint

**Files:** Create `eslint.config.mjs`; modify root `package.json` devDeps/scripts.

- [ ] **Step 1:** `npm i -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-config-prettier globals`.
- [ ] **Step 2:** Flat config: `js.configs.recommended` + `tseslint.configs.recommended` on `**/*.ts(x)`, `react-hooks.configs['recommended-latest']` on `app/renderer/**`, `eslint-config-prettier` last, ignores `dist/`, `release/`, `node_modules/`, `coverage/`. Add `no-console: off` for `app/scripts/**` and bench paths.
- [ ] **Step 3:** `npm run lint` — fix every error by correcting the code (no blanket disables; a narrow inline disable needs a comment).
- [ ] **Step 4:** `npm run typecheck && npm test && npm run lint` green.
- [ ] **Step 5:** Commit `chore: add eslint and fix findings`.

---

## Task 12: Electron hardening

Implements spec §6.

**Files:**
- Create: `app/src/main/security.ts`
- Create: `app/test/security.test.ts`
- Modify: `app/src/main/index.ts` (wire CSP, handlers, `setAppUserModelId`, dev-flag gating, crash logging)
- Create: `app/renderer/src/components/ErrorBoundary.tsx`
- Modify: `app/renderer/src/main.tsx` (wrap `<App/>`)
- Test: `app/test/renderer/error-boundary.test.tsx`

**Interfaces:**
- Produces (pure, testable): `buildCsp(isDev: boolean): string`; `isAllowedNavigation(url: string, allowed: { devServerUrl?: string; appUrl: string }): boolean`.
- The Electron wiring calls `hardenWebContents(contents, options)` and `installSessionSecurity(session, options)`.

- [ ] **Step 1: Failing tests:** `buildCsp(false)` contains `default-src 'self'` and no `unsafe-eval`; `isAllowedNavigation` allows the loaded app URL and the dev origin only; error boundary renders a reload affordance when a child throws (jsdom).
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement** security.ts with the exact CSP from spec §6 (`style-src 'self' 'unsafe-inline'` for React inline styles); deny window-open and permissions; guard `will-navigate`; `app.setAppUserModelId('com.mohaned178.dust')`; ignore `DUST_BENCH_ROOT`/`DUST_AUTO` when `app.isPackaged`; log `uncaughtException`/`unhandledRejection`/`render-process-gone` to `userData/error.log` via one helper; error boundary component.
- [ ] **Step 4:** `npm test -w app && npm run typecheck`; then `npm run build -w app && npm start -w app` smoke check: window loads, devtools console shows no CSP violations, Dashboard renders. If `'self'` fails on `file://`, add the minimal scheme allowance with a comment and re-verify.
- [ ] **Step 5:** Commit `feat(app): harden renderer and log main-process failures`.

---

## Task 13: Icon generator

**Files:**
- Create: `app/scripts/make-icon.mjs`
- Create (generated, committed): `app/resources/icon.ico`
- Test: `app/test/make-icon.test.ts` (imports the encoder functions, asserts ICO header/directory sizes, not file bytes)

**Interfaces:**
- Produces: `renderIcon(size: number): Buffer` (32bpp BGRA), `encodeIco(entries: { size: number; pixels: Buffer }[]): Buffer`, `buildIcon(): Buffer`, plus a CLI block writing `resources/icon.ico` when run directly.

- [ ] **Step 1: Failing tests:** ICO header `00 00 01 00`, entry count 7, each entry's width/height bytes (256 encoded as 0), pixel data length `size*size*4 + maskRows*sizePadBytes` per entry.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement** pure-Node generator: 4× supersampled draw of a rounded square in `#0f6e6e` with three left-aligned white bars of decreasing width (heights 12%/12%/12% of size, vertical spacing symmetrical), box-downsample to 16/24/32/48/64/128/256, build BITMAPINFOHEADER + bottom-up BGRA rows + zeroed AND mask into one `.ico` (BMP/DIB entries; no PNG, no dependencies).
- [ ] **Step 4:** `node app/scripts/make-icon.mjs` writes the file; `npm test -w app` green; verify Explorer-style by checking the ICO parses with `icon` entries count via the test.
- [ ] **Step 5:** Commit `feat(app): add generated app icon`.

---

## Task 14: electron-builder packaging

**Files:**
- Modify: `app/package.json` (`electron-builder` devDep, `dist` script), root `package.json` (`dist:app`)
- Create: `app/electron-builder.yml`
- Test: none (verified by running the build)

- [ ] **Step 1:** `npm i -D electron-builder -w app`.
- [ ] **Step 2:** Write `app/electron-builder.yml` per spec §7: appId/productName/copyright, output `release`, buildResources `resources`, `files: ["dist/**"]`, `asar: true`, `npmRebuild: false`, NSIS assisted per-user with install-dir + shortcuts, `artifactName: ${productName}-Setup-${version}.${ext}`, commented signing stub, `publish: never`.
- [ ] **Step 3:** Scripts: app `dist: npm run build && electron-builder --win`; root `dist:app: npm run dist -w app`.
- [ ] **Step 4:** `npm run dist:app` → confirm `app/release/Dust-Setup-1.0.0.exe` and `app/release/win-unpacked/Dust.exe` exist. Launch `win-unpacked/Dust.exe`, verify Dashboard, Startup Manager, Deep Uninstall open and no CSP violations.
- [ ] **Step 5:** Commit `build: package Windows installer with electron-builder`.

---

## Task 15: CI and release workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1:** `ci.yml`: on push/PR to `master`; `windows-latest`; Node 22 with npm cache; `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:app`.
- [ ] **Step 2:** `release.yml`: on `v*` tags; `windows-latest`; `permissions: contents: write`; `npm ci`, typecheck, test, `npm run dist -w app`; checksums via PowerShell `Get-FileHash` into `sha256sums.txt`; `gh release create "$env:GITHUB_REF_NAME" --draft --generate-notes` with installer + checksums; `GH_TOKEN` from `secrets.GITHUB_TOKEN`.
- [ ] **Step 3:** Validate YAML syntax locally (e.g. `node -e` parse via a YAML-aware check or review); no workflow execution locally.
- [ ] **Step 4:** Commit `ci: add test, build, and release workflows`.

---

## Task 16: Documentation

**Files:**
- Modify: `README.md`, `PROJECT_BRIEF.md`

- [ ] **Step 1:** README: add **Install** section after the intro (Releases link, unsigned SmartScreen note, build-from-source kept); add **Deep Uninstall** feature section (read the actual flow/tests first and document accurately); scripts table adds `lint`, `format`, `dist:app`; add **Releasing** subsection (tag `v1.0.0`, draft review, publish); Roadmap drops installed-apps manager, adds signing + auto-update as post-1.0 items.
- [ ] **Step 2:** PROJECT_BRIEF: update "What the app does today", "Current state" (v1.0.0, Deep Uninstall, packaging, CI), and architecture bullets where the new `security.ts`, `path-policy.ts`, and release tooling belong.
- [ ] **Step 3:** `npm run format:check` (docs are not ignored) and commit `docs: document installation, Deep Uninstall, and release process`.

---

## Task 17: Final verification

- [ ] **Step 1:** Clean check: `git status` clean on `master`; all tasks committed.
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm test` at root — green.
- [ ] **Step 3:** `npm run dist:app` from a clean `app/dist` and `app/release` (delete both first) — installer produced.
- [ ] **Step 4:** Smoke-run `app/release/win-unpacked/Dust.exe`: Dashboard snapshot loads, Startup Manager lists entries, Deep Uninstall opens, System Info renders, devtools console has no CSP violations or React errors.
- [ ] **Step 5:** Verify workflows reference only commands that passed in Step 2–3. Report status and stop; pushing, tagging, and publishing remain user actions.
