import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CategoryId } from '@dust/core';
import { CATEGORY_LABELS, RESULTS_SCOPE_NOTE } from '../../../src/shared/categories';
import type { CleanItemPreview, DustApi, ResultsState } from '../../../src/shared/ipc';
import { BulkBar } from '../components/BulkBar';
import { CategoryStrip } from '../components/CategoryStrip';
import { ContributorList } from '../components/ContributorList';
import type { Contributor } from '../components/ContributorList';
import { TreeTable } from '../components/TreeTable';
import { CleanFlow } from '../components/CleanFlow';
import { CloseIcon, InfoIcon } from '../components/icons';
import { formatBytes, formatCount, formatRelativeTime } from '../format';
import { recordRendererSample } from '../instrument';
import { useLiveScan } from '../live-scan';
import {
  ancestorKeys,
  createRowStore,
  filterPaths,
  flattenVisible,
  matchedPaths,
  pathKey,
  sameRoot,
  upsertRows,
} from '../tree';
import type { RowNode, RowStore, SortState } from '../tree';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const EASE = 'ease-[cubic-bezier(0.16,1,0.3,1)]';
const CONTRIBUTOR_CAP = 250;

export interface ResultsViewProps {
  api: DustApi;
  root: string;
  runId: string | null;
  onOpenDevCleanup?: () => void;
  headingLevel?: 1 | 2;
  initialCategory?: CategoryId | null;
}

export function ResultsView({
  api,
  root,
  runId,
  onOpenDevCleanup,
  headingLevel = 1,
  initialCategory = null,
}: ResultsViewProps) {
  const storeRef = useRef<RowStore>(createRowStore(root));
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [state, setState] = useState<ResultsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ key: 'size', desc: true });
  const [categoryFilter, setCategoryFilter] = useState<CategoryId | null>(initialCategory);
  const [search, setSearch] = useState('');
  const [reviewToo, setReviewToo] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeSelectedPath, setTreeSelectedPath] = useState<string | null>(null);
  const [showDanger, setShowDanger] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const reloadSeqRef = useRef(0);
  const seededRef = useRef(false);
  const announceAtRef = useRef(Number.NEGATIVE_INFINITY);

  const live = useLiveScan(api, root, runId, 'analyze');
  const liveMode = runId !== null;
  const useLive = liveMode && !reconciled;
  const store = useLive ? live.store : storeRef.current;
  const version = useLive ? live.version : snapshotVersion;

  const announce = useCallback((message: string, force = false) => {
    const now = performance.now();
    if (!force && now - announceAtRef.current < 1200) return;
    announceAtRef.current = now;
    setAnnouncement(message);
  }, []);

  const applySnapshot = useCallback(
    (next: ResultsState) => {
      storeRef.current = createRowStore(root);
      upsertRows(storeRef.current, next.rows);
      setState(next);
      setSnapshotVersion((value) => value + 1);
      if (!seededRef.current) {
        setExpanded(defaultExpanded(storeRef.current));
        seededRef.current = true;
      }
    },
    [root],
  );

  const reload = useCallback(() => {
    const seq = reloadSeqRef.current + 1;
    reloadSeqRef.current = seq;
    setError(null);
    api
      .getResults(root)
      .then((next) => {
        if (reloadSeqRef.current !== seq) return;
        applySnapshot(next);
      })
      .catch(() => {
        if (reloadSeqRef.current !== seq) return;
        setError('Couldn\u2019t load results. Reload to try again.');
      });
  }, [api, applySnapshot, root]);

  useEffect(() => {
    storeRef.current = createRowStore(root);
    setState(null);
    setError(null);
    seededRef.current = false;
    setExpanded(new Set());
    setCategoryFilter(initialCategory);
    setSearch('');
    setReviewToo(false);
    setTreeSelectedPath(null);
    setSelected(new Set());
    setKept(new Set());
    setBulkOpen(false);
    setReconciled(false);
    if (runId === null) reload();
  }, [initialCategory, reload, root, runId]);

  useEffect(() => {
    if (runId !== null || reconciled) return;
    if (live.phase !== 'done') return;
    const seq = reloadSeqRef.current + 1;
    reloadSeqRef.current = seq;
    api
      .getResults(root)
      .then((next) => {
        if (reloadSeqRef.current !== seq) return;
        applySnapshot(next);
        setReconciled(true);
      })
      .catch(() => {
        /* Keep the live results when the snapshot cannot be reconciled. */
      });
  }, [api, applySnapshot, live.phase, reconciled, root, runId]);

  useEffect(() => {
    return api.onScanEvent((next) => {
      if (runId !== null) return;
      if (next.type === 'cleaned' && sameRoot(next.root, root)) {
        setSelected(new Set());
        setKept(new Set());
        reload();
      }
    });
  }, [api, reload, root, runId]);

  useEffect(() => {
    if (!liveMode) return;
    const reclaimable = live.categories.reduce((sum, row) => sum + row.bytes, 0);
    if (reclaimable <= 0) return;
    announce(`Scanning — ${formatBytes(reclaimable)} reclaimable so far.`);
  }, [announce, live.categories, live.categoriesVersion, liveMode]);

  useEffect(() => {
    if (!liveMode || live.finished === null) return;
    announce(
      live.finished.status === 'complete'
        ? `Scan complete — ${formatBytes(live.finished.reclaimableBytes ?? 0)} reclaimable.`
        : 'Scan stopped — results are partial.',
      true,
    );
  }, [announce, live.finished, liveMode]);


  const allContributors = useMemo(() => {
    const startedAt = performance.now();
    const out: Contributor[] = [];
    for (const node of store.nodes.values()) {
      const action = node.action;
      if (action === null) continue;
      if (categoryFilter !== null && action.category !== categoryFilter) continue;
      out.push({ path: node.path, name: node.name, bytes: node.bytes, grade: action.grade, action });
    }
    out.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
    recordRendererSample('results.contributors', performance.now() - startedAt);
    return out;
  }, [categoryFilter, store, version]);

  const safe = useMemo(() => allContributors.filter((row) => row.grade === 'safe'), [allContributors]);
  const review = useMemo(() => allContributors.filter((row) => row.grade === 'review'), [allContributors]);
  const safeBytes = useMemo(() => safe.reduce((sum, row) => sum + row.bytes, 0), [safe]);
  const reviewBytes = useMemo(() => review.reduce((sum, row) => sum + row.bytes, 0), [review]);

  const query = search.trim().toLowerCase();
  const listed = useMemo(() => {
    const scope = reviewToo ? allContributors : safe;
    const visible = scope.filter((row) => !kept.has(pathKey(row.path)));
    if (query === '') return visible;
    return visible.filter(
      (row) => row.path.toLowerCase().includes(query) || row.name.toLowerCase().includes(query),
    );
  }, [allContributors, safe, reviewToo, kept, query]);
  const visibleContributors = useMemo(() => listed.slice(0, CONTRIBUTOR_CAP), [listed]);

  const listedBytes = useMemo(() => listed.reduce((sum, row) => sum + row.bytes, 0), [listed]);
  const listedKeys = useMemo(() => listed.map((row) => pathKey(row.path)), [listed]);
  const allListedSelected = listedKeys.length > 0 && listedKeys.every((key) => selected.has(key));
  const someListedSelected = !allListedSelected && listedKeys.some((key) => selected.has(key));
  const selectAllNoun = listed.length > 0 && listed.every((row) => row.grade === 'safe') ? 'safe' : 'shown';
  const toggleAllListed = useCallback(() => {
    setSelected((current) => {
      const next = new Set(current);
      if (allListedSelected) for (const key of listedKeys) next.delete(key);
      else for (const key of listedKeys) next.add(key);
      return next;
    });
  }, [allListedSelected, listedKeys]);

  const figureBytes = reviewToo ? safeBytes + reviewBytes : safeBytes;
  const figureCount = reviewToo ? safe.length + review.length : safe.length;
  const scanning = useLive && live.phase !== 'done' && live.phase !== 'failed' && allContributors.length === 0;
  const emptySafe = safe.length === 0 && !reviewToo;

  const selection = useMemo(() => {
    const paths: string[] = [];
    let bytes = 0;
    for (const row of allContributors) {
      if (selected.has(pathKey(row.path))) {
        paths.push(row.path);
        bytes += row.bytes;
      }
    }
    return { paths, bytes, count: paths.length };
  }, [allContributors, selected]);

  const categoryVisible = useMemo(() => {
    const startedAt = performance.now();
    const next = filterPaths(store, categoryFilter);
    recordRendererSample('results.filterPaths', performance.now() - startedAt);
    return next;
  }, [categoryFilter, store, version]);
  const matchSet = useMemo(() => matchedPaths(store, categoryFilter), [categoryFilter, store, version]);

  const searchSet = useMemo(() => {
    if (query === '') return null;
    const matched = new Set<string>();
    for (const node of store.nodes.values()) {
      if (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)) {
        matched.add(pathKey(node.path));
      }
    }
    const ancestors = ancestorKeys(store, matched);
    return new Set<string>([...matched, ...ancestors]);
  }, [query, store, version]);
  const treeFilter = useMemo(() => {
    if (searchSet === null) return categoryVisible;
    if (categoryVisible === null) return searchSet;
    const out = new Set<string>();
    for (const key of searchSet) if (categoryVisible.has(key)) out.add(key);
    return out;
  }, [searchSet, categoryVisible]);
  const treeExpanded = useMemo(() => {
    if (searchSet === null) return expanded;
    const out = new Set(expanded);
    for (const key of searchSet) out.add(key);
    return out;
  }, [expanded, searchSet]);

  const flatRows = useMemo(() => {
    if (!treeOpen) return [];
    const startedAt = performance.now();
    const next = flattenVisible(
      store,
      treeExpanded,
      sort,
      treeFilter,
      query === '' ? matchSet : null,
    );
    recordRendererSample('results.flattenVisible', performance.now() - startedAt);
    return next;
  }, [version, treeExpanded, sort, treeFilter, matchSet, query, treeOpen, store]);
  const dangerCount = useMemo(() => flatRows.filter((entry) => entry.row.grade === 'danger').length, [flatRows]);
  const tableRows = useMemo(() => {
    const startedAt = performance.now();
    let next = flatRows;
    if (!showDanger) {
      const nodes = store.nodes;
      next = flatRows.filter((entry) => {
        if (entry.row.grade === 'danger') return false;
        let parent = entry.row.parent;
        while (parent !== null && !sameRoot(parent, root)) {
          const node = nodes.get(pathKey(parent));
          if (node === undefined) break;
          if (node.grade === 'danger') return false;
          parent = node.parent;
        }
        return true;
      });
    }
    recordRendererSample('results.tableRows', performance.now() - startedAt);
    return next;
  }, [flatRows, showDanger, version, root, store]);
  const totalBytes = useMemo(() => store.nodes.get(pathKey(root))?.bytes ?? 0, [version, root, store]);

  const categories = useLive ? live.categories : state?.categories ?? [];
  const stripCategories = useMemo(
    () => (onOpenDevCleanup !== undefined ? categories : categories.filter((row) => row.category !== 'npm-projects')),
    [categories, onOpenDevCleanup],
  );
  const source = useLive ? 'live' : state === null ? (liveMode ? 'live' : 'loading') : state.source;

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
      if (category === 'npm-projects') {
        if (onOpenDevCleanup !== undefined) onOpenDevCleanup();
        return;
      }
      setCategoryFilter(category);
      if (category === null) return;
      const matches = matchedPaths(store, category);
      const ancestors = ancestorKeys(store, matches);
      if (ancestors.size === 0) return;
      setExpanded((current) => {
        let changed = false;
        const next = new Set(current);
        for (const key of ancestors) {
          if (!next.has(key)) {
            next.add(key);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    },
    [onOpenDevCleanup, store],
  );

  const toggleSelect = useCallback((path: string) => {
    const key = pathKey(path);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const keep = useCallback((path: string) => {
    const key = pathKey(path);
    setKept((current) => new Set(current).add(key));
    setSelected((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);

  const loadRecovery = useCallback(
    async (path: string): Promise<CleanItemPreview | null> => {
      const result = await api.previewClean({ scope: 'row', root, paths: [path] });
      if (!result.ok) throw new Error('recovery-unavailable');
      return result.preview.items[0] ?? null;
    },
    [api, root],
  );

  const reveal = useCallback(
    (path: string) => {
      void api.revealPath(path).catch(() => {});
    },
    [api],
  );

  const Heading = headingLevel === 2 ? 'h2' : 'h1';

  if (error !== null) {
    return (
      <section aria-label="Results">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <Heading className="text-2xl font-semibold tracking-tight text-ink">
            Results <span className="font-normal text-ink-muted">—</span> <span className="font-mono">{root}</span>
          </Heading>
        </header>
        <div role="alert" className="mt-8 rounded-2xl border border-hairline bg-surface px-4 py-14 text-center">
          <p className="text-sm text-ink">{error}</p>
          <button
            type="button"
            onClick={reload}
            className={`mt-4 inline-flex items-center rounded-lg border border-hairline bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors duration-150 ${EASE} hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`}
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  const notices: ReactNode[] = [];
  if (useLive) {
    if (scanning) {
      notices.push(
        <Notice key="scanning">
          Scanning <span className="font-mono">{root}</span> — these figures are partial until the scan finishes.
        </Notice>,
      );
    } else if (live.finished?.status === 'cancelled') {
      notices.push(<Notice key="cancelled-live">The scan was cancelled — results are partial.</Notice>);
    }
  }
  if (!useLive && source === 'snapshot' && state?.finishedAt != null) {
    notices.push(
      <Notice key="snapshot">
        Snapshot from {formatRelativeTime(state.finishedAt)} — the tree is limited to depth 4 plus top contributors.
        Rescan for the full tree.
      </Notice>,
    );
  }
  if (!liveMode && state?.rulesStale === true) {
    notices.push(<Notice key="stale">Rules updated — rescan for accuracy.</Notice>);
  }
  if (!liveMode && state?.status === 'cancelled') {
    notices.push(<Notice key="cancelled">The last scan was cancelled — results are partial.</Notice>);
  }

  const filteredTreeEmpty =
    categoryFilter !== null && tableRows.length === 0 ? (
      <div className="px-4 py-14 text-center">
        <p className="text-sm text-ink-muted">Nothing to clean in {CATEGORY_LABELS[categoryFilter]}.</p>
      </div>
    ) : undefined;

  const toolbar = (
    <div className="flex w-full items-center justify-between gap-3">
      <p className="min-w-0 truncate text-xs text-ink-muted">
        {categoryFilter === null ? 'All categories' : CATEGORY_LABELS[categoryFilter]}
      </p>
      <button
        type="button"
        aria-pressed={showDanger}
        onClick={() => setShowDanger((value) => !value)}
        className={`inline-flex shrink-0 items-center rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${EASE} ${FOCUS} ${
          showDanger
            ? 'border-accent bg-accent-soft text-accent-strong'
            : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-ink'
        }`}
      >
        {showDanger ? 'Hide danger' : `Show danger (${formatCount(dangerCount)})`}
      </button>
    </div>
  );

  const contributorEmpty = (
    <div className="px-4 py-14 text-center">
      {scanning ? (
        <p className="text-sm text-ink-muted">Reclaimable folders appear here as the scan finds them.</p>
      ) : query !== '' ? (
        <p className="text-sm text-ink-muted">No contributors match “{search.trim()}”.</p>
      ) : emptySafe ? (
        <>
          <p className="text-sm text-ink-muted">
            {review.length > 0
              ? `${formatCount(review.length)} ${review.length === 1 ? 'item needs' : 'items need'} review.`
              : 'Nothing matched a cleanup rule.'}
          </p>
          <button
            type="button"
            onClick={() => (review.length > 0 ? setReviewToo(true) : setTreeOpen(true))}
            className={`mt-4 inline-flex items-center rounded-lg border border-hairline bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors duration-150 ${EASE} hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`}
          >
            {review.length > 0 ? 'Review too' : 'Browse everything'}
          </button>
        </>
      ) : (
        <p className="text-sm text-ink-muted">Nothing to clean here.</p>
      )}
    </div>
  );

  return (
    <section aria-label="Results">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <Heading className="text-2xl font-semibold tracking-tight text-ink">
          Results <span className="font-normal text-ink-muted">—</span> <span className="font-mono">{root}</span>
        </Heading>
        {useLive ? (
          live.finished !== null ? (
            <p className="text-sm text-ink-muted">
              {live.finished.status === 'cancelled' ? 'Partial — cancelled' : 'Analyzed just now'}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">scanning…</p>
          )
        ) : state?.finishedAt != null ? (
          <p className="text-sm text-ink-muted">{analyzedLabel(state.finishedAt)}</p>
        ) : null}
      </header>

      {notices.length > 0 && <div className="mt-6 space-y-2.5">{notices}</div>}

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {source === 'loading' ? (
        <ResultsLoading />
      ) : source === 'empty' ? (
        <p className="mt-8 rounded-2xl border border-hairline bg-surface px-4 py-14 text-center text-sm text-ink-muted">
          No results yet — run an Analyze from the dashboard.
        </p>
      ) : (
        <>
          <section aria-label="Reclaimable summary" className="mt-8">
            {emptySafe ? (
              scanning ? (
                <>
                  <p className="text-xl font-semibold tracking-tight text-ink">Scanning…</p>
                  <p className="mt-1.5 text-sm text-ink-muted">
                    Reclaimable folders appear here as the scan finds them.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xl font-semibold tracking-tight text-ink">Nothing safe to clean here</p>
                  <p className="mt-1.5 text-sm text-ink-muted">
                    {review.length > 0
                      ? 'Turn on Review too to see what needs a closer look, or browse the full tree below.'
                      : 'Browse everything below to look for reclaimable folders.'}
                  </p>
                </>
              )
            ) : (
              <>
                <p className="font-mono text-[2.5rem] font-semibold leading-none tracking-tight text-ink">
                  {formatBytes(figureBytes)}
                </p>
                <p className="mt-2 text-sm text-ink-muted">
                  reclaimable across {formatCount(figureCount)} {figureCount === 1 ? 'item' : 'items'}
                </p>
              </>
            )}
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
              <StatLine label="Safe" count={safe.length} bytes={safeBytes} />
              <StatLine label="Review" count={review.length} bytes={reviewBytes} />
            </div>
            <p className="mt-2 text-xs text-ink-muted">{RESULTS_SCOPE_NOTE}</p>
          </section>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <CategoryStrip categories={stripCategories} active={categoryFilter} onSelect={selectCategory} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p role="status" aria-live="polite" aria-atomic="true" className="text-xs text-ink-muted">
                {query !== '' && (
                  <>
                    <span className="font-mono tabular-nums text-ink">{formatCount(listed.length)}</span>{' '}
                    {listed.length === 1 ? 'match' : 'matches'}
                  </>
                )}
              </p>
              <div className="relative">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search paths and names"
                  aria-label="Search paths and names"
                  className={`h-8 w-52 rounded-lg border border-hairline bg-surface pl-3 pr-8 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${EASE}`}
                />
                {search !== '' && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className={`absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-accent-soft hover:text-ink ${FOCUS}`}
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={reviewToo}
                  onChange={(event) => setReviewToo(event.target.checked)}
                  className={`h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS}`}
                />
                Review too
              </label>
            </div>
          </div>

          <div className="mt-4">
            <ContributorList
              contributors={visibleContributors}
              totalCount={listed.length}
              selected={selected}
              keptCount={kept.size}
              selectAll={{
                count: listed.length,
                bytes: listedBytes,
                allSelected: allListedSelected,
                someSelected: someListedSelected,
                noun: selectAllNoun,
                onToggle: toggleAllListed,
              }}
              onToggleSelect={toggleSelect}
              onKeep={keep}
              onUndoKept={() => setKept(new Set())}
              onAnnounce={announce}
              loadRecovery={loadRecovery}
              empty={contributorEmpty}
            />
          </div>

          <div className="mt-6">
            <button
              type="button"
              aria-expanded={treeOpen}
              aria-controls="results-tree"
              onClick={() => setTreeOpen((value) => !value)}
              className={`inline-flex items-center gap-2 text-sm font-medium text-ink transition-colors duration-150 ${EASE} hover:text-accent ${FOCUS}`}
            >
              <ChevronToggle open={treeOpen} />
              Browse everything
              <span className="font-normal text-ink-muted">the full folder tree</span>
            </button>
            {treeOpen && (
              <div id="results-tree" className="dust-disclose mt-3">
                <TreeTable
                  rows={tableRows}
                  totalBytes={totalBytes}
                  sort={sort}
                  onSortChange={setSort}
                  expanded={expanded}
                  onToggle={toggle}
                  onReveal={reveal}
                  onSelect={(path) => setTreeSelectedPath((current) => (current === path ? null : path))}
                  selectedPath={treeSelectedPath}
                  toolbar={toolbar}
                  empty={filteredTreeEmpty}
                />
              </div>
            )}
          </div>
        </>
      )}

      {selection.count > 0 && (
        <BulkBar
          count={selection.count}
          bytes={selection.bytes}
          onClear={() => setSelected(new Set())}
          onClean={() => setBulkOpen(true)}
        />
      )}

      {bulkOpen && (
        <CleanFlow
          api={api}
          scope="row"
          root={root}
          paths={selection.paths}
          label={`Clean ${selection.count} selected`}
          onClose={() => setBulkOpen(false)}
          onPrimary={() => {
            setBulkOpen(false);
            setSelected(new Set());
          }}
          primaryLabel="Done"
          offerRelaunch
        />
      )}
    </section>
  );
}

function StatLine({ label, count, bytes }: { label: string; count: number; bytes: number }) {
  return (
    <p>
      <span className="font-medium text-ink">{label}</span>
      <span className="mx-1.5 text-ink-muted/60" aria-hidden="true">
        ·
      </span>
      <span className="font-mono text-ink">{formatCount(count)}</span> {count === 1 ? 'item' : 'items'}
      <span className="mx-1.5 text-ink-muted/60" aria-hidden="true">
        ·
      </span>
      <span className="font-mono text-ink">{formatBytes(bytes)}</span>
    </p>
  );
}

function ChevronToggle({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={false}
      className={`h-4 w-4 text-ink-muted transition-transform duration-150 ${EASE} ${open ? 'rotate-90' : ''}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function analyzedLabel(ms: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(now - ms, 0) / 60_000);
  if (minutes < 1) return 'Analyzed just now';
  if (minutes === 1) return 'Analyzed 1 minute ago';
  if (minutes < 60) return `Analyzed ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'Analyzed 1 hour ago';
  if (hours < 24) return `Analyzed ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Analyzed 1 day ago' : `Analyzed ${days} days ago`;
}

function defaultExpanded(store: RowStore): Set<string> {
  const out = new Set<string>();
  const root = store.nodes.get(pathKey(store.root));
  if (!root) return out;
  const walk = (node: RowNode, depth: number): void => {
    if (depth >= 2) return;
    for (const key of node.children) {
      const child = store.nodes.get(key);
      if (!child || child.grade === 'danger') continue;
      out.add(key);
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

function ResultsLoading() {
  return (
    <div role="status" aria-busy="true" className="mt-8 animate-pulse motion-reduce:animate-none">
      <span className="sr-only">Loading results…</span>
      <div aria-hidden="true">
        <div className="h-9 w-48 rounded bg-track" />
        <div className="mt-3 h-3.5 w-40 rounded bg-track/70" />
        <div className="mt-4 flex gap-6">
          <div className="h-3.5 w-36 rounded bg-track/70" />
          <div className="h-3.5 w-36 rounded bg-track/70" />
        </div>
        <div className="mt-6 flex flex-wrap gap-1.5">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-7 w-20 rounded-full bg-track/70" />
          ))}
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-surface shadow-card">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
              <div className="h-4 w-4 rounded bg-track/70" />
              <div className="h-3.5 rounded bg-track" style={{ width: `${40 + (index % 3) * 20}%` }} />
              <div className="ml-auto h-3.5 w-16 rounded bg-track" />
              <div className="h-5 w-14 rounded-full bg-track/70" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <p className="min-w-0">{children}</p>
    </div>
  );
}
