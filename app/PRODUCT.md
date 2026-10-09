# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Built with Electron + React + Tailwind. Runs locally on the user's machine.

## Screens & Surfaces

The window has a 240 px sidebar (a 56 px icon rail below 1100 px) and one page at a time. Pages stay in memory once visited and stop their background work while hidden.

- **Home** — "how is my PC?" without a score. A headline of what can be freed (the sum of rows the user can open; Clean up then ticks only the safe ones), a bar of the drive by category, Scan again and Quick clean, other drives, and four tiles (Startup, Apps, PC Health, Developer).
- **Clean up** — a scan view (progress, elapsed time, the current path, what has been found so far, Cancel), then the results: categories that open in place into their items, with Keep, Show in Explorer, a "Take a look first" group for categories with nothing safe, and a sticky footer that says what is selected.
- **Clean dialog** — one dialog for every deletion: the plan, an acknowledgement when something cannot be recovered, progress, and a summary with the drive before and now. The confirm button names the amount. Modal overlay, not a routed page.
- **Explore disk** — a lazy folder tree, a treemap of the current folder, search, a "Show protected items" switch, and Show in Explorer.
- **Apps** — installed apps with real icons and sizes; a step-by-step uninstall (the app's own uninstaller, then the leftovers to choose from).
- **Startup** — one switch per Windows startup entry, optimistic with Undo, protected rows locked, administrator handoff for machine-wide entries.
- **PC Health** — processor and memory rings, storage per drive, and spec cards.
- **Developer** — `node_modules` grouped by when each project was last used, with rebuild commands, and a Toolchain caches section.
- **Settings** — about, privacy statement, administrator relaunch, updates.

## Users

Everyone who owns a Windows PC and wants it to feel lighter and more orderly, in the same class as Microsoft PC Manager, plus developers, who get a dedicated section. The person might be a student whose laptop is full, a gamer with a dozen launchers, or an engineer with years of `node_modules`. None of them should need to know what a cache is.

Their job: get space back and keep the PC tidy, without the risk of deleting something important. Two feelings frame it. Friction (cleaning takes too many steps, so it never happens) and fear (no cleaner gives a trustworthy answer to "is this safe to delete?", and many act like scareware).

## Product Purpose

Dust scans a drive, shows where the space went, and removes what is safe to remove while explaining, before anything is deleted, what each item is, why it is safe and how it comes back. It also manages what runs at startup, what is installed, and what the PC is made of, and it keeps a dedicated section for developer cleanup.

Success means the user reaches a lighter PC in a few explicit steps (scan, see what can be freed, confirm a plan, delete) and trusts every deletion because Dust explained it first.

## Positioning

Dust competes on trust: a per-item grade with a reason, a recovery statement on every plan item, exact sizes and paths, item-by-item choice (Microsoft PC Manager picks for you), and a hard rule that nothing is deleted without a preview and explicit confirmation. It does not chase raw scan speed.

What it will never do, because that is the line between a cleaner and scareware: no health score, no registry cleaner, no alarm banners or countdowns, no inflated issue counts, no upsells, and no background or automatic deletion.

The developer wedge stays: `node_modules` of projects nobody has opened for months, plus the package cache, with the exact command that brings each one back.

## Operating Context

- Windows-first desktop application (Electron). Runs locally on the user's own machine; no account, no telemetry, and the only network use is checking GitHub for updates (and downloading one when it is found).
- Scans are read directly from the local filesystem. The Electron main process owns scan sessions and the cleaner; the renderer holds no engine state and touches no filesystem.
- The system drive (boot volume, normally `C:\`) gets the full treatment: rule matching, safety grades, Quick clean, developer cleanup, the cache registry, and snapshot persistence. Other drives are shown (usage) and can be scanned, but are not cleaned.
- Scan results for the system drive persist to `userData/snapshot.json`, so relaunch shows Home instantly; a notice says when the rules changed or the scan was depth-limited.
- One global scan lock makes a scan and a clean mutually exclusive. A conflicting attempt shows "A scan is already running." with Cancel it and scan / Wait.
- Scans are progressive and cancellable, and cancelling keeps the partial results, labelled.
- A saved scan keeps only the top of the folder tree (depth 4 plus the cleanup matches); Explore disk says so where it matters.

## Capabilities and Constraints

Shipped:

- Home, scan, Clean up, Quick clean and the Clean dialog; Explore disk; Apps with deep uninstall; Startup; PC Health; Developer; Settings and updates.
- Snapshot persistence, the global scan lock, and an elevated-relaunch handoff for startup changes and uninstalls.

Durable constraints and rules:

- Windows-only at MVP.
- No automatic deletion, ever. Every deletion is user-confirmed. System-drive cleanup is enforced by single-use, in-memory plan tokens in the cleaner API; protected or unknown paths never enter a plan.
- Per-category recovery, not a blanket Recycle Bin: permanent delete only when a rule proves the asset is regenerable (exact restore command shown) or worthless.
- Action grade and display grade are separate: only whitelisted rules produce action grades; unknown paths are never actionable. Display grades are informational only.
- A hard list of system-critical roots (`C:\Windows`, Program Files, ProgramData, profile and volume roots) is read-only, hidden until "Show protected items" is on, and never cleaned.
- No restore feature: Dust never runs package managers, manages background processes, or tracks rebuilds.
- Cache registry pattern: browser and app caches are self-contained rule files; adding one requires no engine changes.
- Unsupported managers are never offered: real pnpm/bun support and Yarn Berry are deferred.

Known gaps (do not present as shipped): a verdict for startup entries and boot time, disk, battery and memory-slot health, new developer caches, a quarantine with Undo for deletions, a restore point before uninstall, a persistent "ignore forever" list, dark mode, code signing, and a rule that keeps node_modules inside installed apps out of Developer.

## Brand Commitments

- Name: **Dust**. Final.
- Tagline: **"Find what is safe to delete."** Final.
- Voice: **Calm Confidence** — plain, factual, direct. This is binding on all user-facing copy; any new screen inherits it without renegotiation, and a different tone (for a destructive action, say) must extend the voice, not contradict it.
  - No exclamation marks; no emoji in production copy.
  - No marketing language ("Amazing!", "Oops!", "We're sorry").
  - No technical jargon shown to users (no "EPERM", no "EACCES", no raw exception text).
  - No fear-mongering ("This will destroy your files!"), no scores, no "issues found".
  - No patronizing ("Great job!", "You did it!").
  - Examples: Loading — "Scanning C:\ — 645,475 files." Error — "Dust could not read this folder." Empty — "Nothing to clean right now." Confirm — "Delete 4.3 GB." Success — "4.3 GB freed." Warning — "Large folders can take a few minutes."
- Iconography: Fluent Regular line icons (20 px, 24 px in the sidebar), imported only through `src/ui/icons.ts`.
- Logo: a placeholder mark and the wordmark "Dust" in the title bar; a final logo is a later concern.
- Look: a light Windows 11 / Fluent style. The accent is **Windows blue** (`#0F6CBD`) on an off-white canvas (`#F7F9FC`). Every color is a CSS token in `renderer/src/styles/tokens.css`, so a dark mode can be added later by changing tokens only. There is no theme or palette picker. See `DESIGN.md`.

## Evidence on Hand

- `PROJECT_BRIEF.md` — the project entry point: what Dust is, the problem, scope, architecture, the locked decisions, and design principles.
- `docs/FRONTEND-PLAN.md` — the rebuilt interface: decisions, trust principles, design system, screens, performance budgets, and a log of what was built and measured in each phase.
- `docs/superpowers/specs/2026-09-17-dust-mvp-design.md` — the approved MVP design spec for the engine.
- `docs/superpowers/plans/` — the ordered implementation plans for the engine and app.

Absences future work must not fabricate: no testimonials, customers, case studies, press, pricing, licensing, or deployment claims exist. The performance figures in `docs/FRONTEND-PLAN.md` are measurements on one machine, not published benchmarks.

## Product Principles

1. **Safety is the product, not a feature.** Every deletion is previewed and explicitly confirmed; recovery is per-category and honest about irreversibility. When safety and convenience conflict, safety wins.
2. **Trust through explanation.** Every grade carries its reason; every plan item carries its recovery statement; every headline total is the sum of rows the user can open. The user should never have to take Dust's word on faith.
3. **Make waiting productive.** Progress is always visible and every scan is cancellable with partial results kept.
4. **Make safe the default.** Only items graded safe start ticked. Nothing the user unticks is touched.
5. **Communicate with calm confidence.** Plain, factual, direct copy that neither sells, alarms, nor patronizes.
6. **Fast and light.** Every screen opens in under 200 ms, lists stay at 60 fps with 100,000 rows, and the renderer's memory stays small. See the budgets in `docs/FRONTEND-PLAN.md`.

## Accessibility & Inclusion

WCAG 2.1 AA-style contrast (checked token by token), full keyboard navigation with a visible focus ring on every control, labels on every interactive control, `prefers-reduced-motion` respected, and focus that moves to the page heading when the page changes.
