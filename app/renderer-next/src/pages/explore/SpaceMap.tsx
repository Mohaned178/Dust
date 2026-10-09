import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../lib/api';
import { TRUNCATED_NOTE, folderKey } from '../../lib/explore';
import { formatBytes } from '../../lib/format';
import { OTHER_TILE_KEY, layoutTreemap } from '../../lib/treemap';
import type { Tile } from '../../lib/treemap';
import { useExploreStore } from '../../stores/explore';
import { cn } from '../../lib/cn';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ChevronRightIcon, OpenIcon } from '../../ui/icons';
import { Skeleton } from '../../ui/Skeleton';

const MAP_HEIGHT = 420;
/** Smaller tiles still show, but without a label; the name stays in the tooltip and the accessible name. */
const LABEL_MIN_WIDTH = 72;
const LABEL_MIN_HEIGHT = 40;

export function SpaceMap({ root }: { root: string }) {
  const api = useApi();
  const stack = useExploreStore((state) => state.mapStack);
  const nodes = useExploreStore((state) => state.nodes);
  const drillTo = useExploreStore((state) => state.drillTo);
  const popTo = useExploreStore((state) => state.popTo);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const current = stack[stack.length - 1] ?? { path: '', name: root, bytes: null };
  const node = nodes[folderKey(current.path)];

  useEffect(() => {
    void useExploreStore.getState().loadFolder(api, root, current.path);
  }, [api, root, current.path]);

  // A page that is hidden reports no width; nothing is laid out until it has one.
  useLayoutEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const tiles = useMemo(
    () => (node?.status === 'ready' ? layoutTreemap(node.rows, current.bytes, width, MAP_HEIGHT) : []),
    [node, current.bytes, width],
  );

  const open = (tile: Tile) => {
    if (tile.row === null || tile.row.childCount === 0) return;
    drillTo(api, root, { path: tile.row.path, name: tile.row.name, bytes: tile.row.bytes });
  };

  let body;
  if (node === undefined || (node.status === 'loading' && node.rows.length === 0)) {
    body = <Skeleton className="h-[420px] w-full" />;
  } else if (node.status === 'error' && node.rows.length === 0) {
    body = (
      <EmptyState
        title="Dust could not read this folder"
        action={
          <Button onClick={() => void useExploreStore.getState().loadFolder(api, root, current.path)}>Try again</Button>
        }
      />
    );
  } else if (node.rows.length === 0) {
    body = (
      <EmptyState
        title={current.path === '' ? 'Nothing to show' : 'No folders in here'}
        description={
          // The scan counted subfolders here, but the saved scan stopped before storing them.
          current.bytes !== null && current.bytes > 0 ? TRUNCATED_NOTE : undefined
        }
      />
    );
  } else {
    body = (
      <div
        role="group"
        aria-label={`Folders in ${current.name}, drawn by size`}
        className="relative"
        style={{ height: MAP_HEIGHT }}
      >
        {tiles.map((tile) => {
          const labelled = tile.w >= LABEL_MIN_WIDTH && tile.h >= LABEL_MIN_HEIGHT;
          const geometry = { left: tile.x, top: tile.y, width: tile.w, height: tile.h };
          const name = `${tile.label}, ${formatBytes(tile.bytes)}`;
          const content = labelled ? (
            <span className="flex min-w-0 flex-col items-start gap-0.5 overflow-hidden p-2 text-left">
              <span className="max-w-full truncate text-body font-semibold">{tile.label}</span>
              <span className="text-caption tabular-nums">{formatBytes(tile.bytes)}</span>
            </span>
          ) : null;
          if (tile.key === OTHER_TILE_KEY) {
            return (
              <div
                key={tile.key}
                role="img"
                aria-label={name}
                title={name}
                className="absolute overflow-hidden rounded-control bg-surface-pressed text-ink-2"
                style={geometry}
              >
                {content}
              </div>
            );
          }
          const canOpen = tile.row !== null && tile.row.childCount > 0;
          return (
            <button
              key={tile.key}
              type="button"
              aria-label={canOpen ? `${name}. Open` : name}
              title={name}
              onClick={() => open(tile)}
              className={cn(
                'dur-faster absolute overflow-hidden rounded-control border border-accent-border bg-accent-soft text-ink transition-colors',
                canOpen ? 'cursor-pointer hover:bg-accent-border' : 'cursor-default',
              )}
              style={geometry}
            >
              {content}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Folder path">
          <ol className="flex flex-wrap items-center gap-1 text-body">
            {stack.map((crumb, index) => {
              const last = index === stack.length - 1;
              return (
                <li key={`${index}:${crumb.path}`} className="flex items-center gap-1">
                  {index > 0 ? <ChevronRightIcon className="size-4 text-ink-3" aria-hidden="true" /> : null}
                  {last ? (
                    <span aria-current="page" className="font-semibold">
                      {crumb.name}
                    </span>
                  ) : (
                    <Button variant="subtle" onClick={() => popTo(index)}>
                      {crumb.name}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        {current.path !== '' ? (
          <Button
            variant="subtle"
            icon={<OpenIcon className="size-4" aria-hidden="true" />}
            onClick={() => void api.revealPath(current.path).catch(() => {})}
          >
            Show in Explorer
          </Button>
        ) : null}
      </div>
      <div ref={frame} style={{ minHeight: MAP_HEIGHT }}>
        {body}
      </div>
      <p className="text-caption text-ink-2">
        {current.bytes === null
          ? 'The largest folders on the drive. Select one to look inside it.'
          : `${current.name} holds ${formatBytes(current.bytes)}. Select a folder to look inside it.`}
      </p>
    </div>
  );
}
