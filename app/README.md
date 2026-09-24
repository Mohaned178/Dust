# Dust app (Electron)

Development notes for the Electron app. The project overview, quick start, and architecture live in the [root README](../README.md).

## Develop

```bash
npm install
npm run dev -w app
```

`dev` bundles main/preload/worker with esbuild, starts the Vite dev server on port 5173 (`strictPort`), and launches Electron against it. Main-process code is not hot-reloaded — restart after changing `app/src/main/`. The renderer hot-reloads normally.

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

`test` runs two vitest projects: `host` in Node and `renderer` in jsdom.

## Layout

- `src/main/` — window, typed IPC, engine host, scan lock, and feature hosts.
- `src/preload/` — the typed bridge exposed as `window.dust`.
- `src/shared/` — IPC contracts and category metadata shared with the renderer.
- `renderer/` — React 19 + Tailwind 4 (Vite), TanStack Table and react-virtual.
- `test/` — the host and renderer test suites plus shared fakes.

## Manual smoke test

1. `npm run dev -w app` and confirm the Dashboard leads with the system drive's reclaimable figure, its capacity bar, and one filled action.
2. Analyze: progress advances, `Cancel` stops within ~1 s and keeps partial results, and the Dashboard shows "Last analyzed" when it finishes.
3. Results: a category card opens Results filtered to that category; expand a contributor for why-this-grade and its recovery; select rows and preview a clean.
4. Quick Clean: the acknowledgement gates Confirm; the summary reports freed bytes and what remains reclaimable.
5. Dev Cleanup: select all dead green projects, confirm against the rebuild commands, then verify the "Recently cleaned" group keeps them for the session.
6. Browse a non-system volume: no Safety column, guarded Delete with confirmation.
7. Build and relaunch (`npm run build -w app && npm run start -w app`): the Dashboard reads the saved snapshot instantly.
8. No IPC or console errors in DevTools (F12).
