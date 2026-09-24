# Dust — Scan Performance & Responsiveness Design

Status: draft for review, 2026-09-23
Scope: system-drive Analyze, Quick Clean, and the scan pipeline's effect on the UI
Evidence: `docs/superpowers/notes/2026-09-23-scan-performance-measurements.md`

## 1. Problem & Evidence

The app is slow and freezes in three places: the Analyze scan, the end-of-scan
finalize, and Quick Clean with no prior Analyze. Measurements separate what is
physics from what is code:

- **The scan engine is not the bottleneck on SSD.** Full C: (728k files) is
  68-82 s cold in isolation and 51 s cold / 33 s warm in the app. The main-process
  trio (IPC send, aggregate-tree merge, ResultRow + display grade) is 0.2-8.9% of
  a run; renderer work is ~1-4 s with a worst single block of 119 ms.
- **Cold HDD scans dominate the user's pain.** F: (385k files) took **4.1 min**
  cold; the same root took 3.8 s warm — a 65x cache effect. This matches the
  reported "2-10 min". The app's measured overhead is negligible there.
- **Fixed costs per Analyze:** ~5 s of synchronous PowerShell (2.4 s before the
  scan, 2.4 s during finalize), ~0.6 s snapshot build/save, plus duplicate
  project classification and a full-tree row rebuild at finalize.
- **Quick Clean's first run** measures rule paths with a single-threaded,
  synchronous, uncancellable walk on the Electron main process.
- **Defender is off** on the measurement machine and there is no memory/GC
  pressure (main RSS 258 MB, renderer heap 28 MB), so neither explains the gap.
- **Residual:** app cold F: ran at 1,562 files/s vs 3,745 files/s in the isolated
  cold bench on a smaller subtree. Concurrent recycle-bin PowerShell and 2 s live
  category ticks are the leading candidates; a controlled cold A/B is required.

User's success bar: **2-3x perceived scan time and no freezes.**

## 2. Success Criteria

1. Perceived scan time (scan start to usable results) improves 2-3x on the real
   workloads: SSD runs lose their fixed costs, HDD runs lose contention and
   finalize stalls.
2. No main-thread block longer than ~100 ms; scan progress keeps moving; Cancel
   is acknowledged within ~1 s (the spec's non-negotiable contract).
3. Quick Clean with no prior Analyze streams progress, is cancellable, and never
   freezes the window.
4. Correctness is preserved: same file/folder/byte totals, rule root-scoping
   intact, snapshot still written, all existing tests green.

## 3. Non-Goals

- A native enumerator (`FindFirstFileW` / N-API). It stays a contingency, chosen
  only if the cold A/B shows the engine still misses the bar after tuning.
- Treemap, Docker, and other Phase 2 items.
- The "Calm Confidence" UI redesign (separate sub-project).
- Full-tree persistence / SQLite.

## 4. Measurement Status (Phase 0)

Done: env-gated main instrumentation (`DUST_INSTRUMENT` / `DUST_BENCH_ROOT`) with
stage timers, IPC send, tree/row work, and memory; renderer instrumentation with
event handling, row upsert, frame delay, and Long Tasks; `bench-tree.ts` and
`bench-scan.ts`; real-disk runs recorded in the notes doc.

Remaining before tuning:
- Controlled cold HDD A/B: workers 1/2/4/8 on a fresh HDD root, with rules on and
  off, to (a) pick the drive-aware worker default and (b) quantify the
  concurrent-IO cost of the recycle-bin enumeration and category ticks.
- Record before/after numbers for each fix in the notes doc using the same table.

## 5. Fixes

### A. Remove blocking PowerShell from the scan path

- `listVolumes` is called four times per Analyze through `execFileSync`
  (`app/src/main/host/engine-host.ts:443,535,658,695`), each costing ~1.1-1.3 s
  and blocking the main process.
- Resolve volumes once per app session, asynchronously (`execFile`), with a TTL
  and an explicit refresh path; never block scan start on it.
- Snapshot `load`/`save` are synchronous (`core/src/snapshot/store.ts:28-56`);
  make them async and keep the save off the critical path.
- `getVolumeUsage` (`statfs`) stays, but is computed once per dashboard read.

Expected: ~5 s saved per Analyze and no 1-2 s UI stalls.

### B. Stop concurrent I/O during the scan

- The recycle-bin rule enumerates `$Recycle.Bin` with PowerShell during the scan
  (`core/src/rules/inventory/recycle-bin.ts:15-28,49-84`, invoked via the host's
  memoized `enumerate`). Defer it until after the scan and enumerate on demand
  when the plan needs the row.
- Live category ticks every 2 s (`app/src/main/host/engine-host.ts:475-491`) run
  `expandProfileWildcard`, which does `readdirSync` on browser profile dirs
  (`core/src/rules/paths.ts:24-43`). Cache expansions per run and raise the tick
  interval.
- Expected: removes the scan-time I/O contention (the leading residual
  candidate) and cuts steady main-thread work.

### C. Move finalize off the critical path

- **Classify once.** `classifyProjects` runs in `finalize`
  (`app/src/main/host/engine-host.ts:661`) and again inside the npm rule
  (`core/src/rules/inventory/npm-project-modules.ts:11-19`). Classify once and
  pass the result into rule matching.
- **Index project discovery.** `discover.ts:42,80-93` scans all units per marker
  with `canonicalizePath` per comparison; normalize once and index units for
  nearest-root lookup.
- **Build rows once.** Reuse the streamed live rows instead of rebuilding all
  rows from the tree at finalize (`app/src/main/host/engine-host.ts:681`), and
  stop calling `tree.children()` twice per node.
- **Single tree.** The session tree and the host live tree duplicate per-folder
  work (`core/src/scanner/session.ts:119-122`,
  `app/src/main/host/engine-host.ts:493-503`); keep one tree.
- **Release accumulators.** Coordinator accumulators are retained for the whole
  scan (`core/src/scan/coordinator.ts:56-62`); release them once finalized.
- **Yield while finalizing.** Chunk the remaining work with `setImmediate` and
  emit progress so "Analyzing results…" never freezes the window.
- **Cap IPC batches.** Bound folder events by row count/bytes so a burst cannot
  become one huge synchronous structured clone.

Expected: finalize on C: from ~4 s to ~1-2 s, no freeze, lower peak memory.

### D. Quick Clean through the pool

- `measureDirectories` (`app/src/main/host/targeted.ts`) walks matched rule paths
  with the legacy single-threaded `scanTree`, sequentially, synchronously, with
  no progress or cancellation.
- Run the measurement through the worker-pool `ScanSession` with progress events
  and cancellation, keeping the targeted semantics (only rule-matched dirs).

Expected: minutes → seconds on cache-heavy first runs, no freeze.

### E. Drive-aware tuning

- Worker count by drive type: HDD → 1-2 workers, SSD → the current default
  (4-8). Drive types are already available from `listVolumes`.
- Seed top-level directories eagerly at scan start and lower `splitAfterEntries`
  (20k → ~2-5k) so all workers ramp immediately
  (`core/src/scan/worker-scan.ts:20,48-52`).
- Replace the `Array.shift()` queue with an index/deque and use LIFO for locality
  (`core/src/scan/coordinator.ts:171-192`).
- Defaults are locked only after the cold A/B; an env override stays for benches.

### F. Verification & Gates

- Tighten the gated perf test (currently 200k files < 90 s, effectively a hang
  detector) to a throughput floor with CI headroom.
- New regression tests: volumes resolved once per session; recycle-bin not
  invoked during a scan; Quick Clean runs through the pool with progress and
  cancellation; finalize emits progress and yields; classification runs once;
  rule root-scoping stays green.
- Re-run the app instrumentation before/after each fix and record the numbers in
  the notes doc.

## 6. Risks

- Caching volumes can go stale on hot-plug; mitigate with a TTL and an explicit
  refresh.
- Reusing live rows for final results must preserve snapshot/depth semantics.
- Deferring recycle-bin changes plan timing; ensure the plan still shows the row
  when it is needed (on-demand enumeration at preview).
- Drive-aware worker counts can regress SSD; measure both before locking.
- Classify-once touches the rule contract; keep `scopeRuleToRoot` and the
  root-scoping invariant intact.

## 7. Order of Work

1. A + B — independent, low risk, immediate perceived win.
2. C — largest, needs care.
3. D — independent.
4. E — after the cold A/B data.
5. F — throughout, with numbers recorded before/after.

Implementation planning follows via the writing-plans skill after this spec is
reviewed.
