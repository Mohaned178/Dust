import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DustApi, ResultRow } from '../../../src/shared/ipc';
import { formatBytes, formatCount } from '../format';
import { pathKey, pathParent } from '../tree';
import { Alert, Button, Card, FOCUS } from './ui';
import { ChevronRightIcon, FolderIcon } from './icons';

// Treemap of where the space went: each folder is a rectangle sized by its
// bytes and shaded by how much of it is safe to clean. Click a folder to look
// inside it; the breadcrumb walks back out.

export interface SpaceMapProps {
  api: DustApi;
  root: string;
  /** Rows of the saved scan, loaded by the Results page. null while loading. */
  rows: ResultRow[] | null;
  failed?: boolean;
}

interface Tile {
  key: string;
  label: string;
  bytes: number;
  /** Bytes inside this tile that are safe to clean. */
  reclaim: number;
  row: ResultRow | null;
  kind: 'folder' | 'files' | 'other';
  openable: boolean;
  /** The scan saw subfolders here, but the snapshot stopped before storing them. */
  truncated: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Level = 'none' | 'some' | 'most' | 'all';

const MAX_TILES = 36;
const TRUNCATED_NOTE = 'Folders deeper than this weren’t saved — rescan to see them.';
const LEVEL_ORDER: Level[] = ['none', 'some', 'most', 'all'];
const LEVELS: Record<Level, { bg: string; ink: string; label: string }> = {
  none: { bg: '--color-map-6', ink: '--color-map-ink-light', label: 'Nothing safe to clean' },
  some: { bg: '--color-map-4', ink: '--color-map-ink-light', label: 'Some safe' },
  most: { bg: '--color-map-2', ink: '--color-map-ink-dark', label: 'Mostly safe' },
  all: { bg: '--color-map-1', ink: '--color-map-ink-dark', label: 'All safe' },
};

/** Squarified treemap layout (Bruls, Huizing, van Wijk). Values must be sorted descending. */
export function squarify(values: number[], frame: Rect): Rect[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  const out: Rect[] = new Array(values.length);
  if (total <= 0 || frame.w <= 0 || frame.h <= 0) return values.map(() => ({ x: frame.x, y: frame.y, w: 0, h: 0 }));
  const scale = (frame.w * frame.h) / total;
  const areas = values.map((value) => value * scale);
  let { x, y, w, h } = frame;
  let index = 0;
  while (index < areas.length) {
    const side = Math.min(w, h);
    let row = [areas[index]!];
    let end = index + 1;
    const worst = (items: number[]) => {
      const sum = items.reduce((a, b) => a + b, 0);
      const max = Math.max(...items);
      const min = Math.min(...items);
      return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
    };
    while (end < areas.length && worst([...row, areas[end]!]) <= worst(row)) {
      row = [...row, areas[end]!];
      end += 1;
    }
    const sum = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      const columnWidth = sum / h;
      let cursor = y;
      row.forEach((area, offset) => {
        const tileHeight = area / columnWidth;
        out[index + offset] = { x, y: cursor, w: columnWidth, h: tileHeight };
        cursor += tileHeight;
      });
      x += columnWidth;
      w -= columnWidth;
    } else {
      const rowHeight = sum / w;
      let cursor = x;
      row.forEach((area, offset) => {
        const tileWidth = area / rowHeight;
        out[index + offset] = { x: cursor, y, w: tileWidth, h: rowHeight };
        cursor += tileWidth;
      });
      y += rowHeight;
      h -= rowHeight;
    }
    index = end;
  }
  return out;
}

interface MapIndex {
  byKey: Map<string, ResultRow>;
  children: Map<string, ResultRow[]>;
  /** Keys of rows that are themselves safe cleanup targets. */
  safeKeys: Set<string>;
  /** Safe-to-clean bytes at or below each saved folder, without double counting nested targets. */
  reclaim: Map<string, number>;
}

function buildIndex(rows: ResultRow[]): MapIndex {
  const byKey = new Map<string, ResultRow>();
  const children = new Map<string, ResultRow[]>();
  const safeKeys = new Set<string>();
  for (const row of rows) {
    const key = pathKey(row.path);
    byKey.set(key, row);
    if (row.action?.grade === 'safe') safeKeys.add(key);
    if (row.parent === null) continue;
    const parentKey = pathKey(row.parent);
    if (parentKey === key) continue;
    const list = children.get(parentKey);
    if (list) list.push(row);
    else children.set(parentKey, [row]);
  }
  // Top contributors below the saved depth arrive without their intermediate
  // folders, so credit each safe target to every saved ancestor by path.
  const reclaim = new Map<string, number>();
  for (const row of rows) {
    if (row.action?.grade !== 'safe') continue;
    let nested = false;
    for (let up = pathParent(row.path); up !== null; up = pathParent(up)) {
      if (safeKeys.has(pathKey(up))) {
        nested = true;
        break;
      }
    }
    if (nested) continue;
    for (let at: string | null = row.path; at !== null; at = pathParent(at)) {
      const key = pathKey(at);
      if (byKey.has(key)) reclaim.set(key, (reclaim.get(key) ?? 0) + row.bytes);
    }
  }
  return { byKey, children, safeKeys, reclaim };
}

function levelOf(tile: Tile): Level {
  if (tile.bytes <= 0) return 'none';
  const fraction = tile.reclaim / tile.bytes;
  if (fraction < 0.005) return 'none';
  if (fraction < 0.5) return 'some';
  if (fraction < 0.95) return 'most';
  return 'all';
}

export function SpaceMap({ api, root, rows, failed = false }: SpaceMapProps) {
  const [current, setCurrent] = useState(root);
  const [hovered, setHovered] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const index = useMemo(() => buildIndex(rows ?? []), [rows]);

  // A clean can remove the folder being viewed; fall back to the nearest one that is left.
  const folder = useMemo(() => {
    for (let at: string | null = current; at !== null; at = pathParent(at)) {
      const row = index.byKey.get(pathKey(at));
      if (row) return row;
    }
    return index.byKey.get(pathKey(root)) ?? null;
  }, [current, index, root]);

  const navigate = (path: string) => {
    setCurrent(path);
    setNote(null);
  };

  const tiles = useMemo<Tile[]>(() => {
    if (folder === null) return [];
    let underSafe = false;
    for (let at: string | null = folder.path; at !== null; at = pathParent(at)) {
      if (index.safeKeys.has(pathKey(at))) underSafe = true;
    }
    const reclaimOf = (row: ResultRow) =>
      underSafe ? row.bytes : Math.min(index.reclaim.get(pathKey(row.path)) ?? 0, row.bytes);
    const kids = [...(index.children.get(pathKey(folder.path)) ?? [])].sort((a, b) => b.bytes - a.bytes);
    const shown = kids.slice(0, MAX_TILES).filter((row) => row.bytes > 0);
    const rest = kids.slice(MAX_TILES);
    const out: Tile[] = shown.map((row) => {
      const hasRows = (index.children.get(pathKey(row.path))?.length ?? 0) > 0;
      return {
        key: row.path,
        label: row.name,
        bytes: row.bytes,
        reclaim: reclaimOf(row),
        row,
        kind: 'folder',
        openable: hasRows,
        truncated: !hasRows && row.childCount > 0,
      };
    });
    const restBytes = rest.reduce((sum, row) => sum + row.bytes, 0);
    if (restBytes > 0) {
      out.push({
        key: '\u0000other',
        label: `${formatCount(rest.length)} smaller folders`,
        bytes: restBytes,
        reclaim: rest.reduce((sum, row) => sum + reclaimOf(row), 0),
        row: null,
        kind: 'other',
        openable: false,
        truncated: false,
      });
    }
    const filesBytes = folder.bytes - kids.reduce((sum, row) => sum + row.bytes, 0);
    if (filesBytes > folder.bytes * 0.005) {
      out.push({
        key: '\u0000files',
        label: 'Files in this folder',
        bytes: filesBytes,
        reclaim: 0,
        row: null,
        kind: 'files',
        openable: false,
        truncated: false,
      });
    }
    return out.sort((a, b) => b.bytes - a.bytes);
  }, [folder, index]);

  const crumbs = useMemo(() => {
    const out: ResultRow[] = [];
    let cursor = folder;
    while (cursor !== null && cursor !== undefined) {
      out.unshift(cursor);
      cursor = cursor.parent === null ? null : (index.byKey.get(pathKey(cursor.parent)) ?? null);
    }
    return out;
  }, [folder, index]);

  const activate = (tile: Tile) => {
    if (tile.row === null) return;
    if (tile.openable) navigate(tile.row.path);
    else if (tile.truncated) setNote(`${tile.label}: ${TRUNCATED_NOTE}`);
    else setNote(`${tile.label} has no subfolders, only files.`);
  };

  if (failed && rows === null) {
    return <Alert tone="danger">Couldn’t load the space map. Open Clean up to try again, or rescan this folder.</Alert>;
  }
  if (rows === null) {
    return (
      <div className="h-[460px] animate-pulse rounded-2xl border border-hairline bg-surface motion-reduce:animate-none" />
    );
  }
  if (folder === null) {
    return <Card className="p-8 text-center text-sm text-ink-muted">Scan this drive to see its space map.</Card>;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <nav aria-label="Folder path" className="mb-3 flex min-w-0 flex-wrap items-center gap-1 text-sm">
          {crumbs.map((crumb, position) => (
            <span key={crumb.path} className="flex min-w-0 items-center gap-1">
              {position > 0 && <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />}
              <button
                type="button"
                onClick={() => navigate(crumb.path)}
                disabled={position === crumbs.length - 1}
                className={`truncate rounded px-1 font-medium ${FOCUS} ${
                  position === crumbs.length - 1 ? 'text-ink' : 'text-accent hover:underline'
                }`}
              >
                {crumb.parent === null ? crumb.path : crumb.name}
              </button>
            </span>
          ))}
          <span className="ml-auto font-mono text-xs text-ink-muted">{formatBytes(folder.bytes)}</span>
        </nav>
        <Treemap tiles={tiles} total={folder.bytes} hovered={hovered} onHover={setHovered} onActivate={activate} />
        <ul
          aria-label="Shading key"
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-muted"
        >
          {LEVEL_ORDER.map((level) => (
            <li key={level} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-sm border border-hairline"
                style={{ backgroundColor: `var(${LEVELS[level].bg})` }}
              />
              {LEVELS[level].label}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-sm border border-hairline"
              style={{ backgroundColor: 'var(--color-map-files)' }}
            />
            Loose files
          </li>
        </ul>
        <p className="mt-2 text-xs text-ink-muted">
          Click a block to look inside it. Bigger blocks use more space; darker blocks have more that is safe to clean.
          {tiles.some((tile) => tile.truncated) && <> Some blocks here can’t be opened. {TRUNCATED_NOTE}</>}
        </p>
        <p role="status" className={note === null ? 'sr-only' : 'mt-1.5 text-xs font-medium text-ink'}>
          {note}
        </p>
      </div>

      <Card className="self-start p-5">
        <h3 className="text-sm font-semibold text-ink">Largest here</h3>
        <ol className="mt-3 space-y-3">
          {tiles.slice(0, 10).map((tile) => {
            const share = folder.bytes > 0 ? tile.bytes / folder.bytes : 0;
            return (
              <li key={tile.key} onMouseEnter={() => setHovered(tile.key)} onMouseLeave={() => setHovered(null)}>
                <button
                  type="button"
                  disabled={tile.row === null}
                  title={tile.truncated ? TRUNCATED_NOTE : undefined}
                  onClick={() => activate(tile)}
                  className={`w-full rounded-lg text-left ${FOCUS} ${tile.openable ? 'group' : 'cursor-default'}`}
                >
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span
                      className={`flex min-w-0 items-center gap-1.5 ${tile.openable ? 'text-ink group-hover:text-accent' : 'text-ink-muted'}`}
                    >
                      {tile.kind === 'folder' && <FolderIcon className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">{tile.label}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-ink-muted">{formatBytes(tile.bytes)}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-track">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(share * 100, 1)}%` }} />
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
        {folder.parent !== null && (
          <div className="mt-5 flex gap-2 border-t border-hairline pt-4">
            <Button size="sm" onClick={() => void api.revealPath(folder.path).catch(() => {})}>
              Open in Explorer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => folder.parent !== null && navigate(folder.parent)}>
              Up one level
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function Treemap({
  tiles,
  total,
  hovered,
  onHover,
  onActivate,
}: {
  tiles: Tile[];
  total: number;
  hovered: string | null;
  onHover: (key: string | null) => void;
  onActivate: (tile: Tile) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = () => setSize({ w: element.clientWidth, h: element.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rects = useMemo(
    () =>
      squarify(
        tiles.map((tile) => tile.bytes),
        { x: 0, y: 0, w: size.w, h: size.h },
      ),
    [tiles, size],
  );

  return (
    <div ref={ref} className="relative h-[460px] overflow-hidden rounded-2xl border border-hairline bg-surface">
      {tiles.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
          This folder is empty.
        </p>
      )}
      <ul aria-label="Space map" className="absolute inset-0 m-0 list-none p-0">
        {tiles.map((tile, position) => {
          const rect = rects[position];
          if (rect === undefined || rect.w < 1 || rect.h < 1) return null;
          const palette = tile.kind === 'files' ? null : LEVELS[levelOf(tile)];
          const share = total > 0 ? Math.round((tile.bytes / total) * 100) : 0;
          const named = rect.w > 44 && rect.h > 22;
          const roomy = rect.w > 64 && rect.h > 40;
          const detail = [
            `${tile.label}, ${formatBytes(tile.bytes)}, ${share} percent`,
            tile.reclaim > 0 ? `${formatBytes(tile.reclaim)} safe to clean` : null,
            tile.openable ? 'open' : tile.truncated ? TRUNCATED_NOTE : null,
          ]
            .filter((part) => part !== null)
            .join(', ');
          return (
            <li
              key={tile.key}
              className="absolute"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            >
              <button
                type="button"
                title={detail}
                aria-label={detail}
                onClick={() => onActivate(tile)}
                onMouseEnter={() => onHover(tile.key)}
                onMouseLeave={() => onHover(null)}
                className={`block h-full w-full overflow-hidden rounded-[10px] border-2 border-surface p-2 text-left transition-[filter] duration-150 ${FOCUS} ${
                  tile.openable ? 'cursor-pointer hover:brightness-110' : 'cursor-default'
                } ${hovered === tile.key ? 'brightness-110' : ''}`}
                style={{
                  backgroundColor: `var(${palette?.bg ?? '--color-map-files'})`,
                  color: `var(${palette?.ink ?? '--color-map-ink-light'})`,
                }}
              >
                {named && <span className="block truncate text-xs font-semibold">{tile.label}</span>}
                {roomy && (
                  <span className="block truncate font-mono text-[11px] opacity-80">
                    {formatBytes(tile.bytes)} · {share}%
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
