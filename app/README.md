# Dust app (Electron)

## Develop

```bash
npm install
npm run dev -w app
```

`dev` bundles main/preload/worker with esbuild, starts the Vite dev server on port 5173, and launches Electron against it. Restart the command after changing `app/src/main/` code (main-process bundles are not hot-reloaded).

## Build and run

```bash
npm run build -w app
npm run start -w app
```

## Test and typecheck

```bash
npm run test -w app
npm run typecheck -w app
```

## Manual smoke checklist (MVP)

### System drive (C:) — full treatment

1. `npm run dev -w app` opens the Dust window on the Dashboard; every fixed volume has a card with a usage bar, and removable/network volumes carry the `external` label. The system-drive card offers `Analyze`; every other volume offers `Browse` (see the browse-only section below).
2. Click `Analyze` on a real drive: the view switches to Scan, files scanned / bytes seen / errors / elapsed advance, and the current path updates. `Cancel scan` stops within ~1 s and shows "Scan cancelled" with a Back button.
3. Analyze again to completion. The summary shows files, bytes, projects and reclaimable bytes; back on the Dashboard the card shows "Last analyzed just now · N GB reclaimable".
4. While a scan runs, click `Analyze` on another card: the "A scan is already running" dialog appears. `Wait` dismisses it; `Cancel it` cancels the running scan and starts the new one.
5. `npm run build -w app` then `npm run start -w app`: the Dashboard reads the persisted snapshot instantly (no scan) and still shows the last-analyzed line.
6. Corrupt the snapshot (`%APPDATA%\Dust\snapshot.json`) with garbage text and relaunch: the "Snapshot unreadable" banner appears and an Analyze rebuilds it. No crash.
7. No IPC or console errors in the DevTools console (open with F12).
8. Click `View results` on an analyzed card: the Results view shows the Category Summary Strip and a tree whose Name/Size/Allocated/Files-Folders/%/Safety/Last-modified/Action columns render. The snapshot banner explains the depth-4 limit.
9. Expand and collapse folders with the chevrons; click any column header to re-sort (default Size descending); click a Safety cell to see the full "why this grade" text and rule evidence in the details panel.
10. Click a category in the strip: the tree filters to that category's matched paths; click it again to clear.
11. Double-click a folder name (or click `Explore`): Windows Explorer opens at that path.
12. Start an Analyze and stay on the Scan view: rows stream into the table as folders complete (parents appear as "scanning…" stubs until finalized), the strip fills in, and when the scan finishes the action grades and evidence appear. `Cancel scan` keeps the partial tree.
13. Relaunch the built app and open `View results`: the tree rebuilds from the snapshot (depth-limited) with the amber banner; running a fresh Analyze replaces it with the full tree.
14. Click `Clean` on a rule-matched row (green badge): the plan dialog lists the path, its recovery statement and evidence. `Cancel` closes it without deleting; `Delete permanently` removes the folder and the row disappears from the tree while parent sizes shrink.
15. Click `Clean` on a yellow/review row (or the Recycle Bin row): the confirmation is disabled until the acknowledgement checkbox is ticked. The Recycle Bin row offers `Open the Recycle Bin in Explorer first`.
16. Click `Quick Clean` on the Dashboard: the plan shows per-category items with recovery notes and totals. Confirm; the summary reports freed bytes, remaining reclaimable space and (for partial items) "N files in use". Back on the Dashboard the card shows `Last cleaned`.
17. With `C:\Windows\Temp` present, the Quick Clean plan marks that row `Needs administrator rights` and shows `Relaunch as Administrator`; clicking it relaunches the app elevated and the window closes.
18. From Results click the `npm projects` strip row: Dev Cleanup opens with Dead / Occasional / Active / Orphaned / Pinned groups. `Select all Dead + green` then `Review cleanup` shows the plan with rebuild commands; confirming cleans the node_modules directories and the summary lists the copyable commands. The collapsed `Recently cleaned` group keeps them for the session; relaunching clears it.
19. Click `Keep` on a project: it moves to the Pinned group and is never selectable; `Unpin` restores it. Locked files are skipped with "partially cleaned: N files in use" and never fail the batch.

### Browse-only volumes (D:, E:, …)

20. A non-system card shows `Browse` (never `Analyze`) and the line "Browse-only — no cleanup rules apply here"; the system card keeps `Analyze` and its last-analyzed/reclaimable lines.
21. Click `Browse`: the view switches to `Browsing`; files scanned / bytes seen / errors / elapsed advance; `Cancel scan` stops within ~1 s and shows "Browse cancelled".
22. Let it finish: the summary shows files / bytes / elapsed only — no projects, no reclaimable bytes. The tree streams rows without a `Safety` column (Name / Size / Allocated / Files-Folders / % / Last modified / Action) and no Category Summary Strip.
23. Expand folders with the chevrons, re-sort columns, and double-click a name (or click `Explore`) to open Windows Explorer.
24. Click `Delete` on a row: a simple confirmation shows the path and that it cannot be undone. `Cancel` keeps it; `Delete permanently` removes the row and shrinks parent sizes.
25. Try to delete a protected path (a volume root, a system path, or a user document folder): the dialog shows `Delete refused (…)` and the row stays.
26. Relaunch after browsing: the volume shows no `Last analyzed`/`reclaimable` line (browse results are session-only), and the C: snapshot is untouched.
27. While a scan runs, clicking `Browse` on another card shows the same "A scan is already running" dialog; `Cancel it` cancels the running scan and starts the browse.
28. With no system volume present, `Quick Clean` is disabled.
