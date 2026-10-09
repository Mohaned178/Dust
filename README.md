<div align="center">
  <img src="app/resources/icon.png" width="96" alt="Dust icon">

# Dust

**Find what is safe to delete.**

A calm, open-source PC cleaner for Windows. It shows where the space went, explains each item, and lets you choose.

[![Latest release](https://img.shields.io/github/v/release/Mohaned178/Dust?label=release&style=flat-square)](https://github.com/Mohaned178/Dust/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/Mohaned178/Dust/ci.yml?label=CI&logo=github&style=flat-square)](https://github.com/Mohaned178/Dust/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Mohaned178/Dust?style=flat-square)](LICENSE)
[![Windows 10/11](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d6?logo=windows&style=flat-square)](#install)
[![Downloads](https://img.shields.io/github/downloads/Mohaned178/Dust/total?style=flat-square)](https://github.com/Mohaned178/Dust/releases)

**[Download the latest version](https://github.com/Mohaned178/Dust/releases/latest)**

</div>

Dust is a PC cleaner and manager for Windows, for everyone, with a dedicated section for developers. It scans a drive, shows where the space went, and removes what is safe to remove: temporary files, the Recycle Bin, browser and app caches, and the `node_modules` folders and package caches that development work leaves behind. Before anything is deleted, it explains what each item is, why it is safe and how it comes back.

Every deletion is previewed and confirmed by you. Dust never deletes anything on its own.

> [!NOTE]
> Dust is Windows-only. Docker cleanup, a recovery buffer for deletions, dark mode and cross-platform builds are not shipped yet. See the [Roadmap](#roadmap).

**Contents:** [What Dust does](#what-dust-does) · [Why you can trust it](#why-you-can-trust-it) · [Install](#install) · [Build from source](#build-from-source) · [How safety works](#how-safety-works) · [Documentation](#documentation) · [Reference](#reference) · [Roadmap](#roadmap)

## What Dust does

### Home

The first screen answers "how is my PC?" without a score. A headline says how much can be freed (the sum of the rows you can open; Clean up then ticks only the safe ones), with a bar of the drive split by category, **Scan again** and **Quick clean** buttons, and notices for a cancelled scan, changed rules or a depth-limited scan. Below it are the other drives and tiles for Startup, Apps, PC Health and Developer that each fill in on their own.

### Clean up

A deep, progressive scan of the system drive (files scanned, elapsed time, the current path, and what has been found so far; cancellable, with partial results kept), then a category-first list: Temporary files, Recycle Bin, Package cache and App caches. Each category opens in place into its items, each with a plain "why" line, **Keep** with Undo, and **Show in Explorer**. Only items graded safe start ticked; categories with nothing safe (the Recycle Bin) sit under "Take a look first", unticked.

**Review and clean** opens a plan that names the amount ("Delete 599 MB"), lists what comes back and how, asks for acknowledgement when something cannot be recovered, shows progress, and ends with the drive before and now. Items under `C:\Windows\Temp` offer **Relaunch as administrator**. **Quick clean** (from Home) builds the same plan for the four quick categories and never touches `node_modules`.

### Explore disk

A lazy, virtualized folder tree that copes with thousands of children per folder, a treemap of the folder you are in, search, a **Show protected items** switch, and **Show in Explorer**. It reads the saved scan, so folders deeper than the saved depth say so.

### Apps

Removes an installed app with its own uninstaller, then clears what it leaves behind. The list comes from the Windows uninstall registry (per-user and machine-wide). Pick an app and Dust builds a plan showing the uninstaller it will run, leftover folders (graded **safe** or **review**, with the reason), registry keys and startup entries, plus what is kept and why.

Only a whitelisted set of locations can be targeted: the app's registered install directory, its `%APPDATA%`, `%LOCALAPPDATA%` and `%ProgramData%` folders, and its registry keys. Paths are validated again at execution time against the protected-path policy, user-data items always go through the Recycle Bin, and registry keys are exported to `%APPDATA%\Dust\uninstall-backups` before deletion, so every removal has a `reg import` restore command. Deletions are gated on a write-ahead journal. Machine-wide removals ask for administrator rights and relaunch elevated; the elevated instance rebuilds the plan from the app id and waits for your confirmation before touching anything.

### Startup

One On/Off switch per Windows startup entry, in one list with an All, On and Off filter. Turning an entry off moves it to a Dust backup (the `Run-Dust-Disabled` registry key for Run entries, `%APPDATA%\Dust\startup-disabled` for Startup-folder shortcuts) and offers an **Undo** toast; turning it on moves it back to its original location. Dust never deletes an entry.

Entries are read from the `HKCU` and `HKLM` Run keys (including `WOW6432Node`) and the user and common Startup folders, with icons and publishers resolved from the executable. Entries disabled by Windows itself appear read-only with a **Windows** tag. Protected system entries (Windows Security, GPU and audio drivers, `System32` commands) show a lock and cannot be toggled. Machine-wide entries ask for administrator rights and relaunch through the existing elevation flow, carrying a `--dust-startup-toggle=<id>` argument that is validated against the current list before any write.

### PC Health

How this PC is doing right now and what it is made of: processor and memory rings read every two seconds while the page is open, storage per internal drive, and spec cards (This PC, Windows, Processor, Memory, Graphics, Firmware). **Copy specs** produces a plain-text block for bug reports with no serial numbers, MAC addresses or IP addresses.

### Developer

`node_modules` folders grouped by when each project was last used (Not used for 6+ months, Used now and then, Used recently, Loose node_modules, Kept), with a "Can be rebuilt" or "Check first" mark, **Keep** with Undo, and **Select all safe and unused**. The same Clean dialog shows each project's rebuild command, with a copy button, before anything is deleted. A Toolchain caches section covers the package cache and links to Clean up. `node_modules` folders that belong to installed apps (under Program Files, ProgramData, AppData, editor extension folders or a packaged Electron app) are listed but never offered, because deleting them would break the app.

### Settings

About (version, license), a privacy statement, administrator relaunch, and updates. The look is a fixed product decision (a light Windows 11 style with Windows blue) and is not configurable. Dark mode is planned.

## Why you can trust it

- **It explains before it acts.** Every item has a plain reason and a statement of how it comes back. Every plan names the amount before you confirm.
- **Only safe items are preselected.** Anything you untick is left alone, and review items start unticked.
- **Exact sizes and paths.** Every headline total is the sum of rows you can open.
- **No scores, no alarms.** Dust shows no health score, no "issues found" count and no countdowns, and it has no registry cleaner.
- **Nothing deletes on its own.** There is no background or automatic deletion. Every deletion needs a preview and your confirmation.
- **It runs entirely on this PC.** There is no account and no telemetry. The only place Dust connects to is GitHub, to look for new versions and to download one when there is one.
- **It is open source.** The code is MIT-licensed and in this repository.

## Install

**System requirements:** Windows 10 or 11, 64-bit (x64).

1. Download `Dust-Setup-<version>.exe` from [Releases](https://github.com/Mohaned178/Dust/releases/latest).
2. Run it. The installer is per-user, asks where to install, and creates Start Menu and desktop shortcuts.

> [!IMPORTANT]
> The installer is **not code-signed**, so Windows SmartScreen may show "Windows protected your PC". Choose **More info**, then **Run anyway**. Code signing is on the [Roadmap](#roadmap).

To verify the download, compare its SHA-256 hash with the matching line in `sha256sums.txt` from the same release:

```powershell
Get-FileHash .\Dust-Setup-<version>.exe -Algorithm SHA256
```

Installed builds check GitHub Releases for updates and say when one is ready.

## Build from source

Requirements: Windows 10 or 11, and Node.js `^20.19.0 || >=22.12.0` with npm.

```bash
git clone https://github.com/Mohaned178/Dust.git
cd Dust
npm install
npm run dev:app
```

`dev:app` bundles the Electron main, preload and worker processes with esbuild, starts Vite on `http://localhost:5173`, and launches Electron against it. Use an administrator terminal when you want to exercise the elevated flows (the [smoke checklist](#new-interface-smoke-checklist) assumes one).

> [!WARNING]
> Main-process code (`app/src/main/`) is not hot-reloaded. Restart `npm run dev:app` after changing it. The renderer hot-reloads normally.

Build and run the production app, or build the installer into `app/release/`:

```bash
npm run build:app
npm start -w app
npm run dist:app
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## How safety works

- **Nothing deletes without a plan.** `Cleaner.preview` mints a single-use, in-memory plan token; `Cleaner.execute(token)` is the only deletion path. Forged or expired tokens are refused.
- **Action grade vs display grade.** Only whitelisted rule matches can enable cleanup, and their evidence is shown. Every visible row still gets an informational display grade with a "why".
- **A hard protected list.** System-critical roots (`C:\Windows`, Program Files, ProgramData, profile and volume roots) are read-only, hidden until "Show protected items" is on, and never actionable. Unknown paths are never actionable either.
- **Per-category recovery.** Permanent delete only when a rule proves the asset is regenerable (the exact restore command is shown) or worthless. The Recycle Bin is the recovery path only for unverifiable content, not a blanket default, because recycling frees no bytes for GB-scale artifacts.
- **One acknowledgement.** The plan's confirm stays disabled until the irreversibility acknowledgement is ticked.

## Documentation

- [PROJECT_BRIEF.md](PROJECT_BRIEF.md): what Dust is, the locked decisions, and the design principles.
- [app/PRODUCT.md](app/PRODUCT.md): users, positioning, brand commitments, and constraints.
- [app/DESIGN.md](app/DESIGN.md): the design system, with tokens, components, and named rules.
- [docs/FRONTEND-PLAN.md](docs/FRONTEND-PLAN.md): the rebuilt interface, with decisions, budgets and measurements.
- [docs/superpowers/specs/2026-09-17-dust-mvp-design.md](docs/superpowers/specs/2026-09-17-dust-mvp-design.md): the full MVP design spec.
- [docs/superpowers/plans/](docs/superpowers/plans/): the ordered implementation plans.
- [CHANGELOG.md](CHANGELOG.md): what changed in each release.

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
  renderer/                  React 19 + Tailwind 4 (Vite), Zustand, Radix Primitives, Fluent icons, react-virtual, d3-hierarchy
  test/                      Vitest host and jsdom renderer suites

docs/superpowers/            Design spec, implementation plans, perf measurements
```

### Architecture

- **Electron main owns the engine.** Scan sessions, the cleaner, and persistence live in the main process. The renderer holds no engine state and never touches the filesystem; it reaches the engine only through the typed `window.dust` bridge.
- **A worker pool does the walking.** The scanner runs synchronous fs calls across 4–8 `worker_threads` with directory-level work-stealing. Reparse points (symlinks/junctions) are detected and never followed.
- **Snapshots make relaunch instant.** The last system-drive scan is persisted to `%APPDATA%\Dust\snapshot.json`; Home reads it immediately and Clean up and Explore disk rebuild from it. Staleness and `rulesVersion` mismatches prompt a rescan.
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

1. Bump `version` in `app/package.json` and move the `CHANGELOG.md` entries under a new `## [x.y.z]` heading; merge to `master`.
2. Tag and push: `git tag v2.0.0 && git push origin v2.0.0`.
3. The **Release** workflow (`.github/workflows/release.yml`) first checks that the tag matches the `app/package.json` version. It then runs typecheck, lint and tests, builds the NSIS installer, writes `sha256sums.txt`, and opens a draft release. The notes are the matching `CHANGELOG.md` section plus an install note. The installer, `latest.yml`, the blockmap and `sha256sums.txt` are attached.
4. Check the draft, then publish it. `Dust-Setup-<version>.exe` is the asset users download, and installed apps read `latest.yml` from the published release.

`npm run dist:app` reproduces the installer locally. Signing is unset: electron-builder's `win.certificateFile`/`certificatePassword` (or Azure Trusted Signing) are documented as a stub in `app/electron-builder.yml`.

### New interface smoke checklist

<details>
<summary>Show the 13-step smoke checklist</summary>

Run from an administrator terminal with `npm run dev:app`. This covers every screen of the interface in `app/renderer/` (see `docs/FRONTEND-PLAN.md`). Steps marked **(changes your PC)** delete or change real things; use a machine you can afford to change.

1. **Home.** The window opens light, with no dark flash, and the first screen shows within half a second. The greeting, the drive card and the four tiles (Startup, Apps, PC Health, Developer) fill in on their own. Nothing says "score", "risk" or "issues".
2. **Scan.** Choose **Scan again**: the progress bar, file count, elapsed time and a path shortened in the middle update. **Cancel** stops it, and the results open with "Scan cancelled. Showing what was found."
3. **Clean up.** Safe items start ticked, review items (the Recycle Bin) sit under "Take a look first" unticked. Open a category, **Keep** an item, then **Undo** in the toast. The footer total equals the plan total in the next step.
4. **Clean dialog.** **Review and clean** opens a plan with Cancel focused and a confirm button that names the amount ("Delete 599 MB"). Cancel deletes nothing. **(changes your PC)** Confirm: progress counts up, the summary shows the drive before and now, and the list reads again.
5. **Quick clean.** From Home, **Quick clean** builds a plan; closing it while it builds stops the scan.
6. **Explore disk.** From Clean up, open **Explore disk**: open folders in place, scroll a folder with thousands of children, search for a folder name (one request after you stop typing), turn on **Show protected items**, switch to **Map** and open a folder, then use the breadcrumb to go back.
7. **Apps.** Icons and sizes appear without the list jumping; sort by Size shows "Sizes updated. Sort again" when more sizes arrive. **(changes your PC)** Uninstall a test app: its own uninstaller runs, then the leftovers are listed unticked where they may hold your data, and the done line only says the app is removed if it is.
8. **Startup.** The summary reads "N apps start with Windows · M on". **(changes your PC)** Turn an entry off: the switch moves at once and a toast offers Undo. A protected row shows a lock and its reason. A machine-wide entry asks for administrator rights first.
9. **PC Health.** The two rings update about every 2 seconds, and stop updating while another page is open. **Copy specs** puts plain text on the clipboard.
10. **Developer.** Groups are named in plain words and the total equals the sum of the rows. **Review and clean** shows each rebuild command with a copy button before anything is deleted. Check that no folder inside an installed app (for example VS Code or Docker) is offered.
11. **Settings.** The version, license and privacy statement are shown, **Check for updates** reports a result, and **Relaunch as administrator** restarts Dust elevated.
12. **Keyboard only.** From each page, Tab reaches every control in a sensible order, each shows a visible focus ring, Escape closes dialogs, and arrow keys move through the Explore tree and the Developer list.
13. **Reduced motion.** With Windows animation effects off, nothing slides or fades.

</details>

### Development flags

Environment variables used by development and benchmark tooling. They are not needed for normal use.

| Flag                       | Effect                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| `DUST_PERF=1`              | Enables the gated 200k-file throughput test in `core`                     |
| `DUST_SYSTEM_INFO_SMOKE=1` | Runs the real Windows system-info query smoke test in `core`              |
| `DUST_TIMING=1`            | Logs IPC timing to `userData/perf.log`                                    |
| `DUST_INSTRUMENT=1`        | Collects host-process timing samples                                      |
| `DUST_BENCH_ROOT=<path>`   | Runs the benchmark harness against a drive and writes `bench-report.json` |
| `DUST_BENCH_REPORT=<path>` | Overrides the bench report output path                                    |
| `DUST_DEV_SERVER_URL`      | Points the main process at an existing Vite server                        |

### Troubleshooting

- **The window opens but main-process changes don't appear.** Restart `npm run dev:app`; main bundles are not hot-reloaded.
- **"Snapshot unreadable" banner.** `%APPDATA%\Dust\snapshot.json` is corrupt. Run Analyze to rebuild it; nothing else is lost.
- **Some Temp items can't be cleaned.** `C:\Windows\Temp` needs elevation; use **Relaunch as administrator** in the plan or Settings.
- **Port 5173 is taken.** Vite runs with `strictPort`, so stop the other process or point the app at a different server with `DUST_DEV_SERVER_URL`.

## Roadmap

Planned, in rough order:

- Code signing
- Docker image cleanup
- Real pnpm and bun support (global store and symlink math); Yarn Berry
- A recovery buffer for deletions, with Undo
- Dark mode
- Cross-platform builds and background scheduled scans

## License

[MIT](LICENSE)
