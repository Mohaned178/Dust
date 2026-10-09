import type { CategoryId } from '@dust/core';
import type { ResultAction, ResultRow } from '../../../src/shared/ipc';
import type { CheckedState } from '../ui/Checkbox';

/**
 * A result row Dust offers to clean: it has a cleanup rule and is not a developer item. The folder's own display
 * grade is not a filter: Windows\Temp is graded system-critical as a folder, yet its rule says its contents are safe
 * to clear, and Quick clean already includes it. Anything the plan refuses is listed there as not included.
 */
export type OfferedRow = ResultRow & { action: ResultAction };

/** Developer dependencies have their own section; Clean up never lists or selects them. */
export const DEVELOPER_CATEGORY: CategoryId = 'npm-projects';

/** Paths compare case-insensitively on Windows. */
export function pathKey(path: string): string {
  return path.toLowerCase();
}

export function isOffered(row: ResultRow): row is OfferedRow {
  return row.action !== null && row.action.category !== DEVELOPER_CATEGORY;
}

/** Only items graded safe start ticked. Review items are never preselected. */
export function isSafeByDefault(row: OfferedRow): boolean {
  return row.action.grade === 'safe';
}

/**
 * What the user has changed. A row follows its default (safe: ticked, review: unticked) unless it has an entry in
 * `overrides`, so a refreshed scan result never wipes the user's choices. Kept rows are out of the list entirely.
 */
export interface Selection {
  overrides: ReadonlyMap<string, boolean>;
  kept: ReadonlySet<string>;
}

export const EMPTY_SELECTION: Selection = { overrides: new Map(), kept: new Set() };

export function isKept(selection: Selection, row: ResultRow): boolean {
  return selection.kept.has(pathKey(row.path));
}

export function isSelected(selection: Selection, row: OfferedRow): boolean {
  const key = pathKey(row.path);
  if (selection.kept.has(key)) return false;
  return selection.overrides.get(key) ?? isSafeByDefault(row);
}

function withOverride(selection: Selection, rows: ReadonlyArray<OfferedRow>, checked: boolean): Selection {
  const overrides = new Map(selection.overrides);
  for (const row of rows) {
    const key = pathKey(row.path);
    if (selection.kept.has(key)) continue;
    // Store only what differs from the default, so "all safe" stays "all safe" after a refresh.
    if (checked === isSafeByDefault(row)) overrides.delete(key);
    else overrides.set(key, checked);
  }
  return { overrides, kept: selection.kept };
}

export function setRows(selection: Selection, rows: ReadonlyArray<OfferedRow>, checked: boolean): Selection {
  return withOverride(selection, rows, checked);
}

export function toggleRow(selection: Selection, row: OfferedRow): Selection {
  return withOverride(selection, [row], !isSelected(selection, row));
}

export function keepRow(selection: Selection, row: ResultRow): Selection {
  const key = pathKey(row.path);
  const overrides = new Map(selection.overrides);
  overrides.delete(key);
  return { overrides, kept: new Set(selection.kept).add(key) };
}

export function unkeepRow(selection: Selection, row: ResultRow): Selection {
  const kept = new Set(selection.kept);
  kept.delete(pathKey(row.path));
  return { overrides: selection.overrides, kept };
}

/** The rows that can be listed: everything offered that the user has not kept. */
export function listedRows(rows: ReadonlyArray<OfferedRow>, selection: Selection): OfferedRow[] {
  return rows.filter((row) => !isKept(selection, row));
}

export function categoryChecked(rows: ReadonlyArray<OfferedRow>, selection: Selection): CheckedState {
  const listed = listedRows(rows, selection);
  if (listed.length === 0) return false;
  const selected = listed.filter((row) => isSelected(selection, row)).length;
  if (selected === 0) return false;
  return selected === listed.length ? true : 'indeterminate';
}

/**
 * A category with nothing graded safe goes under "Take a look first", where nothing starts ticked.
 * A mixed category stays in the main list with its review rows unticked inside.
 */
export function needsLookFirst(rows: ReadonlyArray<OfferedRow>): boolean {
  return rows.length > 0 && !rows.some(isSafeByDefault);
}

export interface SelectionTotals {
  bytes: number;
  items: number;
  categories: number;
  /** Exactly the paths handed to the plan, so the footer and the plan cannot disagree. */
  paths: string[];
}

export function selectionTotals(
  byCategory: ReadonlyArray<ReadonlyArray<OfferedRow>>,
  selection: Selection,
): SelectionTotals {
  let bytes = 0;
  let categories = 0;
  const paths: string[] = [];
  for (const rows of byCategory) {
    let any = false;
    for (const row of rows) {
      if (!isSelected(selection, row)) continue;
      any = true;
      bytes += row.bytes;
      paths.push(row.path);
    }
    if (any) categories += 1;
  }
  return { bytes, items: paths.length, categories, paths };
}
