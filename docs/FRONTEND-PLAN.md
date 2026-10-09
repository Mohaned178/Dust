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

- [ ] 0.1 (Plan already saved here on 2026-10-09.) Commit the 17 currently uncommitted files first, on their own,
      after checking with the owner.
- [ ] 0.2 Scaffold `renderer-next/` and wire the build (§4.5). Add a blank shell that renders "Dust".
- [ ] 0.3 Write `tokens.css` and `base.css`. Add the fonts (system only, no downloads).
- [ ] 0.4 Make the IPC additions in §4.3, with host tests.
- **Done when:**
  - `npm run dev:next` opens the blank shell with a light title bar and no dark flash.
  - The old renderer still runs with `npm run dev`.
  - Contract tests pass.

### Phase 1 — Component kit and Gallery

- [ ] Build every component in §2.5, plus `icons.ts` and the Gallery page.
- [ ] Add a test per interactive component: keyboard behavior, aria attributes, and the Dialog focus trap and restore.
- **Done when:**
  - The Gallery shows every component in every state.
  - Tab order is correct.
  - Focus rings are visible.
  - Reduced motion disables animation.

### Phase 2 — Shell, navigation, data layer

- [ ] TitleBar, Sidebar (with the compact rail), the nav store, and `<Activity>` page hosting with lazy chunks.
- [ ] Focus moves on navigation.
- [ ] `ApiContext`, the stores skeleton, `events.ts` with coalescing and run replay, ToastHost, DialogHost, and
      ErrorBoundary.
- **Done when:**
  - Every nav item opens a placeholder page.
  - Returning to a page keeps its state.
  - A unit test proves 1,000 progress events in one frame cause **one** store update.
  - A unit test proves a `finished` event that arrives before subscription is replayed.

### Phase 3 — Home

- [ ] Build §3.1 with every hero state, the drive rows and the four tiles. Each tile loads independently.
- [ ] Add a "Busy scan" dialog.
- **Done when:**
  - Home paints from cached data in under 500 ms on relaunch.
  - Tests cover all four hero states.

### Phase 4 — Scan and Clean up

- [ ] Build §3.2 and §3.3: the category list, expandable item lists, Keep with Undo, the sticky footer, and the Clean
      dialog (plan → acknowledge → progress → summary).
- [ ] Build Quick Clean on the same dialog with `scope:'quick'`.
- [ ] Handle the admin relaunch.
- **Done when:**
  - The full flow works on a real C:\ scan.
  - The confirm button shows the size.
  - Only safe items are preselected.
  - The renderer heap with results open is under 80 MB.
  - Tests cover selection rules, the acknowledgement rule, progress counting and the cancelled-scan notice.

### Phase 5 — Explore disk

- [ ] Build the lazy virtualized folder tree using `getFolderChildren`.
- [ ] Build the treemap using `d3-hierarchy`, with breadcrumbs.
- [ ] Add main-process search, the protected-items toggle, and Open in Explorer.
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
