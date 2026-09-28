# Dust

**Find what is safe to delete.**

Dust is a Windows-first disk-cleanup tool for developers. It scans a drive, shows where the space went, and removes the junk development work accumulates — `node_modules` in abandoned projects, the npm download cache, temp files, and browser/app caches — while explaining why each item is safe (or not) to delete.

Every deletion is previewed and explicitly confirmed. Dust never deletes anything on its own.

> [!NOTE]
> Dust is Windows-only. Docker cleanup, a quarantine buffer, and cross-platform builds are planned but not shipped yet — see [Roadmap](#roadmap).

**Contents:** [Why Dust](#why-dust) · [Install](#install) · [Quick start](#quick-start) · [Features](#features) · [How safety works](#how-safety-works) · [Documentation](#documentation) · [Reference](#reference) · [Roadmap](#roadmap)

## Install

Download `Dust-Setup-1.0.0.exe` from [Releases](https://github.com/Mohaned178/Dust/releases) and run it. The installer is per-user, asks where to install, and creates Start Menu and desktop shortcuts.

> [!IMPORTANT]
> The 1.0.0 build is **not code-signed**, so Windows SmartScreen may show "Windows protected your PC" on first run. Choose **More info → Run anyway**. Signed builds are on the [Roadmap](#roadmap).

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

### Startup Manager

One On/Off switch per Windows startup entry, grouped into **Enabled** and **Disabled** (alphabetical, with live section counts). Toggling off moves the entry to a Dust backup — the `Run-Dust-Disabled` registry key for Run entries, `%APPDATA%\Dust\startup-disabled` for Startup-folder shortcuts — and offers a 5-second **Undo**; toggling on moves it back to its original location. Dust never deletes an entry.

Entries are read from `HKCU`/`HKLM` Run (including `WOW6432Node`) and the user/common Startup folders, with icons and publishers resolved from the executable. Entries disabled by Windows itself appear read-only with a **Windows** tag; protected system entries (Windows Security, GPU/audio drivers, `System32` commands) show a lock and cannot be toggled. Machine-wide entries ask for administrator rights and relaunch through the existing elevation flow, carrying a `--dust-startup-toggle=<id>` argument that is validated against the current list before any write.

### Deep Uninstall

Removes an installed app with its own uninstaller, then clears what it leaves behind. The app list comes from the Windows uninstall registry (per-user and machine-wide); pick an app and Dust builds a plan showing the uninstaller it will run, leftover folders (graded **safe** or **review**, with the reason for each grade), registry keys, and startup entries, plus what is kept and why.

Only a whitelisted set of locations can be targeted: an app's registered install directory, its `%APPDATA%`/`%LOCALAPPDATA%`/`%ProgramData%` folders, and its registry keys. Paths are validated again at execution time against the protected-path policy, user-data items always go through the Recycle Bin, and registry keys are exported to `%APPDATA%\Dust\uninstall-backups` before deletion so every removal has a `reg import` restore command. Deletions are gated on a write-ahead journal.

Machine-wide removals ask for administrator rights and relaunch elevated; the elevated instance rebuilds the plan from the app id and waits for your confirmation before touching anything.

### System Info

A read-only view of the machine: OS name, version, build, and architecture; hostname and uptime; CPU model with physical cores and logical threads; every reported display adapter with its driver version and VRAM when Windows reports it; and motherboard/BIOS when Windows reports them. CPU and memory usage update live while the page is open; everything else is captured once and refreshed on demand. **Copy system info** produces a plain-text block for bug reports with no serial numbers, MAC addresses, or IP addresses.

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

| Command                 | What it does                                              |
| ----------------------- | --------------------------------------------------------- |
| `npm run dev:app`       | Launch the Electron app with a hot-reloading renderer     |
| `npm run build:app`     | Production build (renderer + main/preload/worker bundles) |
| `npm start -w app`      | Run the built app                                         |
| `npm test`              | Vitest across both workspaces                             |
| `npm test -w core`      | Engine tests (plain Node)                                 |
| `npm test -w app`       | Host and renderer tests (Node + jsdom)                    |
| `npm run typecheck`     | TypeScript checks across both workspaces                  |
| `npm run lint`          | ESLint across the repo                                    |
| `npm run format`        | Prettier write                                            |
| `npm run dist:app`      | Build the Windows installer into `app/release/`           |
| `npm run bench -w core` | Scan throughput benchmarks                                |

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
  src/system/                Volume enumeration, drive types, cluster size, system info

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
- **Renderer security.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a strict production CSP, denied window-open/navigation outside the app, denied permission requests, and a top-level error boundary.

### Testing

```bash
npm run typecheck
npm test
```

`core` runs its suite in Node; `app` runs host tests in Node and renderer tests in jsdom. The throughput test is gated and skipped unless enabled:

```bash
DUST_PERF=1 npm test -w core
```

### Releasing

Releases are tag-driven and produce a draft GitHub Release:

1. Bump `version` in `app/package.json` and add a `CHANGELOG.md` entry; merge to `master`.
2. Tag and push: `git tag v1.0.0 && git push origin v1.0.0`.
3. The **Release** workflow (`.github/workflows/release.yml`) runs typecheck, tests, builds the NSIS installer, writes `sha256sums.txt`, and opens a draft release with both files attached.
4. Review the draft, then publish it. `Dust-Setup-<version>.exe` is the asset users download.

`npm run dist:app` reproduces the installer locally. Signing is unset: electron-builder's `win.certificateFile`/`certificatePassword` (or Azure Trusted Signing) are documented as a stub in `app/electron-builder.yml`.

### Startup Manager smoke checklist

1. `npm run dev:app`, open **Startup Manager** from the sidebar: enabled and disabled entries list alphabetically with the total in the header and live counts on each section.
2. Toggle off an ordinary entry (for example Discord): the row moves to **Disabled**, a "Discord disabled · Undo" toast appears for 5 seconds, and the entry's value now exists under `...\CurrentVersion\Run-Dust-Disabled` with the original `...\Run` value gone.
3. Click **Undo** within 5 seconds: the entry returns to **Enabled** and the original registry value is restored.
4. Toggle off a Startup-folder shortcut: the `.lnk` moves to `%APPDATA%\Dust\startup-disabled` (with a sidecar JSON) instead of being deleted; toggling on moves it back.
5. Protected rows (Windows Security, GPU drivers) show a lock and a disabled switch with the tooltip "Protected by Dust. This entry cannot be disabled." Windows-disabled rows show the **Windows** tag and cannot be toggled.
6. Toggle a machine-wide entry (HKLM Run or the common Startup folder): the **Administrator required** dialog appears; **Relaunch as Administrator** reopens Dust elevated, performs the toggle, opens Startup Manager, and shows the undo toast.
7. After an elevated relaunch with a stale or forged id (`--dust-startup-toggle=deadbeefdeadbeef`), no write happens and Startup Manager opens with no toast.

### System Info smoke checklist

1. `npm run dev:app`, open **System Info**: the page shows a captured timestamp, OS/build/architecture, hostname, uptime, CPU model with cores and threads, every reported display adapter with its driver version and VRAM (an asterisk marks a value Windows may under-report), and motherboard/BIOS when the machine reports them.
2. CPU and memory figures update every ~1.5 seconds while the page is open; leaving the page stops the polling.
3. **Refresh** re-queries the machine and updates the captured timestamp.
4. **Copy system info** copies the formatted block and shows the "System info copied." toast; the block contains no serial numbers, MAC addresses, or IP addresses.
5. On a machine or VM with no discrete GPU, the page renders without a Graphics section (or with the adapters Windows reports) and never shows an error; on any machine, no administrator prompt appears.

### Development flags

Environment variables used by development and benchmark tooling — not needed for normal use.

| Flag                       | Effect                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| `DUST_PERF=1`              | Enables the gated 200k-file throughput test in `core`                     |
| `DUST_SYSTEM_INFO_SMOKE=1` | Runs the real Windows system-info query smoke test in `core`              |
| `DUST_TIMING=1`            | Logs IPC timing to `userData/perf.log`                                    |
| `DUST_INSTRUMENT=1`        | Collects host-process timing samples                                      |
| `DUST_BENCH_ROOT=<path>`   | Runs the benchmark harness against a drive and writes `bench-report.json` |
| `DUST_BENCH_MODE=browse`   | Benchmarks a browse scan instead of an analyze                            |
| `DUST_BENCH_REPORT=<path>` | Overrides the bench report output path                                    |
| `DUST_AUTO=1`              | Runs a scripted navigation pass (UI timing)                               |
| `DUST_DEV_SERVER_URL`      | Points the main process at an existing Vite server                        |

### Troubleshooting

- **The window opens but main-process changes don't appear.** Restart `npm run dev:app`; main bundles are not hot-reloaded.
- **"Snapshot unreadable" banner.** `%APPDATA%\Dust\snapshot.json` is corrupt. Run Analyze to rebuild it; nothing else is lost.
- **Some Temp items can't be cleaned.** `C:\Windows\Temp` needs elevation; use **Relaunch as Administrator** in the plan or Settings.
- **Port 5173 is taken.** Vite runs with `strictPort`, so stop the other process or point the app at a different server with `DUST_DEV_SERVER_URL`.

## Roadmap

Planned after 1.0, in rough order:

- Code signing and auto-update
- Docker image cleanup
- Real pnpm/bun support (global store and symlink math); Yarn Berry
- Quarantine (recovery buffer for deletions)
- Cross-platform builds, background scheduled scans, and a visual treemap
