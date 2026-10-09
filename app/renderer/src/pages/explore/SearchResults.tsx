import { useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { ResultRow } from '../../../../src/shared/ipc';
import { useApi } from '../../lib/api';
import { formatBytes, formatCount } from '../../lib/format';
import { useExploreStore } from '../../stores/explore';
import { EmptyState } from '../../ui/EmptyState';
import { GradePill } from '../../ui/Badge';
import { IconButton } from '../../ui/IconButton';
import { MapIcon, OpenIcon } from '../../ui/icons';
import { Skeleton } from '../../ui/Skeleton';
import { VirtualList } from '../../ui/VirtualList';
import type { VirtualListHandle } from '../../ui/VirtualList';
import { useRoving } from './useRoving';

export interface SearchState {
  query: string;
  rows: ResultRow[];
  /** Every match, even when `rows` is capped. */
  total: number;
  status: 'loading' | 'ready' | 'error';
}

const getKey = (row: ResultRow) => row.path.toLowerCase();
const ROW_HEIGHT = 52;

export function SearchResults({ root, state }: { root: string; state: SearchState }) {
  const api = useApi();
  const listRef = useRef<VirtualListHandle>(null);
  const roving = useRoving(state.rows, getKey, listRef);
  const { tabStopKey, setActiveKey } = roving;

  const renderRow = useCallback(
    (row: ResultRow) => {
      const active = getKey(row) === tabStopKey;
      return (
        <div className="group flex h-13 items-center gap-3 px-3 hover:bg-surface-hover">
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-semibold">{row.name}</p>
            <p className="truncate font-mono text-caption text-ink-2" title={row.path}>
              {row.path}
            </p>
          </div>
          {row.grade === 'danger' ? <GradePill grade="protected" /> : null}
          <span className="w-20 shrink-0 text-right text-body tabular-nums">{formatBytes(row.bytes)}</span>
          <span className="flex shrink-0 items-center">
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
    [api, root, tabStopKey],
  );

  const itemProps = useCallback(
    (row: ResultRow) => ({
      tabIndex: getKey(row) === tabStopKey ? 0 : -1,
      'data-key': getKey(row),
      'aria-label': `${row.path}, ${formatBytes(row.bytes)}`,
      onClick: () => setActiveKey(getKey(row)),
    }),
    [tabStopKey, setActiveKey],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) =>
    roving.onKeyDown(event, (index) => {
      const row = state.rows[index];
      if (row === undefined || event.key !== 'Enter') return false;
      useExploreStore.getState().showOnMap(api, root, row);
      return true;
    });

  if (state.status === 'loading' && state.rows.length === 0) {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (state.status === 'error') {
    return <EmptyState title="The search did not finish" description="Try searching again." />;
  }
  if (state.rows.length === 0) {
    return <EmptyState title={`Nothing matches “${state.query}”`} description="Names and folder paths are searched." />;
  }

  return (
    <div>
      <p className="px-3 pt-2 pb-1 text-caption text-ink-2" role="status">
        {state.total > state.rows.length
          ? `Showing the largest ${formatCount(state.rows.length)} of ${formatCount(state.total)} matches. Search for something more specific to narrow them.`
          : `${formatCount(state.total)} ${state.total === 1 ? 'match' : 'matches'}`}
      </p>
      <div ref={roving.containerRef} onKeyDown={onKeyDown} className="h-[56vh] min-h-72">
        <VirtualList
          ref={listRef}
          items={state.rows}
          rowHeight={ROW_HEIGHT}
          getKey={getKey}
          renderRow={renderRow}
          label="Search results"
          itemProps={itemProps}
        />
      </div>
    </div>
  );
}
