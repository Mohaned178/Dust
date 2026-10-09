import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  categoryChecked,
  isOffered,
  isSelected,
  keepRow,
  listedRows,
  needsLookFirst,
  selectionTotals,
  setRows,
  toggleRow,
  unkeepRow,
} from '../../../renderer-next/src/lib/selection';
import type { OfferedRow } from '../../../renderer-next/src/lib/selection';
import type { ResultRow } from '../../../src/shared/ipc';
import { makeResultsRows } from '../../renderer/fakes';

export function offered(
  path: string,
  bytes: number,
  options: { grade?: 'safe' | 'review'; category?: OfferedRow['action']['category'] } = {},
): OfferedRow {
  const { grade = 'safe', category = 'temp' } = options;
  const base = makeResultsRows()[3]!;
  return {
    ...base,
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    bytes,
    grade,
    action: { ruleId: 'rule', category, grade, evidence: 'Why' },
  };
}

describe('selection', () => {
  const safe = offered('C:\\Temp\\a', 100);
  const review = offered('C:\\Bin', 50, { grade: 'review', category: 'recycle-bin' });

  it('only safe rows start selected', () => {
    expect(isSelected(EMPTY_SELECTION, safe)).toBe(true);
    expect(isSelected(EMPTY_SELECTION, review)).toBe(false);
  });

  it('offers every row with a cleanup rule, even one whose folder is graded system-critical, but not developer items', () => {
    const rows = makeResultsRows();
    expect(isOffered(rows[3]!)).toBe(true);
    // No rule, no offer.
    expect(isOffered(rows[0]!)).toBe(false);
    // The folder is read-only system territory, but its rule marks the contents safe to clear (Windows temp files).
    const systemTemp: ResultRow = { ...rows[3]!, grade: 'danger', gradeReason: 'System-critical � read-only' };
    expect(isOffered(systemTemp)).toBe(true);
    const project = { ...rows[3]!, action: { ...rows[3]!.action!, category: 'npm-projects' as const } };
    expect(isOffered(project)).toBe(false);
  });

  it('keeps only the differences from the defaults, so ticking back restores the default', () => {
    const unticked = toggleRow(EMPTY_SELECTION, safe);
    expect(isSelected(unticked, safe)).toBe(false);
    expect(unticked.overrides.size).toBe(1);
    const again = toggleRow(unticked, safe);
    expect(isSelected(again, safe)).toBe(true);
    expect(again.overrides.size).toBe(0);
  });

  it('matches paths case-insensitively', () => {
    const unticked = toggleRow(EMPTY_SELECTION, safe);
    expect(isSelected(unticked, { ...safe, path: safe.path.toUpperCase() })).toBe(false);
  });

  it('shows a tri-state for a mixed category and ticks the whole thing on request', () => {
    const rows = [safe, review];
    expect(categoryChecked(rows, EMPTY_SELECTION)).toBe('indeterminate');
    const all = setRows(EMPTY_SELECTION, rows, true);
    expect(categoryChecked(rows, all)).toBe(true);
    const none = setRows(all, rows, false);
    expect(categoryChecked(rows, none)).toBe(false);
    expect(categoryChecked([review], EMPTY_SELECTION)).toBe(false);
    expect(categoryChecked([], EMPTY_SELECTION)).toBe(false);
  });

  it('puts a category with no safe rows under "take a look first"', () => {
    expect(needsLookFirst([review])).toBe(true);
    expect(needsLookFirst([safe, review])).toBe(false);
    expect(needsLookFirst([])).toBe(false);
  });

  it('drops kept rows from the list, the totals and the paths, and brings them back on undo', () => {
    const other = offered('C:\\Temp\\b', 30);
    const kept = keepRow(toggleRow(EMPTY_SELECTION, other), safe);
    expect(listedRows([safe, other], kept)).toEqual([other]);
    expect(isSelected(kept, safe)).toBe(false);
    expect(selectionTotals([[safe, other]], kept)).toEqual({ bytes: 0, items: 0, categories: 0, paths: [] });
    const undone = unkeepRow(kept, safe);
    expect(selectionTotals([[safe, other]], undone).paths).toEqual([safe.path]);
  });

  it('totals exactly the rows that would be handed to the plan', () => {
    const second = offered('C:\\Cache\\c', 20, { category: 'app-caches' });
    const totals = selectionTotals([[safe], [review], [second]], EMPTY_SELECTION);
    expect(totals).toEqual({ bytes: 120, items: 2, categories: 2, paths: [safe.path, second.path] });
    const withReview = setRows(EMPTY_SELECTION, [review], true);
    expect(selectionTotals([[safe], [review], [second]], withReview).bytes).toBe(170);
  });
});
