# Dust — Project Brief

Entry point for a new agent or developer. Read this file first; it explains what the project is, why it exists, how it is built, and where to go next. The full design lives in the spec linked at the bottom.

## What Dust is

Dust is a Windows-first desktop disk-cleanup tool for developers. It scans a drive, shows where the space went, and removes the junk that accumulates during development work — `node_modules` in abandoned projects, the npm download cache, temp files, and browser/app caches — while explaining why each item is safe (or not) to delete. It is built as an Electron app (TypeScript, React, Tailwind) with a pure-TypeScript engine in `core/` that has no Electron dependency. It exists because developers know their disks are full of junk, but existing cleanup tools either take too many steps to use or give no trustworthy answer to "is this safe to delete?"

## The problem it solves

**Friction.** Cleaning a disk takes too many steps: find the folders, check sizes, decide what is safe, delete manually. Because the payoff is not immediate, people procrastinate and the disk stays full. Dust cuts the path to a few explicit steps: Analyze → see what is reclaimable → confirm a plan → execute.

**Fear.** Users are afraid of deleting something important because no tool tells them what is safe. Dust addresses this with a per-match safety classification (green/yellow/red), a "why this grade" explanation on every row, a recovery statement on every plan item, and a hard rule that nothing is deleted without a preview and explicit confirmation.

## What the app does today (MVP)

- **Dashboard** — disk cards for fixed volumes with usage bars, an `external` label for removable/network volumes, last-analyzed/last-cleaned info, and the two global actions: Analyze and Quick Clean.
- **Analyze** — a deep scan of a chosen drive with live progress (files scanned, bytes seen, current paths, elapsed, error count), filling in results as folders complete. Cancellable at any moment; partial results are kept and labeled.
- **Tree Table with Safety column** — the main results surface: sortable Name / Size / Allocated / Files-Folders / % / Safety / Last modified / Action columns, in-place expansion to arbitrary depth, virtualized for large trees, double-click to open Explorer. Safety cells show an action grade with evidence for rule-matched rows, an informational display grade with a "why" for everything else.
- **Category Strip** — reclaimable totals per category (Temp, Recycle Bin, npm cache, App caches, npm projects); clicking a category filters the tree.
- **Dev Cleanup** — npm project discovery from Analyze data: groups Dead / Occasional / Active / Orphaned / Pinned, restorability badges, bulk "Select all Dead + green", confirmation screen with rebuild commands, per-project progress, and a session-only "Recently cleaned" group holding copyable restore commands.
- **Quick Clean** — targeted scan when no Analyze data exists, otherwise built from the freshest Analyze results without re-scanning: per-category plan with recovery notes, explicit confirmation, execute, and a freed-bytes summary. Never touches `node_modules`. `C:\Windows\Temp` items offer "Relaunch as Administrator".
- **Snapshot persistence** — scan results persisted to `userData/snapshot.json`; relaunch shows the Dashboard instantly, a depth-4 folder map backs the Results view, staleness/`rulesVersion` banners prompt a rescan, and `cleanedAt` updates after cleanup.
- **Scan Lock** — one global lock; Analyze and Quick Clean are mutually exclusive. A conflicting attempt shows "A scan is already running" with [Cancel it] / [Wait].

## What the app does NOT do yet (Phase 2)

- Docker image cleanup
- Installed-apps manager (Deep Uninstall) — planned next
- Visual treemap (the Tree Table is the MVP navigation surface)
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
  system/                    volume enumeration, drive types, cluster size

app/                         Electron app
  src/main/                  window, typed IPC, engine host, worker-pool host,
                             scan lock, analyze/results/cleanup/dev-cleanup hosts
  src/preload/               typed bridge exposed as window.dust
  renderer/                  React 19 + Tailwind 4 (Vite), TanStack Table + react-virtual
  test/                      vitest (node + jsdom projects), manual smoke checklist in README
```

Key architectural facts:

- Electron main owns scan sessions and the cleaner; the renderer holds no engine state and touches no filesystem. It reaches the engine only through `window.dust`.
- The scanner uses 4–8 `worker_threads` with synchronous fs calls and directory-level work-stealing; reparse points (symlinks/junctions) are detected and never followed.
- `core/` is host-agnostic: moving it into an Electron `utilityProcess` later requires no core changes.
- Renderer security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

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
- **Safety classification with a hard red list.** Unknown paths default to yellow; system-critical roots (`C:\Windows`, Program Files, ProgramData, profile and volume roots) are red, read-only, hidden behind a "Show danger" toggle, and never actionable.
- **Plan tokens.** `Cleaner.preview` mints a single-use, in-memory token; `Cleaner.execute(token)` is the only deletion path. Forged or expired tokens are refused, and red/unknown paths never enter a plan.
- **Cache registry pattern.** Browser and app caches are self-contained rule files declared via path resolvers; adding one requires no engine changes.
- **Action grade ≠ display grade.** Only whitelisted rule matches can enable cleanup, with their evidence shown; display grades are purely informational and the cleaner never consults them.
- **Fixed accent color.** Accent color is a fixed product decision (Pine Teal). Not user-configurable. The single accent lives in one token (`--color-accent`, `#0f6e6e`); no hardcoded hex appears outside `styles.css`, and there is no theme or palette picker.

## Current state

Plans 1–10 complete: the engine, snapshots, app shell, results surface, cleanup flows, and the scan-performance pass are merged to `master`, and the renderer is rebuilt on the light-first design system. Deep Uninstall is planned next.

Repository note: everything is merged to `master`; historical `plan-*` and `redesign/light-workbench` branches remain on the remote only.

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
- **Engine source:** [core/src/](core/src/) — `model/`, `scanner/`, `scan/`, `rules/`, `cleaner/`, `projects/`, `display/`, `snapshot/`, `system/`; tests in [core/test/](core/test/).
- **Electron app source:** [app/](app/) — `src/main/`, `src/preload/`, `renderer/`; dev commands are in the [root README](README.md).
- **Run it:**
  ```bash
  npm install
  npm run test        # all workspaces
  npm run typecheck
  npm run dev -w app  # launch the Electron app
  ```
