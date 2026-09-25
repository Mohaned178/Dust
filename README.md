# Dust

**Find what is safe to delete.**

Dust is a Windows-first disk-cleanup tool for developers. It scans a drive, shows where the space went, and removes the junk development work accumulates — `node_modules` in abandoned projects, the npm download cache, temp files, and browser/app caches — while explaining why each item is safe (or not) to delete.

Every deletion is previewed and explicitly confirmed. Dust never deletes anything on its own.

> [!NOTE]
> Dust is an MVP and Windows-only. Docker cleanup, an installed-apps manager, a quarantine buffer, and cross-platform builds are planned but not shipped yet — see [Roadmap](#roadmap).

**Contents:** [Why Dust](#why-dust) · [Quick start](#quick-start) · [Features](#features) · [How safety works](#how-safety-works) · [Documentation](#documentation) · [Reference](#reference) · [Roadmap](#roadmap)

## Why Dust

- **Friction.** Cleaning a disk takes too many steps — find the folders, check sizes, decide what is safe, delete by hand. Dust cuts it to a few explicit steps: Analyze → see what is reclaimable → confirm a plan → execute.
- **Fear.** No tool gives a trustworthy answer to "is this safe to delete?" Dust answers per item, with a grade, the evidence behind it, and what comes back if it is removed.
- **The developer wedge.** npm cleanup — dead `node_modules` plus the npm download cache — is the reason to install Dust. Temp-file cleaning is table stakes around it.

## Quick start

Requirements:

- Windows 10 or 11
- Node.js `^20.19.0 || >=22.12.0` and npm

```bash
npm install
npm run dev:app
```

`dev:app` bundles the Electron main/preload/worker processes with esbuild, starts Vite on `http://localhost:5173`, and launches Electron against it.

> [!WARNING]
> Main-process code (`app/src/main/`) is not hot-reloaded. Restart `npm run dev:app` after changing it. The renderer hot-reloads normally.

Build and run the production app:

```bash
npm run build:app
npm start -w app
```

## Features

### Dashboard

The system drive's reclaimable total is the dominant object, with a used/free capacity bar and evidence below it. Category cards (Temp, Recycle Bin, npm cache, App caches) open Results filtered to that category and show their share of the total on hover; a developer-cleanup row hands off to Dev Cleanup. Session-dismissible notices cover a cancelled scan, stale rules (with one-click **Rescan**), and an unreadable snapshot.

- Keyboard: `A` analyze · `R` results (once analyzed) · `Q` Quick Clean · `D` Dev Cleanup

### Analyze

A deep, progressive scan of a chosen drive: files scanned, bytes seen, current path, elapsed time, and error count update live, with results streaming in as folders complete. Cancellable at any moment — partial results are kept — and persisted so the next launch opens instantly.

### Results

One mono reclaimable figure over the evidence. Filter by category chip or search, then work the size-ordered contributor list: each row unfolds to show **why this grade**, its category, the rule id, and its recovery path (with a copyable restore command when the asset is regenerable). Select rows and use the sticky **Preview & clean** bar; the full folder tree lives behind "Browse everything", with protected rows hidden behind a **Show danger** gate.

### Quick Clean

The fast path for the four quick categories, never touching `node_modules`. With no Analyze data it runs a targeted scan (progress and Cancel included); otherwise it builds from the freshest results without re-scanning. Per-category totals and recovery notes sit behind one acknowledgement, and the summary reports freed bytes, what remains reclaimable, and any skipped or failed items. Items under `C:\Windows\Temp` offer **Relaunch as Administrator**.

### Dev Cleanup

npm project discovery from Analyze data, grouped **Dead / Occasional / Active / Orphaned / Pinned**. Bulk-select the safe ones, then confirm against a plan that carries each project's rebuild command. Removed projects keep copyable restore commands in a session-only "Recently cleaned" group. A manual Keep pin always wins.

### Browse-only volumes

Non-system volumes show size and structure without safety grades or cleanup rules. The only action is a guarded permanent delete with a simple confirmation; browse results are session-only and never touch the system-drive snapshot.

### Settings

Light theme, administrator relaunch, and about. The accent color is a fixed product decision (Pine Teal) and is not configurable.

## How safety works

- **Nothing deletes without a plan.** `Cleaner.preview` mints a single-use, in-memory plan token; `Cleaner.execute(token)` is the only deletion path. Forged or expired tokens are refused.
- **Action grade vs display grade.** Only whitelisted rule matches can enable cleanup, and their evidence is shown. Every visible row still gets an informational display grade with a "why".
- **A hard protected list.** System-critical roots (`C:\Windows`, Program Files, ProgramData, profile and volume roots) are red, read-only, hidden behind "Show danger", and never actionable. Unknown paths are never actionable either.
- **Per-category recovery.** Permanent delete only when a rule proves the asset is regenerable (the exact restore command is shown) or worthless. The Recycle Bin is the recovery path only for unverifiable content — not a blanket default, because recycling frees no bytes for GB-scale artifacts.
- **One acknowledgement.** The plan's confirm stays disabled until the irreversibility acknowledgement is ticked.

## Documentation

- [PROJECT_BRIEF.md](PROJECT_BRIEF.md) — what Dust is, the locked decisions, and the design principles.
- [app/PRODUCT.md](app/PRODUCT.md) — users, positioning, brand commitments, and constraints.
- [app/DESIGN.md](app/DESIGN.md) — the design system: tokens, components, and named rules.
- [docs/superpowers/specs/2026-09-17-dust-mvp-design.md](docs/superpowers/specs/2026-09-17-dust-mvp-design.md) — the full MVP design spec.
- [docs/superpowers/plans/](docs/superpowers/plans/) — the ordered implementation plans.

## Reference

Look-up material for day-to-day development.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev:app` | Launch the Electron app with a hot-reloading renderer |
| `npm run build:app` | Production build (renderer + main/preload/worker bundles) |
| `npm start -w app` | Run the built app |
| `npm test` | Vitest across both workspaces |
| `npm test -w core` | Engine tests (plain Node) |
| `npm test -w app` | Host and renderer tests (Node + jsdom) |
| `npm run typecheck` | TypeScript checks across both workspaces |
| `npm run bench -w core` | Scan throughput benchmarks |

### Project structure

```
core/                        Pure-TypeScript engine — no Electron imports, runs under Node
  src/model/                 Types and AggregateTree (aggregate/merge/path totals)
  src/scanner/               Enumerator seam, scanTree, ScanSession
  src/scan/                  Worker pool: coordinator, worker runtime, protocol, limits
  src/rules/                 Rule types, validation, path resolvers, cache registry
  src/cleaner/               Plan builder, protected-path guard, plan tokens, executor
  src/projects/              npm project discovery and classification
  src/display/               Display grades (safe / review / protected) with reasons
  src/snapshot/              Snapshot schema, build, store, post-cleanup prune
  src/system/                Volume enumeration, drive types, cluster size

app/                         Electron app
  src/main/                  Window, typed IPC, engine host, scan lock, feature hosts
  src/preload/               Typed bridge exposed as window.dust
  src/shared/                IPC contracts and category metadata shared with the renderer
  renderer/                  React 19 + Tailwind 4 (Vite), TanStack Table + react-virtual
  test/                      Vitest host and jsdom renderer suites

docs/superpowers/            Design spec, implementation plans, perf measurements
```

### Architecture

- **Electron main owns the engine.** Scan sessions, the cleaner, and persistence live in the main process. The renderer holds no engine state and never touches the filesystem; it reaches the engine only through the typed `window.dust` bridge.
- **A worker pool does the walking.** The scanner runs synchronous fs calls across 4–8 `worker_threads` with directory-level work-stealing. Reparse points (symlinks/junctions) are detected and never followed.
- **Snapshots make relaunch instant.** The last system-drive scan is persisted to `%APPDATA%\Dust\snapshot.json`; the Dashboard reads it immediately and the Results tree rebuilds from it. Staleness and `rulesVersion` mismatches prompt a rescan.
- **One global scan lock.** Analyze and Quick Clean are mutually exclusive; a conflicting attempt offers "Wait" or "Cancel it".
- **The engine is host-agnostic.** `core/` has zero Electron imports and runs under vitest in plain Node, so it can move into a utility process later without changes.
- **Renderer security.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

### Testing

```bash
npm run typecheck
npm test
```

`core` runs its suite in Node; `app` runs host tests in Node and renderer tests in jsdom. The throughput test is gated and skipped unless enabled:

```bash
DUST_PERF=1 npm test -w core
```

### Development flags

Environment variables used by development and benchmark tooling — not needed for normal use.

| Flag | Effect |
| --- | --- |
| `DUST_PERF=1` | Enables the gated 200k-file throughput test in `core` |
| `DUST_TIMING=1` | Logs IPC timing to `userData/perf.log` |
| `DUST_INSTRUMENT=1` | Collects host-process timing samples |
| `DUST_BENCH_ROOT=<path>` | Runs the benchmark harness against a drive and writes `bench-report.json` |
| `DUST_BENCH_MODE=browse` | Benchmarks a browse scan instead of an analyze |
| `DUST_BENCH_REPORT=<path>` | Overrides the bench report output path |
| `DUST_AUTO=1` | Runs a scripted navigation pass (UI timing) |
| `DUST_DEV_SERVER_URL` | Points the main process at an existing Vite server |

### Troubleshooting

- **The window opens but main-process changes don't appear.** Restart `npm run dev:app`; main bundles are not hot-reloaded.
- **"Snapshot unreadable" banner.** `%APPDATA%\Dust\snapshot.json` is corrupt. Run Analyze to rebuild it; nothing else is lost.
- **Some Temp items can't be cleaned.** `C:\Windows\Temp` needs elevation; use **Relaunch as Administrator** in the plan or Settings.
- **Port 5173 is taken.** Vite runs with `strictPort`, so stop the other process or point the app at a different server with `DUST_DEV_SERVER_URL`.

## Roadmap

Planned after the MVP, in rough order:

- Deep Uninstall — an installed-apps manager
- Docker image cleanup
- Real pnpm/bun support (global store and symlink math); Yarn Berry
- Quarantine (recovery buffer for deletions)
- Cross-platform builds, background scheduled scans, and a visual treemap
