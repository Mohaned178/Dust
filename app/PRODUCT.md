# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Built with Electron + React + Tailwind. Runs locally on the user's machine.

## Screens & Surfaces

- **Dashboard** — landing screen. Volume cards with usage bars, per-volume actions (Analyze on the system drive, Browse on others), last-analyzed/last-cleaned info, and the two global actions: Analyze and Quick Clean.
- **Scan View** — live progress during an Analyze or browse scan. Shows files scanned, bytes seen, current path, elapsed time, error count, and a Cancel button.
- **Results** — the Tree Table plus Category Strip. Sortable rows, in-place expansion, Safety column (system drive only), Action column (Clean or Explore on the system drive; Delete on browse volumes).
- **Quick Clean** — targeted scan (if no Analyze data exists) → plan screen with per-category bytes and recovery notes → explicit confirmation → execute → freed-bytes summary.
- **Confirmation** — the explicit plan-confirmation screen before any deletion. Shows the total to be freed, per-item recovery notes, and Cancel/Confirm buttons. Modal overlay, not a routed page.
- **Success** — post-cleanup summary. Freed bytes, remaining reclaimable space, "View updated disk" button, and (for Dev Cleanup) copyable restore commands. Modal overlay, not a routed page.
- **Dev Cleanup** — npm project groups (Dead / Occasional / Active / Orphaned / Pinned), restorability badges, bulk select, confirmation with rebuild commands, per-project progress, session-only "Recently cleaned" group.
- **Browse View** — for non-system volumes. Same Tree Table without the Safety column, no Category Strip, no Clean actions. Just Delete with confirmation.

## Users

Primary user: a developer on Windows whose system drive fills up from development work — `node_modules` in abandoned projects, the npm download cache, Docker images, temp files, and forgotten projects. They are technical, comfortable with the command line and package managers, and use Dust on their own machine.

Their job: reclaim disk space quickly and safely, without the risk of deleting something important. Two emotional drivers frame the job — friction (cleaning takes too many steps, so they procrastinate) and fear (no tool gives a trustworthy answer to "is this safe to delete?").

Developer-first is a deliberate design target. A less-technical Windows user is not a primary audience; developer-specific insight is the wedge, not an accommodation to strip out.

## Product Purpose

Dust scans a drive, shows where the space went, and removes the junk that accumulates during development work while explaining why each item is safe (or not) to delete. It exists because developers know their disks are full of junk, but existing cleanup tools either take too many steps to use or give no trustworthy safety answer.

Success means the user reaches a clean disk in a few explicit steps — Analyze → see what is reclaimable → confirm a plan → execute — and trusts every deletion because Dust explained it first.

## Positioning

The wedge is npm cleanup: `node_modules` of dead projects plus the npm download cache is the reason a developer installs Dust. Temporary-file cleaning is commodity.

Dust competes on safety classification, developer-specific insight, and making waiting feel productive — not on raw scan speed. It explicitly does not chase WizTree-class MFT scan speed. What a neighboring cleanup tool could not truthfully copy: a per-match safety grade (green/yellow/red) with a "why this grade" explanation on every row, a recovery statement on every plan item, and a hard rule that nothing is deleted without a preview and explicit confirmation.

## Operating Context

- Windows-first desktop application (Electron). Runs locally on the user's own machine; no account, cloud, or remote service is part of the product.
- Scans are read directly from the local filesystem. The Electron main process owns scan sessions and the cleaner; the renderer holds no engine state and touches no filesystem.
- The system drive (boot volume, normally `C:\`) gets the full treatment: Analyze, rule matching, safety grades, Quick Clean, Dev Cleanup, cache registry, and snapshot persistence.
- Every other fixed, removable, or network volume is browse-only: the same scanner shows size and structure, but no safety judgment, no rules, no cleanup categories. The only action is a guarded permanent Delete with a simple confirmation, and results are session-only.
- Scan results for the system drive persist to `userData/snapshot.json`, so relaunch shows the dashboard instantly; a snapshot-age banner communicates staleness and a `rulesVersion` mismatch prompts a rescan.
- One global scan lock makes Analyze and Quick Clean mutually exclusive. A conflicting attempt shows "A scan is already running" with Cancel it / Wait.
- Scans are progressive and cancellable: results stream in as folders complete, and cancelling keeps partial results, labeled.
- The current UI is a working incumbent that is slated for redesign; performance also needs improvement.

## Capabilities and Constraints

Confirmed MVP functionality:

- Dashboard with disk cards for fixed volumes (usage bars, `external` label for removable/network), last-analyzed/last-cleaned info, and the two global actions: Analyze and Quick Clean.
- Analyze: deep, progressive, cancellable scan of the system drive with live progress (files scanned, bytes seen, current paths, elapsed, error count).
- Tree Table with a Safety column: sortable Name / Size / Allocated / Files-Folders / % / Safety / Last modified / Action columns, in-place expansion to arbitrary depth, virtualized for large trees, double-click to open Explorer.
- Category Strip: reclaimable totals per category (Temp, Recycle Bin, npm cache, App caches, npm projects); clicking a category filters the tree.
- Dev Cleanup: npm project discovery from Analyze data, grouped Dead / Occasional / Active / Orphaned / Pinned, restorability badges, bulk "Select all Dead + green", confirmation with rebuild commands, per-project progress, and a session-only "Recently cleaned" group holding copyable restore commands.
- Quick Clean: targeted scan when no Analyze data exists, otherwise built from the freshest Analyze results without re-scanning; per-category plan with recovery notes, explicit confirmation, execute, freed-bytes summary. Never touches `node_modules`. `C:\Windows\Temp` items offer "Relaunch as Administrator".
- Snapshot persistence and the single global scan lock.

Durable constraints and rules:

- Windows-only at MVP.
- No automatic deletion, ever. Every deletion is user-confirmed. System-drive cleanup is enforced by single-use, in-memory plan tokens in the cleaner API; red or unknown paths never enter a plan.
- Per-category recovery, not a blanket Recycle Bin: permanent delete only when a rule proves the asset is regenerable (exact restore command shown) or worthless.
- Action grade and display grade are separate: only whitelisted rules produce action grades; unknown paths are never actionable. Display grades are informational only.
- A hard red list (system-critical roots such as `C:\Windows`, Program Files, ProgramData, profile and volume roots) is read-only, hidden behind a "Show danger" toggle, and never actionable.
- No restore feature: Dust never runs package managers, manages background processes, or tracks rebuilds.
- Cache registry pattern: browser and app caches are self-contained rule files; adding one requires no engine changes.
- Unsupported managers are never offered for cleanup: real pnpm/bun support (global store and symlink math) and Yarn Berry are deferred.

Explicitly undecided / Phase 2 (do not present as shipped): Deep Uninstall (installed-apps manager — planned next), Docker image cleanup, visual treemap, quarantine/recovery buffer, cross-platform, background scheduled scans, SQLite-backed full-tree persistence, editor-MRU activity signals, global npm package audit, NVIDIA/Steam caches, broader browser cache coverage.

## Brand Commitments

- Name: **Dust**. Final.
- Tagline: **"Find what is safe to delete."** Final.
- Voice: **Calm Confidence** — plain, factual, direct. This is binding on all user-facing copy; any new screen inherits it without renegotiation, and a different tone (e.g. for a destructive action) must extend the voice, not contradict it.
  - No exclamation marks; no emoji in production copy (a single small icon may appear in empty states; a single small checkmark is allowed on the success screen).
  - No marketing language ("Amazing!", "Oops!", "We're sorry").
  - No technical jargon shown to users (no "EPERM", no "EACCES").
  - No fear-mongering ("This will destroy your files!").
  - No patronizing ("Great job!", "You did it!").
  - Examples: Loading — "Scanning C:\ — 645,475 files." Error — "Couldn't read this folder. Skipped." Empty — "Nothing to clean here." Confirm — "This will permanently delete 4.3 GB. This cannot be undone." Success — "Done. Freed 4.3 GB." Warning — "This may take a few minutes on this drive."
- Iconography: minimal line icons only.
- Logo: not defined yet. A placeholder text wordmark "Dust" in the app header; a final logo is a Phase 2 concern.
- Color: the accent is a fixed brand asset — **Pine Teal** (`#0f6e6e`), calm, fresh, and clinical. It is not user-configurable and no theme picker exists. The product ships **light-first**: a clean white background, near-black text, and that single accent; it lives in one token and no hardcoded hex appears outside `styles.css`. A dark mode may follow in Phase 2 but is not required for the MVP.

## Evidence on Hand

- `PROJECT_BRIEF.md` — the project entry point: what Dust is, the problem, MVP scope, architecture, the 13 locked decisions, and design principles.
- `docs/superpowers/specs/2026-09-17-dust-mvp-design.md` — the full approved MVP design spec (problem/positioning, scope, locked decisions, architecture, safety model, project classification, UX flows, performance contract, edge cases, testing, risks, Phase 2).
- `docs/superpowers/plans/` — the ordered implementation plans for Plans 1–9.

Absences future work must not fabricate: no testimonials, customers, case studies, press, benchmarks, pricing, licensing, or deployment claims exist. The performance figures (e.g. "1M files under 45 s") are internal goals, not published evidence.

## Product Principles

1. **Safety is the product, not a feature.** Every deletion is previewed and explicitly confirmed; recovery is per-category and honest about irreversibility. When safety and convenience conflict, safety wins.
2. **Trust through explanation.** Every grade carries its "why"; every plan item carries its recovery statement; nothing fails or deletes silently. The user should never have to take Dust's word on faith.
3. **Make waiting productive.** Progress is always visible and every scan is cancellable with partial results kept. A slow scan must still feel like forward motion.
4. **Developer-specific insight over commodity cleaning.** The npm/`node_modules` wedge and developer-oriented signals are the differentiation; general disk cleanup is the table stakes around them.
5. **Communicate with calm confidence.** Plain, factual, direct copy that neither sells, alarms, nor patronizes.
6. **Light-first UI.** Clean, quiet, readable. No dark-theme-default aesthetic.

## Accessibility & Inclusion

Target a standard baseline: WCAG 2.1 AA-style contrast, full keyboard navigation, and screen-reader labels on interactive controls. No product-specific accessibility need was established beyond this baseline.
