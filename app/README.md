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

1. `npm run dev -w app` opens the Dust window on the Dashboard; every fixed volume has a card with a usage bar, and removable/network volumes carry the `external` label.
2. Click `Analyze` on a real drive: the view switches to Scan, files scanned / bytes seen / errors / elapsed advance, and the current path updates. `Cancel scan` stops within ~1 s and shows "Scan cancelled" with a Back button.
3. Analyze again to completion. The summary shows files, bytes, projects and reclaimable bytes; back on the Dashboard the card shows "Last analyzed just now · N GB reclaimable".
4. While a scan runs, click `Analyze` on another card: the "A scan is already running" dialog appears. `Wait` dismisses it; `Cancel it` cancels the running scan and starts the new one.
5. `npm run build -w app` then `npm run start -w app`: the Dashboard reads the persisted snapshot instantly (no scan) and still shows the last-analyzed line.
6. Corrupt the snapshot (`%APPDATA%\Dust\snapshot.json`) with garbage text and relaunch: the "Snapshot unreadable" banner appears and an Analyze rebuilds it. No crash.
7. No IPC or console errors in the DevTools console (open with F12).
