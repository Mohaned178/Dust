import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DustApi, ResultRow } from '../../../src/shared/ipc';
import { formatBytes, formatCount } from '../format';
import { pathKey } from '../tree';
import { Button, Card, FOCUS } from './ui';
import { ChevronRightIcon, FolderIcon } from './icons';

// Treemap of where the space went: each folder is a rectangle sized by its
// bytes. Click a folder to look inside it; the breadcrumb walks back out.

export interface SpaceMapProps {
  api: DustApi;
  root: string;
}

interface Tile {
  key: string;
  label: string;
  bytes: number;
  row: ResultRow | null;
  kind: 'folder' | 'files' | 'other';
  count?: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_TILES = 36;
const RAMP = ['--color-map-1', '--color-map-2', '--color-map-3', '--color-map-4', '--color-map-5', '--color-map-6'];

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

export function SpaceMap({ api, root }: SpaceMapProps) {
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(root);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    setCurrent(root);
    api
      .getResults(root)
      .then((state) => {
        if (active) setRows(state.rows);
      })
      .catch(() => {
        if (active) setError('Couldn’t load the space map.');
      });
    return () => {
      active = false;
    };
  }, [api, root]);

  const index = useMemo(() => {
    const byKey = new Map<string, ResultRow>();
    const children = new Map<string, ResultRow[]>();
    for (const row of rows ?? []) {
      byKey.set(pathKey(row.path), row);
      if (row.parent === null) continue;
      const parentKey = pathKey(row.parent);
      const list = children.get(parentKey);
      if (list) list.push(row);
      else children.set(parentKey, [row]);
    }
    return { byKey, children };
  }, [rows]);

  const folder = index.byKey.get(pathKey(current)) ?? null;
  const tiles = useMemo<Tile[]>(() => {
    if (folder === null) return [];
    const kids = [...(index.children.get(pathKey(folder.path)) ?? [])].sort((a, b) => b.bytes - a.bytes);
    const shown = kids.slice(0, MAX_TILES).filter((row) => row.bytes > 0);
    const rest = kids.slice(MAX_TILES);
    const out: Tile[] = shown.map((row) => ({ key: row.path, label: row.name, bytes: row.bytes, row, kind: 'folder' }));
    const restBytes = rest.reduce((sum, row) => sum + row.bytes, 0);
    if (restBytes > 0) {
      out.push({
        key: '\u0000other',
        label: `${formatCount(rest.length)} smaller folders`,
        bytes: restBytes,
        row: null,
        kind: 'other',
        count: rest.length,
      });
    }
    const filesBytes = folder.bytes - kids.reduce((sum, row) => sum + row.bytes, 0);
    if (filesBytes > folder.bytes * 0.005) {
      out.push({ key: '\u0000files', label: 'Files in this folder', bytes: filesBytes, row: null, kind: 'files' });
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

  const canOpen = (tile: Tile) => tile.row !== null && (index.children.get(pathKey(tile.row.path))?.length ?? 0) > 0;

  if (error !== null) return <Card className="p-8 text-center text-sm text-ink-muted">{error}</Card>;
  if (rows === null) return <div className="h-[460px] animate-pulse rounded-2xl border border-hairline bg-surface" />;
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
                onClick={() => setCurrent(crumb.path)}
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
        <Treemap
          tiles={tiles}
          total={folder.bytes}
          hovered={hovered}
          onHover={setHovered}
          canOpen={canOpen}
          onOpen={(tile) => tile.row !== null && setCurrent(tile.row.path)}
        />
        <p className="mt-2 text-xs text-ink-muted">Click a block to look inside it. Bigger blocks use more space.</p>
      </div>

      <Card className="self-start p-5">
        <h3 className="text-sm font-semibold text-ink">Largest here</h3>
        <ol className="mt-3 space-y-3">
          {tiles.slice(0, 10).map((tile) => {
            const share = folder.bytes > 0 ? tile.bytes / folder.bytes : 0;
            const open = canOpen(tile);
            return (
              <li key={tile.key} onMouseEnter={() => setHovered(tile.key)} onMouseLeave={() => setHovered(null)}>
                <button
                  type="button"
                  disabled={!open}
                  onClick={() => tile.row !== null && setCurrent(tile.row.path)}
                  className={`w-full rounded-lg text-left ${FOCUS} ${open ? 'group' : 'cursor-default'}`}
                >
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span
                      className={`flex min-w-0 items-center gap-1.5 ${open ? 'text-ink group-hover:text-accent' : 'text-ink-muted'}`}
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
            <Button size="sm" onClick={() => void api.revealPath(folder.path)}>
              Open in Explorer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => folder.parent !== null && setCurrent(folder.parent)}>
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
  canOpen,
  onOpen,
}: {
  tiles: Tile[];
  total: number;
  hovered: string | null;
  onHover: (key: string | null) => void;
  canOpen: (tile: Tile) => boolean;
  onOpen: (tile: Tile) => void;
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
    <div
      ref={ref}
      role="list"
      aria-label="Space map"
      className="relative h-[460px] overflow-hidden rounded-2xl border border-hairline bg-surface"
    >
      {tiles.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
          This folder is empty.
        </p>
      )}
      {tiles.map((tile, position) => {
        const rect = rects[position];
        if (rect === undefined || rect.w < 1 || rect.h < 1) return null;
        const shade = tile.kind === 'folder' ? Math.min(position, RAMP.length - 1) : -1;
        const dark = shade >= 0 && shade <= 2;
        const open = canOpen(tile);
        const share = total > 0 ? Math.round((tile.bytes / total) * 100) : 0;
        const named = rect.w > 44 && rect.h > 22;
        const roomy = rect.w > 64 && rect.h > 40;
        return (
          <button
            key={tile.key}
            type="button"
            role="listitem"
            title={`${tile.label} · ${formatBytes(tile.bytes)} (${share}%)`}
            aria-label={`${tile.label}, ${formatBytes(tile.bytes)}, ${share} percent${open ? ', open' : ''}`}
            onClick={() => open && onOpen(tile)}
            onMouseEnter={() => onHover(tile.key)}
            onMouseLeave={() => onHover(null)}
            className={`absolute overflow-hidden border-2 border-surface p-2 text-left transition-[filter] duration-150 ${FOCUS} ${
              open ? 'cursor-pointer hover:brightness-110' : 'cursor-default'
            } ${hovered === tile.key ? 'brightness-110' : ''}`}
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              borderRadius: 10,
              backgroundColor: shade >= 0 ? `var(${RAMP[shade]})` : 'var(--color-map-files)',
              color: dark ? 'var(--color-map-ink-dark)' : 'var(--color-map-ink-light)',
            }}
          >
            {named && <span className="block truncate text-xs font-semibold">{tile.label}</span>}
            {roomy && (
              <span className="block truncate font-mono text-[11px] opacity-80">
                {formatBytes(tile.bytes)} · {share}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
