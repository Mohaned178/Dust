import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import type { ResultRow } from '../../../src/shared/ipc';
import { folderKey } from './explore';

/** Most tiles on the map, the "everything else" tile included. */
export const MAX_TILES = 40;

export interface Tile {
  key: string;
  label: string;
  bytes: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The folder this tile stands for; null for the "everything else" tile. */
  row: ResultRow | null;
}

export const OTHER_TILE_KEY = '\u0000other';

interface Datum {
  key: string;
  label: string;
  value: number;
  row: ResultRow | null;
  children?: Datum[];
}

/**
 * Lays out up to MAX_TILES rectangles, sized by bytes, for the folders in `rows` (largest first).
 * What the shown folders leave out of `folderBytes` becomes one muted "everything else" tile. A drive root has no
 * known size, so it passes null and gets no such tile.
 */
export function layoutTreemap(
  rows: ReadonlyArray<ResultRow>,
  folderBytes: number | null,
  width: number,
  height: number,
): Tile[] {
  if (width < 2 || height < 2) return [];
  const positive = rows.filter((row) => row.bytes > 0);
  const shown = positive.slice(0, MAX_TILES - 1);
  const shownBytes = shown.reduce((sum, row) => sum + row.bytes, 0);
  const rest = folderBytes === null ? 0 : Math.max(folderBytes - shownBytes, 0);
  const items: Datum[] = shown.map((row) => ({ key: folderKey(row.path), label: row.name, value: row.bytes, row }));
  if (rest > 0) items.push({ key: OTHER_TILE_KEY, label: 'Everything else', value: rest, row: null });
  if (items.length === 0) return [];
  const tree = hierarchy<Datum>({ key: '', label: '', value: 0, row: null, children: items }).sum((datum) =>
    datum.children === undefined ? datum.value : 0,
  );
  const laid = treemap<Datum>().size([width, height]).tile(treemapSquarify).paddingInner(2).round(true)(tree);
  return laid.leaves().map((leaf) => ({
    key: leaf.data.key,
    label: leaf.data.label,
    bytes: leaf.data.value,
    x: leaf.x0,
    y: leaf.y0,
    w: leaf.x1 - leaf.x0,
    h: leaf.y1 - leaf.y0,
    row: leaf.data.row,
  }));
}
