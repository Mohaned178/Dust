# Dust scan performance — combined measurements (2026-09-23)

Machine: 12 logical CPUs, 16 GB RAM, Windows Defender real-time protection OFF.
Volumes: C: = T-FORCE 256GB SATA SSD; F: and G: = WDC WD10EZEX 1TB HDD.

## App-level runs (real Electron, auto-Analyze, UI-driven where noted)

| Run | Root | Files | Dirs | Cache state | scanMs | finalizeMs | totalMs |
|---|---|---|---|---|---|---|---|
| Warm, dashboard-only | C:\ | 728k | 278k | warm | 29,091 | 3,935 | 33,026 |
| Cold-ish (12 GB standby eviction), dashboard-only | C:\ | 728k | 278k | partially cold | 46,767 | 4,494 | 51,261 |
| Warm, UI-driven (ScanView + live ResultsView) | C:\ | 728k | 278k | warm | 29,328 | 4,164 | 33,492 |
| Cold, UI-driven | F:\ | 385k | 36.5k | cold (first scan) | 246,688 | 2,732 | 249,420 |

## Isolated engine (no Electron/IPC/renderer)

| Root | Files | Mode | Cache state | Time | files/s |
|---|---|---|---|---|---|
| C:\ | 728k | scanTree raw | cold-ish | 81.9s | 8,894 |
| C:\ | 728k | worker pool | cold-ish | 67.7s | 10,749 |
| C:\Users | 434k | worker pool | warm | 4.3s | 101,218 |
| F:\ | 385k | worker pool | warm | 3.8s | 102,391 |
| F:\Dust | 27k | worker pool | cold | 7.3s | 3,745 |
| G:\ | 63k | worker pool | warm | 1.1s | 58,979 |

## Main-process per-subsystem totals (during a real Analyze)

| Subsystem | C: warm UI run (33.5s) | F: cold UI run (249.4s) |
|---|---|---|
| (a) IPC send/serialize | 471 ms (601 events) | 150 ms (1,439 events) |
| (b) Aggregate tree merge (both trees) | 624 ms (556,571 calls) | 62 ms (73,069 calls) |
| (c) ResultRow + display grade | 1,881 ms | 244 ms |
| PowerShell at scan start (listVolumes ×2) | 2,560 ms | 2,429 ms |
| PowerShell at finalize (listVolumes + usage) | 2,390 ms | 2,348 ms |
| Snapshot build + save | 621 ms | 81 ms |
| Project classification | 154 ms | 107 ms |
| Rule matching | 118 ms | 11 ms |
| Main process RSS (end) | 258 MB | 258 MB |

## Renderer per-subsystem totals (UI-driven runs)

| Subsystem | C: warm (33.5s) | F: cold (249.4s) |
|---|---|---|
| Event handling (`results.event`) | 1,843 ms (600) | 174 ms (1,438) |
| Row store upsert | 665 ms (292) | 60 ms (590) |
| Flatten/sort visible rows | 8.6 ms (10) | 1.3 ms (12) |
| Frame delay after folders event | 540 ms (292, max 27.2) | 806 ms (590, max 23.9) |
| Long tasks (>50 ms) | 1,520 ms / 21 tasks, max 119 ms | none |
| JS heap used | 28 MB | 28 MB |

## Conclusions

1. The 2-10 min gap is explained by the HDD volume: F:\ cold = 4.1 min for 385k files.
   Cache state is decisive — the same F:\ root takes 3.8s when warm (65x).
2. The instrumented pipeline is not the bottleneck: on F: the main-process trio is
   456 ms of 249 s (0.2%); on C: it is 2.98 s of 33.5 s (8.9%). Renderer work is
   ~2-4 s on C:, ~1 s on F:, with worst single block of 119 ms.
3. Defender is OFF on this machine, so it is not a factor here.
4. No memory/GC pressure: main RSS 258 MB, renderer heap 28 MB.
5. Fixed costs per Analyze: ~5 s of synchronous PowerShell (2.4 s before the scan,
   2.4 s during finalize), plus ~0.6 s snapshot build/save on C:.
6. Residual: app cold F: throughput (1,562 files/s) is ~2.4x lower than the isolated
   cold F:\Dust bench (3,745 files/s). Different subtree/workload and recycle-bin
   PowerShell + 2 s live-category ticks running concurrently are the candidates;
   a controlled cold A/B (workers 1/2/4/8, rules disabled) is still needed.

## Browse-only scan smoke (real Electron, after the system-drive rescope)

| Run | Root | Files | Mode | Time | Notes |
|---|---|---|---|---|---|
| Browse, warm | G:\ | 62,990 | browse | 880 ms | no finalize, no rules, no snapshot, no projects/reclaimable |

Browse runs stream `browse-folders` rows only and finish with `browse-finished`; the
main-process work is one aggregate tree merge plus one row build per folder (measured
at 1.97 ms / 1.77 ms total for G:).

## Cold HDD worker A/B (Task 10, F:\ root, rules disabled)

F:\ is the file-dense HDD volume (397,169 files / 37,814 dirs in this run; G:\ has only ~63k
files), so the controlled A/B ran against `F:\`. Before each run the standby cache was
approximated as cold by reading 12 GB from the largest file on G:\ (`G:\Cyberpunk 2077 [DODI
Repack]\data1.doi`, 64.6 GB). Exact commands, run back-to-back from `core/`:

```bash
node -e 'const fs=require("fs");const p=process.argv[1];const target=12*1024*1024*1024;const buf=Buffer.alloc(8*1024*1024);const fd=fs.openSync(p,"r");let total=0;while(total<target){const n=fs.readSync(fd,buf,0,buf.length,total);if(n<=0)break;total+=n;}fs.closeSync(fd);console.log(total);' "G:/Cyberpunk 2077 [DODI Repack]/data1.doi"
npx tsx scripts/bench-scan.ts --root 'F:\' --workers 1
# repeat the eviction, then --workers 2, then 4, then 8
```

Every run reported `status: complete`, 397,169 files, 37,814 folders, 5 errors and
35,772,327,811 bytes.

| Run | Root | Workers | Cache state (intended) | elapsedMs | files/s |
|---|---|---|---|---|---|
| 1 | F:\ | 1 | 12 GB eviction | 550,284 | 722 |
| 2 | F:\ | 2 | 12 GB eviction | 355,715 | 1,117 |
| 3 | F:\ | 4 | 12 GB eviction | 140,971 | 2,817 |
| 4 | F:\ | 8 | 12 GB eviction | 37,284 | 10,653 |

Confound checks (reverse order and stronger eviction, same commands):

| Run | Workers | Eviction | elapsedMs | files/s |
|---|---|---|---|---|
| 5 | 8 | 12 GB | 17,832 | 22,273 |
| 6 | 8 | 32 GB | 42,642 | 9,314 |

Warm reference (no eviction, back-to-back, cache warm from run 6):

| Workers | elapsedMs | files/s |
|---|---|---|
| 1 | 10,484 | 37,883 |
| 2 | 6,685 | 59,412 |
| 4 | 7,379 | 53,824 |
| 8 | 3,731 | 106,451 |

### Caveats

- The cold curve is confounded by cache state, not a real worker-count effect. It is monotonic
  in the direction that is physically impossible for a single 7200 rpm HDD (8 workers sustained
  10.6k files/s cold, far above cold random-IOPS), and run 5 with 8 workers was *faster* than
  run 4 despite the same eviction. Each run warms the NTFS metadata/directory cache and the
  eviction does not undo it.
- The 12 GB eviction is too weak: only 9.64 GB of the 16 GB RAM was free, so most of the read
  lands in free pages instead of evicting F:\'s cached metadata; even a 32 GB read only slowed
  workers=8 to 42.6 s, nowhere near the 550 s of run 1.
- Run 1 (workers=1) is the only genuinely cold-ish point and is not comparable to runs 2-4.
- A valid cold curve cannot be measured on this machine with this eviction method. Per the
  controller ruling for a confounded curve, `HDD_WORKERS = 2`. This also matches the design
  spec's "HDD -> 1-2 workers" guidance and avoids head-seek contention. The warm pass above was
  fastest at 8 workers, but warm throughput is not the target for a spinning disk.

## After (perf plan) — Task 11

Same machine, same instrumented harness (`npm run build -w app`, then `DUST_BENCH_ROOT=...`
`DUST_BENCH_REPORT=...` `npm run start -w app`). Each root was run twice: the first run is
cold/first-touch for this session, the second immediately after is warm. Dirs are the live
folder rows reported by `row.build.live` (analyze) / `row.build.browse` (browse); the bench
report does not carry a dirs field. Baseline rows are copied from the two tables above.

| Run | Root | Files | Dirs | Cache state | scanMs | finalizeMs | totalMs |
|---|---|---|---|---|---|---|---|
| Baseline warm, UI-driven | C:\ | 728k | 278k | warm | 29,328 | 4,164 | 33,492 |
| After warm, UI-driven | C:\ | 737,554 | 279k | warm | 30,084 | 2,692 | 32,776 |
| Baseline cold-ish, dashboard-only | C:\ | 728k | 278k | partially cold | 46,767 | 4,494 | 51,261 |
| After cold (first run after build) | C:\ | 737,549 | 279k | cold | 108,153 | 8,560 | 116,713 |
| Baseline browse, warm | G:\ | 62,990 | — | warm | 880 | 0 | 880 |
| After browse, warm | G:\ | 63,116 | 981 | warm | 662 | 0 | 662 |
| After browse, cold (first touch) | G:\ | 63,116 | 981 | cold | 4,832 | 0 | 4,832 |

Main-process samples (ms, count):

| Sample | C: cold (116.7s) | C: warm (32.8s) | G: cold browse | G: warm browse |
|---|---|---|---|---|
| start.listVolumes | 0.06 (1) | 0.03 (1) | 0.02 (1) | 0.08 (1) |
| finalize.listVolumes | 2,528.01 (1) | 1,239.82 (1) | — | — |
| finalize.volumes (usage) | 0.42 (1) | 0.31 (1) | — | — |
| finalize.classifyProjects | 4,691.98 (1) | 176.95 (1) | — | — |
| finalize.collectRuleMatches | 460.14 (1) | 415.98 (1) | — | — |
| row.applyMatches | 135.06 (1) | 131.70 (1) | — | — |
| row.build.live / row.build.browse | 1,474.69 (279,103) | 1,466.07 (279,104) | 2.53 (981) | 2.29 (981) |
| tree.addFolder.total | 470.65 (558,207) | 421.19 (558,209) | 1.99 (1,963) | 1.69 (1,963) |
| ipc.send | 506.58 (1,047) | 449.06 (609) | 4.08 (34) | 2.52 (14) |
| finalize.buildSnapshot | 638.63 (1) | 556.18 (1) | — | — |
| finalize.store.save | 96.12 (1) | 103.77 (1) | — | — |
| finalize.store.load | 7.78 (1) | 65.93 (1) | — | — |
| Main process RSS (end) | 434 MB | 716 MB | 191 MB | 188 MB |
| Renderer JS heap (end) | 215 MB | 242 MB | 10 MB | 10 MB |

`row.build.final` is gone; `row.applyMatches` replaces it and reuses the rows streamed during
the scan. Row building plus match application now totals 1,598 ms warm (1,466.07 + 131.70) vs
the 1,881 ms "ResultRow + display grade" baseline. Finalize emits four `finalize-progress`
steps (`projects`, `rules`, `rows`, `snapshot`); the renderer received all four
(`app.event.finalize-progress`, count 4).

### PowerShell and finalize comparison

| Cost per Analyze | Baseline C: warm | After C: warm | After C: cold |
|---|---|---|---|
| PowerShell `listVolumes` at scan start | 2,560 ms (×2 calls) | 0.03 ms | 0.06 ms |
| PowerShell `listVolumes` at finalize | part of 2,390 ms | 1,239.82 ms | 2,528.01 ms |
| PowerShell volume usage at finalize | part of 2,390 ms | 0.31 ms (statfs) | 0.42 ms (statfs) |
| Total PowerShell per Analyze | ~4,950 ms | ~1,240 ms | ~2,530 ms |
| finalizeMs (wall) | 3,935–4,164 ms | 2,692 ms | 8,560 ms |

Observations:

1. `start.listVolumes` collapses to ~0 because the dashboard already populated the volume cache
   before Analyze starts; the usage call now uses `statfs` and costs ~0.3 ms (was the PowerShell
   half of the ~2.4 s finalize block).
2. `finalize.listVolumes` does **not** collapse on runs longer than 30 s: the cache TTL is
   30,000 ms, the warm C: scan took 30,084 ms (a ~100 ms miss) and the cold one 108 s, so the
   finalize re-runs PowerShell. Warm finalize is still 2,692 ms vs the 3,935–4,164 ms baseline,
   but ~1.24 s of it is this avoidable re-list. Session-long caching (or reusing the start-time
   volume list in finalize) would remove that ~1.24 s and take total PowerShell per Analyze to
   ~0.
3. Warm C: total 32,776 ms vs baseline 33,026–33,492 ms (within noise); warm G: browse 662 ms
   vs baseline 880 ms (25% faster) even though G: is an HDD and now uses `workers: 2`.
4. The C: cold run (108 s) is not comparable to the baseline "cold-ish" 46.8 s: the baseline
   eviction was itself shown to be too weak (see caveats above), and this run was first-touch
   after the build. Only the warm pairs are like-for-like.
5. Memory is higher than the baseline: main RSS 716 MB warm (was 258 MB) because Task 7 keeps
   all `liveRows` (279k folders) until finalize, and the renderer heap reads 242 MB vs the
   baseline's 28 MB with the same ~279k-node row store. The renderer number is the more
   suspicious one and is not explained by the perf-plan diff; it may be GC timing/measurement
   noise. Worth a follow-up memory pass, not a correctness blocker.

## Re-measurement (Task 11 follow-up)

Three controller-requested follow-ups: the A1 TTL re-list fix, a repeat of the cold C: app run
plus an isolated engine run, and two back-to-back warm C: runs for the memory question.

### 1. A1 fix: reuse the scan-start volume list in finalize

`startAnalyze` already awaits `volumes.get()` for the target lookup; that `volumeList` is now
threaded through `runAnalysis` into `finalize`, which uses it for `createExternalPredicate` and
`getVolumeUsageFn` instead of re-calling `volumes.get()`. The `finalize.listVolumes` sample no
longer exists. Dashboard and the start-time target lookup keep using the 30 s TTL cache.

New app test (`app/test/engine-host.test.ts`): with `now: () => clock`, dashboard + analyze,
`clock += 30_001` mid-scan, then finish. RED (before the fix): `expected "volumeList" to be
called 1 times, but got 2 times`. GREEN (after): 28/28 tests pass. Commands run:
`npm run typecheck -w app` (clean), `npm run test -w app -- test/engine-host.test.ts`
(28 passed), `npm run typecheck -w core` (clean); full app suite 174 passed.

Real-app confirmation (same build/bench harness, fixed code):

| Run | Root | Files | Cache state | scanMs | finalizeMs | totalMs | start.listVolumes | finalize.listVolumes | finalize.volumes |
|---|---|---|---|---|---|---|---|---|---|
| After fix, repeat cold-ish | C:\ | 737,562 | warm by then | 28,464 | 1,804 | 30,268 | 0.02 ms | absent | 0.30 ms |
| After fix, mem run 1 | C:\ | 737,567 | warm | 23,670 | 1,408 | 25,078 | 0.06 ms | absent | 0.32 ms |
| After fix, mem run 2 | C:\ | 737,567 | warm | 29,184 | 1,433 | 30,617 | 0.03 ms | absent | 0.39 ms |

Total PowerShell per Analyze is now ~0.3–0.4 ms (was ~1,240 ms warm / ~2,530 ms cold in the
Task 11 table, and ~4,950 ms at baseline). Warm finalize is 1,408–1,804 ms vs 2,692 ms before
the fix and 4,164 ms at baseline. Observation 2 in the Task 11 section is superseded.

### 2. Cold C: app repeat and isolated engine C:

| Run | Files | Folders | Cache state | elapsedMs | files/s |
|---|---|---|---|---|---|
| App repeat (`DUST_BENCH_ROOT="C:/"`, analyze) | 737,562 | 279,116 | warm (could not reproduce cold) | 28,464 scan / 30,268 total | 25,912 scan |
| Isolated engine (`npx tsx scripts/bench-scan.ts --root "C:/"`, pool, default 8 workers) | 737,564 | 279,117 | warm-ish | 50,644 | 14,564 |

Recorded isolated cold-ish reference: 81.9 s raw / 67.7 s pool. The engine is faster than both,
so there is no engine regression to escalate. The Task 11 cold app run (108,153 ms) was
first-touch cache state, not a code regression: the same command now returns 28.5 s and the
memory runs returned 23.7–29.2 s. The earlier notes already established that this machine
cannot be forced cold (the 12 GB eviction does not evict the NTFS metadata cache), so the
cold/warm spread is an environment property; the isolated run is warm-ish for the same reason.

### 3. Memory: two back-to-back warm C: runs

| Run | Files | scanMs | totalMs | memory.rssMb | memory.heapUsedMb | renderer usedJsHeapMb | renderer totalJsHeapMb |
|---|---|---|---|---|---|---|---|
| Mem run 1 | 737,567 | 23,670 | 25,078 | 729 | 294 | 228 | 273 |
| Mem run 2 | 737,567 | 29,184 | 30,617 | 723 | 261 | 228 | 290 |
| After-fix repeat (for context) | 737,562 | 28,464 | 30,268 | 701 | 276 | 228 | 290 |
| Task 11 warm runs (for context) | 737,554 | 30,084 | 32,776 | 716 | 300 | 242 | 290 |

The renderer heap is **228 MB in every repeat** (Task 11 runs: 215–242 MB), so this is a
consistent finding, not GC timing. Hypothesis grounded in the code: the renderer row store
(`app/renderer/src/tree.ts`) keeps one `RowNode` per scanned folder — ~279k nodes, each with a
`children: string[]` and a `childSet: Set` — and the main process streams one `folders` row per
folder (`app.event.folders.rows` = 279,117), which `upsertRows` materializes and retains for
the life of the view. The main-process RSS of 700–729 MB is the deliberate Task 7 trade-off
(all `liveRows` retained until finalize; baseline 258 MB). Important context for the final
review: `git diff 4eaf9c9..HEAD` over `app/renderer/src/pages/ResultsView.tsx`,
`app/renderer/src/App.tsx` and `app/renderer/src/tree.ts` is empty, and the pre-plan host also
emitted a row per folder, so the baseline's 28 MB reading is inconsistent with the same
~279k-node store. The most likely explanation is a baseline measurement artifact (store not yet
filled, or a dashboard-only run recorded in the UI-driven table), not a perf-plan regression.
No refactor was started; a follow-up memory pass (trim/release the renderer store or virtualize
it) is recommended for the final review.

## Final review: accepted follow-ups and recorded deviations

- Finalize stays phase-level granular (yields between phases, not inside `classifyProjects`/`buildSnapshot`): cold classify ~4.7s / warm ~177ms, buildSnapshot 556–639ms; the renderer runs in a separate process and its longtasks stayed <=56ms, so UI paint is not blocked. Follow-up: chunk those two phases.
- Memory: main RSS ~723MB (deliberate `liveRows` retention from the rows-once design) and renderer store ~228MB (renderer code unchanged by this plan). Follow-up memory pass.
- Evidence gap: no before/after Quick Clean measurement; the warm-SSD end-to-end total is within noise (32,776ms vs 33,026–33,492ms) — the verified wins are finalize (4,164 -> 1,408–1,804ms) and session PowerShell (~4,950 -> ~0.3ms). Cold HDD app-level A/B was not measurable on this machine.
- Spec E deviations: `splitAfterEntries` stays 20k and the queue stays FIFO; eager root split covers the ramp-up intent.
