# Dust — MVP Design

Status: approved in brainstorming session, 2026-09-17
Platform: Windows first
Stack: Electron + Node.js + React + TypeScript + Tailwind + Vite

## 1. Problem & Positioning

Two dimensions of the disk-cleanup problem:

1. **Friction** — users know they have junk files, but execution takes too many steps, so they procrastinate.
2. **Fear** — users are afraid of deleting something important because no tool tells them what is safe.

Target user: a developer whose disk fills from npm packages, Docker images, and forgotten projects.

Wedge: npm cleanup (node_modules of dead projects + npm download cache) is the reason a developer installs Dust. Temporary-file cleaning is commodity; safety classification, developer-specific insight, and progressive UX are the differentiation.

Explicit non-competition: Dust does not chase WizTree-class MFT scan speed. It competes on safety classification, developer insights, and making waiting feel productive.

## 2. MVP Scope

In scope:

1. Dashboard with all fixed disks and usage bars. The system drive (boot volume, normally `C:\`) gets two actions: Analyze (deep scan) and Quick Clean (safe cleanup only); every other volume is browse-only (Section 2.1).
2. Scanner engine (Node) that walks a disk or folder and collects size / type / last-modified.
3. Results view: Category Summary Strip + Tree Table with safety classification (green / yellow / red) and "why this grade" explanations.
4. Quick Clean: %TEMP%, C:\Windows\Temp, Recycle Bin, npm cache, application caches — plan screen, explicit confirmation, execute.
5. Developer Cleanup: npm projects (detect, classify, one-click removal of node_modules from dead projects) and the npm download cache.
6. Cache Registry: Chrome, Edge, Firefox, Discord, Slack caches as self-contained rule files.

Superseded from the original project context (decided during brainstorming):

- Browser caches were out of scope; they are now in scope via the Cache Registry.
- Treemap stays Phase 2; the Tree Table covers navigation in MVP.
- "Default action = move to Recycle Bin" is replaced by the per-category recovery model (Section 5.3): recycling frees zero bytes and the bin quota auto-purges large items, so it is not a safety net for GB-scale artifacts.
- Equal treatment of all fixed disks is superseded: only the system drive gets the full Analyze/cleanup treatment; other volumes are browse-only (Section 2.1).

Out of scope (Phase 2+): Docker, installed-apps manager, visual treemap, quarantine, snapshots, real pnpm/bun support (global store math), NVIDIA/Steam caches, cross-platform, global npm package audit, editor-MRU activity signals, background scheduled scans, move/quarantine for browse-only volumes.

### 2.1 System drive vs browse-only volumes

Dust is system-drive-focused. The system drive is the boot volume, resolved from `volumeRootOf(env.windowsDir)` with `%SystemDrive%` as fallback, and injected into the engine host so tests can substitute a fixture root.

**System drive — full treatment:** Analyze (worker pool, progressive streaming), rule matching, action and display grades, safety classification, Quick Clean, Dev Cleanup, Cache Registry, and snapshot persistence.

**Every other fixed, removable, or network volume — browse-only:**

- The same scanner (`Enumerator`/`scanTree`, worker pool) walks the volume and shows size/structure. No rule matching, project classification, or npm discovery runs.
- No Safety column, display grade, or action grade — Dust makes no safety judgment outside the system drive.
- No Quick Clean, Dev Cleanup, or Cache Registry rules apply.
- The tree offers a plain permanent Delete action (in-app, simple confirmation). No rule evidence, recovery statement, or plan-token flow. Move/quarantine is Phase 2 (Section 12).
- The protected-path guard (Section 5.5) still runs for these deletes: volume roots, system paths, and their ancestors are refused.
- Browse results are session-only: no snapshot, no relaunch persistence.

Why: the rule inventory (npm cache, temp, cache registry) encodes system-drive paths; extending classification to arbitrary volumes adds correctness risk for unvalidated demand. Benchmarks showed cold scans of secondary HDDs are 4-7x slower than the SSD system drive, and real usage concentrates the cleanup pain on the system drive.

## 3. Locked Decisions

| # | Decision |
|---|----------|
| 1 | **Progressive scan.** Results stream in as folders complete. The contract: progress is always visible and the scan is cancellable at any moment with partial results retained and labeled. The 1M-files-on-SSD < 45 s figure is a goal pending the benchmark spike (Section 8), not a pass/fail gate on the MVP. |
| 2 | **One-pass measurement.** node_modules and friends are measured, not skipped — Windows has no O(1) directory size, so summing requires enumerating every file. Engine: sync fs inside 4-8 worker_threads with directory-level work-stealing. `Enumerator` interface leaves room for a future native fast path (FindFirstFileW / N-API); not in MVP. |
| 3 | **npm discovery rides Analyze.** `package.json` outside node_modules marks a project root; node_modules sizes are attributed to the nearest project root during the same walk. No second pass. |
| 4 | **Dev Cleanup is a category row in the results Category Summary Strip.** No third Dashboard button. A persisting snapshot makes it instant on relaunch. |
| 5 | **Two-axis classification.** Recency groups projects (Active ≤ 30 d / Occasional 31–180 d / Dead > 180 d, one config constant); restorability grades each project (green/yellow; unsupported package managers never offered). Manual "Keep" pin always wins. |
| 6 | **Per-category recovery path.** Permanent delete only when a rule proves the asset is regenerable (exact restore command shown) or worthless. Moving to the Recycle Bin is not a blanket default; it remains the recovery path only for future unverifiable content. |
| 7 | **npm cache is in MVP** as its own row in the Developer category. |
| 8 | **Cache Registry pattern.** Adding a Phase 2 cache is a ~10-line self-contained rule file with zero engine changes. |
| 9 | **Action grade vs display grade are separate.** Only whitelisted rules produce action grades; unknown paths are never actionable. Tree rows get an informational display grade with a "why" explanation. |
| 10 | **Quick Clean and Analyze are mutually exclusive.** Single global scan lock. Quick Clean uses the freshest data: its own targeted scan when no Analyze exists, or Analyze results without re-scan. |
| 11 | **No restore feature.** Dust never runs package managers, manages background processes, or tracks rebuilds. After cleanup, each project shows a copyable restore command. A session-only "Recently cleaned" group holds them. |
| 12 | **No one-click-and-done anywhere.** Every deletion requires an explicit user confirmation. System-drive cleanup is enforced by plan tokens in the cleaner API; the browse-only Delete (Section 2.1) is a separate guard-enforced path with a simple confirmation. |
| 13 | **Tree Table is the main results surface,** coexisting with the Category Summary Strip. |
| 14 | **System-drive focus.** Only the boot volume gets Analyze, rules, grades, cleanup, and snapshot persistence. All other volumes are browse-only with a guarded permanent Delete (Section 2.1). Browse scans share the single global scan lock and never write the snapshot. |

## 4. Architecture

### 4.1 Layout

npm workspaces monorepo:

- `core/` — pure TypeScript: `model/`, `scanner/`, `rules/` (with `rules/caches/`), `cleaner/`, `snapshot/`. Zero Electron imports; the entire engine runs under vitest in plain Node.
- `app/` — Electron: `main/` (window, IPC, worker-pool host, cleaner host, elevation helper), `preload/` (typed bridge), `renderer/` (React + Tailwind + Vite, TanStack Table + react-virtual).

### 4.2 Process & Concurrency Model

- Electron main owns scan sessions; the renderer holds no engine state.
- Worker pool of 4-8 `worker_threads`. Each worker uses synchronous fs — `readdirSync(dir, {withFileTypes: true})` plus one `lstatSync` per file for size and mtime (Dirent saves the stat call on directories). Sync avoids libuv thread-pool round trips; blocking is free inside a worker.
- Work distribution is a directory-level producer/consumer queue with stealing: workers pull unclaimed directories as they finish, so one giant folder cannot idle the pool.
- Reparse points (symlinks and junctions) are detected via Dirent and never followed — prevents double-counting (`C:\Users\All Users`) and cycles. Junction rows render inert.
- Streaming protocol: workers batch every ~200 ms — completed directory records, partial-directory deltas, discovered items (`package.json` roots, node_modules roots), progress counters, error counts. Main merges into the aggregate tree and throttles renderer updates to ~10 fps over typed IPC.
- Cancellation: abort flag checked per directory, graceful drain of in-flight batches; partial tree is kept and marked cancelled.
- Worker crash: one automatic restart; the affected subtree is marked incomplete.
- Future seam: `core/` is host-agnostic; moving it into an Electron `utilityProcess` later requires no core changes.

### 4.3 Enumerator Interface

```ts
interface Enumerator {
  walk(dir: string, opts: { signal: AbortSignal }): Iterable<Entry>;
}
interface Entry {
  name: string;
  kind: 'file' | 'dir' | 'link';
  size: number;
  mtimeMs: number;
}
```

Baseline implementation: Node sync fs. Future implementation: native FindFirstFileW addon behind the same interface. Rules and aggregation code never change for the swap.

### 4.4 Hard Exclusions

Never scanned or counted: `pagefile.sys`, `hiberfil.sys`, `swapfile.sys`, `System Volume Information`, all reparse points, Dust's own install directory, and `$Recycle.Bin` contents outside the recycle-bin rule.

Cloud placeholder files (OneDrive etc.) are counted at logical size — documented limitation surfaced in the UI.

### 4.5 Persistence

Single snapshot file at `userData/snapshot.json`. It is system-drive-only: browse scans of other volumes never read or write it (Section 2.1).

- `schemaVersion`, `rulesVersion`
- scan root, startedAt, finishedAt, status (`complete` or `cancelled`), `cleanedAt` (last successful cleanup, shown on disk cards)
- per-disk used/free totals (`fs.statfs`, PowerShell `Get-Volume` fallback)
- category summaries (bytes + item counts per rule)
- project records (path, name, manager, lockfile grade, recency, node_modules bytes)
- folder map to depth 4 + top contributors

Semantics: relaunch shows the dashboard instantly from the snapshot; the Tree Table beyond depth 4 requires a fresh scan; a snapshot-age banner communicates staleness. A `rulesVersion` mismatch shows "rules updated — rescan for accuracy". Corrupt snapshots are discarded with a rescan prompt, never a crash. SQLite is deferred until full-tree persistence is needed (post-MVP treemap).

## 5. Rules, Plan, and Safety Model

### 5.1 Rule Interface

```ts
interface Rule {
  id: string;                 // 'system-temp', 'npm-cache', 'cache-chrome', ...
  category: CategoryId;       // 'temp' | 'recycle-bin' | 'npm-cache' | 'app-caches' | 'npm-projects'
  title: string;
  match(ctx: ScanContext): RuleMatch[];
  action: Action;             // { kind: 'delete-path' } | { kind: 'empty-recycle-bin' }
}
interface RuleMatch {
  path: string;
  bytes: number;
  grade: 'safe' | 'review';   // per match: npm-project-modules grades per project
  recovery: Recovery;         // { kind: 'regenerate', command } | { kind: 'junk' }
  evidence: string;           // shown in UI and in the plan
}
```

- Rules live in `core/rules/<id>.ts`; cache rules in `core/rules/caches/<app>.ts`.
- **Rule matches are root-scoped.** A rule may only return paths on the volume of `ctx.root` (the system drive). Rules that resolve absolute system paths (temp, npm cache, caches, recycle bin) must filter candidates by `volumeRootOf(match.path) === volumeRootOf(ctx.root)`. This is a data-loss guard, not a UI nicety: without it, analyzing another volume could offer system-drive paths for deletion.
- The cleaner executes only actions declared by whitelisted rule ids. There is no generic delete entry point in the system-drive cleanup flow, and the UI never touches fs directly. The browse-only Delete action on non-system volumes (Section 2.1) is a separate, guard-enforced path that never consults rules.

### 5.2 Action Grade vs Display Grade

- **Action grade** — produced only by whitelisted rules. Green = regenerable or worthless, permanent delete allowed with the recovery statement shown. Yellow = heuristic evidence, incomplete evidence, or irreversible; entering a plan requires an explicit acknowledge.
- **Display grade** — computed for every visible Tree Table row on the system drive from path patterns. Known-safe patterns (`\Temp\`, `\Cache\`, `node_modules`, `Windows\Temp`) green; unknown yellow; system-critical red. Purely informational: clicking shows "why this grade"; never a cleanup button. When a rule matched the row, the cell shows the rule's action grade plus its evidence instead. Browse-only volumes have no display grade at all (Section 2.1).
- No fourth color; yellow is the default for unknown. The cleaner never consults display grades.
- Red list (read-only, hidden behind a "Show danger" toggle, never actionable): `C:\Windows`, Program Files / Program Files (x86), ProgramData, profile roots, volume roots.

### 5.3 Rule Inventory & Recovery Paths

| Rule | Scope | Grade | Recovery |
|------|-------|-------|----------|
| `system-temp` | `%TEMP%`, `C:\Windows\Temp` (elevation flag) | green | Junk by definition; permanent. |
| `recycle-bin` | Per-volume `$Recycle.Bin`, enumerated (count, bytes, oldest/newest) | yellow | Irreversible. Plan offers "open in Explorer" first; emptying confirmed separately. |
| `npm-cache` | `%LOCALAPPDATA%\npm-cache\_cacache` | green | Permanent; re-downloaded on demand. |
| `npm-project-modules` | node_modules under discovered project roots | per project | Permanent only when green (lockfile + known manager); exact rebuild command shown. |
| `cache-chrome` | Chrome profile cache dirs | green | "[App] cache will be re-downloaded on next use." Permanent. |
| `cache-edge` | Edge profile cache dirs | green | Same pattern. |
| `cache-firefox` | Firefox profile `cache2` | green | Same pattern. |
| `cache-discord` | Discord cache / Code Cache / GPUCache | green | Same pattern. |
| `cache-slack` | Slack cache / Code Cache / GPUCache / CacheStorage | green | Same pattern. |

The inventory is system-drive-scoped: these rules only run for the system drive (Section 2.1), and each only matches paths on its volume (Section 5.1).

Cache rules: declared via a `paths(ctx)` resolver with profile wildcards (Chrome/Edge/Firefox multi-profile, Discord variants, Slack workspaces); a cache row renders only when its cache directory exists. Deletion is allowed while the app runs; locked files are skipped and counted. Adding a new cache is a ~10-line file with zero engine changes.

Locked files anywhere: skipped and reported per action as "partially cleaned: N files in use"; never a batch error.

### 5.4 Plan Tokens & Invariants

- `cleaner.execute(planId)` accepts only a plan produced by a prior plan preview. No other code path can delete within the system-drive cleanup flow; the browse-only Delete (Section 2.1) is a separate, guard-enforced path with explicit confirmation and no rule involvement.
- Invariants: no automatic deletion ever; every deletion is explicitly confirmed by the user; red items never enter a plan; unknown paths never enter a plan; every plan item carries its recovery statement.

### 5.5 Protected-Path Guard

Defense in depth enforced in the cleaner: refuses volume roots, `C:\Windows`, Program Files, ProgramData, profile roots, user-document-class directories, and Dust's own install — and any path that is an ancestor of these. Exception requires a rule match against an exact known path (temp dir, cache dir, or node_modules inside a discovered project root).

The guard is drive-agnostic and applies to the browse-only Delete action on non-system volumes (Section 2.1), where it is the only safety net and no rule-match exemption exists. The system-drive policy itself is enforced by the host, not by the guard. Deletes are re-checked against the guard at execution time, never only at plan/confirmation time.

## 6. Project Discovery & Classification

### 6.1 Discovery

- A `package.json` whose path contains no `\node_modules\` segment is a candidate project root. Manifests are parsed lazily (only for discovered roots) for `name`, `workspaces`, `packageManager`.
- Monorepo signals (`workspaces` field, `pnpm-workspace.yaml`, `lerna.json`, `turbo.json`, `nx.json`) merge the tree into one unit: member manifests are grouped, root node_modules is measured as the unit, UI shows "Monorepo · N packages".
- node_modules is attributed to the nearest project root and never descended for discovery; nested node_modules is counted within.
- Orphaned node_modules (no manifest or lockfile) forms its own yellow group: "can't be recreated — no manifest found".
- Global npm install roots (`AppData\Roaming\npm\node_modules` etc.) are not projects; their cache is handled by `npm-cache`. Global package audit is Phase 2.

### 6.2 Restorability Grades

- **Green:** `package-lock.json` or `yarn.lock` present; no `patches/` directory; lockfile registry hosts are public (best-effort sample of the lockfile).
- **Yellow:** missing lockfile; `patches/` present; private registry host detected ("ensure registry access before removing").
- **Not offered:** `pnpm-lock.yaml`, `bun.lockb`, or `packageManager: pnpm | bun | yarn@>=2` — labeled "unsupported manager (Phase 2)"; pnpm store/symlink math would misreport freed space. Yarn Berry PnP projects have no node_modules and show "nothing to clean".

### 6.3 Recency

- `lastActivity = max(` newest file mtime inside the project excluding node_modules and .git internals, `.git/logs/HEAD` mtime when present, manifest mtime `)`.
- The git reflog signal exists because cloning or checking out an old repository resets file mtimes to today; raw mtime alone would call zombie projects "Active".
- Groups: Active ≤ 30 d, Occasional 31–180 d, Dead > 180 d. Defaults live in one config constant.
- "Keep" pin (stored in config) always wins: pinned projects are never suggested and appear in a Pinned group.
- Projects are discovered and classified only on the system drive. Every other volume is browse-only (Section 2.1), so its projects are never offered for cleanup. The "external" predicate (removable/network) remains only as a dashboard label; it is no longer the cleanup gate.

### 6.4 Dev Cleanup Flow

- Developer row in the Category Summary Strip → Dev Cleanup view: collapsed groups Dead / Occasional / Active / Orphaned / Pinned. Each row: name, path, node_modules size, last activity with source ("git reflog 38 d ago"), restorability badge.
- Bulk action "Select all Dead + green"; individual selection allowed for any project. Confirmation is always required.
- Confirmation screen: total bytes, per-project rebuild command, mandatory acknowledge checkbox when any yellow item is in the plan.
- Execute → per-project progress → summary with copyable commands (`npm ci`, `yarn install --frozen-lockfile`).
- Post-clean: a session-only collapsed "Recently cleaned" group holds removed projects with their commands. On relaunch they are gone; a future scan shows such projects as clean / no action.
- No restore button. Dust never spawns package managers and never tracks rebuild completion.

## 7. Results View & Flows

### 7.1 Dashboard

Disk cards for all fixed volumes with usage bars (`statfs`), plus an "external" label for removable drives. The system-drive card offers Analyze and, with a snapshot present, shows "Last analyzed X d ago · Y GB reclaimable" plus View results; it is the only card tied to the global Quick Clean. Every other card offers Browse (session-only tree, Section 2.1) and shows no reclaimable/last-analyzed framing — there is no rule-based reclaim story outside the system drive.

### 7.2 Scan Lock & Mutual Exclusion

One global scan lock is held by whichever operation starts first (Analyze, Quick Clean, or a browse scan). A conflicting attempt shows "A scan is already running. Cancel it first?" with [Cancel it] / [Wait]. Quick Clean before any Analyze runs its own targeted scan (seconds); after an Analyze it builds its plan from Analyze data without re-scanning, showing the scan age. Browse scans never use Analyze or Quick Clean data and never write the snapshot.

### 7.3 Quick Clean Flow

Targeted scan if needed → plan screen (per-category bytes, per-category recovery notes, admin-required items) → explicit confirmation → execute → summary. node_modules never appears in Quick Clean — project cleanup requires Analyze evidence. The Recycle Bin row keeps its yellow irreversible treatment. Rows needing admin (`C:\Windows\Temp`) offer "Relaunch as Administrator" for that action only.

### 7.4 Analyze Flow

Pick the system drive → live view: progress header (files scanned, bytes seen, current paths, elapsed, cancel), Category Summary Strip filling in, Tree Table streaming rows as folders complete. Cancel keeps partial results, labeled cancelled. Completion persists the snapshot. Browse-only volumes use the same live view (progress header, cancel, streaming tree) but without the Category Summary Strip, grades, finalize, or snapshot.

### 7.5 Results Surfaces

- **Category Summary Strip:** reclaimable totals per category (Temp, Recycle Bin, npm cache, App caches, npm projects); clicking a category filters the tree. The fast path. The strip appears only for the system drive; browse-only volumes have no rules, hence no categories.
- **Tree Table:** columns Name (expand/collapse) | Size | Allocated (cluster-rounded approximation from the volume's cluster size; compressed files not decomposed) | file/folder count | % bar | Safety + why | Last modified | Action. Sortable on any column, default Size descending. In-place expansion to arbitrary depth; double-click opens Windows Explorer. Rows stream in and numbers finalize in place during scan. Virtualized for 100k+ rows (TanStack Table + react-virtual). The Action column shows Clean only for rule-matched rows; all others show Explore.

  Columns are mode-dependent. On the system drive the table shows Safety + why and the Clean action. On browse-only volumes the Safety column is absent (no grade, no evidence) and the Action column offers Delete (guarded, simple confirmation) and Explore; every other column is shared.
- Folder exploration is first-class: the analyzed root opens at the top level, every folder expands in place, arbitrary depth. This is the "where is my space going" experience with a Safety column.
- The Category Summary Strip and Tree Table coexist and read one data model: the strip is the fast path, the tree is the deep path.

### 7.6 Post-Cleanup UI State (any cleanup — Quick Clean or Analyze-triggered)

- **Tree Table:** cleaned rows are removed from the tree; parent sizes update in place. Collapsed parents update their numbers when the user next expands them.
- **Browse-only deletes:** the in-memory tree updates in place; there is no category strip or snapshot to update, and the deletion is not carried across relaunch (Section 2.1).
- **Category Summary Strip:** the cleaned category's value decreases to the new state. At zero it shows "0 B — nothing to clean" instead of disappearing (vanishing rows feel like bugs).
- **Snapshot:** updated immediately with new sizes plus a `cleanedAt` timestamp, so relaunch shows accurate numbers; disk cards show a "Last cleaned" line.
- **Success screen:** freed bytes, remaining reclaimable space, and a "View updated disk" button returning to the Results view. Dev Cleanup's summary additionally lists the copyable restore commands (Section 6.4).
- **Session-only state applies only to the Dev Cleanup "Recently cleaned" group;** general cleanup results are persistent as described above.

## 8. Performance Contract & Budget

**Contract (non-negotiable, independent of benchmarks):**

- Progress is always visible: streaming counters, tree rows, and category totals.
- The scan is cancellable at any moment with partial results retained and labeled; cancellation responds within ~1 s.

**Budget (a goal validated by the spike below, not a pass/fail gate on the MVP):**

- 1M files on SSD: target < 45 s; 60 s acceptable; > 90 s unacceptable without visible progress.

The budget applies to the system drive. Browse-only scans of other volumes are view-only and are not performance-gated; measured cold scans of secondary HDDs run 4-7x slower than the system SSD.

**Validation spike before UI investment:** benchmark the Node sync worker walk on the developer's real disk (expect 2-4M entries). If the budget is missed, levers in order: worker-count tuning, batch-size tuning, native enumerator behind the `Enumerator` interface. Windows Defender real-time scanning is the main variance source; measure with it enabled.

## 9. Edge Cases & Error Handling

- Scanner: per-entry try/catch; `EPERM` / `EACCES` / `EBUSY` counted and skipped; folder flagged "partially scanned" past a threshold. No single file can kill a scan.
- Cleaner: verifies existence at plan time; vanished paths report "already gone"; locked files skip and count; permission denials report per action. Nothing fails silently; nothing partially applies without a report.
- Browse-only Delete: the guard is re-checked at execution time; vanished paths report "already gone"; locked files are skipped and counted; refusals are surfaced per path. Nothing is deleted without the confirmation step.
- Cloud placeholder files: counted at logical size (documented limitation).
- Long paths: rely on Node's internal `\\?\` handling; verify during implementation.
- Snapshot: version mismatch shows a rescan banner; corruption discards and prompts; write failure is non-fatal.
- Non-NTFS volumes (exFAT, network): scanning works; cluster-size approximation falls back to 4096.
- Renderer closed mid-scan: workers are owned by main; a system-drive scan completes into the snapshot, a browse scan is discarded.
- Multiple Windows user profiles: only the current user's caches are scanned in MVP.
- Elevation: `C:\Windows\Temp` needs admin; MVP fallback is "Relaunch as Administrator" scoped to that action; a dedicated helper is an implementation-time decision.
- Antivirus interference: performance variance is expected; benchmarks must be run with Defender enabled.

## 10. Testing Strategy

- `core/` runs under vitest in plain Node with fixture trees generated in `os.tmpdir` (controlled sizes and mtimes).
- Rules: table-driven match / no-match / grade / recovery tests per rule; cache rules assert "renders only when the cache directory exists".
- Root-scoping: a regression test analyzes a non-system fixture root and asserts no rule ever returns a system-drive path (the data-loss guard from Section 5.1).
- System-drive policy: the system root is injectable; tests use a fixture system root instead of a literal `C:\`.
- Browse mode: a non-system scan produces rows without grade/action, never touches the snapshot, and refuses guarded paths on Delete.
- Classifier fixtures: npm lockfile, yarn lockfile, monorepo workspace, orphaned node_modules, patched, private registry, pnpm/bun (not offered), Keep pin.
- Display grade: table-driven — `C:\Users\X\AppData\Local\SomeApp\Cache` → green with reason; `C:\Users\X\RandomFolder` → yellow with reason; `C:\Windows\System32` → red with reason; a rule-matched path shows the rule's action grade instead of the pattern grade.
- Cleaner: guard fuzzing — random candidate paths including protected roots must always be refused; locked-file test via an open handle; plan-token test — execute with a forged or expired planId is refused.
- Concurrency (scan lock): Quick Clean while Analyze runs is blocked and surfaces the dialog path; after Analyze completes, Quick Clean starts without a re-scan (uses snapshot data); cancel-then-start works.
- Snapshot: round-trip, corruption discard, version-mismatch banners.
- Performance: gated `--perf` test on a 200k sparse-file tree; manual real-disk benchmark spike before UI work.
- Recovery text: every plan item carries a non-empty recovery statement.
- UI: React Testing Library for streaming table and selection logic; manual Electron smoke checklist for MVP.

## 11. Risks / Validate First

1. Performance goal on real hardware — spike #1, before UI investment (the visible-progress contract holds regardless of the outcome).
2. Elevation mechanism for `C:\Windows\Temp` (helper vs relaunch) — "Relaunch as Administrator" is the MVP fallback.
3. `fs.statfs` behavior on Windows — PowerShell `Get-Volume` fallback.
4. Cluster-size query for the Allocated column — default 4096 fallback.
5. Chrome/Edge cache paths drift across versions — centralized paths resolver plus fixture tests; treat as a maintenance surface.
6. Private registry sampling can produce false negatives — the warning is advisory only.
7. Rules matching system-drive paths while scanning another root — fixed by root-scoping rules to `ctx.root` (Section 5.1); covered by a regression test.
8. Browse-only permanent Delete on arbitrary volumes has no recovery path — mitigated by the drive-agnostic guard, execution-time re-check, and explicit confirmation; move/quarantine is Phase 2.

## 12. Phase 2 Pointers

Docker images, installed-apps manager, visual treemap, quarantine, snapshot versioning, real pnpm/bun support (global store math), Yarn Berry, broader browser cache coverage, editor-MRU activity signals, global npm package audit, NVIDIA/Steam caches, cross-platform, background scheduled scans, SQLite-backed full-tree persistence, move/quarantine for browse-only volumes.
