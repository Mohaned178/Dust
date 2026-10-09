import { describe, expect, it } from 'vitest';
import { TRUNCATED_NOTE, flattenTree } from '../../../renderer/src/lib/explore';
import type { FolderNode } from '../../../renderer/src/lib/explore';
import { MAX_TILES, OTHER_TILE_KEY, layoutTreemap } from '../../../renderer/src/lib/treemap';
import type { ResultRow } from '../../../src/shared/ipc';
import { makeResultsRows } from '../../renderer/fakes';

function folder(path: string, bytes: number, childCount = 0): ResultRow {
  return {
    ...makeResultsRows()[1]!,
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    bytes,
    childCount,
    action: null,
    grade: 'review',
  };
}

const ready = (rows: ResultRow[], total = rows.length): FolderNode => ({ rows, total, status: 'ready' });

describe('flattenTree', () => {
  const users = folder('C:\\Users', 100, 2);
  const windows = folder('C:\\Windows', 50, 1);
  const pc = folder('C:\\Users\\pc', 80, 0);

  it('lists the drive root first and says so while it loads', () => {
    expect(flattenTree({}, new Set())).toMatchObject([{ kind: 'note', tone: 'loading' }]);
    const items = flattenTree({ '': ready([users, windows]) }, new Set());
    expect(items.map((item) => item.kind)).toEqual(['folder', 'folder']);
    // Bars are drawn against the largest sibling.
    expect(items[1]).toMatchObject({ kind: 'folder', scaleBytes: 100, depth: 0, expanded: false });
  });

  it('puts the children of an open folder right under it, one level deeper', () => {
    const nodes = { '': ready([users, windows]), 'c:\\users': ready([pc]) };
    const items = flattenTree(nodes, new Set(['c:\\users']));
    expect(items.map((item) => (item.kind === 'folder' ? `${item.depth}:${item.row.name}` : item.kind))).toEqual([
      '0:Users',
      '1:pc',
      '0:Windows',
    ]);
  });

  it('shows a loading row, an error row, and the saved-scan note under the right folders', () => {
    const open = new Set(['c:\\users', 'c:\\windows']);
    const loading = flattenTree({ '': ready([users, windows]) }, open);
    expect(
      loading.filter((item) => item.kind === 'note').map((item) => (item.kind === 'note' ? item.tone : '')),
    ).toEqual(['loading', 'loading']);

    const failed = flattenTree(
      { '': ready([users]), 'c:\\users': { rows: [], total: 0, status: 'error' } },
      new Set(['c:\\users']),
    );
    expect(failed[1]).toMatchObject({ kind: 'note', tone: 'error', parentPath: 'C:\\Users' });

    // The scan counted subfolders in Windows, but the saved scan stored none of them.
    const truncated = flattenTree({ '': ready([windows]), 'c:\\windows': ready([]) }, new Set(['c:\\windows']));
    expect(truncated[1]).toMatchObject({ kind: 'note', tone: 'note', text: TRUNCATED_NOTE });

    // A folder with no subfolders at all is just empty.
    const leaf = folder('C:\\Leaf', 5, 0);
    const empty = flattenTree({ '': ready([leaf]), 'c:\\leaf': ready([]) }, new Set(['c:\\leaf']));
    expect(empty[1]).toMatchObject({ kind: 'note', text: 'No folders in here.' });
  });

  it('adds a "more" row when only part of a long folder has been loaded', () => {
    const rows = Array.from({ length: 3 }, (_, index) => folder(`C:\\big\\${index}`, 10 - index));
    const items = flattenTree({ '': ready(rows, 10_000) }, new Set());
    expect(items).toHaveLength(4);
    expect(items[3]).toMatchObject({ kind: 'more', remaining: 9_997, loading: false, parentPath: '' });
    const loadingMore = flattenTree({ '': { rows, total: 10_000, status: 'loading' } }, new Set());
    expect(loadingMore[3]).toMatchObject({ kind: 'more', loading: true });
  });

  it('flattens 10,000 rows without trouble and keeps every key unique', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => folder(`C:\\big\\${index}`, 10_000 - index));
    const items = flattenTree({ '': ready(rows) }, new Set());
    expect(items).toHaveLength(10_000);
    expect(new Set(items.map((item) => item.key)).size).toBe(10_000);
  });
});

describe('layoutTreemap', () => {
  const rows = Array.from({ length: 60 }, (_, index) => folder(`C:\\f${index}`, 1000 - index * 10));

  it('draws at most 40 tiles, folders first, and never at zero width', () => {
    expect(layoutTreemap(rows, null, 0, 400)).toEqual([]);
    expect(layoutTreemap(rows, null, 800, 1)).toEqual([]);
    const tiles = layoutTreemap(rows, 100_000, 800, 400);
    expect(tiles).toHaveLength(MAX_TILES);
    expect(tiles.filter((tile) => tile.row !== null)).toHaveLength(MAX_TILES - 1);
    expect(tiles.filter((tile) => tile.row === null)).toHaveLength(1);
  });

  it('turns what the shown folders leave out into one "everything else" tile, never a negative one', () => {
    const three = rows.slice(0, 3); // 1000 + 990 + 980
    const withRest = layoutTreemap(three, 4000, 600, 300);
    const other = withRest.find((tile) => tile.key === OTHER_TILE_KEY);
    expect(other).toMatchObject({ label: 'Everything else', bytes: 1030, row: null });
    // The folder is smaller than its parts add up to (files changed since the scan): no remainder.
    expect(layoutTreemap(three, 100, 600, 300).some((tile) => tile.key === OTHER_TILE_KEY)).toBe(false);
    // The drive root has no known size, so no remainder either.
    expect(layoutTreemap(three, null, 600, 300).some((tile) => tile.key === OTHER_TILE_KEY)).toBe(false);
  });

  it('keeps every tile inside the frame, sized in proportion to its bytes', () => {
    const tiles = layoutTreemap(rows.slice(0, 10), null, 800, 400);
    for (const tile of tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.w).toBeLessThanOrEqual(800);
      expect(tile.y + tile.h).toBeLessThanOrEqual(400);
    }
    const largest = tiles.find((tile) => tile.bytes === 1000)!;
    const smallest = tiles.find((tile) => tile.bytes === 910)!;
    expect(largest.w * largest.h).toBeGreaterThan(smallest.w * smallest.h);
  });

  it('skips empty folders', () => {
    expect(layoutTreemap([folder('C:\\empty', 0)], null, 800, 400)).toEqual([]);
  });
});
