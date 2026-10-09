# Design

The visual system of the Dust interface. The source of truth is `renderer/src/styles/tokens.css` (the only file with raw color values) and `renderer/src/ui/` (the component kit). This document says why they are what they are. The product rules are in `PRODUCT.md`; the decisions and measurements are in `docs/FRONTEND-PLAN.md`.

## Principles

- **Light, calm, native.** A Windows 11 / Fluent look: Segoe UI Variable, a 4 px control radius and an 8 px overlay radius, and a light title bar that matches the window. A familiar look is itself a trust signal.
- **One accent per region.** Windows blue marks the primary action, links, selection and focus. Per-row actions are neutral and take the accent on hover.
- **Safety colors never decorate chrome.** Safe, review and protected appear only on grades, a grade is always a word plus a dot, and red is only for deletion confirmations and protected items.
- **No scareware.** No scores, alarm banners, countdowns, upsells or inflated counts.
- **Fast by construction.** Animate only `transform` and `opacity`; no `backdrop-filter`, no `transition: all`, no animated shadows; long lists are virtualized; pages stay mounted but stop their effects while hidden.

## Color (light)

Every color is a token. A dark mode is a second block of the same names.

| Token                                | Value                            | Use                                                | Contrast                        |
| ------------------------------------ | -------------------------------- | -------------------------------------------------- | ------------------------------- |
| `--canvas`                           | `#F7F9FC`                        | Window and page ground                             |                                 |
| `--surface`                          | `#FFFFFF`                        | Cards, dialogs, lists                              |                                 |
| `--surface-hover`                    | `#F3F6FA`                        | Row and button hover                               |                                 |
| `--surface-pressed`                  | `#EAEFF5`                        | Pressed, selected-neutral, empty bar tracks        |                                 |
| `--border`                           | `#E3E8EF`                        | 1 px hairlines                                     |                                 |
| `--border-strong`                    | `#CDD5DF`                        | Input borders, outline-button hover                |                                 |
| `--ink`                              | `#1B1B1F`                        | Primary text                                       | 16.3:1 on canvas                |
| `--ink-2`                            | `#5C6370`                        | Secondary text                                     | 5.7:1 on canvas, 6.0:1 on white |
| `--ink-3`                            | `#8A8F98`                        | Icons and disabled only, never body text           | 3.25:1                          |
| `--accent`                           | `#0F6CBD`                        | Primary buttons, links, selection, focus, bar fill | 5.4:1 white on accent           |
| `--accent-hover`, `--accent-pressed` | `#115EA3`, `#0F548C`             | Primary button states                              |                                 |
| `--accent-soft`, `--accent-border`   | `#EBF3FC`, `#B4D6FA`             | Selected nav item, info notice, map tiles          | 5.95:1 for `#115EA3` on soft    |
| `--safe`, `--safe-soft`              | `#0E700E`, `#F1FAF1`             | "Safe" pill                                        | 5.9:1                           |
| `--review`, `--review-soft`          | `#8A5A00`, `#FFF9F0`             | "Review" pill                                      | 5.7:1                           |
| `--danger`, `--danger-soft`          | `#B10E1C`, `#FDF3F4`             | "Protected" pill, error text                       | 6.5:1                           |
| `--danger-fill`                      | `#C42B1C`                        | Destructive confirm button fill only               | 5.7:1 white on fill             |
| `--chart-1` to `--chart-5`           | blue, teal, violet, amber, slate | Category segments in usage bars                    | each at least 4.2:1 on white    |

## Typography

- **Text:** `"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`. Headings use the Display optical size where available. System fonts only; nothing is downloaded.
- **Data:** `"Cascadia Mono", Consolas, ui-monospace, monospace` for paths, rebuild commands and rule ids only.
- **Sizes and counts** use the text font with `font-variant-numeric: tabular-nums`.
- **Ramp** (Fluent 2): caption 12/16; body 14/20 (600 for strong); subtitle 20/28, 600; title 28/36, 600; hero figure 40/52, 600, tabular. Nothing below 12 px.

## Space, shape and elevation

- 4 px grid (2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48; the 2 and 6 are for aligning icons). Page gutter 32 px (24 px below 1100 px), 24 px between cards, 12 px inside groups. Content is at most 1040 px wide.
- Radius: 4 px for buttons, inputs, checkboxes, bars, tooltips and chips; 8 px for cards, list containers, flyouts and dialogs; full only for pills.
- Elevation is static: `--shadow-card` (`0 1px 2px` at 5%) plus a border for cards, `--shadow-flyout` for menus and tooltips, `--shadow-dialog` for dialogs. The dialog backdrop is `rgba(0,0,0,.3)` with no blur.

## Motion

- Durations: `--dur-faster` 100 ms (hover, press), `--dur-fast` 150 ms (disclosures, toasts), `--dur-normal` 200 ms (dialog entrance), `--dur-slow` 300 ms at most. Exits are one step shorter than entrances.
- Easing: enter `cubic-bezier(0.1, 0.9, 0.2, 1)`, exit `cubic-bezier(1, 0, 1, 1)`, standard `cubic-bezier(0.33, 0, 0.67, 1)`.
- Page changes use a quick fade, never a slide. List rows have no mount animation. Progress bars update `transform: scaleX()` directly.
- Under `prefers-reduced-motion`, every duration is 0.

## Icons

Fluent Regular, 20 px (24 px in the sidebar), imported only through `renderer/src/ui/icons.ts` from the headless per-icon modules (the package root pulls in a CSS-in-JS runtime). Decorative icons are `aria-hidden`; an icon-only button must have a `label`, which sets both its accessible name and its tooltip. App icons are the real program icons at 32 px, with a letter tile when one is missing.

## Components (`renderer/src/ui/`)

Built on Radix Primitives for behaviour and accessibility, styled with Tailwind and the tokens. Fluent UI v9 components are not used (too many dependencies and a runtime style engine).

`Button` (primary, secondary, subtle, danger; keeps its width while loading), `IconButton`, `Card`, `CardHeader`, `Section`, `PageHeader`, `Checkbox` (tri-state), `Switch`, `Tabs`, `SegmentedControl`, `SearchBox` (300 ms debounce, Ctrl+F), `ProgressBar` (determinate or indeterminate), `UsageBar`, `Ring`, `GradePill`, `Badge`, `Tag`, `Notice`, `Toast`, `Dialog` and `ConfirmDialog`, `EmptyState`, `ErrorState`, `Skeleton` (appears after 150 ms), `VirtualList` (fixed rows, a `scrollToIndex` handle, tree semantics), `CopyLine`, `Stat`, `Kbd`, `FileSize`, `RelativeTime`.

## Layout

A 40 px title bar overlay (the native window buttons on the right, the Dust mark on the left) over a 240 px sidebar and the page area. Below 1100 px the sidebar becomes a 56 px icon rail with tooltips on the right. The window is 1200 x 800 by default and at least 960 x 640. Sticky footers reserve space with scroll padding so a focused control is never covered.

## Accessibility

Every interactive element is reachable by keyboard, shows a 2 px focus ring in the accent color, and has a name. Long lists use a roving tab stop with arrow keys, Home, End and Page keys. Dialogs trap focus, close on Escape (except while deleting), and return focus to what opened them; each step of a flow puts focus on its safe choice. Focus moves to the page heading when the page changes. Toasts are announced politely and never take focus.
