# Dust — Frontend Rebuild Plan

> This file is the handoff for the implementation
> session. Written 2026-10-09 on branch `feat/ui-overhaul`.

## Context

The current renderer (`app/renderer/`) is slow and crowded:

- It pulls the **entire folder tree** (about 279k rows, a 228 MB renderer heap) over IPC and rebuilds it in React.
- Search scans every node on each keystroke.
- Streamed sizes and icons re-render whole, non-virtualized lists.
- Every page unmounts on navigation.
- Dialogs use full-screen `backdrop-blur`, and up to 250 bars play clip-path animations at once.

The design also targets developers only. The owner wants Dust to become a PC manager that **anyone** can trust and use
every day, in the same class as Microsoft PC Manager. Developer cleanup stays as one dedicated section.

**Decisions made with the owner (2026-10-09):**

| Topic | Decision |
|---|---|
| Audience | Everyone, plus a dedicated Developer section. `PRODUCT.md` is updated to match (phase 11). |
| Look | Light, Windows 11 / Fluent feel. Accent is **Windows blue `#0F6CBD`** on an off-white `#F7F9FC` canvas. This replaces petrol blue. |
| Dark mode | Not now. Every color is a CSS token, so dark mode can be added later by changing tokens only. |
| Strategy | Build a **new renderer in `app/renderer-next/`** against the same `window.dust` API, one screen at a time. Switch the build over at parity, then delete `app/renderer/`. The app stays runnable throughout. |

**Outcome:**

- A calm, native-feeling, fast UI.
- Every screen opens in under 200 ms.
- Scrolling stays at 60 fps with 100k+ rows.
- Every deletion is explained before it happens.

## How to run this plan

**Who does what:**

- **Sonnet 5.5, high effort:** implements. Work one phase at a time, in order, with one commit per phase (conventional
  commits). Do not push.
- **Haiku:** code search, checking paths, and mechanical edits.
- **Opus:** plans and reviews each phase's diff against its "Done when" list.

**After each phase:**

- Run `npm run typecheck`, `npx eslint .`, and `npm test -w app`.
- Run the app with `DUST_RENDERER=next npm run dev -w app` and look at the changed screens.
- Tick the checkboxes here, then stop and summarise.

**Starting prompt for the Sonnet session:**

```
Implement docs/FRONTEND-PLAN.md on branch feat/ui-overhaul. Read it fully first, then git log -5
and git status. Do the next unchecked phase only, meet its "Done when" list, run typecheck, lint
and app tests, tick the boxes, commit (don't push), then stop and summarise what to look at in
the running app. Use Haiku subagents for code search. Ask before anything this plan doesn't cover.
Do not change app/renderer/ (the old UI) except in phase 11.
```

**Rules for every phase:**

- **The backend contract is fixed.** Use `DustApi` from `app/src/shared/ipc.ts` exactly as it is. Phase 0.4 lists the
  only allowed IPC additions.
- **No hex values outside `tokens.css`.** No inline styles, except for virtualizer positioning and computed widths.
- **Voice is "Calm Confidence"** (from `app/PRODUCT.md`):
  - Plain, factual and short.
  - No exclamation marks, emoji, jargon (`EPERM`) or fear words.
  - No made-up scores or "issues found" counts.
- **Every interactive element:**
  - Is reachable by keyboard.
  - Shows a visible focus ring.
  - Has a label. Icon-only buttons need an `aria-label` and a tooltip.
- **Respect `prefers-reduced-motion`.**

---

## 1. Trust principles (what makes people trust a PC cleaner)

_Research-backed. Sources: section 9._

**Do:**

1. **Explain before acting.** Every category shows three things:
   - What it is, in plain words ("Files Windows and apps leave behind while working").
   - Why it is safe.
   - How it comes back ("Re-downloaded when needed", "Cannot be recovered").
2. **Make safe the default.** Only `safe` items are preselected. "Review" items sit in a separate, unselected "Take a
   look" group. Protected items are never actionable.
3. **Show exact numbers and paths.** Sizes are exact. Paths are one click away (expand a category) and can be opened
   in Explorer.
4. **Never surprise.** No automatic cleaning, no background deletion, no one-click-and-done.
   - The confirm button states what will happen: "Delete 4.2 GB".
   - Afterwards, a summary says exactly what was freed and what failed.
5. **No scareware patterns.** Microsoft Defender classes cleaners as *unwanted software* when they report errors "in an
   exaggerated or alarming manner", push the user to act within a time limit, or make "misleading or inaccurate claims
   about files, registry entries". Dust must never come close to that line:
   - No red alarm banners or "Your PC is at risk".
   - No 0–100 health score.
   - No registry cleaner.
   - No inflated issue counts.
   - No countdowns.
   - No upsells.
   - Red is used only for deletion confirmations and protected items.
   - Every headline total is the sum of itemised rows the user can open.
6. **Let the user choose, item by item.** Microsoft PC Manager picks the items itself and offers no per-item choice;
   reviewers criticise this. Follow CleanMyMac's "Review details" and BleachBit's "Preview" pattern instead:
   - Every category can be expanded.
   - Every item can be unticked.
   - Unticked items are never touched.
   - Uninstall leftover scans default to the safest level, and the user checks each entry rather than "select all".
7. **Be open about the app itself.** Settings > About shows:
   - Version and license (open source, with a link to the repo).
   - "Runs entirely on this PC. No account. No telemetry. Only checks GitHub for updates."
   - Where logs are kept.

   Verify each claim in the code before shipping it.
8. **Look native.** Use Windows 11 typography (Segoe UI Variable), a Fluent-style spacing and radius scale, and a
   light title bar that matches the app. A familiar look is itself a trust signal.

---

## 2. Design system

All tokens live in `app/renderer-next/src/styles/tokens.css` as CSS custom properties. Tailwind v4's `@theme`
maps them to utilities. Contrast was checked with a WCAG calculator on 2026-10-09.

### 2.1 Color (light)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--canvas` | `#F7F9FC` | Window and page ground | |
| `--surface` | `#FFFFFF` | Cards, dialogs, lists | |
| `--surface-hover` | `#F3F6FA` | Row and button hover | |
| `--surface-pressed` | `#EAEFF5` | Pressed and selected-neutral | |
| `--border` | `#E3E8EF` | 1px hairlines | |
| `--border-strong` | `#CDD5DF` | Input borders, outline-button hover | |
| `--ink` | `#1B1B1F` | Primary text | 16.3:1 on canvas |
| `--ink-2` | `#5C6370` | Secondary text | 5.7:1 on canvas, 6.0:1 on white |
| `--ink-3` | `#8A8F98` | Icons and disabled only, **never body text** | 3.25:1 |
| `--accent` | `#0F6CBD` | Primary buttons, links, selection, focus, usage fill | 5.4:1 white-on-accent |
| `--accent-hover` / `--accent-pressed` | `#115EA3` / `#0F548C` | Primary button states | |
| `--accent-soft` / `--accent-border` | `#EBF3FC` / `#B4D6FA` | Selected nav item, selected chip, info notice | 5.95:1 for `#115EA3` on soft |
| `--safe` / `--safe-soft` | `#0E700E` / `#F1FAF1` | "Safe" pill (text plus dot) | 5.9:1 |
| `--review` / `--review-soft` | `#8A5A00` / `#FFF9F0` | "Review" pill | 5.7:1 |
| `--danger` / `--danger-soft` | `#B10E1C` / `#FDF3F4` | "Protected" pill, error text | 6.5:1 |
| `--danger-fill` | `#C42B1C` | Destructive confirm button fill only | 5.7:1 white-on-fill |
| `--chart-1…5` | Five calm hues, with blue first | Category segments in the storage bar | Validate with the `dataviz` skill palette check |

**Rules:**

- Safety colors (safe, review, danger) never decorate chrome.
- A grade is always a **word plus a dot**, never color alone.
- One accent per screen region. Per-row actions are neutral and take the accent on hover.

### 2.2 Typography

- **Text:** `"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`. Headings use the
  `Display` optical size where available.
- **Data:** `"Cascadia Mono", Consolas, ui-monospace, monospace` for paths, restore commands and rule ids only.
- **Sizes and counts** use the text font with `font-variant-numeric: tabular-nums`, which is friendlier for everyday
  users than monospace.
- **Type ramp** (Fluent 2):

  | Style | Size / line height | Weight |
  |---|---|---|
  | caption | 12/16 | regular |
  | body | 14/20 | regular, or 600 for strong |
  | subtitle | 20/28 | 600 |
  | title | 28/36 | 600 |
  | hero figure | 40/52 | 600, tabular |

  Nothing below 12px.

### 2.3 Spacing, radius, elevation, motion

- **Spacing:** 4px grid, following the Fluent 2 scale. Steps: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48. The 2 and 6
  steps are for aligning icons only.
  - Page gutter 32px; 24px below 1100px.
  - 24px between cards; 12px inside groups.
- **Radius** (Windows 11 geometry: `ControlCornerRadius` 4, `OverlayCornerRadius` 8):
  - 4px: buttons, inputs, checkboxes, progress bars, tooltips, small chips.
  - 8px: cards, list containers, flyouts, dialogs.
  - Full: pills only.
- **Elevation** (static only, never animated):

  | Level | Treatment | Use |
  |---|---|---|
  | `--shadow-card` | `0 1px 2px rgba(0,0,0,.05)` plus border | Cards |
  | `--shadow-flyout` | `0 8px 16px rgba(0,0,0,.12)` | Menus, tooltips |
  | `--shadow-dialog` | `0 24px 48px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08)` | Dialogs |

  Dialog backdrop: `rgba(0,0,0,.3)` with **no blur**.
- **Motion** (Fluent 2 tokens):
  - Durations: `--dur-faster` 100ms for hover and press; `--dur-fast` 150ms to open a disclosure or toast;
    `--dur-normal` 200ms for dialog entrance; `--dur-slow` 300ms maximum. Exits use one step shorter than entrances.
  - Easing: `--ease-enter` is DecelerateMax `cubic-bezier(0.1,0.9,0.2,1)`; `--ease-exit` is AccelerateMid
    `cubic-bezier(1,0,1,1)`; `--ease-standard` is EasyEase `cubic-bezier(0.33,0,0.67,1)`.
  - Page changes use a quick 100ms fade, never a slide.
  - **Animate only `transform` and `opacity`.** No width, height or clip-path animation.
  - No mount animation on list rows.
  - Progress bars update their `transform: scaleX()` directly.
  - Under reduced motion every duration becomes 0.

### 2.4 Icons

- Use `@fluentui/react-icons` with the Regular style at 20px (24px in the nav) for a native Windows look.
- Import icons only through `src/ui/icons.ts`, a re-export module. A future swap then touches one file.
- Check the dev-server cold start after adding them. If it regresses by more than 1 s, switch `icons.ts` to deep
  per-icon imports.
- **App icons** are the real program icons (data URLs from the backend), shown at 32px. If an icon fails to load,
  show a letter tile.

### 2.5 Component kit (`app/renderer-next/src/ui/`)

- Build on **Radix Primitives** (`radix-ui` package) for behavior and accessibility: Dialog, Checkbox, Switch, Tabs,
  Tooltip, DropdownMenu, Progress, Collapsible, ScrollArea (optional).
- Style with Tailwind and the tokens.
- **Do not use Fluent UI v9 components.** About 62 dependencies and a runtime CSS-in-JS engine are too heavy for this
  app.

| Component | Notes |
|---|---|
| `Button` | Variants: primary, secondary (outline), subtle (ghost), danger. Sizes: md (32px), lg (40px). Has a `loading` state, keeps its width, and can carry an icon. |
| `IconButton` | 32px square. Requires `label`, which sets both `aria-label` and the tooltip. |
| `Card`, `CardHeader`, `Section` | 8px radius, border, card shadow. |
| `PageHeader` | Title, an optional one-line subtitle, and actions on the right. |
| `Checkbox` | Supports a tri-state (indeterminate) value. |
| `Switch`, `Tabs`, `SegmentedControl` | For filters such as All / Enabled / Disabled. |
| `SearchBox` | 300ms debounce built in. Clear button. `Ctrl+F` focuses it. |
| `ProgressBar` | Determinate or indeterminate. Uses `transform: scaleX`. Has `role=progressbar` and `aria-valuetext`. |
| `UsageBar` | Stacked segments with a legend. Each segment can be a button. |
| `Ring` | SVG ring for drive usage and CPU/memory. No transition while a value is streaming. |
| `GradePill`, `Badge`, `Tag` | |
| `Notice` | Variants: info and warning. One line plus an optional action. |
| `Toast` + `useToast` | `aria-live="polite"`. Auto-dismisses after 5 s and pauses on hover. Can carry an Undo action. |
| `Dialog` + `ConfirmDialog` | Focus trap, Escape to close, focus returns to the trigger. The confirm button's text states the action. |
| `EmptyState`, `ErrorState` | Error state includes a Retry button. |
| `Skeleton` | Static blocks. Opacity pulse only. Shows only after 150 ms, so instant loads never flash. |
| `VirtualList` | Thin wrapper over `@tanstack/react-virtual`. Fixed row height by default. Takes `getKey`. Rows render through a memoized row component. |
| `Stat` | Label plus tabular figure. |
| `Kbd` | |
| `FileSize`, `RelativeTime` | Formatting components. Reuse `renderer/src/format.ts` logic by copying it into `renderer-next/src/lib/format.ts`. |

A dev-only **Gallery** page (`#gallery`, excluded from production builds) shows every component in every state. It
is the visual review surface for phase 1.

---

## 3. Information architecture and screens

**Window:**

- Default size 1200×800, minimum 960×640.
- Light **native title bar overlay**: `titleBarStyle: 'hidden'` plus
  `titleBarOverlay: { color: '#F7F9FC', symbolColor: '#1B1B1F', height: 40 }`. The app draws its own 40px drag
  region with the Dust logo and name.
- `BrowserWindow.backgroundColor` changes from `#0b0b0c` to `#F7F9FC`. This removes the dark flash on launch.

**Sidebar:**

- 240px wide. Below 1100px it compacts to a 56px icon rail. The rail switches instantly, with no width animation.
- The active item gets the accent-soft background and `aria-current`.

```
┌──────────────┬─────────────────────────────────────────────┐
│ ◇ Dust       │                                    — □ ✕    │  ← 40px title bar (overlay)
├──────────────┼─────────────────────────────────────────────┤
│ ⌂ Home       │                                             │
│ ✦ Clean up   │              page content                   │
│ ▦ Apps       │       (max-width 1040px, centered)          │
│ ⏻ Startup    │                                             │
│ ♥ PC Health  │                                             │
│ </> Developer│                                             │
│              │                                             │
│ ⚙ Settings   │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

**Navigation:**

- A typed view state lives in a Zustand `nav` store (`{ page, params }`). There is no router library.
- Pages are `React.lazy` chunks.
- Pages render inside React 19 **`<Activity mode={active ? 'visible' : 'hidden'}>`**. Leaving a page keeps its state
  (selection, scroll, search) and pauses its effects, including polling.
- Visited pages are kept. At most 4 hidden pages are kept; the oldest is dropped first.
- On page change, move focus to the page `<h1>`.

### 3.1 Home

The answer to "how is my PC?" in one glance. There is no score.

```
Good afternoon                                         (no score, no alarms)
┌──────────────────────────────────────────────────────────────┐
│  4.2 GB can be freed safely                [ Clean up 4.2 GB ]│  hero card
│  Last checked 2 days ago · C:\        Quick clean · Scan again│
│  ███████████████████████████░░░░░░  187 GB of 237 GB used     │
│  ■ Temp 1.9 GB ■ Browser 1.1 GB ■ Recycle Bin 0.8 GB ■ …      │  segments link to Clean up
└──────────────────────────────────────────────────────────────┘
┌ Other drives ─────────────┐  (one row per drive: usage bar + used/free)
┌ Startup ──────┐┌ Apps ─────────┐┌ PC Health ────┐┌ Developer ────┐
│ 9 start with  ││ 142 installed ││ Memory 61%    ││ 5.2 GB in     │
│ Windows       ││               ││ CPU 12%       ││ caches        │
└───────────────┘└───────────────┘└───────────────┘└───────────────┘
```

- **Hero states:**
  - Never scanned: "Find out what can be freed on C:\" with a [Scan C:\] button.
  - Scanning: a compact progress bar. Selecting it opens the scan view.
  - Results: as in the sketch above.
  - Nothing to clean: "C:\ is in good shape. Nothing to clean right now." with a "Scan again" button.
- **Data:** `getDashboard`, `getResultCategories(systemRoot)`, `getStartup`, `listUninstallApps`,
  `getSystemInfoLive`, `getDevCleanup`.
- **Tiles** render as soon as their own data arrives. Each tile has its own skeleton.

### 3.2 Scan (inside Clean up)

- One card with:
  - A determinate ring or bar when the total is known.
  - "Scanning C:\ — 645,475 files".
  - The current path in mono, on one line, truncated in the middle.
  - Elapsed time.
  - "Found so far" category figures.
  - A [Cancel] button.
- Progress arrives from the event bridge (phase 2), coalesced to at most 10 renders per second.
- Elapsed time ticks from a local 1 s timer, not from events.
- **On finish:** go straight to the results.
- **On cancel:** show the partial results with a notice: "Scan cancelled. Showing what was found."
- **Busy lock:** a dialog says "A scan is already running." with [Cancel it and scan] and [Wait].

### 3.3 Clean up (results)

Category-first, as in workstream 2 of `docs/ENHANCEMENT-PLAN.md`. Its tests and design move here.

```
Clean up                                              [Scan again]
C:\ · checked 5 minutes ago                       (one-line notice row if stale/depth-limited/cancelled)
┌──────────────────────────────────────────────────────────────┐
│ [x] (icon) Temporary files   Left behind by Windows and apps  4.1 GB ›│
│ [x] (icon) Browser caches    Chrome, Edge, Firefox            3.0 GB ›│
│ [x] (icon) Recycle Bin       23 items                         1.1 GB ›│
├ Take a look first (not selected) ────────────────────────────┤
│ [ ] (icon) Old downloads …                                    2.0 GB ›│
└──────────────────────────────────────────────────────────────┘
 Developer caches 5.2 GB ›   Explore disk ›
──────────────── sticky footer ─────────────────
 3 categories · 8.2 GB selected                 [ Review and clean ]
```

- **Category row:** icon, name, one-line description, item count, size, and a tri-state checkbox.
  - Selecting the chevron expands the row **in place** into a virtualized list of its items: path, size, grade pill,
    a "why" line, Keep, and Open in Explorer.
  - Recovery details load lazily with `previewClean({scope:'row'})`, as today.
- **Category descriptions and icons:** a new `renderer-next/src/lib/categories.ts`, keyed by category id from
  `ResultsCategoriesState`. Check the ids in `app/src/shared/categories.ts` with Haiku.
- **Footer:** the primary button opens the **Clean dialog**. It shows the plan from `previewClean`:
  - The total.
  - Each category's recovery note.
  - The acknowledgement checkbox, only when review or unrecoverable items are in the plan.
  - A confirm button with the size: "Delete 8.2 GB".

  Then: progress ("Deleted 120 of 340 items · 3.1 GB freed") → a summary with a before/after drive bar and any
  failures in plain words. "Relaunch as administrator" appears when an item needs it.
- **Explore disk** opens a sub-view with two tabs:
  - **Folders:** a virtualized lazy tree. See 4.3 for the IPC.
  - **Map:** a treemap of the current folder, using `d3-hierarchy` squarify with at most 40 tiles.

  It has its own search, which is debounced, runs in the main process and is capped at 500 hits. Protected items stay
  hidden until "Show protected" is on.

### 3.4 Apps (uninstall)

- **Header:** "142 apps · 38.4 GB". Search box. Sort by Size, Name or Install date.
- **List:** virtualized, fixed 56px rows. Each row shows the app icon, name, publisher, version, install date, size,
  and an [Uninstall] subtle button that appears on hover or focus.
- Sizes and icons arrive by event. They go into a `Map` in the apps store, and each row subscribes to **its own entry
  only** (`useAppsStore(s => s.sizes.get(id))`). Arriving data never re-sorts the list. A "Sizes updated — re-sort"
  link appears when the sort is by size.
- **Uninstall wizard** (dialog, same steps as now): confirm → run the app's own uninstaller → scan for leftovers →
  review leftovers (grouped, with select all/none) → removing (per-item progress) → done. The done message must say
  what actually happened.
- **Elevated relaunch:** keep `getUninstallLaunchHint` resume. Port the logic of `UninstallFlow.tsx`.

### 3.5 Startup

- **Summary:** "9 apps start with Windows · 6 on".
- **Filter:** SegmentedControl with All, On and Off. One list.
- **Row:** icon, name, publisher, where it starts from (Registry or Startup folder, shown as text), and a Switch.
  - Toggles are optimistic.
  - A toast offers Undo for 5 s.
  - Protected rows are read-only and show a lock icon and the reason.
  - Admin and "Windows has turned this off" cases open the existing dialogs, redesigned.
- **Leave a slot for a "verdict" pill** ("Usually safe to turn off"). It renders only when the backend later provides
  it. Its data is a backend follow-up and is not part of this plan.

### 3.6 PC Health (replaces System Info)

- **Live tiles:** CPU and Memory rings. They poll `getSystemInfoLive` every 2 s **only while the page is visible**,
  because `<Activity>` hidden pauses effects.
- **Storage:** one row per drive.
- **Spec cards:** This PC, Processor, Graphics, Memory, Windows, Firmware. Each card has its own skeleton. "Graphics"
  fills in when `hardwarePending` clears.
- **[Copy specs]** copies a plain-text summary.
- Disk health, battery health and top processes are future backend work. Do not fake them.

### 3.7 Developer

- Port today's Dev Cleanup:
  - Groups: Not used for 6+ months, Occasional, Active, Orphaned, Kept. Labels are plain words; the recency is shown as
    text ("Not touched for 7 months").
  - Restorability pill.
  - Pin/keep.
  - "Select all safe and unused".
  - The same Clean dialog with restore commands (copyable, in mono).
  - Recently cleaned.
- The project list is virtualized.
- Leave a "Toolchain caches" section header that shows the npm cache row today, ready for the caches in
  `ENHANCEMENT-PLAN.md` §3b.

### 3.8 Settings

- **About:** version, "Check for updates", license, source link, and the privacy statement from §1.7.
- **Permissions:** "Relaunch as administrator", with a sentence on why you would.
- **Updates:** reuse `getUpdateStatus`, `checkForUpdates`, `installUpdate` and `onUpdateEvent`. A non-blocking update
  toast appears when an update is ready.

---

## 4. Architecture and performance

### 4.1 Folder layout

```
app/renderer-next/
  index.html
  src/
    main.tsx                 StrictMode > ErrorBoundary > App
    app/App.tsx              shell: TitleBar, Sidebar, <Activity> pages, ToastHost, DialogHost
    app/nav.ts               zustand nav store
    app/events.ts            the ONE subscription to each window.dust.on* stream → coalesced store writes
    stores/                  dashboard.ts, scan.ts, results.ts, clean.ts, apps.ts, startup.ts, health.ts, dev.ts
    pages/                   home/, cleanup/, explore/, apps/, startup/, health/, developer/, settings/, gallery/
    ui/                      design-system components (§2.5) + icons.ts
    lib/                     format.ts, categories.ts, api.ts (typed wrapper + ApiContext), resource.ts
    styles/                  tokens.css, base.css (Tailwind @import + @theme)
```

### 4.2 Data layer

- **`lib/api.ts`** exposes `ApiContext`, which provides `DustApi`. Tests inject `makeApi()` from
  `app/test/renderer/fakes.ts`. Do not read `window.dust` directly anywhere else.
- **Stores use Zustand v5.**
  - Components select atomically: `useStore(s => s.x)`. For object picks, use `useShallow`.
  - Never select the whole store.
- **`lib/resource.ts`** is a small stale-while-revalidate helper inside stores. It returns the last data instantly
  and refreshes in the background. Port the idea of `renderer/src/page-cache.ts`.
- **`app/events.ts`** subscribes once at startup to `onScanEvent`, `onUninstallEvent`, `onStartupEvent` and
  `onUpdateEvent`.
  - High-rate events go into a buffer: scan `progress`, `clean-item`, uninstall `app-size` and `app-icon`, and startup
    details.
  - The buffer flushes into the stores once per `requestAnimationFrame`, at most 10 times per second for progress. That
    is one `set()` per flush.
  - Port the "replay events for the current run" fix from `renderer/src/App.tsx:61-88`, so a fast scan's `finished`
    event is never missed.
- **Heavy lists:**
  - Use `useDeferredValue` for search and filter input.
  - The list component is wrapped in `memo`.
  - Row components are `memo` with primitive props.

### 4.3 Allowed IPC additions (phase 0.4, the only backend change)

The slowest part today is shipping every folder row to the renderer. Add these as **new** channels. Keep the old ones
until phase 11.

- `getResultsSummary(root)`: the same as `getResultCategories`, plus the per-category top contributors (at most 200
  per category), sorted by size. The Clean up page uses only this, never the full tree.
- `getFolderChildren(root, path, { limit, offset, sort })` returns `{ rows: ResultRow[], total }`. These are the
  direct children only, for the Explore tree and map.
- `searchResults(root, query, { limit: 500 })` runs the search in the main process against the in-memory tree or
  snapshot.
- Stop emitting the unused `matches` scan event, or make it opt-in.
- In the uninstall host, batch `app-size` and `app-icon` into arrays every 100 ms. Check whether
  `app/src/main/host/uninstall.ts` already batches; extend the event type to carry arrays and keep single-item
  compatibility for the old renderer.
- Update `app/test/ipc-contract.test.ts` (it counts 34 channels) and add host tests for the new handlers.
- Register handlers in `app/src/main/ipc.ts` with argument sanitizers, following lines 180–232.

### 4.4 Performance budgets ("Done when" for every phase)

| Metric | Budget | How to measure |
|---|---|---|
| Window shown to first content | < 500 ms | `performance.mark` in `main.tsx` and at the first Home paint, logged to `perf.log` through the existing instrument |
| Page switch, already visited | < 50 ms | React `<Profiler>` (dev) |
| Page switch, first visit | < 200 ms to skeleton or data | as above |
| Scroll in Apps, Explore tree, item lists | 60 fps, no long tasks > 50 ms | DevTools Performance |
| Typing in any search box | no dropped keystrokes; results < 150 ms after debounce | |
| Renderer heap after a full C:\ scan, results open | < 80 MB (today 228 MB) | DevTools Memory |
| Initial JS (entry chunk) | < 250 KB minified | `vite build` report |

**CSS rules:**

- No `backdrop-filter` anywhere.
- No `transition: all`.
- No animated shadows.
- `content-visibility: auto` on long off-screen sections of PC Health.

### 4.5 Build wiring

- **`app/vite.config.ts`:**
  - `root` is `./renderer-next` when `process.env.DUST_RENDERER === 'next'`, else `./renderer`.
  - Output stays `dist/renderer`, so `index.ts:101` `loadFile` works unchanged.
  - Phase 11 flips the default.
- Add the script `"dev:next": "cross-env DUST_RENDERER=next node scripts/dev.mjs"`. Use `cross-env` if it is not
  installed, or set the env in `dev.mjs` from an argument.
- **`app/vitest.config.ts`:** add a `renderer-next` jsdom project for `test/renderer-next/**`. Reuse
  `test/setup.ts`, `fakes.ts` and `virtual-mock.ts`.
- **ESLint:** extend the renderer block's globs to `renderer-next/**`.
- **New dependencies:**
  - `zustand`
  - `radix-ui`
  - `@fluentui/react-icons`
  - `d3-hierarchy` and `@types/d3-hierarchy`
  - `@testing-library/user-event` (dev)

  Pin exact versions. Keep the existing `@tanstack/react-virtual`. Drop `@tanstack/react-table` in phase 11 if
  nothing uses it.
- **Window changes** in `app/src/main/index.ts:79-83`: the title bar overlay, `backgroundColor`, and `minWidth: 960`.
  Apply them only when the next renderer is active until phase 11.

---

## 5. Phases

Each phase is one commit. Tests for new code go in `app/test/renderer-next/`.

### Phase 0 — Groundwork

- [x] 0.1 (Plan already saved here on 2026-10-09.) Commit the 17 currently uncommitted files first, on their own,
      after checking with the owner. Done: committed as `45d7151` (plus `b9e355e` for this plan), owner approved.
- [x] 0.2 Scaffold `renderer-next/` and wire the build (§4.5). Add a blank shell that renders "Dust".
      Notes: `npm run dev:next` passes `--next` to `dev.mjs` (no `cross-env` needed). The new vitest project has its
      own `test/setup-next.ts`, because `test/setup.ts` imports old-renderer modules that phase 11 deletes.
- [x] 0.3 Write `tokens.css` and `base.css`. Add the fonts (system only, no downloads).
      Notes: shadows, radii and easings are Tailwind `@utility` classes (`shadow-card`, `rounded-control`, `ease-enter`)
      because they keep the token names. Chart colors checked against white: all at least 4.2:1; run the `dataviz`
      check when `UsageBar` is built in phase 1.
- [x] 0.4 Make the IPC additions in §4.3, with host tests.
      Notes: `getResultsSummary`, `getFolderChildren`, `searchResults` are served from `host/results-index.ts` over the
      rows the host already holds. The `matches` scan event is now opt-in (`emitMatchEvents`, default off). Uninstall
      `app-size` / `app-icon` events are batched into `app-sizes` / `app-icons` every 100 ms only when the next
      renderer runs (`batchAppEvents`), so the old renderer keeps working. Contract test now counts 37 channels.
      Folder rows hide system-critical items with `hideDanger` (the grade is called `danger` in code).
      Measured on 280k synthetic rows: summary 15 ms, first folder request 85 ms, first search 330 ms (builds the
      search index once; later searches 4–7 ms). Phase 5 should warm the search index when Explore opens.
      **Dev note:** Dust relaunches itself elevated, and the elevated copy does not inherit `DUST_RENDERER` or
      `DUST_DEV_SERVER_URL`. Run `npm run dev:next` from an administrator terminal (as `npm run dev` already needs).
      `DUST_DEV_PORT` picks another port when 5173 is taken. For a non-admin check, start vite with
      `DUST_RENDERER=next` and launch `electron . --dust-elevated` against it.
      **Bundle baseline:** the blank shell's entry chunk is 223 kB minified (70 kB gzip), almost all React. The 250 kB
      budget in §4.4 leaves about 27 kB for the shell, stores and nav; pages and Radix parts must stay lazy.
      **Verified by running the app** (vite dev server on the next root + Electron, inspected over the debug port): window
      1200×800, `windowControlsOverlay.visible` true with a 40 px title area, body background `rgb(247,249,252)`,
      tokens and Tailwind utilities applied. The old renderer, started the same way with no env var, still opens at
      1180×780, dark, on its Home page. **Verified by tests/build only:** IPC handlers, batching, `vite build`.
- **Done when:**
  - `npm run dev:next` opens the blank shell with a light title bar and no dark flash.
  - The old renderer still runs with `npm run dev`.
  - Contract tests pass.

### Phase 1 — Component kit and Gallery

- [x] Build every component in §2.5, plus `icons.ts` and the Gallery page.
- [x] Add a test per interactive component: keyboard behavior, aria attributes, and the Dialog focus trap and restore.
      Notes: the kit is in `renderer-next/src/ui/` (Tooltip is its own file; `DropdownMenu` and `Collapsible` are not
      built yet because no screen needs them). 39 tests in `test/renderer-next/`. Radix only returns focus to a
      `Dialog.Trigger`, so `Dialog` remembers the opener itself. A new dialog starts with focus on its close button;
      phase 4 should pick a safer first focus for the delete dialog. Toasts are announced by Radix's polite live region
      and never take focus. `UsageBar` legend buttons are the tab stops; the bar's own buttons are mouse-only so keyboard
      users do not tab through each action twice. The Gallery is `#gallery` in dev only and is absent from the
      production bundle (entry chunk unchanged at 223 kB). Icon cold start is fine (about 190 ms for `icons.ts`), so
      `icons.ts` first kept the barrel import; phase 2 switched it to headless per-icon imports to save bundle size. The `dataviz` palette validator was not run on `--chart-1…5`; they are only
      checked for 4.2:1 or better against white.
- **Done when:**
  - The Gallery shows every component in every state.
  - Tab order is correct.
  - Focus rings are visible.
  - Reduced motion disables animation.

### Phase 2 — Shell, navigation, data layer

- [x] TitleBar, Sidebar (with the compact rail), the nav store, and `<Activity>` page hosting with lazy chunks.
- [x] Focus moves on navigation.
- [x] `ApiContext`, the stores skeleton, `events.ts` with coalescing and run replay, ToastHost, DialogHost, and
      ErrorBoundary.
      Notes: the shell is in `renderer-next/src/app/` (`nav.ts`, `events.ts`, `PageHost.tsx`, `Sidebar.tsx`,
      `dialogs.tsx`, `launch.ts`); stores are in `stores/`; the SWR helper is `lib/resource.ts`. `nav.params` keeps the
      last parameters per page, so leaving and returning shows the same view. Pages are `<Activity>`-hosted only once
      visited (the visible page plus at most 4 hidden, least recently used dropped). Each page slot saves and restores
      its own scroll position, because `display: none` loses it. Focus: `navigate()` sets `focusTarget`; the page
      slot focuses its `<h1>` when shown, and waits with a `MutationObserver` if the lazy page has not rendered yet.
      Nothing takes focus on first load.
      **Events:** `startEvents(api)` is started from `main.tsx` before the first render, next to `applyLaunchHints`. Only high-rate events are buffered (scan
      `progress`/`categories`/`finalize-progress`, `quick-clean-progress`, `clean-item`, uninstall `app-size(s)` /
      `app-icon(s)` / `item`, startup details). They reach the stores at most every 100 ms, as one `set()` per store.
      `started`, `finalizing`, `finished`, `failed`, `cleaned`, uninstall phases and update events flush the buffer
      first and apply at once, because a hidden window gets no animation frames. The stores are the replay: a screen
      that mounts after a fast scan reads `runs[runId].outcome` from the store, so the old `getRun` ref is not needed.
      Runs and clean jobs keep the last 3. `folders`, `browse-folders`, `browse-finished` and `matches` payloads are
      never stored.
      **Phase 4 heads-up:** the host still emits the `folders` scan event with every folder row to the renderer
      (`engine-host.ts:821`). The new renderer ignores it, but the IPC cost and the structured clone remain. Make it
      opt-in like `matches` before the phase 4 heap measurement.
      **Launch hints:** `applyLaunchHints(api)` runs once from `main.tsx`; a Startup hint opens Startup with
      `{ notice }`, an uninstall hint opens Apps with `{ hint }` (and wins if both are set). The pages read and clear
      these in phases 6 and 7.
      **Stores:** `scan`, `clean`, `apps` (sizes, icons, uninstall job folding), `startup` (details) and `updates` are
      wired to the bridge. `dashboard`, `results`, `health` and `dev` are typed resource skeletons with a `load(api)`.
      `resetAllStores()` runs after every test.
      **Dialogs and toasts:** `useDialogs().open(({ open, close }) => <Dialog … />)` shows any dialog, keeping it
      mounted 150 ms after close so the exit plays. Toasts are pushed with `useToast()` from `ui/toast-store.ts`; the
      Radix host loads on the first toast (`ToastLayer`).
      **Bundle:** the entry chunk is **245.7 kB** minified (78 kB gzip), budget 250 kB. Getting there took three
      changes: the toast host and rail tooltips load lazily, `ErrorState` loads only on a crash, and `ui/icons.ts` now
      imports from `@fluentui/react-icons/headless/svg/<icon>`, which drops the Griffel runtime (about 5 kB). The
      headless icons carry `data-fui-icon`; `base.css` imports `@fluentui/react-icons/headless/styles.css` for the
      forced-colors defaults. Do not import from the package root. That brings Griffel back.
      **Error boundaries:** one around the whole app in `main.tsx` (its button reloads the window) and one around each
      page. The fallback is plain markup with no lazy code, so it still draws when the crash is a chunk that failed
      to load. A crash in a page leaves the sidebar and the other pages working.
      **Rail tooltips** open to the right of the icon (`Tooltip` takes a `side`). The tooltip code is fetched after the
      shell mounts, so resizing into the rail does not swap a focused button for a fresh one.
      **Verified in the production build** (`DUST_RENDERER=next vite build`, then `electron . --dust-elevated` with no
      dev server, driven over the debug port, window in front): the console and log are empty; every nav item opens its
      page, so each lazy chunk loads from `file://`; click to second animation frame is 12-23 ms on a first visit and
      3-8 ms on a revisit (budgets: 200 and 50); the renderer's first contentful paint is 40 ms after navigation
      start; `#gallery` shows the normal app and the gallery code is not in `dist`; the heading takes focus after each
      click; a scrolled page is back at its position after leaving and returning (`scrollTop` is 0 while the page is
      hidden, which is why it is restored by hand); at 1000 px the sidebar is a 56 px rail and hovering an icon shows
      its tooltip on the right. **Verified in the dev server run:** 1200x800 window, focus ring on a tabbed nav item.
      **Verified by tests only:** coalescing (with the real scheduler too, including the 250 ms fallback when no frame
      arrives), replay, eviction, state kept across pages, hidden pages stopping their effects, both error boundaries,
      the dialog host, the lazy toast host, the rail tooltip. **Not checked:** the native title-bar overlay buttons,
      real screen-reader output, and any scan, uninstall or startup event stream in the live app (none was started).
      **Note for later phases:** a window that is behind others gets no animation frames at all (measured: none fired
      until the window was brought to the front), so anything that waits on `requestAnimationFrame` needs a timer
      fallback, as the event bridge has. **Unexplained:** on the first dev-server launch the app had already visited
      Clean up, Startup and PC Health and the Home heading had focus before any script of mine clicked. It did not
      repeat on two fresh launches.
- **Done when:**
  - Every nav item opens a placeholder page.
  - Returning to a page keeps its state.
  - A unit test proves 1,000 progress events in one frame cause **one** store update.
  - A unit test proves a `finished` event that arrives before subscription is replayed.

### Phase 3 — Home

- [x] Build §3.1 with every hero state, the drive rows and the four tiles. Each tile loads independently.
- [x] Add a "Busy scan" dialog.
      Notes: Home is `pages/home/` (`HomePage`, `Hero`, `OtherDrives`, `Tiles`/`Tile`). The hero has the plan's four
      states (never scanned, scanning, results, nothing to clean) plus loading, error, no-drive, and `checking`:
      the drive is known to have been scanned but the totals have not arrived, so the card shows the drive, the last-scan
      time, the usage bar and a placeholder figure instead of a blank. The headline is the sum of the rows in the legend
      (temporary files, Recycle Bin, package cache, app caches: the Quick Clean categories). npm projects are left out
      because they belong to the Developer tile. The bar's other colour is "Everything else" (a new `muted` segment in
      `UsageBar`), so the segments add up to the drive's used space. Notices show for a cancelled scan, stale rules and
      a depth-limited scan. Names and one-line descriptions for every category are in `lib/categories.ts`.
      The scan flow is shared: `app/useStartScan.ts` starts the scan, opens the scan screen with its run id, and shows
      `app/BusyScanDialog.tsx` ("A scan is already running." with Cancel it and scan / Wait) when the backend is busy.
      Phase 4's Scan again reuses it. "Clean up 4.2 GB" currently opens the Clean up page; the Clean dialog and the
      Quick clean link arrive in phase 4. A resumed uninstall or startup relaunch still opens its page as in phase 2.
      Tiles: Startup, Apps, PC Health (polls every 5 s, only while Home is visible) and Developer (sum of offered,
      unpinned `node_modules`). Each has its own skeleton and its own "Unavailable right now". The page title is a
      greeting for the time of day (`Good morning` and so on), as in the plan's sketch.
      **Speed:** `prefetchHome` (called from `main.tsx`) asks for the drives and the scan totals before the page has
      loaded. Measured in the production build, three cold launches: the first Home content, with the figure, was
      397-410 ms after navigation start (window in front). Before the prefetch it was 527 ms. Every IPC call Home makes
      takes 0-8 ms once warm, but the first `getResultCategories` after launch takes about 340 ms in the backend (it
      reads the last scan), which is most of the remaining time. Warming that in the main process at startup would
      save it; that is backend work outside this plan.
      **Bundle:** entry chunk 247.5 kB (budget 250), Home chunk 44 kB.
      **Tests:** `test/renderer-next/pages/home.test.tsx` (21 cases): all hero states and the notices, retry on error,
      category links, other drives, the busy dialog (cancel-and-scan, wait, a failed start), tiles filling in
      independently, an unreadable source, the Developer total, tile polling, the greeting, and the prefetch.
      `setup-next.ts` now gives Testing Library a 5 s timeout, because lazy pages compile on first use in jsdom.
      Prettier was run over `renderer-next/` and its tests; it had not been applied in phases 1 and 2.
      **Verified in the production build with real data:** the hero, bar, other drives and four tiles render with the
      machine's own figures and the console is empty. **Not exercised in the app:** starting a scan or the busy dialog
      (covered by tests only); I did not start a scan on this machine.
- **Done when:**
  - Home paints from cached data in under 500 ms on relaunch.
  - Tests cover all four hero states.

### Phase 4 — Scan and Clean up

- [x] Build §3.2 and §3.3: the category list, expandable item lists, Keep with Undo, the sticky footer, and the Clean
      dialog (plan → acknowledge → progress → summary).
- [x] Build Quick Clean on the same dialog with `scope:'quick'`.
- [x] Handle the admin relaunch.
      Notes: the page is `pages/cleanup/` (`CleanupPage` picks the view, `ScanView`, `ResultsView`, `CategoryList`,
      `CleanDialog`, `openClean.tsx`, `refresh.ts`). Selection and kept items are pure functions in `lib/selection.ts`,
      held in `stores/cleanup.ts` as **differences from the defaults** (safe: ticked, review: unticked), so a refreshed
      scan never wipes the user's choices. Paths are keyed case-insensitively. Danger rows and `npm-projects` are never
      offered; Developer dependencies are a link to the Developer page. A category with no safe item goes under
      "Take a look first" and starts unticked; a mixed category stays in the main list with its review rows unticked
      (tri-state checkbox). The footer figure is the sum of the exact rows passed to `previewClean({scope:'row'})`;
      the dialog total comes from `preview.totals`.
      **Plan inconsistency to decide:** the sketch in §3.3 shows Recycle Bin ticked, but every Recycle Bin item is graded
      `review` (irreversible), and §1.2 says only safe items are preselected. Clean up follows §1.2, so Recycle Bin starts
      unticked under "Take a look first". Home's headline ("can be freed safely") still adds the Recycle Bin in, because
      it sums the Quick clean categories; so the Clean up footer can read lower than the Home figure (by the bin, and by
      any other review item). Quick clean itself does include the bin (behind the acknowledgement checkbox). Options:
      drop the bin from Home's headline, or keep it and add a line. Left as is, for the owner to choose.
      **Rows must add up to the totals (found on the live run, fixed):** the first version hid rows that Home and
      Quick clean count. Two causes. (1) It dropped any row whose folder is graded `danger`; `C:\Windows\Temp` is
      graded system-critical as a folder but its rule marks the contents safe, and Quick clean includes it. Clean up now
      offers every row that has a cleanup rule; the plan lists anything it refuses under "not included". (2) After a
      relaunch the saved scan keeps only the top of the folder tree, so most matches had no row (temp 1 of 2, app
      caches 0 of 10); and the Recycle Bin is not a folder, so a live scan had no row for it either. `getResultsSummary`
      now builds its rows from the cleanup **matches** (`rowsForMatches` in `host/results.ts`), sized by what the rule
      counted (a folder's own size can differ: Windows temp is 2.6 MB as a folder, 0 for the rule). The live results keep
      their matches (and drop cleaned ones after a clean). Checked on the real machine, for both a saved and a live
      scan: for every category the number of rows equals `items` and the sum of their sizes equals `bytes`, and the
      footer figure equals the plan total (711 MB).
      **Cap:** the host sends at most 200 rows per category. The list says "Showing the largest 200 of N items" when
      the category has more, and only those rows can be selected. Cleaning a whole category beyond 200 needs a new
      IPC, so it was not added. Quick clean (`scope:'quick'`) covers everything in its categories.
      **Deviation:** per-item recovery is not loaded lazily on each row (`previewClean({scope:'row'})` per click).
      Every item's recovery and rebuild command is shown in the Clean dialog before anything is deleted, which is the
      point of the lazy load. Rows show the rule's "why" line instead.
      **Not built:** the "Explore disk ›" link (phase 5). `view: 'explore'` falls back to the results.
      **Scan:** `ScanView` reads the run from the scan store (so a fast scan is never missed), ticks its own 1 s
      clock, shortens the path in the middle with JS, and on any finish (including cancel) reads the lists again
      and then opens the results; a cancelled scan shows "Scan cancelled. Showing what was found." A run missing
      from the store after 3 s opens the results instead of waiting. Opened from the sidebar with no parameters, the
      page shows a scan that is running, otherwise the system drive's results.
      **Dialog:** one `Dialog` with internal steps (planning, plan, deleting, done, failed). `Dialog` has a new
      `initialFocus` ref, and every step puts focus on its safe control (Cancel, Done, Close). It cannot be dismissed
      while deleting. Progress reads `clean-item` events from the clean store and is weighted by planned bytes. The
      acknowledgement list is the review-grade paths, as before. The summary shows the drive "Before" (read before the
      clean) and "Now" (read again afterwards through `refreshAfterClean`), never a computed figure. "Relaunch as
      administrator" shows in the plan when an item needs it and in the summary when such an item failed. A quick
      plan that is still building is cancelled with `cancelScan` if the dialog closes. The dialog is its own lazy chunk
      (14 kB), opened through `openCleanDialog`. Copy was rewritten (no "Analyze", no "plan expired").
      **Host:** the `folders` scan event is now opt-in (`emitFolderEvents`, off when `DUST_RENDERER=next`, on for the
      old renderer), as phase 2 asked. `getResultsSummary` was corrected as described above (new host tests for a live
      scan with a row-less match and for a saved scan). **Home:** a "Quick clean" button next to "Scan again" in the results hero.
      **Bundle:** entry chunk 248.0 kB (budget 250); `CleanupPage` 39 kB and `CleanDialog` 14 kB are lazy.
      **Tests:** `test/renderer-next/pages/cleanup.test.tsx` (23 cases: preselection, grouping, cap note, Keep and
      Undo, link from Home, notices, the dialog steps, acknowledgement, progress weighting, summary with the drive read
      again, failures and admin relaunch, refused plans, cancel, Quick clean, a StrictMode double mount, a system-graded
      folder that still has a rule, every scan view
      state) and `lib/selection.test.ts`, `lib/clean.test.ts`. Whole app suite: 587 tests.
      **Verified in the running app** (production build of the next renderer, Electron driven over the debug port,
      real C:\ data): a full scan of C:\ (660k files, 32 s) showed the progress, the path cut in the middle and
      "Found so far"; it opened the results by itself; a category opened in place with its items; the Clean dialog
      plan for the selected rows and the Quick clean plan both rendered with Cancel focused, "Delete 599 MB" and
      the footer figure equal to the plan total. JS heap after a garbage collection with the results open: 3.5 MB
      (4.8 MB after opening a category and both dialogs); the budget is 80 MB. That is the JS heap from DevTools'
      `Runtime.getHeapUsage`, not whole-process memory. The scan replaced the saved scan on this machine.
      **Not exercised live:** deleting anything (no real delete was run on this machine), so the progress and
      summary steps, the Keep toast and the administrator relaunch are covered by tests only; scroll smoothness.
- **Done when:**
  - The full flow works on a real C:\ scan.
  - The confirm button shows the size.
  - Only safe items are preselected.
  - The renderer heap with results open is under 80 MB.
  - Tests cover selection rules, the acknowledgement rule, progress counting and the cancelled-scan notice.

### Phase 5 — Explore disk

- [x] Build the lazy virtualized folder tree using `getFolderChildren`.
- [x] Build the treemap using `d3-hierarchy`, with breadcrumbs.
- [x] Add main-process search, the protected-items toggle, and Open in Explorer.
      Notes: reached from Clean up through "Explore disk ›" (`view: 'explore'`), as its own lazy chunk (34 kB; the entry
      chunk is 248.03 kB, budget 250). Code: `pages/explore/` (`ExploreView`, `FolderTree`, `SearchResults`, `SpaceMap`,
      `useRoving`), `stores/explore.ts`, and the pure `lib/explore.ts` (tree flattening) and `lib/treemap.ts` (d3 layout).
      **Tree:** one flat, virtualized list of the open folders. Each open folder fetches its direct children, 1,000 at a
      time, sorted by size; the next page loads by itself when the list is scrolled to the "Show N more" row (the button
      stays for the keyboard). Bars are drawn against the largest sibling. Protected folders are hidden until "Show
      protected items" is on, then carry a "Protected" pill; flipping the switch closes everything and starts again.
      Cached folders are tied to the scan (`root|finishedAt`) and cleared after a clean or a new scan.
      **Keyboard:** the tree has tree semantics with a roving tab stop: Up, Down, Home, End, PageUp and PageDown move,
      Right opens (or goes to the first child), Left closes (or goes up to the parent), Enter opens, and the active row's
      action buttons join the tab order. This needed two additions to `VirtualList`: a `scrollToIndex` handle and
      `semantics='tree'` with per-row attributes (the shared test virtualizer got a no-op `scrollToIndex`).
      **Map:** the folder you are in, drawn with d3's squarified treemap, at most 40 tiles. What the shown folders leave
      out of the folder's size is one muted, unclickable "Everything else" tile (never negative). The drive root has no
      known size, so it has no such tile. Breadcrumbs are the stack of folders you drilled through (so each keeps its
      size); a tree row's map button jumps there from anywhere. Labels are hidden on tiny tiles; the name stays in the
      tooltip and accessible name. Nothing is laid out at width 0 (a hidden page).
      **Search:** the 300 ms debounce in `SearchBox` sends one request per burst; answers that arrive out of order are
      dropped; clearing the box restores the tree with no request; results are capped at 500 and say "Showing the largest
      500 of N matches". The backend matches the whole path, so a folder name also matches everything inside it (searching
      `winsxs` finds 38,814). The count is the honest part of that. The search index is warmed once per backend, early,
      with a query no Windows path can match (`<dust-index-warm-up>`), after the first screen is showing.
      **Saved scan:** a saved scan keeps the top of the tree. Folders the scan counted subfolders in, but the saved scan
      did not keep, say "Folders this deep were not saved. Scan again to see them." A notice at the top says the view is
      the saved scan. On this machine `getFolderChildren` was coherent for both a saved and a fresh scan: for 20 folders
      checked, `total` equals `childCount` and the children's sizes never exceed the folder's (the rest is files), so
      nothing was changed in `results-index.ts`.
      **Focus:** the heading takes focus on entering Explore and on going back to Clean up.
      **Tests:** `test/renderer-next/pages/explore.test.tsx` (19 cases: opening and focus, in-place open, paging, the
      saved-scan note, protected items, keyboard use, Explorer, warm-up, empty scan, back, search burst and clear, capped
      and empty results, out-of-order answers, protected search, show on map, map drill and breadcrumb, tile bounds)
      and `lib/explore.test.ts` (tree flattening incl. 10,000 rows, treemap limits). Whole suite: 615 tests. The test
      virtualizer draws every row, so the jsdom tests use at most 1,100 rows.
      **Verified in the running app** (production build, Electron over the debug port, real C:\ data): Explore opens
      with rows 375-390 ms after the click; with protected items on, `C:\Windows\WinSxS` (27,774 children) opens, and
      scrolling to the end pages in all of them (about 27,900 rows in the list, 20-29 in the page). A scripted scroll
      from top to bottom over 4 s gave 297 frames, median 15 ms, p99 30 ms, one frame over 33 ms, none over 50 ms, and
      no long task. JS heap with those rows loaded: 20 MB. Typing `winsxs` six characters 40 ms apart: results 294 ms
      after the last key, no long task. The map and the search results rendered and looked right. Not run live: a
      screen reader, the 20-keystroke burst as an IPC count (that is covered by the test that types 15 characters and
      counts one search call), and the map at a window narrower than 1000 px.
- **Done when:**
  - Expanding a folder with 10k children scrolls at 60 fps.
  - Search never blocks typing.

### Phase 6 — Apps

- [ ] Build §3.4: the virtualized list, per-row subscriptions, sort and search, and the uninstall wizard.
- [ ] Support resuming an elevated relaunch.
- **Done when:**
  - Streaming sizes and icons for 300 apps causes no full-list re-render. Verify with the Profiler, and add a test that
    counts row renders.

### Phase 7 — Startup

- [ ] Build §3.5: the single list, the filter, optimistic toggles with Undo, the protected, admin and Windows-disabled
      paths, and the verdict slot.
- **Done when:**
  - All toggle result kinds are handled and tested.

### Phase 8 — PC Health

- [ ] Build §3.6: live tiles that pause when hidden, the spec cards, and Copy specs.
- [ ] Rename the page in the UI.
- **Done when:**
  - No polling happens while another page is open. Prove it with a test that uses `<Activity>` hidden.

### Phase 9 — Developer

- [ ] Build §3.7 with the shared Clean dialog and restore commands.
- **Done when:**
  - It reaches parity with today's Dev Cleanup tests, ported.

### Phase 10 — Settings, updates, polish pass

- [ ] Build §3.8 and the update toast.
- [ ] Do a copy pass against the voice rules.
- [ ] Add empty and error states on every page.
- [ ] Do a keyboard-only walkthrough of every flow.
- [ ] Run the `ui-ux-pro-max` pre-delivery checklist (`references/pro-rules.md`).
- **Done when:**
  - A manual checklist (in the README smoke list) passes on a real machine.

### Phase 11 — Switch over and clean up

- [ ] Flip the Vite default to `renderer-next` and make the window changes permanent.
- [ ] Delete `app/renderer/` and `app/test/renderer/` tests that have ported equivalents. Keep `fakes.ts`, and move it
      to `test/renderer-next/`.
- [ ] Remove IPC channels nothing uses any more: browse, plus `getResults` if it is replaced. Update the contract test.
- [ ] Rename `renderer-next` to `renderer`.
- [ ] Rewrite `app/DESIGN.md` from §2, and update `app/PRODUCT.md`:
  - Audience: everyone plus a developer section.
  - Accent: Windows blue.
  - Screens: per §3.
- [ ] Update `PROJECT_BRIEF.md` and mark the superseded parts of `docs/ENHANCEMENT-PLAN.md`.
- **Done when:**
  - `npm run dist:app` builds.
  - The installer runs.
  - Every budget in §4.4 is met and the measurements are recorded in this file.

---

## 6. Out of scope (backend follow-ups, tracked in `docs/ENHANCEMENT-PLAN.md`)

These features need new engine or host work, so this plan does not include them:

- Startup verdict rules and boot time.
- Disk, battery and memory-slot health.
- New developer caches.
- Recycle Bin or quarantine with Undo.
- A restore point before uninstall.
- A persistent "Ignore forever" list.
- "Freed so far".
- Dark mode.
- Code signing.

The UI leaves slots for them where noted.

## 7. Critical files

- **Contract (read-only except §4.3):** `app/src/shared/ipc.ts`, `app/src/preload/index.ts`, `app/src/main/ipc.ts`,
  `app/test/ipc-contract.test.ts`.
- **Host for §4.3:** `app/src/main/host/engine-host.ts` (results at ~1233 and 1323), `app/src/main/host/results.ts`,
  `app/src/main/host/uninstall.ts`.
- **Window:** `app/src/main/index.ts:79-101`.
- **Build:** `app/vite.config.ts`, `app/scripts/dev.mjs`, `app/vitest.config.ts`, `eslint.config.mjs`,
  `app/package.json`.
- **Logic to port (not copy wholesale):**

  | Old file | What to port |
  |---|---|
  | `renderer/src/App.tsx:61-109` | Event replay and launch hints |
  | `renderer/src/page-cache.ts` | Stale-while-revalidate cache |
  | `renderer/src/format.ts` | Formatting |
  | `renderer/src/clean.ts` | Clean flow |
  | `renderer/src/components/CleanFlow.tsx` and `CleanPlan.tsx` | Flow states and acknowledgement rules |
  | `renderer/src/components/UninstallWizard.tsx` and `UninstallFlow.tsx` | Wizard steps and elevated resume |
  | `renderer/src/pages/StartupView.tsx` | Toggle result handling |
  | `renderer/src/components/SpaceMap.tsx` | Squarify logic |

- **Test fakes:** `app/test/renderer/fakes.ts` (`makeApi`, `makeScanBus`, builders) and
  `app/test/renderer/virtual-mock.ts`.

## 8. Verification

1. **Per phase:** run `npm run typecheck`, `npx eslint .` and `npm test -w app`. All must be green, with new tests
   for each "Done when" item.
2. **Run** `npm run dev:next -w app` and walk the phase's screens with mouse and keyboard only.
3. **Performance:**
   - Do a full C:\ scan.
   - Open Clean up and record the heap.
   - Profile scrolling in Apps and Explore.
   - Check that the Profiler shows no full-list re-render during streaming.
   - Record the numbers in §4.4.
4. **Contrast:** check any new color pairs with a WCAG calculator. They must be ≥ 4.5:1 for text and ≥ 3:1 for icons
   and borders that carry meaning.
5. **Final (phase 11):** run `npm run dist:app`, install the build, and run the README smoke checklist on a clean
   Windows 11 user account.

## 9. Research notes and sources

Haiku did the research on 2026-10-09. [P] marks a primary source that was fetched. [S] marks a secondary article or a
search summary. Some Microsoft PC Manager pages could not be fetched, so the notes on its UI are secondary.

**Competitors: what to copy and what to avoid**

- **Microsoft PC Manager** [S]:
  - A Fluent, Defender-like light UI.
  - A left rail (Home/Cleanup, Storage, Apps, Toolbox; it varies by version).
  - A home screen with memory and temp-file figures and one big action.
  - Startup apps with their startup impact.
  - **Avoid:** it picks items with no per-item choice or confirmation, and Deep Cleanup empties the Recycle Bin.
  - Sources: pcworld.com/article/2229944, pureinfotech.com/windows-11-pc-manager-app-boost-performance,
    windowslatest.com (2024-10-31).
- **CleanMyMac** [S]: one summary total, then "Review details" per module with deselectable items, an info panel per
  item, and an ignore list. This is the model for Clean up. Source: macpaw.com/support/cleanmymac-business/knowledgebase/smart-scan.
- **BleachBit** [P]: tick boxes → Preview → Delete. Cleaners are rules per app. Source: bleachbit.org/features.
- **Revo Uninstaller** [S]: run the app's own uninstaller, then a leftover scan with Safe, Moderate and Advanced
  levels; users are told to check each entry. **BCUninstaller** [P] is open source (Apache-2.0) with bulk uninstall.
- **WinDirStat, WizTree, TreeSize** [P]: a tree sorted by size plus a treemap, with drill-down. TreeSize says "No data
  ever leaves your PC", which is a privacy statement worth matching.
- **Windows 11 Storage** [P/S]: capacity at the top, then category rows, then "Show more categories". Cleanup
  recommendations group temp files, large unused files, cloud-synced files and unused apps. Source:
  support.microsoft.com/kb/5000679.
- **CCleaner and Wise Care 365** [S]: "health check" framing, status lines like "your PC feels under the weather",
  aggressive registry cleaners and upsells. These are the anti-pattern.

**Trust** [P]:

- Microsoft's 2018 policy on coercive cleaner messaging:
  microsoft.com/en-us/security/blog/2018/01/30/protecting-customers-from-being-intimidated-into-making-an-unnecessary-purchase/
- Defender unwanted-software criteria: learn.microsoft.com/en-us/defender-xdr/criteria
- Microsoft does not support registry cleaners (KB 2563254) [S].

**Fluent and Windows 11** [P]:

| Topic | Values | Source |
|---|---|---|
| Typography | Segoe UI Variable. Ramp 12/16, 14/20, 18/24, 20/28, 28/36, 40/52, 68/92. Sentence case. Minimum 12px regular. | learn.microsoft.com/windows/apps/design/signature-experiences/typography |
| Geometry | 4px controls, 8px overlays and dialogs, 0px when maximized | …/signature-experiences/geometry |
| Spacing | 4px base | fluent2.microsoft.design/layout |
| Motion | 50–500ms durations and the easing curves in §2.3 | github.com/microsoft/fluentui `packages/tokens/src/global` |
| Mica | `win.setBackgroundMaterial('mica')` on Windows 11 22H2+, a BrowserWindow method. Not used: the canvas is a solid token, which keeps it predictable and fast. | electronjs.org/docs/latest/api/browser-window |
| Icons | `@fluentui/react-icons` with names like `Delete20Regular` | github.com/microsoft/fluentui-system-icons |

**Performance** [P]:

| Finding | Source |
|---|---|
| Electron performance checklist: lazy-load, never `sendSync`, profile first | electronjs.org/docs/latest/tutorial/performance |
| `MessagePort` for high-rate streams, if ever needed | …/tutorial/message-ports |
| Only `transform` and `opacity` are compositor-only | web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count |
| Animated blur is expensive every frame | developer.chrome.com/blog/animated-blur |
| `useDeferredValue` needs a `memo` child to help | react.dev/reference/react/useDeferredValue |
| Store writes can't be transitions | react.dev/reference/react/useSyncExternalStore |
| Zustand v5 is about 0.5 KB gzipped; use atomic selectors and `useShallow` | github.com/pmndrs/zustand |

Bundle sizes (gzipped, from bundlephobia):

| Package | Size |
|---|---|
| @tanstack/react-virtual 3.14 | 7.8 KB |
| react-virtuoso | 19.3 KB |
| d3-hierarchy | 5.65 KB |
| recharts | 151 KB (rejected) |
| @fluentui/react-components | 62 dependencies and a Griffel runtime (rejected) |

**Design skill** (`ui-ux-pro-max`): its rules are applied throughout:

- Minimalism / Swiss style for professional tools.
- Virtualize lists of 50+ items.
- Debounce high-frequency input.
- Confirm destructive actions and support Undo.
- Toasts use `aria-live="polite"` and never steal focus.
- Every page has an empty state and an error state with a retry.
- Focus moves on route change.
- No emoji as icons.
