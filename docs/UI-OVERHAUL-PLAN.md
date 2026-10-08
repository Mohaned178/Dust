# UI/UX overhaul — plan and status

Handoff file for continuing the UI/UX overhaul in a new session. Read this first, then `git status`.
Last updated: 2026-10-08.

## How the work is split

- **Opus** (orchestrator): audits, writes the plan, and reviews every diff before it is accepted.
- **Sonnet, high effort**: implementation tasks.
- **Sonnet, medium effort**: unit tests.
- **Haiku**: simple tasks and code search.

Implementation agents do not edit test files. They report which tests fail on purpose, and the test agent updates those tests afterwards.

Nothing from this overhaul is committed yet. Suggested commits: (1) the previous session's redesign + MFT scanner + uninstall rework, (2) this overhaul. Use the `git-workflow-and-versioning` skill to split them.

Baseline before this overhaul: the uncommitted redesign from the previous session, which is not committed yet. Its tree snapshot is `12584f12`. To diff the work done since then: `git diff 12584f12 $(GIT_INDEX_FILE=/tmp/x git add -A && GIT_INDEX_FILE=/tmp/x git write-tree)`.

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done and reviewed

## 1. Cleanup
- [x] Delete the dead pages and their tests: `pages/Dashboard.tsx`, `ScanView.tsx`, `BrowseView.tsx`, `DrivesView.tsx`, `components/DiskCard.tsx`, and `test/renderer/{dashboard,scan-view,browse-view,drives-view}.test.tsx`.

## 2. Bugs
- [x] (App.tsx keeps a per-run event record; ScanProgress subscribes, then replays it.) The scan screen can stay on "Scanning" forever. `ScanProgress` subscribes after `startAnalyze` resolves, and `engine-host` `emit()` never replays events, so a fast MFT scan's `finished` event can be missed.
- [x] `ResultsView` selection: changing the category filter silently drops selected items from the bulk bar and from the clean action.
- [x] `ResultsPage`: switching the "Clean up" / "Space map" tabs unmounts `ResultsView` and loses selection, kept items, search and expanded folders. Both tabs also fetch `getResults` separately.
- [x] `ResultsPage` header total (all categories, including npm-projects) disagrees with the big total in `ResultsView` (safe items only).
- [x] `UninstallWizard` dialog has no Escape, no focus trap and no focus restore. Reuse the `CleanDialog` behaviour.
- [x] `UninstallWizard` "Done" says "X is removed" even after the still-installed → look-for-leftovers path.

## 3. Delete flow (CleanPlan / CleanFlow / CleanSummary / BulkBar / ContributorList)
- [x] Show the "I understand some items cannot be recovered" checkbox only when there are review items or items that cannot be recovered.
- [x] Put the size in the confirm button ("Delete 4.2 GB"), and in the bulk bar.
- [x] Show deletion progress. `CleanFlow` counts the existing per-item `clean-item` events for its `cleanId`; `CleanPlan` shows "Deleted N of M items · X freed" and a size-weighted meter. Tested.
- [x] Show errors with the danger style, not the teal info notice.
- [x] Use the shared `Button` from `components/ui.tsx` instead of copied class strings.
- [x] Make "Keep" reachable without opening the row's drill-down.

## 4. Results page / Space map
- [x] Space map tiles are `role="listitem"` buttons; restore button semantics.
- [x] Space map: tell the user when the saved results' depth limit stops drill-down ("Rescan for deeper folders").
- [x] Space map: colour by meaning (reclaimable share) instead of by rank.
- [x] Remove the dead live-scan path from `ResultsView`. `runId` is always `null` now.

## 5. Uninstall
- [x] Show per-item progress while removing. `item` events already arrive.
- [x] Add select all / none per group in the review step.
- [x] Add a "Try again" button for "Couldn't read installed apps".

## 6. System Info
- [x] Migrate to the shared `ui.tsx` components (`PageHeader`, `Card`, `Button`, `Meter`).
- [x] Add a Storage section (volumes with usage meters).
- [x] Make the CPU tile a meter, like the memory tile.
- [x] Label the GPU driver version.
- [x] Pause live polling while the window is hidden.
- [x] Add a retry button to the loading and error states.

## 7. Palette and dark mode
- [x] Move the brand accent to petrol blue, so it no longer collides with the "safe" green. Dark mode follows the system setting.

| Token | Light | Dark |
|---|---|---|
| canvas | `#F6F5F2` | `#0F1115` |
| surface | `#FFFFFF` | `#171A20` |
| ink / muted | `#1A1D21` / `#5B6370` | `#E8EAED` / `#9AA3AF` |
| hairline | `#E6E3DD` | `#2A2F38` |
| accent | `#1F6F8B` (strong `#175A72`, soft `#E7F1F5`) | `#4FB3D1` (soft `#15303A`) |
| safe | `#1E7A4C` / soft `#E6F4EC` | `#5CC98A` |
| review | `#9A6200` / soft `#FBF1DC` | `#E0A93B` |
| danger | `#B42318` / soft `#FDECEA` | `#F07167` |

## Visual checks still needed (run `npm run dev:app`)
- Both themes on every screen: the Startup toggle knob is `bg-surface` and may be hard to see on the dark "off" track.
- Results: switch tabs back to "Clean up" after opening the map. The panels stay mounted with `hidden`; confirm the virtualized tree re-measures.
- Delete confirm button is `danger` only when acknowledgement is required.

## 8. Tests (Sonnet, medium effort)
- [x] Rewrite `sidebar.test.tsx`, `app.test.tsx` and `uninstall-view.test.tsx` for the new screens.
- [x] Add tests for `SpaceMap` (including `squarify`), `UninstallWizard` and `ScanProgress` (including the missed-`finished` race).
- [x] Update the existing tests that fail on purpose because of sections 2–7.

## 8b. Follow-ups found during review
- [x] Regression from the earlier redesign: `UninstallView` ignored `hint.appId`. It now reopens `UninstallFlow` for that app when relaunched elevated. The wizard has a "Relaunch as administrator" button (except after a verified uninstall). Tested.
- [x] Lint: 8 `react-hooks/exhaustive-deps` warnings in `ResultsView.tsx`. Since the live-scan path was removed, every snapshot builds a fresh row store, so the store now lives in state and its identity is the memo key; the `version` counter is gone. `stripCategories` memo fixed too.
- [x] Backend per-item progress event: not needed. `engine-host` already emits `clean-item` per item (DevCleanupView used it); the delete dialog now does too.
- [x] Core test flakiness. Not reproduced in 12 runs. Found instead: 2 of 5 back-to-back runs failed with timeouts in the locked-file tests (`executor`, `browse-delete`: copy and spawn `node.exe` under a 5 s default while waiting up to 15 s) and the 1500-file `WindowsDirInfoEnumerator` test, then EPERM in `afterEach` because the sleeper still held its exe. Gave them 30 s / 20 s timeouts; 6/6 runs green since. If `napi_throw` reappears, suspect a test timing out mid-koffi call and its worker being torn down.

State at last check: typecheck clean · app 49 files / 390 tests pass · core 561 pass (6/6 runs) · lint 0 errors, 0 warnings.

## 9. Features (not started; suggested order)
1. Recycle Bin / quarantine mode for deletions, with a 7-day undo.
2. A persistent "Ignore forever" list. "Keep" is session-only today.
3. Before and after drive meter on the cleanup summary.
4. More developer caches: Docker, `.gradle`, `~/.cargo`, pip/uv, Visual Studio `obj`/`bin`, and Windows Update cleanup.
5. Duplicate and large-old-file finder built on the MFT data.
6. Scheduled scan with a tray notification above a reclaimable-space threshold.
7. Batch uninstall, with real app icons (registry `DisplayIcon`).
8. A Light / Dark / System theme switch in Settings. Dark mode currently follows the system.
