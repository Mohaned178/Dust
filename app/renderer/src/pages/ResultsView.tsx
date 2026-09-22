import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryId } from '@dust/core';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../../src/shared/categories';
import type { DustApi, ResultsState } from '../../../src/shared/ipc';
import { CategoryStrip } from '../components/CategoryStrip';
import { TreeTable } from '../components/TreeTable';
import { RowCleanDialog } from '../components/RowCleanDialog';
import { formatBytes, formatCount, formatRelativeTime } from '../format';
import { recordRendererSample } from '../instrument';
import {
  createRowStore,
  filterPaths,
  flattenVisible,
  isRowVisible,
  mergeMatches,
  pathKey,
  sameRoot,
  upsertRows,
} from '../tree';
import type { RowNode, RowStore, SortState } from '../tree';

export interface ResultsViewProps {
  api: DustApi;
  root: string;
  runId: string | null;
  onOpenDevCleanup?: () => void;
}

export function ResultsView({ api, root, runId, onOpenDevCleanup }: ResultsViewProps) {
  const storeRef = useRef<RowStore>(createRowStore(root));
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<ResultsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveCategories, setLiveCategories] = useState<ResultsState['categories']>(emptyCategories);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ key: 'size', desc: true });
  const [filter, setFilter] = useState<CategoryId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cleanPath, setCleanPath] = useState<string | null>(null);
  const [showDanger, setShowDanger] = useState(false);
  const expandedRef = useRef(expanded);
  const reloadSeqRef = useRef(0);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const reload = useCallback(() => {
    const seq = reloadSeqRef.current + 1;
    reloadSeqRef.current = seq;
    api
      .getResults(root)
      .then((next) => {
        if (reloadSeqRef.current !== seq) return;
        storeRef.current = createRowStore(root);
        upsertRows(storeRef.current, next.rows);
        setState(next);
        setVersion((value) => value + 1);
      })
      .catch((cause: unknown) => {
        if (reloadSeqRef.current !== seq) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [api, root]);

  useEffect(() => {
    if (runId !== null) return;
    storeRef.current = createRowStore(root);
    setState(null);
    setError(null);
    setExpanded(new Set());
    setFilter(null);
    setSelected(null);
    setCleanPath(null);
    reload();
  }, [reload, root, runId]);

  useEffect(() => {
    return api.onScanEvent((next) => {
      const startedAt = performance.now();
      try {
        if (next.type === 'cleaned') {
          if (sameRoot(next.root, root)) reload();
          return;
        }
        if (runId === null || !('runId' in next) || next.runId !== runId) return;
        if (next.type === 'folders') {
          const affectsVisible = next.folders.some((row) => isRowVisible(row.parent, root, expandedRef.current));
          const upsertStartedAt = performance.now();
          upsertRows(storeRef.current, next.folders);
          recordRendererSample('results.upsertRows', performance.now() - upsertStartedAt);
          if (affectsVisible) setVersion((value) => value + 1);
          const frameStartedAt = performance.now();
          requestAnimationFrame(() => {
            recordRendererSample('results.frameDelay', performance.now() - frameStartedAt);
          });
        } else if (next.type === 'categories') {
          setLiveCategories(next.categories);
        } else if (next.type === 'matches') {
          const mergeStartedAt = performance.now();
          mergeMatches(storeRef.current, next.matches);
          recordRendererSample('results.mergeMatches', performance.now() - mergeStartedAt);
          setVersion((value) => value + 1);
        }
      } finally {
        recordRendererSample('results.event', performance.now() - startedAt);
      }
    });
  }, [api, root, runId, reload]);

  const filterSet = useMemo(() => {
    const startedAt = performance.now();
    const next = filterPaths(storeRef.current, filter);
    recordRendererSample('results.filterPaths', performance.now() - startedAt);
    return next;
  }, [filter, version]);
  const flatRows = useMemo(() => {
    const startedAt = performance.now();
    const next = flattenVisible(storeRef.current, expanded, sort, filterSet);
    recordRendererSample('results.flattenVisible', performance.now() - startedAt);
    return next;
  }, [version, expanded, sort, filterSet]);
  const dangerCount = useMemo(() => flatRows.filter((entry) => entry.row.grade === 'danger').length, [flatRows]);
  const tableRows = useMemo(() => {
    const startedAt = performance.now();
    const next = showDanger ? flatRows : flatRows.filter((entry) => entry.row.grade !== 'danger');
    recordRendererSample('results.tableRows', performance.now() - startedAt);
    return next;
  }, [flatRows, showDanger]);
  const totalBytes = useMemo(() => storeRef.current.nodes.get(pathKey(root))?.bytes ?? 0, [version, root]);

  const categories = runId !== null ? liveCategories : state?.categories ?? [];
  const source = runId !== null ? 'live' : state === null ? 'loading' : state.source;
  const selectedRow: RowNode | undefined =
    selected !== null ? storeRef.current.nodes.get(pathKey(selected)) : undefined;

  const toggle = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      const key = pathKey(path);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectCategory = useCallback(
    (category: CategoryId | null) => {
      if (category === 'npm-projects' && onOpenDevCleanup !== undefined) {
        onOpenDevCleanup();
        return;
      }
      setFilter(category);
    },
    [onOpenDevCleanup],
  );

  const reveal = useCallback(
    (path: string) => {
      void api.revealPath(path).catch(() => {});
    },
    [api],
  );

  if (error !== null) {
    return <section aria-label="Results" className="text-sm text-red-300">{error}</section>;
  }

  return (
    <section aria-label="Results" className="space-y-4">
      {source === 'snapshot' && state?.finishedAt != null && (
        <p className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
          Snapshot from {formatRelativeTime(state.finishedAt)} — the tree is limited to depth 4 plus top contributors.
          Rescan for the full tree.
        </p>
      )}
      {runId === null && state?.rulesStale === true && (
        <p className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
          Rules updated — rescan for accuracy.
        </p>
      )}
      {runId === null && state?.status === 'cancelled' && (
        <p className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
          The last scan was cancelled — results are partial.
        </p>
      )}

      <CategoryStrip categories={categories} active={filter} onSelect={selectCategory} />

      {source === 'loading' ? (
        <p className="text-sm text-neutral-400">Loading results…</p>
      ) : source === 'empty' ? (
        <p className="text-sm text-neutral-400">No results yet — run an Analyze from the dashboard.</p>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              aria-pressed={showDanger}
              onClick={() => setShowDanger((value) => !value)}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
            >
              {showDanger ? 'Hide danger' : `Show danger (${formatCount(dangerCount)})`}
            </button>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <TreeTable
              rows={tableRows}
              totalBytes={totalBytes}
              sort={sort}
              onSortChange={setSort}
              expanded={expanded}
              onToggle={toggle}
              onReveal={reveal}
              onSelect={setSelected}
              onClean={setCleanPath}
              selectedPath={selected}
            />
            <aside className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
              {selectedRow ? (
                <>
                  <p className="break-all text-xs text-neutral-500">{selectedRow.path}</p>
                  <dl className="mt-3 space-y-2">
                    <Detail label="Size" value={formatBytes(selectedRow.bytes)} />
                    <Detail label="Allocated" value={formatBytes(selectedRow.allocatedBytes)} />
                    <Detail
                      label="Files / folders"
                      value={`${formatCount(selectedRow.fileCount)} / ${formatCount(selectedRow.folderCount)}`}
                    />
                    <Detail
                      label="Last modified"
                      value={selectedRow.newestMtimeMs > 0 ? formatRelativeTime(selectedRow.newestMtimeMs) : '—'}
                    />
                  </dl>
                  <div className="mt-3 rounded-lg border border-neutral-800 p-3">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Why this grade</p>
                    <p className="mt-1 text-neutral-300">
                      {selectedRow.action ? selectedRow.action.evidence : selectedRow.gradeReason}
                    </p>
                    {selectedRow.action && (
                      <p className="mt-1 text-xs text-neutral-500">Rule: {selectedRow.action.ruleId}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => reveal(selectedRow.path)}
                    className="mt-3 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
                  >
                    Explore
                  </button>
                </>
              ) : (
                <p className="text-neutral-500">Select a row to see why it is graded this way.</p>
              )}
            </aside>
          </div>
        </>
      )}

      {cleanPath !== null && (
        <RowCleanDialog api={api} root={root} path={cleanPath} onClose={() => setCleanPath(null)} />
      )}
    </section>
  );
}

function emptyCategories(): ResultsState['categories'] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    bytes: 0,
    items: 0,
    ruleIds: [],
  }));
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-neutral-200">{value}</dd>
    </div>
  );
}
