# Dust — Project Brief

Entry point for a new agent or developer. Read this file first; it explains what the project is, why it exists, how it is built, and where to go next. The full design lives in the spec linked at the bottom.

## What Dust is

Dust is a Windows PC cleaner and manager for everyone, with a dedicated section for developers. It scans a drive, shows where the space went, and removes what is safe to remove — temp files, the Recycle Bin, browser/app caches, and the `node_modules` and package caches development work leaves behind — while explaining why each item is safe (or not) to delete. It also manages startup apps and installed apps and shows the PC's specs. It is built as an Electron app (TypeScript, React, Tailwind) with a pure-TypeScript engine in `core/` that has no Electron dependency. It exists because people know their disks are full of junk, but existing cleanup tools either take too many steps, pick items for you, or behave like scareware.

## The problem it solves

**Friction.** Cleaning a disk takes too many steps: find the folders, check sizes, decide what is safe, delete manually. Because the payoff is not immediate, people procrastinate and the disk stays full. Dust cuts the path to a few explicit steps: Analyze → see what is reclaimable → confirm a plan → execute.

**Fear.** Users are afraid of deleting something important because no tool tells them what is safe. Dust addresses this with a per-match safety classification (green/yellow/red), a "why this grade" explanation on every row, a recovery statement on every plan item, and a hard rule that nothing is deleted without a preview and explicit confirmation.

## What the app does today

The interface was rebuilt in 2026-10 (see `docs/FRONTEND-PLAN.md`): light Windows 11 style, Windows blue accent, one page at a time.

- **Home** — what can be freed safely (the sum of rows the user can open, never a score), a bar of the drive by category, Scan again and Quick clean, other drives, and tiles for Startup, Apps, PC Health and Developer.
- **Clean up** — a progressive, cancellable scan with live progress, then a category-first list: each category opens in place into its items, each with a plain reason, Keep with Undo and Show in Explorer. Only safe items start ticked; categories with nothing safe sit under "Take a look first".
- **Clean dialog** — one dialog for every deletion: plan, acknowledgement when something cannot be recovered, progress, and a summary with the drive before and now. The confirm button names the amount.
- **Quick clean** — the same dialog for the four quick categories; never touches `node_modules`. `C:\Windows\Temp` items offer "Relaunch as administrator".
- **Explore disk** — a lazy folder tree, a treemap, main-process search, and a "Show protected items" switch.
- **Apps** — installed apps with real icons and sizes, and a deep uninstall: the app's own uninstaller, then a reviewed list of leftover folders, registry keys and startup entries. Plans grade every item, validate paths against the protected-path policy at plan and execution time, back registry keys up to `reg import` archives, gate deletions on a write-ahead journal, and rebuild the plan in the elevated instance before any write.
- **Startup** — one switch per Windows startup entry with a Dust backup, Undo, protected read-only rows and an elevated handoff for machine-wide entries.
- **PC Health** — processor and memory rings, storage per drive and spec cards, with a plain-text Copy specs. No elevation, nothing written to disk, no serial numbers or addresses.
- **Developer** — `node_modules` grouped by when each project was last used, restorability marks, bulk select of the safe ones, rebuild commands shown before and after, and a Toolchain caches section.
- **Settings** — about, a privacy statement, administrator relaunch, and updates.
- **Snapshot persistence** — scan results persisted to `userData/snapshot.json`; relaunch shows Home instantly, and staleness or a `rulesVersion` change is noted.
- **Scan Lock** — one global lock; a scan and a clean are mutually exclusive. A conflicting attempt shows "A scan is already running." with Cancel it and scan / Wait.

## What the app does NOT do yet (Phase 2)

- Docker image cleanup
- Code signing (releases are unsigned; updates download from GitHub Releases)
- A startup verdict and boot time; disk, battery and memory-slot health; dark mode
- Quarantine (recovery buffer for deletions)
- Real pnpm/bun support (global store and symlink math); Yarn Berry is also not supported
- Cross-platform (Windows only at MVP)
- Background scheduled scans
- Also deferred: SQLite-backed full-tree persistence, editor-MRU activity signals, global npm package audit, NVIDIA/Steam caches, broader browser cache coverage

## Architecture

npm workspaces monorepo, two packages:

```
core/                        TypeScript engine — zero Electron imports, runs under vitest in plain Node
  model/                     types, AggregateTree (aggregate/merge/path totals)
  scanner/                   Enumerator seam, scanTree, ScanSession
  scan/                      worker pool: coordinator, worker runtime, protocol, limits
  rules/                     cleanup rules: types/validation, path resolvers, probe
    rules/inventory/         system-temp, recycle-bin, npm-cache, npm-project-modules
    rules/inventory/         cache registry: chrome, edge, firefox, discord, slack
  cleaner/                   plan builder, protected-path guard, plan tokens, executor
  projects/                  npm project discovery and classification
  display/                   path-pattern display grades (green/yellow/red + why)
  snapshot/                  snapshot schema, build, store, post-cleanup prune
  startup/                   Run-key and Startup-folder reads, toggles, envelopes
  uninstall/                 app discovery, leftovers, path policy, plan, backup,
                             journal, verify, executor
  system/                    volume enumeration, drive types, cluster size, system info

app/                         Electron app
  src/main/                  window, typed IPC, engine host, worker-pool host, scan lock,
                             analyze/results/cleanup/dev-cleanup/startup/uninstall/system-info
                             hosts, security hardening
  src/preload/               typed bridge exposed as window.dust
  renderer/                  React 19 + Tailwind 4 (Vite), TanStack Table + react-virtual
  scripts/                   esbuild bundling, dev server, icon generator
  electron-builder.yml       NSIS installer configuration (unsigned, signing stub)
  test/                      vitest (node + jsdom projects), manual smoke checklist in README
```

Key architectural facts:

- Electron main owns scan sessions and the cleaner; the renderer holds no engine state and touches no filesystem. It reaches the engine only through `window.dust`.
- The scanner uses 4–8 `worker_threads` with synchronous fs calls and directory-level work-stealing; reparse points (symlinks/junctions) are detected and never followed, including a re-check before descending during removal.
- `core/` is host-agnostic: moving it into an Electron `utilityProcess` later requires no core changes.
- Renderer security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict production CSP, navigation/window-open and permission denial, and a top-level error boundary.
- Deep Uninstall has its own safety layer: a shared path policy (normalization, allowed parents, protected roots) enforced at plan and execution time, write-ahead journaling, and an elevated handoff that rebuilds the plan from an app id and waits for confirmation.

## The 13 locked decisions

1. **Progressive scan** — results stream in as folders complete; progress is always visible and the scan is cancellable at any moment with partial results retained and labeled. The 1M-files-under-45s figure is a goal, not a release gate.
2. **One-pass measurement** — `node_modules` is measured, not skipped; sync fs inside 4–8 worker threads with directory-level work-stealing. The `Enumerator` interface leaves room for a future native fast path.
3. **npm discovery rides Analyze** — a `package.json` outside `node_modules` marks a project root; `node_modules` sizes are attributed to the nearest root during the same walk. No second pass.
4. **Dev Cleanup is one category row** in the results Category Strip, not a third Dashboard button; the snapshot makes it instant on relaunch.
5. **Two-axis classification** — recency groups projects (Active ≤ 30 d, Occasional 31–180 d, Dead > 180 d, one config constant) and restorability grades each project (green/yellow; unsupported package managers are never offered). A manual Keep pin always wins.
6. **Per-category recovery path** — permanent delete only when a rule proves the asset is regenerable (exact restore command shown) or worthless. The Recycle Bin is the recovery path only for unverifiable content, not a blanket default.
7. **npm cache is in MVP** as its own row in the Developer category.
8. **Cache Registry pattern** — adding a Phase 2 cache is a ~10-line self-contained rule file with zero engine changes.
9. **Action grade vs display grade are separate** — only whitelisted rules produce action grades; unknown paths are never actionable. Every visible tree row gets an informational display grade with a "why" explanation.
10. **Quick Clean and Analyze are mutually exclusive** under a single global scan lock; Quick Clean uses the freshest data, either its own targeted scan or existing Analyze results without re-scanning.
11. **No restore feature** — Dust never runs package managers, manages background processes, or tracks rebuilds; it shows copyable restore commands and keeps a session-only "Recently cleaned" group.
12. **No one-click-and-done anywhere** — every deletion requires a plan preview and explicit user confirmation, enforced by plan tokens in the cleaner API.
13. **The Tree Table is the main results surface**, coexisting with the Category Summary Strip; the strip is the fast path, the tree is the deep path.

## Key design principles

- **No automatic deletion, ever.** Every deletion is user-confirmed. The renderer never constructs plan items or touches fs; it sends intent and renders what the host returns.
- **Per-category recovery, not a blanket Recycle Bin.** Each rule declares how its target comes back (re-downloaded cache, rebuild command, junk by definition, irreversible). Recycling frees no bytes for GB-scale artifacts, so it is not a general safety net.
- **Safety classification with a hard red list.** Unknown paths default to yellow; system-critical roots (`C:\Windows`, Program Files, ProgramData, profile and volume roots) are red, read-only, hidden behind a "Show protected items" switch, and never actionable.
- **Plan tokens.** `Cleaner.preview` mints a single-use, in-memory token; `Cleaner.execute(token)` is the only deletion path. Forged or expired tokens are refused, and red/unknown paths never enter a plan.
- **Cache registry pattern.** Browser and app caches are self-contained rule files declared via path resolvers; adding one requires no engine changes.
- **Action grade ≠ display grade.** Only whitelisted rule matches can enable cleanup, with their evidence shown; display grades are purely informational and the cleaner never consults them.
- **Fixed accent color.** The accent is a fixed product decision (Windows blue, `#0F6CBD`), not user-configurable. Every color is a token in `app/renderer/src/styles/tokens.css`; no hex appears outside it, and there is no theme or palette picker. A dark mode would be a second block of the same tokens.

## Current state

v1.2.0. The engine, snapshots, the rebuilt interface (Home, Clean up, Explore disk, Apps, Startup, PC Health, Developer, Settings), the cleanup flows and updates are on the `feat/ui-overhaul` branch; `npm run dist:app` produces an unsigned NSIS installer. The old renderer was deleted in the switch-over, along with the browse-a-drive feature (its IPC channels were removed; the guarded-delete code in `core` is unused). CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and a production build; the release workflow builds a draft GitHub Release from a `v*` tag.

Known follow-ups are listed in `docs/FRONTEND-PLAN.md` section 6 and in the phase notes (notably: Developer offers `node_modules` that belong to installed apps; no install date in the Apps list).

## Where to find the details

- **Full design spec:** [docs/superpowers/specs/2026-09-17-dust-mvp-design.md](docs/superpowers/specs/2026-09-17-dust-mvp-design.md) — problem, scope, locked decisions (§3), architecture (§4), safety model (§5), project classification (§6), UX flows (§7), performance contract (§8), edge cases (§9), testing (§10), risks (§11), Phase 2 (§12).
- **Implementation plans:** [docs/superpowers/plans/](docs/superpowers/plans/) — in order:
  1. `2026-09-17-core-scan-engine.md`
  2. `2026-09-17-worker-pool-perf.md`
  3. `2026-09-17-rules-cleaner-core.md`
  4. `2026-09-17-rule-inventory-display.md`
  5. `2026-09-17-project-classification.md`
  6. `2026-09-20-snapshot-persistence.md`
  7. `2026-09-21-app-shell-engine-host.md`
  8. `2026-09-21-results-view.md`
  9. `2026-09-22-cleaner-quick-clean-dev-cleanup.md`
  10. `2026-09-23-scan-performance.md`
  11. `2026-09-28-system-info.md`
  12. `2026-09-28-production-release.md`
- **Engine source:** [core/src/](core/src/) — `model/`, `scanner/`, `scan/`, `rules/`, `cleaner/`, `projects/`, `display/`, `snapshot/`, `startup/`, `uninstall/`, `system/`; tests in [core/test/](core/test/).
- **Electron app source:** [app/](app/) — `src/main/`, `src/preload/`, `renderer/`, `scripts/`, `electron-builder.yml`; dev commands are in the [root README](README.md).
- **Interface rebuild:** [docs/FRONTEND-PLAN.md](docs/FRONTEND-PLAN.md) — decisions, trust principles, design system, screens, budgets, and a log of every phase; [app/DESIGN.md](app/DESIGN.md) and [app/PRODUCT.md](app/PRODUCT.md).
- **Release design and plan:** [docs/superpowers/specs/2026-09-28-production-release-design.md](docs/superpowers/specs/2026-09-28-production-release-design.md) and [docs/superpowers/plans/2026-09-28-production-release.md](docs/superpowers/plans/2026-09-28-production-release.md).
- **Run it:**
  ```bash
  npm install
  npm run test        # all workspaces
  npm run typecheck
  npm run lint
  npm run dev -w app  # launch the Electron app
  npm run dist:app    # build the Windows installer
  ```
