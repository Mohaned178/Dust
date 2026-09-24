---
name: Dust
description: Find what is safe to delete.
colors:
  accent: "#0f6e6e"
  accent-strong: "#0b5858"
  accent-soft: "#e8f3f2"
  accent-border: "#cfe6e3"
  canvas: "#f4f5f7"
  surface: "#ffffff"
  ink: "#161b22"
  ink-muted: "#59616e"
  hairline: "#e4e7eb"
  track: "#e7eaef"
  notice: "#eef5f4"
  notice-border: "#d5e7e4"
  grade-safe: "#1d6b45"
  grade-safe-soft: "#e8f4ed"
  grade-safe-dot: "#2f9e63"
  grade-review: "#8a5a12"
  grade-review-soft: "#f7efdc"
  grade-review-dot: "#c98a2e"
  grade-danger: "#a13a3a"
  grade-danger-soft: "#f8ecec"
  grade-danger-dot: "#c2564f"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.16em"
  mono:
    fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
  figure:
    fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, monospace"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
rounded:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.75rem"
  xl: "3.5rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "0.75rem 1.5rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-primary-compact:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "0.625rem 1.25rem"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.75rem 1.5rem"
  button-secondary-compact:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.375rem 0.875rem"
  button-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.25rem 0.625rem"
  danger-gate:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    padding: "0.375rem 0.75rem"
  danger-gate-on:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-strong}"
  chip-system:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-strong}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  chip-external:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.5rem"
  checkbox:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xs}"
  usage-bar-track:
    backgroundColor: "{colors.track}"
    rounded: "{rounded.full}"
    height: "0.625rem"
  usage-bar-fill:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.full}"
  card-hero:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "2.25rem"
  category-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.875rem 1rem"
  category-card-selected:
    backgroundColor: "{colors.accent-soft}"
  grade-pill-safe:
    backgroundColor: "{colors.grade-safe-soft}"
    textColor: "{colors.grade-safe}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  grade-pill-review:
    backgroundColor: "{colors.grade-review-soft}"
    textColor: "{colors.grade-review}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  grade-pill-danger:
    backgroundColor: "{colors.grade-danger-soft}"
    textColor: "{colors.grade-danger}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
---

# Design System: Dust

## Overview

**Creative North Star: "The Quiet Workbench"**

Dust is a well-lit workbench: one tool is in your hand, and everything else is within reach but out of the way. The system is light-first by default — a soft grey canvas under white working surfaces, low ambient shadows, and hairline rules instead of borders you can feel. Hierarchy is carried by scale, weight, and spacing, never by darkness or glow. The renderer sits on a near-black window ground, but every working surface opts into the light world explicitly.

The surface is calm because the task is not: a developer is here to reclaim a full disk, and the interface owes them one unmistakable next action. The system spends its contrast budget on exactly that — a single dominant card — and quiets everything else into a plain list. Machine data (drive paths, byte figures, counts, rule ids, restore commands) is set in monospace so it reads as measurement rather than prose; labels and chrome stay in the system UI face.

Color is restraint, not decoration. A single desaturated teal-slate carries every interactive and measured element, and the safety palette — green, amber, red — is held in reserve for deletion grades, never spent on chrome. Motion is a single authored ease, spent on reveals that explain what changed: a bar filling once, a path line settling, a panel rising.

**Key Characteristics:**
- Light-first: soft grey canvas, white surfaces, near-black ink, on a near-black window shell.
- One accent (Pine Teal) for actions, usage, selection, and focus — nothing else competes.
- Monospace reserved for machine data; system UI sans for everything else.
- Hairline borders plus soft, low, offset shadows for depth.
- Flat, text-only secondary lists; no bars or card grids outside the hero.
- One ease (`cubic-bezier(0.16, 1, 0.3, 1)`) and one authored reveal per event.

## Colors

A near-monochrome light palette with one calm teal-slate accent; the only saturated colors in the product are the reserved safety grades.

### Primary
- **Pine Teal** (#0f6e6e): the single interactive and measured color. Fills the primary button, the usage bar, links, the ledger's percentage bars, and the "View results" affordance; a 40% opacity of it provides every focus ring.
- **Pine Teal Deep** (#0b5858): hover and pressed state for primary fills, and the text color of the System chip.
- **Pine Teal Soft** (#e8f3f2): the System chip and selected-category field, the "Copy"/"Clear" hover ground, and the accent-soft fill behind a selected row or the success check — a tinted field, never a second accent.
- **Pine Teal Border** (#cfe6e3): the 1px edge on accent-tinted chips and badges.

### Neutral
- **Workbench Canvas** (#f4f5f7): the page ground behind the white surfaces; also the background of the `external` chip.
- **Surface White** (#ffffff): the hero card and every raised working surface.
- **Near-Black Ink** (#161b22): primary text, headings, and the machine figures that need to read as data. Also the dialog backdrop at 25% opacity.
- **Muted Ink** (#59616e): every secondary line, label, and caption; meets 4.5:1 on both canvas and white.
- **Hairline** (#e4e7eb): 1px borders and dividers between surfaces and list rows, and the `border-hairline` on buttons, chips, and the `keep`/`not offered` tags.
- **Bar Track** (#e7eaef): the unfilled portion of a usage bar, the ledger's percentage bars, and the loading skeleton bars.
- **Notice Field** (#eef5f4): the ground of a banner, paired with a 1px Notice Border (#d5e7e4) — a slightly deeper teal hairline.

### Safety Grades
The only saturated colors in the product, and the only place they may appear. Each grade is a soft tint field plus a readable text tone and a small decorative dot; the word always carries the meaning, never the color alone.
- **Safe** (text #1d6b45 on #e8f4ed, dot #2f9e63): a rule proves the asset is regenerable or worthless.
- **Review** (text #8a5a12 on #f7efdc, dot #c98a2e): matched, but the user should look before deleting.
- **Protected** (text #a13a3a on #f8ecec, dot #c2564f): system-critical or unknown; never actionable.

### Named Rules
**The Safety Colors Are Not Chrome Rule.** Green, amber, and red belong to deletion grades only. No button, banner, badge, or icon in the interface chrome may carry them; warnings and errors are communicated in the teal-slate family and in words.

**The One Accent Rule.** Pine Teal is the only hue. Any new screen that needs a second accent is a sign the hierarchy is wrong, not a sign the palette is thin.

**The Scarcity Rule.** On a working surface with many rows, Pine Teal is spent on selection and focus only — the selected category chip, the focus ring, the active "Show danger" gate. Per-row actions ("Explore", "Delete", "Browse", "Keep") are neutral outline or ghost buttons that take the accent on hover, so a table of cleanable rows never floods the surface with teal.

## Typography

**Display / Title / Body / Label Font:** system UI sans (`system-ui, -apple-system, 'Segoe UI', sans-serif`)
**Mono / Figure Font:** platform monospace (`ui-monospace, 'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, monospace`)

**Character:** Plain, legible, and unshowy. The system face carries chrome, labels, and prose; monospace is a functional register reserved for values read off the machine, so a byte figure and a drive path are visibly different kinds of content from a sentence.

### Hierarchy
- **Display** (600, 3rem/1, -0.025em): the `Dust` wordmark only; centered and prominent, never used for body headings.
- **Title** (600, 1.5rem/1.2, -0.025em): page headings ("Results", "Dev Cleanup", the `C:\` hero path, dialog titles).
- **Figure** (600, 2.5rem/1, -0.025em, mono): the single number that owns a clean-flow dialog — bytes "will be freed" or "freed" — and the Results reclaimable total at the head of the surface. Category chips carry a smaller cousin in the `xs` step.
- **Body** (400, 0.875rem/1.55): status lines, descriptions, and list meta.
- **Label** (600, 0.75rem, uppercase): section markers. The canonical tracking is 0.16em (the sidebar "Coming soon" marker, the scan-panel section heading); in-surface labels tighten to 0.14em ("Why this grade", the "will be freed" caption), and table column headers tighten further to 0.08em.

### Named Rules
**The Mono-Is-Machine-Data Rule.** Monospace is used only for drive paths, byte figures, counts, file paths, rule ids, and restore commands — never for labels, buttons, or prose. It is a data register, not a technical costume.

**The Tabular Figures Rule.** Every numeric figure in a row, bar, or list is set in mono (inherently tabular) so columns of sizes align.

## Layout

The app is a two-pane shell: a fixed left sidebar (`15rem`, manually collapsing to a `3.5rem` icon rail) on Surface White over the canvas, and the scrollable content column beside it. The sidebar is navigation only — the wordmark, four nav items, and an inert "coming soon" footer — and the content region owns the task. The dashboard's content column is `max-w-6xl` (72rem), top to bottom: an optional notice stack, the dominant hero card, a four-card "Reclaimable by category" grid, and a flat developer-cleanup row. Non-system volumes no longer appear on the dashboard; they live on the Drives surface behind their own nav item.

Working surfaces widen to fit their machines. The Results ledger and the Scan view are `max-w-6xl` (72rem); Browse is `max-w-6xl`; Dev Cleanup is `max-w-5xl` (64rem). The Results composition is one working column, top to bottom: the header, one large mono reclaimable figure with its Safe/Review stat lines, a compact category filter-chip row with search and a "Review too" toggle, the size-ordered contributor list (the working surface, carrying the Card shadow), then the full folder tree behind a "Browse everything" disclosure.

Spacing is a tight group / wide separation rhythm: controls inside a group sit 0.5–0.75rem apart, while major regions are separated by 2.5–3.5rem. Space above a heading always exceeds the space below it. Every surface uses a 1.5rem page gutter (`px-6`) growing to 2rem (`sm:px-8`).

Sticky bars anchor the two working surfaces that scroll: Browse carries a full-bleed mode banner pinned to the top; Dev Cleanup pins a selection bar to the top and a "Clean Selected (n)" action bar to the bottom, both on a translucent surface (`bg-surface/95 backdrop-blur`).

Responsive behavior is additive, not reductive: the sidebar's manual collapse to its icon rail is the narrow-window strategy, and the app is desktop-first. Below `sm` the dashboard's category grid drops to two columns and the hero actions wrap only when they must; on the Drives surface, rows fold their used/free figures under the drive name. The hero card's padding and the page's vertical rhythm carry the scale change. On narrow screens the ledger keeps a minimum width and scrolls horizontally rather than crushing the Name column; the filter chips wrap onto further rows.

The renderer's page ground is near-black (`#0a0a0b`); each light surface opts in through a `.dust-dashboard` or `.dust-dialog` scope that sets `color-scheme: light` and the accent caret. No fixed pixel grid is assumed between 1280 and 1600px.

## Elevation & Depth

Depth is borrowed light: white surfaces lift off the grey canvas through a hairline border plus a soft, low, offset shadow. There is no glow, no halo, and no colored shadow. The hero card is the only strongly elevated object; list rows and secondary buttons stay at the surface level or flat on the canvas.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 16px 40px -20px rgba(16,24,40,0.22)`): the hero card and any primary working surface.
- **Pop** (`box-shadow: 0 1px 2px rgba(16,24,40,0.06), 0 24px 60px -24px rgba(16,24,40,0.30)`): modal dialogs above a dimmed backdrop.
- **Whisper** (`box-shadow: 0 1px 2px rgba(16,24,40,0.04)`): Dev Cleanup's group ledgers.

### Named Rules
**The Low, Offset Rule.** Every shadow carries a vertical offset and a soft blur. A zero-offset colored halo is decoration and does not belong here.

## Shapes

Corners are gently curved and functional: `0.25rem` for checkboxes and skeleton bars, `0.5rem` for buttons, icon buttons, code blocks, and plan items, `0.75rem` for notices, category chips, progress lists, and empty-state wells, `1rem` for the hero card, dialogs, Dev Cleanup groups, and the contributor list, and fully rounded (`9999px`) for the usage bar, track, chips, grade pills, and tags. The secondary tree behind the Results disclosure carries the same `1rem` corners as any standalone surface. Borders are always 1px hairlines; nothing has a visible stroke weight above that. There are no side-stripe accents, no clipped polygons, and no decorative silhouettes.

## Components

### Buttons
- **Shape:** gently curved (0.5rem radius), 1px hairline for outline variants.
- **Primary:** Pine Teal fill, white text, semibold. Two sizes: large `0.75rem 1.5rem` (the hero "Analyze"/"View results" and clean-flow confirms) and compact `0.625rem 1.25rem` (Dev Cleanup's "Clean Selected"); the dialog confirm tightens to `0.375rem 0.875rem`. Hover deepens to Pine Teal Deep; focus adds a 2px Pine Teal outline at 2px offset. Disabled drops to 45% opacity with a not-allowed cursor.
- **Secondary:** white fill, hairline border, Near-Black ink; hover shifts the border to `#cfd6df` and the background to `#fafbfc`. Large `0.75rem 1.5rem` beside the hero primary; compact `0.375rem 0.875rem` is the workhorse outline ("Back to dashboard", "Wait", "Cancel", "Relaunch", "Keep", "Copy").
- **Row / Ghost:** a small in-table action at `0.25rem 0.625rem` radius 0.5rem — "Clean" and "Delete" (outline, hover to accent border + accent text) and "Explore" (text-only muted, hover to canvas). The dashboard's tertiary "Quick Clean", the Results "Clear", and the scan "Copy" affordances are text-only in Pine Teal with a Pine Teal Soft tint on hover.
- **Icon button:** a 2rem square at 0.5rem radius, muted ink, hover to canvas ground and ink — used for close, the sidebar collapse toggle, and disclosure toggles.

### Sidebar
- **Shape:** a full-height Surface White rail with a 1px hairline right border, `15rem` expanded and `3.5rem` collapsed; the width animates on the single ease and the collapsed choice persists in `localStorage`.
- **Header:** the placeholder `Dust` wordmark beside the collapse toggle (icon button).
- **Nav item:** an icon + label at `0.5rem` radius in Muted Ink; hover fills the canvas. The active item is the shell's only accent spend — a Pine Teal Soft field with deep-teal text and `aria-current="page"`. Collapsed, the label hides and the item exposes it through `aria-label` and `title`.
- **Coming-soon group:** a hairline-separated footer of inert text rows (Deep Uninstall, Startup Manager, System Info), each with a "Soon" state tag; never a control, and outside the tab order.

### Dashboard Category Card
- **Style:** a flat white `0.75rem`-radius card with a hairline border — the category label in the system face above its byte figure in mono. Distinct from the Results category filter chips: these are evidence for the dashboard headline, not a filter's pressed state, and they carry no `aria-pressed`. Each is a button that opens Results filtered to that category. Unknown or unanalyzed values dim to 55% with an em-dash figure, and no grade color or progress semantics ever enters the card.

### Chips / Tags
- **System chip:** Pine Teal Soft field, deep-teal text, a 1px `#cfe6e3` teal border, fully rounded — marks the boot volume and the "Light" theme badge.
- **External chip:** canvas field, muted-ink text, hairline border, fully rounded — marks removable or network volumes.
- **State tag:** canvas field, muted-ink text, hairline border, fully rounded, `0.5rem 0.625rem` padding — Dev Cleanup's "kept" and "not offered".

### Checkbox
- **Style:** native, 1rem square, `0.25rem` radius, hairline border, with `accent-color: Pine Teal` so the check is the single accent. Disabled drops to 40% opacity. Used for the "I understand some items cannot be recovered" acknowledgement and Dev Cleanup project selection.

### Cards / Containers
- **Corner Style:** 1rem radius for the hero card, dialogs, and Dev Cleanup groups; 0.75rem for notices, category cards, and empty-state wells.
- **Background:** Surface White above the Workbench Canvas.
- **Shadow Strategy:** Card shadow on the hero and group ledgers; Pop on dialogs; see Elevation & Depth.
- **Border:** 1px Hairline.
- **Internal Padding:** 1.75rem, growing to 2.25rem at `sm` for the hero.

### Usage Bar
- **Style:** a 0.625rem fully-rounded track in Bar Track with a Pine Teal fill; carries `progressbar` semantics with an `aria-valuetext` of the used/total figure. A 0.5rem variant exists in the ledger's percentage column.
- **Behavior:** the fill reveals left-to-right once on mount (a 900ms exponential ease-out `clip-path` reveal), disabled under `prefers-reduced-motion`.

### List Rows
- **Style:** flat on the canvas with hairline dividers; drive path in mono on the left, used/free figures in mono on the right, an outline row button at the far right. No bars, no cards.
- **Responsive:** below `sm`, the used/free line moves beneath the drive name.

### Category Strip
- **Style:** a compact, wrapping row of fully-rounded chips on the canvas: an `All` chip, then one chip per category carrying its label in the system face beside a small mono byte figure. Unselected chips are Surface White with a hairline border.
- **Selected:** Pine Teal Soft field, Pine Teal border, deep-teal text — the surface's one accent spend; carries `aria-pressed`.
- **Empty:** dimmed to 55% and disabled, with an em dash in place of the figure. No grade colors ever enter the row. The `npm projects` chip hands off to Dev Cleanup instead of filtering, and is absent wherever that handoff is not available, so it never degrades into an empty filter.

### Contributor List
- **Style:** the Results working surface — a white `1rem`-radius card with a hairline border and the Card shadow. A header row (a tri-state select-all checkbox, "Select all safe/showed", and the mono `(N · X GB)` count) sits above size-ordered rows (`divide-y` hairlines): a selection checkbox, a folder icon, the item name with its parent path in mono beneath it, a right-aligned mono byte figure, a grade pill, and a chevron disclosure.
- **Drill:** clicking a row's disclosure unfolds it in place (the 150ms disclose) to show the full path in mono, "Why this grade" evidence, the category, the rule id, a recovery line (with the restore command in mono and a Copy button when it is regenerable), and a neutral "Keep" ghost button. A failed recovery fetch reads "Couldn't load recovery details." with a "Try again" retry and announces the load state, distinct from an item with no preview.
- **Selection:** a tri-state header checkbox selects or clears every currently listed contributor — the list's active category, search, and kept state all narrow what it targets, and it reaches the full filtered set rather than only the rows past the contributor cap. A selection checkbox per row remains; the selected rows' bytes and count feed a sticky bulk bar ("Clean N selected · X GB") with Clear and a primary "Preview & clean" that opens the clean flow. No per-row Clean action exists.
- **Kept:** a session-only Keep removes a row from the list (totals stay truthful) and shows a muted "N items kept · Undo" line.

### Ledger Table
- **Style:** the full folder tree, relocated behind the "Browse everything" disclosure on Results and still the primary surface on Browse. A white `1rem`-radius card; a slim toolbar (active-filter readout and the danger gate at right), then a sticky, sortable column header (0.08em uppercase labels), then virtualized rows with hairline dividers.
- **Columns (analyze):** Name / Size / Files-Folders / % / Safety / Last modified / Action — seven columns; Action is Explore only, so the tree is for exploration and all cleaning flows through the contributor list's selection + bulk confirm.
- **Rows:** the Name cell carries an indent, a chevron disclosure, and a folder icon; every byte figure, count, and percentage is mono and right-aligned, with the percentage echoed as a thin Pine Teal bar on the Bar Track. An open row's background is Pine Teal Soft at 50%; a protected row sits on canvas at 50%.
- **Grade pill:** a fully-rounded soft-tinted pill carrying the grade word and a small dot (see Safety Grades). Never color alone.
- **Grade disclosure:** clicking the Safety cell expands a slim strip under the row with the reason, the category, and the rule id in mono. A single authored reveal: 150ms exponential ease-out, disabled under `prefers-reduced-motion`.

### Danger Gate
- **Style:** an outline toggle in the ledger toolbar at 0.375rem 0.75rem. Off: hairline border, muted ink. On (`aria-pressed`): Pine Teal Soft field, Pine Teal border, deep-teal text.
- **Behavior:** protected rows are absent until "Show danger (n)" is pressed; then they render dimmed, non-actionable, with no action button and a "Protected" pill. Hiding them hides their whole subtree.

### Clean Flow (Plan & Summary)
- **Result figure:** the dialog leads with one mono 2.5rem number — the bytes that "will be freed" or were "freed" — centered over a one-line caption, then a full-width hairline seam.
- **Clean ledger:** a category-grouped, expandable list (`divide-y` hairline rows on a top hairline). Each row is a full-width button: a rotating chevron, the category label, a right-aligned mono byte total, and a note; expanding reveals the items with the same 150ms disclose.
- **Item card:** a `0.5rem`-radius well on `bg-canvas/40` with a hairline border; the path in mono on the left, its byte figure in mono on the right, then a grade pill, a recovery line, and the evidence. An "Open the Recycle Bin in Explorer first" text link appears for that action.
- **Restore command:** a mono `code` line beside a compact outline "Copy" button; the command is the recovery promise made literal.
- **Acknowledgement:** the plan's confirm stays disabled until the "I understand some items cannot be recovered" checkbox is checked.
- **Summary check:** the freed figure is crowned by a 2.75rem Pine Teal Soft circle holding a Pine Teal check — the single decorative moment in the system, and the only allowed checkmark.

### Dev Cleanup Groups
- **Style:** collapsible sections (1rem radius, hairline border, Whisper shadow) with a full-width header button: a rotating chevron, the group title, a muted count, and a right-aligned mono total. Expanded, a hairline seam separates the header from the project rows.
- **Project row:** a checkbox (or a pin glyph when pinned), the project name, a mono rebuild/activity subline, a right-aligned mono byte figure, a restorability pill ("Restorable" / "Review") or a "kept"/"not offered" tag, and a hover-revealed "Keep"/"Unpin" ghost action. Selected rows sit on Pine Teal Soft at 50%.
- **Recently cleaned:** a native `<details>` disclosure (0.75rem radius, hairline border) holding session-only entries with copyable restore commands.

### Loading Skeleton
- **Style:** a `motion-reduce`-safe pulse (`animate-pulse`, disabled under reduced motion) of Bar Track blocks — the summary figure, a stat row, filter-chip shapes, and contributor rows — mirroring the real Results layout so the swap is calm.

### Notices
- **Style:** Notice Field background, 1px Notice Border (#d5e7e4), 0.75rem radius, a single line info glyph in Pine Teal, and ink text. Informational and warning banners share this one treatment.
- **Mode banner:** Browse's sticky top banner is the same field and glyph, but full-bleed and square-cornered, pinned above the content.

### Dialogs
- **Style:** centered white panel, 1rem radius, Pop shadow over a 25% ink backdrop; the clean-flow dialogs add `backdrop-blur-sm`. Settings is `max-w-md`; the clean flow is `max-w-[34rem]` with a scrolling body and a pinned close button. Escape and backdrop click dismiss; focus is trapped and returns to the trigger. The backdrop fades in over 160ms ease-out and the panel rises 6px over 200ms ease-out, both disabled under `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** keep exactly one dominant object per screen; if two things shout, quiet one.
- **Do** set every path, byte figure, count, rule id, and restore command in mono (The Mono-Is-Machine-Data Rule).
- **Do** tint secondary text from the neutral family (Muted Ink) so it clears 4.5:1 on canvas and white.
- **Do** use a 2px Pine Teal outline at 2px offset for every focus-visible state (1px offset inside the ledger).
- **Do** reveal the usage bar, the grade disclosure, and the dialog entrance with the single ease (`cubic-bezier(0.16, 1, 0.3, 1)`), and disable them under `prefers-reduced-motion`.
- **Do** carry a grade by its word and a dot inside a soft-tinted pill, and spend Pine Teal on selection and focus only (The Scarcity Rule).
- **Do** keep the outline button's hover to a border shift plus a faint Surface Hover tint (`#fafbfc`), never a fill.

### Don't:
- **Don't** use green, amber, or red as UI chrome; reserve them for safety grades (The Safety Colors Are Not Chrome Rule).
- **Don't** add a second accent hue, gradient text, or a gradient fill.
- **Don't** give secondary drives usage bars or card treatment; they are a plain list.
- **Don't** use hard, zero-blur, or zero-offset colored shadows.
- **Don't** put an eyebrow or kicker above a heading; let the heading carry its own weight.
- **Don't** use monospace for labels, buttons, or prose.
- **Don't** give the category filter chips grade colors.
- **Don't** introduce a second easing curve or a decorative animation beyond the bar reveal, the disclose, and the dialog entrance.
