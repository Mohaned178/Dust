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
