import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryId } from '@dust/core';
import type { DustApi, ResultsState } from '../../../src/shared/ipc';
import { CategoryStrip } from '../components/CategoryStrip';
import { TreeTable } from '../components/TreeTable';
import { formatBytes, formatCount, formatRelativeTime } from '../format';
import {
  createRowStore,
  filterPaths,
  flattenVisible,
  mergeMatches,
  pathKey,
  upsertRows,
} from '../tree';
import type { RowNode, RowStore, SortState } from '../tree';

export interface ResultsViewProps {
  api: DustApi;
  root: string;
  runId: string | null;
}

export function ResultsView({ api, root, runId }: ResultsViewProps) {
  const storeRef = useRef<RowStore>(createRowStore(root));
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<ResultsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveCategories, setLiveCategories] = useState<ResultsState['categories']>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ key: 'size', desc: true });
  const [filter, setFilter] = useState<CategoryId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (runId !== null) return;
    let active = true;
    storeRef.current = createRowStore(root);
    setState(null);
    setError(null);
    setExpanded(new Set());
    setFilter(null);
    setSelected(null);
    api
      .getResults(root)
      .then((next) => {
        if (!active) return;
        upsertRows(storeRef.current, next.rows);
        setState(next);
        setVersion((value) => value + 1);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [api, root, runId]);

  useEffect(() => {
    if (runId === null) return;
    return api.onScanEvent((next) => {
      if (next.runId !== runId) return;
      if (next.type === 'folders') {
        upsertRows(storeRef.current, next.folders);
        setVersion((value) => value + 1);
      } else if (next.type === 'categories') {
        setLiveCategories(next.categories);
      } else if (next.type === 'matches') {
        mergeMatches(storeRef.current, next.matches);
        setVersion((value) => value + 1);
      }
    });
  }, [api, runId]);

  const filterSet = useMemo(
    () => filterPaths(storeRef.current, filter),
    [filter, version],
  );
  const flatRows = useMemo(
    () => flattenVisible(storeRef.current, expanded, sort, filterSet),
    [version, expanded, sort, filterSet],
  );
  const totalBytes = useMemo(() => storeRef.current.nodes.get(pathKey(root))?.bytes ?? 0, [version, root]);

  const categories = runId !== null ? liveCategories : state?.categories ?? [];
  const source = runId !== null ? 'live' : state?.source ?? 'empty';
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

      <CategoryStrip categories={categories} active={filter} onSelect={setFilter} />

      {source === 'empty' ? (
        <p className="text-sm text-neutral-400">No results yet — run an Analyze from the dashboard.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <TreeTable
            rows={flatRows}
            totalBytes={totalBytes}
            sort={sort}
            onSortChange={setSort}
            expanded={expanded}
            onToggle={toggle}
            onReveal={reveal}
            onSelect={setSelected}
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
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-neutral-200">{value}</dd>
    </div>
  );
}
