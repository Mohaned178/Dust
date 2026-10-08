# Enhancement plan: speed, results, dev cleanup, tools, home

Handoff file for the next round of work. Read this first, then `git log -3` and `git status`.
Written 2026-10-09 on branch `feat/ui-overhaul` (pushed, PR not opened yet). The previous round is
`docs/UI-OVERHAUL-PLAN.md`; its visual checks are still open.

## How to work through it

- One workstream at a time, in the order in section 9, each in its own commit. Workstream 1 is a bug and should ship
  first.
- Same split as last time: Opus plans and reviews each diff, Sonnet (high) implements, Sonnet (medium) writes tests,
  Haiku does code search and simple edits. Implementation agents do not edit test files.
- After each workstream: `npm run typecheck`, `npx eslint .`, app and core tests, then run the app (`npm run dev:app`)
  and look at the changed screen in light and dark mode.

### Starting a session

Open a fresh chat (`/clear`), set the main model to **Opus 5.5** (`/model opus`) at **high effort** (`/effort high`),
then paste this prompt. Claude only uses subagents when asked, so the prompt asks for the split explicitly.

```
Start docs/ENHANCEMENT-PLAN.md on branch feat/ui-overhaul.

Read the plan first, then git log -5 and git status. Work through it in the plan's
suggested order, one workstream at a time, starting with workstream 1 (speed) plus
the crash-logging fix from section 8.

Use subagents with this split:
- You (Opus): plan each workstream, write the task briefs, and review every diff
  before accepting it. Reject anything that doesn't meet the "Done when" criteria.
- Sonnet, high effort: implementation. Implementation agents must not edit test
  files; they report which tests they expect to fail.
- Sonnet, medium effort: writing and updating tests after each implementation.
- Haiku: code search, verifying file paths and cache locations, and simple edits.

After each workstream:
1. Run npm run typecheck, npx eslint ., and the app and core tests.
2. Re-measure where the plan has numbers (workstream 1: time System Info and
   Startup page loads before and after).
3. Update the checkboxes and the status line in docs/ENHANCEMENT-PLAN.md.
4. Commit that workstream on its own (conventional commit message), but don't
   push. Then stop and give me a short summary plus what I should check visually
   with npm run dev:app.

Decisions already made: System Info becomes PC Health; keep the petrol-blue
palette and change only the review amber; fonts are Segoe UI Variable and
Cascadia Mono. Ask me before anything the plan doesn't cover.
```

To resume later, use the same prompt but replace "starting with workstream 1 …" with "continue from the first
unchecked workstream".

### Which model for which work

| Work                                                                                      | Model                   | Why                                                        |
| ----------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| Main session: planning, task briefs, reviewing every diff                                 | Opus 5.5, high          | Has to catch mistakes, so it needs the strongest judgement |
| Workstreams 1 (speed), 2 (Results), 3 (Dev cleanup), 5 (Startup), 6 (PC Health), 7 (Home) | Sonnet, high            | Real redesign and logic changes                            |
| Workstream 4 (icons), most of section 8 (log rotation, deleting dead code)                | Sonnet medium, or Haiku | Small, well-defined changes                                |
| Checking the cache paths in 3b on a real machine                                          | Haiku                   | Only needs to look up folders                              |
| Tests                                                                                     | Sonnet, medium          | Mostly follows existing patterns                           |

## Status legend

`[ ]` todo · `[~]` in progress · `[x]` done and reviewed

---

## 1. Speed: tool pages take 2–4 s to open (bug)

**Measured on 2026-10-09** (cold calls, timed with `tsx` against `core`):

| Call                                                               | Time                      | Used by                            |
| ------------------------------------------------------------------ | ------------------------- | ---------------------------------- |
| `getSystemInfoStatic()` (PowerShell + 5 `Get-CimInstance` queries) | ~1.9 s, every call        | System Info                        |
| `listVolumesAsync()` (PowerShell)                                  | ~2.3 s on a cold cache    | Home, System Info (`getDashboard`) |
| startup `registry.readSnapshot()` (PowerShell)                     | ~0.5 s                    | Startup                            |
| startup publisher lookup (a second PowerShell process)             | not timed, likely 0.5–1 s | Startup                            |

**Root cause:** every page unmounts when you leave it (`App.tsx` renders one view at a time), and each tool page asks
the main process for its data only on mount. The main process then starts a new PowerShell process (each one costs
~0.3–0.5 s just to start) and the page shows a skeleton until **all** of it returns. System Info has a 5-minute cache,
but its first visit is always cold. The Startup page waits for publishers **and** icons before showing any row.

- [ ] **Prewarm after launch.** Once the window has shown and Home has loaded, start `systemInfo.get()`,
      `startupService.list()` and the volume list in the background (one after the other, not in parallel, so they do
      not compete with Home). Files: `app/src/main/index.ts`, `app/src/main/host/engine-host.ts`.
- [ ] **Keep page data in the renderer.** A small per-page cache (module-level map or a context) so going back to a
      page shows the last data at once and refreshes quietly in the background (stale-while-revalidate). Files: the
      views in `app/renderer/src/pages/`, possibly a new `app/renderer/src/page-cache.ts`.
- [ ] **Startup: show rows first, enrich later.** Return the entries as soon as the registry and the folders have
      been read; send publishers and icons in a second response or an event. Files: `app/src/main/host/startup.ts`.
- [ ] **Replace PowerShell where a direct call exists.** `koffi` is already a dependency:
  - Registry reads (startup Run keys, installed apps, OS version from `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion`,
    BIOS from `HKLM\HARDWARE\DESCRIPTION\System\BIOS`, CPU name from `HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0`):
    `RegOpenKeyExW` / `RegEnumValueW` / `RegQueryValueExW`.
  - Volume list: `GetLogicalDriveStringsW` + `GetDriveTypeW` + `GetVolumeInformationW` + `GetDiskFreeSpaceExW`.
  - File publisher: `GetFileVersionInfoW` + `VerQueryValueW` (`\StringFileInfo\...\CompanyName`).
  - Keep PowerShell only for what has no simple API (GPU list, physical disks). Run it once and cache it on disk,
    since hardware rarely changes.
- [ ] **Fix the timing instrumentation.** `timed()` in `app/src/main/ipc.ts:46` measures only the synchronous part of
      a handler. For async handlers it logs the time to create the promise, not the time to resolve it, so every async
      IPC number in the timing log is wrong. Await when the result is a promise.

**Done when:** opening System Info and Startup from Home shows content in under 200 ms after the first launch, and
under 1 s on the very first visit. Add a test for the stale-while-revalidate cache and for startup rows arriving
before icons.

---

## 2. Results page: crowded and hard to use

**What is there now** (`app/renderer/src/pages/ResultsView.tsx`, `ResultsPage.tsx`, `ContributorList.tsx`,
`CategoryStrip.tsx`): a big total, two stat lines, a scope note, a row of category chips, a search box, a "Review
too" checkbox, a flat list of individual **paths** with checkboxes and a "Select all safe" header, a "Browse
everything" tree with its own toolbar, a separate "Space map" tab, notices, and a bulk bar. That is three ways of
looking at the same data on one screen, and the main list is paths, which most people cannot judge.

**Proposed design (category-first, like Windows Storage and CleanMyMac):**

```
┌──────────────────────────────────────────────────────────────┐
│  12.4 GB can be freed safely              [ Clean 12.4 GB ]  │
│  C:\ · analysed 5 minutes ago · Rescan                       │
├──────────────────────────────────────────────────────────────┤
│ [x] 🗑  Temporary files      Left behind by Windows   4.1 GB ›│
│ [x] 🌐  Browser caches       Chrome, Edge, Firefox    3.0 GB ›│
│ [x] 📦  npm cache            Re-downloaded on demand  2.2 GB ›│
│ [x] ♻  Recycle Bin           23 items                 1.1 GB ›│
├─ Needs a look (not selected) ────────────────────────────────┤
│ [ ] 🧱  Old node_modules     6 projects               2.0 GB ›│
└──────────────────────────────────────────────────────────────┘
   Explore disk ›  (search, folder tree and space map)
```

- [ ] One row per **category**: icon, name, one-line plain-language description, size, item count, a checkbox for
      the whole category. All safe categories are selected by default.
- [ ] A chevron opens the category's items (the current contributor rows, with Keep), so paths are one click away
      but not the first thing you see.
- [ ] Review-grade categories go in a separate "Needs a look" group, unselected. This replaces the "Review too"
      checkbox and the "Select all safe" header.
- [ ] One primary action with the size in it, in the header and in a sticky footer when scrolled. This replaces the
      bulk bar.
- [ ] Move search, the folder tree and the space map to a second tab, "Explore disk". Remove the category chips:
      the category list now is the filter.
- [ ] Merge notices (depth-limited snapshot, rules updated, cancelled scan) into one compact line under the header.
- [ ] Delete `CategoryStrip.tsx` and `BulkBar.tsx` if nothing else uses them.

Needs: a short description and an icon per category in `app/src/shared/categories.ts`.
Tests to rewrite: `results-view.test.tsx`, `results-page.test.tsx`, `contributor-list` tests, `category-strip` tests.

---

## 3. Developer cleanup: logic and design

**What is there now** (`DevCleanupView.tsx`, `core/src/projects/`, `core/src/rules/inventory/npm-project-modules.ts`):
it only knows Node projects (`node_modules`), grouped by how recently each project was used. Global caches (npm cache)
live on the Results page instead, so a developer has to look in two places.

**Proposed design: two sections on one page.**

1. **Toolchain caches** (global, per tool). One row per installed tool: size, what it is, and whether it is
   recreated automatically. Where the tool has its own clean command, use it instead of deleting files, because the
   tool knows what is safe (for example `npm cache clean --force`, `pnpm store prune`, `docker builder prune`,
   `go clean -cache`).
2. **Projects** (per project folder). One card per project: name, path, last activity, and its build output by type
   (`node_modules`, `target`, `bin`/`obj`, `.venv`, `build`, `.next`, `.turbo`, `.gradle`). The current
   green/yellow grading by recency stays, but it is shown as plain text ("Not touched for 7 months") instead of a
   colour alone.

- [ ] Generalise project detection from `package.json` to a list of markers: `Cargo.toml` → `target/`;
      `*.csproj`/`*.sln` → `bin/`, `obj/`; `pyproject.toml`/`requirements.txt` → `.venv/`, `__pycache__/`;
      `build.gradle(.kts)` → `build/`, `.gradle/`; `package.json` → `node_modules/`, `.next/`, `.turbo/`, `dist/`
      (`dist/` as review only).
- [ ] Move the npm cache from Results to the Toolchain section, and keep a link from Results ("Developer caches: 5.2 GB ›").
- [ ] Show the restore command per row (already in the data as `restoreCommand`).

### 3b. New developer caches to add

Each is a rule in `core/src/rules/inventory/` with a spec in `cache-specs.ts`. Grade them **safe** only when the tool
recreates the data on demand; otherwise **review**.

| Cache                       | Default location on Windows                                                                            | Grade         | Prefer                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------ |
| Yarn                        | `%LOCALAPPDATA%\Yarn\Cache`                                                                            | safe          | `yarn cache clean`                                                 |
| pnpm store                  | `%LOCALAPPDATA%\pnpm\store`                                                                            | safe          | `pnpm store prune`                                                 |
| pip                         | `%LOCALAPPDATA%\pip\Cache`                                                                             | safe          | `pip cache purge`                                                  |
| uv                          | `%LOCALAPPDATA%\uv\cache`                                                                              | safe          | `uv cache clean`                                                   |
| Poetry                      | `%LOCALAPPDATA%\pypoetry\Cache`                                                                        | safe          |                                                                    |
| Conda packages              | `<conda root>\pkgs`                                                                                    | safe          | `conda clean --all`                                                |
| Cargo registry              | `%USERPROFILE%\.cargo\registry\cache`, `\src`                                                          | safe          |                                                                    |
| Go build cache              | `%LOCALAPPDATA%\go-build`                                                                              | safe          | `go clean -cache`                                                  |
| Go module cache             | `%USERPROFILE%\go\pkg\mod`                                                                             | review        | `go clean -modcache`                                               |
| Gradle                      | `%USERPROFILE%\.gradle\caches`, `\wrapper\dists` (old versions)                                        | safe          |                                                                    |
| Maven                       | `%USERPROFILE%\.m2\repository`                                                                         | review        |                                                                    |
| NuGet                       | `%USERPROFILE%\.nuget\packages`, `%LOCALAPPDATA%\NuGet\v3-cache`                                       | safe          | `dotnet nuget locals all --clear`                                  |
| Docker / WSL                | `docker system df`                                                                                     | review        | `docker builder prune`, `docker image prune` (only if Docker runs) |
| VS Code / Cursor            | `%APPDATA%\Code\Cache`, `CachedData`, `CachedExtensionVSIXs`                                           | safe          |                                                                    |
| JetBrains                   | `%LOCALAPPDATA%\JetBrains\<IDE><ver>\caches`, folders of old IDE versions                              | safe / review |                                                                    |
| Android                     | `%USERPROFILE%\.android\avd` (review), `%LOCALAPPDATA%\Android\Sdk\system-images` (review)             | review        |                                                                    |
| Flutter / Dart              | `%LOCALAPPDATA%\Pub\Cache`                                                                             | safe          | `dart pub cache clean`                                             |
| GPU shader caches           | `%LOCALAPPDATA%\D3DSCache`, `%LOCALAPPDATA%\NVIDIA\DXCache`, `\GLCache`, `%LOCALAPPDATA%\AMD\DxCache`  | safe          |                                                                    |
| Windows Update leftovers    | `C:\Windows\SoftwareDistribution\Download`                                                             | safe, admin   | `DISM /Online /Cleanup-Image /StartComponentCleanup` (slow, admin) |
| Delivery Optimization       | `C:\Windows\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache` | safe, admin   |                                                                    |
| Crash dumps / error reports | `%LOCALAPPDATA%\CrashDumps`, `C:\ProgramData\Microsoft\Windows\WER\ReportArchive`                      | safe          |                                                                    |

Verify each path on a real machine before adding it. Paths move between tool versions, and some tools take an
environment variable (`PIP_CACHE_DIR`, `GOMODCACHE`, `CARGO_HOME`, `GRADLE_USER_HOME`, `NUGET_PACKAGES`); read it first.

---

## 4. Uninstall: real app icons

`UninstallView.tsx:269` draws the first letter of the name. The data is already there: installed apps carry
`displayIcon` from the registry (for example `C:\Apps\Foo\foo.exe,0`), and the Startup page already loads icons with a
`loadIcon` helper in `app/src/main/host/startup.ts`.

- [ ] Parse `DisplayIcon` (strip the `,index` suffix and quotes, expand `%vars%`). Fall back to the uninstaller exe,
      then to the install folder's main exe, then to the letter.
- [ ] Load icons with Electron `app.getFileIcon(path, { size: 'normal' })` as data URLs, cached by path. Load them
      after the list is shown (same pattern as startup in workstream 1), never before.
- [ ] Share one icon loader and cache between Startup and Uninstall (move it to `app/src/main/host/icons.ts`).
- [ ] `.ico` files: `getFileIcon` handles them; if one fails, use the letter.

---

## 5. Startup apps: better logic and UI

**What is there now:** only Run registry keys and the Startup folders, two lists (Enabled / Disabled), and an on/off
toggle per row. There is nothing to help the user decide **what** to turn off, which is the hard part.

Proposed, in order of value:

- [ ] **Tell the user what each entry is and whether it is safe to disable.** Add a small rules table (like the
      cleanup rules) that maps known executables/publishers to a verdict and a plain sentence:
  - _Safe to disable:_ updaters (`*Update*.exe`, Google/Adobe/Java updaters), launchers (Steam, Epic, Discord,
    Spotify, Teams), cloud-sync helpers you do not use.
  - _Keep:_ security software, audio and touchpad drivers, input methods, OneDrive if the user syncs.
  - _Unknown:_ everything else, with its publisher and file location.
    Show the verdict as text and a pill, and sort "Safe to disable" first.
- [ ] **Show the cost.** Read the last boot time from the `Microsoft-Windows-Diagnostics-Performance/Operational`
      event log (event 100: boot duration; event 101: apps that slowed boot). Show "Last boot took 48 s" at the top and a
      "Slowed boot by 3.2 s" note on matching rows. This log needs admin rights; without them, show the boot time from
      `System` event 6005 / uptime only and say so.
- [ ] **Cover what Task Manager covers.** Add scheduled tasks with a logon or boot trigger (non-Microsoft) and packaged
      (Store) apps' startup tasks. Leave services for later; they are riskier.
- [ ] **One list, not two.** A single list with a filter (All / Enabled / Disabled), each row with icon, name,
      publisher, verdict, cost, and the toggle. Disabled rows stay in place, dimmed, so the user can undo.
- [ ] **A summary line:** "9 apps start with Windows · 4 can probably be turned off".

---

## 6. System Info: why would anyone use it?

**Honest answer:** as it stands, mostly they would not. It shows what Windows already shows in Settings > About, Task
Manager and `msinfo32`. People open a page like this to answer a specific question:

1. "What exactly is in my PC?" (to buy an upgrade, check game requirements, or ask for help on a forum)
2. "Is something wrong?" (disk dying, battery worn, running hot, out of memory)
3. "Can I upgrade?" (free RAM slots, max RAM, Windows 11 readiness: TPM 2.0, Secure Boot)

**Decided (2026-10-09): turn it into PC Health**, which fits a cleanup app. Rename the page and the sidebar entry. It includes:

- [ ] **Disk health** per physical disk: `Get-PhysicalDisk` health status and `Get-StorageReliabilityCounter`
      (temperature, wear %, power-on hours, read errors). This is the one thing most users cannot find in Windows.
- [ ] **Battery health** on laptops: design capacity vs full-charge capacity (`root\wmi` `BatteryStaticData` /
      `BatteryFullChargedCapacity`, or `powercfg /batteryreport`). "Battery holds 78% of its original charge."
- [ ] **Memory:** sticks, speed, used and free slots (`Win32_PhysicalMemory`, `Win32_PhysicalMemoryArray`).
- [ ] **Windows:** activation, TPM version, Secure Boot, last update installed.
- [ ] **"Copy specs"** button: a short plain-text summary for forums and support chats.
- [ ] Keep the CPU and memory meters, and add the top 5 processes by memory (`Get-Process`), so "my PC is slow" has an
      answer.
- [ ] Load everything slow in the background (workstream 1) and cache the hardware part on disk.

---

## 7. Home page and palette

Research by Haiku on 2026-10-09 (from search snippets, not full reviews; sources were not fetched in full). The
best-regarded tools share four things: one clear primary action, a preview before deleting, a picture of where the
space went, and a calm screen. The most common complaints are upsells, bundled software and hidden features.

**Proposed home (drive cards + reclaimable bar):**

- [ ] One card per drive: usage ring, "Scanned 2 days ago · 4.1 GB can be freed", and one Scan / Rescan button.
- [ ] Under the system drive card, a thin stacked bar of what can be freed by category (safe and review shades),
      each segment linking to that category on the Results page.
- [ ] A status strip instead of tool tiles: "9 startup apps · last boot 48 s", "142 apps installed",
      "Developer caches 5.2 GB", "Disk health: Good". Each opens its page. No made-up 0–100 health score.
- [ ] A "Freed so far" line (total freed across sessions, stored in `user.json`). It rewards coming back.
- [ ] Keep Quick Clean, but as a secondary button on the system drive card.

**Palette:** the current palette already passes WCAG AA everywhere Haiku checked (accent on white 5.7:1, ink on canvas
15.5:1). The only weak spot is review amber on canvas (4.7:1).

- [ ] **Decided (2026-10-09): keep petrol blue** and change only review amber to `#8A5A00` (light) and `#E5B04F`
      (dark). Rejected alternatives Haiku proposed: "Harbour" (slate blue `#2563A6`, closer to Windows 11) and "Graphite Mint" (teal
      `#0B6E69`, which sits too close to the safe green; not recommended). Check every new value with a contrast
      checker before shipping.
- [ ] **Font:** use **Segoe UI Variable** for text and **Cascadia Mono** for paths and sizes. Both ship with Windows 11,
      look native, and need no download. Check what `styles.css` uses today before changing it.

---

## 8. Other issues found (not reported by the owner)

- [ ] **Crash reasons are lost.** `%APPDATA%\Dust\error.log` records three renderer crashes (2026-10-03 twice,
      2026-10-07) as `[render-process-gone] [object Object]`. The details object is stringified wrongly; log
      `JSON.stringify(details)` (it holds `reason` and `exitCode`). The cause is `String(error)` in `logMainError`,
      `app/src/main/index.ts:235`, called from the handlers at lines 255–260. Then watch for the next crash.
- [ ] **The 16.7 MB snapshot is parsed synchronously on the main process** (`core/src/snapshot/store.ts:43`,
      `readFileSync` + `JSON.parse`) the first time Home loads. The UI freezes for that moment. Read it asynchronously or
      in a worker, and consider a smaller format.
- [ ] **A synchronous PowerShell call is still exported.** `listVolumes()` in `core/src/system/drive-type.ts:103` uses
      `execFileSync` with a 15 s timeout, which would freeze the main process. Only `listFixedVolumes()` uses it and
      nothing in the app calls that. Delete both (and the sync `getVolumeUsage`) so nobody reuses them.
- [ ] **Logs never rotate.** `uninstall-history.log` (80 KB), `elevation-launch.log` (45 KB), `perf.log` and
      `error.log` only grow. Cap each at ~1 MB and keep one old copy.
- [ ] **Elevation log is full of PowerShell progress XML** (`#< CLIXML ... Preparing modules for first use`). Set
      `$ProgressPreference = 'SilentlyContinue'` in the elevation script.
- [ ] **Many separate PowerShell launches** (about 10 places in `core/src` and `app/src/main`), each with its own copy
      of `powershellExecutable()`. After workstream 1, move what is left into one shared helper.
- [ ] **Core tests were flaky under load** (fixed on 2026-10-08 with longer timeouts on 3 tests). If they flake again,
      run core tests with fewer workers on Windows.
- [ ] **Visual checks from the last round are still open** (see `docs/UI-OVERHAUL-PLAN.md`).

---

## 9. Suggested order

1. Workstream 1 (speed) and the crash-logging fix from 8. Small, and they fix things users notice now.
2. Workstream 2 (Results). The main screen of the app.
3. Workstream 4 (icons). Small, and it reuses the icon loader from 1.
4. Workstream 3 (Dev cleanup + new caches).
5. Workstream 5 (Startup).
6. Workstream 7 (Home), after Results and Dev cleanup, because Home summarises them.
7. Workstream 6 (PC Health).
8. The rest of 8.
