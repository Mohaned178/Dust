import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { ResultRow } from '../../../../src/shared/ipc';
import { useApi } from '../../lib/api';
import { flattenTree } from '../../lib/explore';
import type { FlatItem } from '../../lib/explore';
import { formatBytes, formatCount } from '../../lib/format';
import { useExploreStore } from '../../stores/explore';
import { Button } from '../../ui/Button';
import { GradePill } from '../../ui/Badge';
import { IconButton } from '../../ui/IconButton';
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, MapIcon, OpenIcon } from '../../ui/icons';
import { VirtualList } from '../../ui/VirtualList';
import type { VirtualListHandle } from '../../ui/VirtualList';
import { cn } from '../../lib/cn';
import { useRoving } from './useRoving';

export const ROW_HEIGHT = 40;
const INDENT = 20;

const getKey = (item: FlatItem) => item.key;

/**
 * The end of a folder that has more children than were loaded. It is only drawn once the list has been scrolled to
 * it, which is when the next page is wanted, so it loads that page by itself. The button is for the keyboard and
 * for a page that failed.
 */
function MoreRow({
  item,
  padding,
  onLoad,
}: {
  item: Extract<FlatItem, { kind: 'more' }>;
  padding: { paddingLeft: number };
  onLoad: (path: string) => void;
}) {
  const { loading, parentPath } = item;
  useEffect(() => {
    if (!loading) onLoad(parentPath);
    // Once, when the row comes into view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex h-10 items-center pr-3" style={padding}>
      <span className="w-5 shrink-0" aria-hidden="true" />
      <Button variant="subtle" loading={loading} onClick={() => onLoad(parentPath)} tabIndex={-1}>
        Show {formatCount(Math.min(item.remaining, 1000))} more
        {item.remaining > 1000 ? ` (${formatCount(item.remaining)} left)` : ''}
      </Button>
    </div>
  );
}

export function FolderTree({ root }: { root: string }) {
  const api = useApi();
  const nodes = useExploreStore((state) => state.nodes);
  const expanded = useExploreStore((state) => state.expanded);
  const items = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded]);
  const listRef = useRef<VirtualListHandle>(null);
  const roving = useRoving(items, getKey, listRef);
  const { tabStopKey, setActiveKey, moveTo, activeIndex } = roving;

  const toggle = useCallback((row: ResultRow) => useExploreStore.getState().toggle(api, root, row), [api, root]);
  const loadMore = useCallback(
    (path: string) => void useExploreStore.getState().loadFolder(api, root, path, true),
    [api, root],
  );
  const retry = useCallback((path: string) => void useExploreStore.getState().loadFolder(api, root, path), [api, root]);

  const activate = useCallback(
    (item: FlatItem) => {
      if (item.kind === 'folder') {
        if (item.row.childCount > 0) toggle(item.row);
      } else if (item.kind === 'more') loadMore(item.parentPath);
      else if (item.tone === 'error') retry(item.parentPath);
    },
    [toggle, loadMore, retry],
  );

  const renderRow = useCallback(
    (item: FlatItem) => {
      const padding = { paddingLeft: 8 + item.depth * INDENT };
      if (item.kind === 'note') {
        return (
          <div className="flex h-10 items-center gap-2 pr-3 text-caption text-ink-2" style={padding}>
            <span className="w-5 shrink-0" aria-hidden="true" />
            <span>{item.text}</span>
            {item.tone === 'error' ? (
              <Button variant="subtle" onClick={() => retry(item.parentPath)}>
                Try again
              </Button>
            ) : null}
          </div>
        );
      }
      if (item.kind === 'more') {
        return <MoreRow item={item} padding={padding} onLoad={loadMore} />;
      }
      const { row } = item;
      const hasChildren = row.childCount > 0;
      const active = item.key === tabStopKey;
      const Icon = item.expanded ? FolderOpenIcon : FolderIcon;
      return (
        <div className="group flex h-10 items-center gap-2 pr-2 hover:bg-surface-hover" style={padding}>
          <ChevronRightIcon
            className={cn('size-5 shrink-0 text-ink-2', !hasChildren && 'invisible', item.expanded && 'rotate-90')}
            aria-hidden="true"
          />
          <Icon className="size-5 shrink-0 text-ink-2" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-body" title={row.path}>
            {row.name}
          </span>
          {row.grade === 'danger' ? <GradePill grade="protected" /> : null}
          <span
            className="hidden h-1 w-24 shrink-0 overflow-hidden rounded-control bg-surface-pressed sm:block"
            aria-hidden="true"
          >
            <span
              className="block h-full origin-left bg-accent"
              style={{ width: `${Math.max((row.bytes / item.scaleBytes) * 100, 1)}%` }}
            />
          </span>
          <span className="w-20 shrink-0 text-right text-body tabular-nums">{formatBytes(row.bytes)}</span>
          <span
            className={cn(
              'flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
              active && 'opacity-100',
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton
              label={`Show ${row.name} on the map`}
              tabIndex={active ? 0 : -1}
              onClick={() => useExploreStore.getState().showOnMap(api, root, row)}
            >
              <MapIcon className="size-5" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`Show ${row.name} in Explorer`}
              tabIndex={active ? 0 : -1}
              onClick={() => void api.revealPath(row.path).catch(() => {})}
            >
              <OpenIcon className="size-5" aria-hidden="true" />
            </IconButton>
          </span>
        </div>
      );
    },
    [api, root, tabStopKey, loadMore, retry],
  );

  const itemProps = useCallback(
    (item: FlatItem) => ({
      'aria-level': item.depth + 1,
      'aria-expanded': item.kind === 'folder' && item.row.childCount > 0 ? item.expanded : undefined,
      'aria-label': item.kind === 'folder' ? `${item.row.name}, ${formatBytes(item.row.bytes)}` : undefined,
      tabIndex: item.key === tabStopKey ? 0 : -1,
      'data-key': item.key,
      // On the row itself, so a click anywhere on it (or on the row for a test or a screen reader) opens it.
      onClick: () => {
        setActiveKey(item.key);
        if (item.kind === 'folder' && item.row.childCount > 0) toggle(item.row);
      },
    }),
    [tabStopKey, setActiveKey, toggle],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) =>
    roving.onKeyDown(event, (index) => {
      const item = items[index];
      if (item === undefined) return false;
      if (event.key === 'Enter' || event.key === ' ') {
        activate(item);
        return true;
      }
      if (item.kind !== 'folder') return false;
      const hasChildren = item.row.childCount > 0;
      if (event.key === 'ArrowRight') {
        if (!hasChildren) return true;
        if (!item.expanded) toggle(item.row);
        else moveTo(index + 1);
        return true;
      }
      if (event.key === 'ArrowLeft') {
        if (item.expanded) {
          useExploreStore.getState().collapse(item.row);
        } else {
          // Up to the folder this one sits in.
          for (let at = index - 1; at >= 0; at -= 1) {
            const candidate = items[at];
            if (candidate !== undefined && candidate.depth < item.depth) {
              moveTo(at);
              break;
            }
          }
        }
        return true;
      }
      return false;
    });

  return (
    <div ref={roving.containerRef} onKeyDown={onKeyDown} className="h-[60vh] min-h-80" data-active-index={activeIndex}>
      <VirtualList
        ref={listRef}
        items={items}
        rowHeight={ROW_HEIGHT}
        getKey={getKey}
        renderRow={renderRow}
        label="Folders"
        semantics="tree"
        itemProps={itemProps}
      />
    </div>
  );
}
