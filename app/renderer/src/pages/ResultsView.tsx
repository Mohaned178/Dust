import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryId } from '@dust/core';
import { CATEGORY_LABELS, RESULTS_SCOPE_NOTE } from '../../../src/shared/categories';
import type { CleanItemPreview, DustApi, ResultsCategoriesState, ResultsState } from '../../../src/shared/ipc';
import { BulkBar } from '../components/BulkBar';
import { CategoryStrip } from '../components/CategoryStrip';
import { ContributorList } from '../components/ContributorList';
import type { Contributor } from '../components/ContributorList';
import { TreeTable } from '../components/TreeTable';
import { CleanFlow } from '../components/CleanFlow';
import { CloseIcon, SparkleIcon } from '../components/icons';
import { Alert, Button, Card, FOCUS } from '../components/ui';
import { formatBytes, formatCount, formatRelativeTime } from '../format';
import { recordRendererSample } from '../instrument';
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

const EASE = 'ease-[cubic-bezier(0.16,1,0.3,1)]';
const CONTRIBUTOR_CAP = 250;

export interface ResultsViewProps {
  api: DustApi;
  root: string;
  onOpenDevCleanup?: () => void;
  headingLevel?: 1 | 2;
  initialCategory?: CategoryId | null;
  /** Rendered inside the Results page, which supplies the title. */
  embedded?: boolean;
  /** Called with every snapshot this view loads, including the reload after a clean. */
  onLoaded?: (state: ResultsState) => void;
  /** Called when a (re)load fails. */
  onLoadFailed?: () => void;
}

export function ResultsView({
  api,
  root,
  onOpenDevCleanup,
  headingLevel = 1,
  initialCategory = null,
  embedded = false,
  onLoaded,
  onLoadFailed,
}: ResultsViewProps) {
  // Each snapshot builds a fresh store, so its identity is the memo key.
  const [store, setStore] = useState<RowStore>(() => createRowStore(root));
  const [state, setState] = useState<ResultsCategoriesState | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  // The page may pass fresh closures every render; reload must stay stable.
  const callbacksRef = useRef({ onLoaded, onLoadFailed });
  callbacksRef.current = { onLoaded, onLoadFailed };

  const announce = useCallback((message: string, force = false) => {
    const now = performance.now();
    if (!force && now - announceAtRef.current < 1200) return;
    announceAtRef.current = now;
    setAnnouncement(message);
  }, []);

  const applySnapshot = useCallback(
    (next: ResultsState) => {
      const nextStore = createRowStore(root);
      upsertRows(nextStore, next.rows);
      setStore(nextStore);
      setState({
        source: next.source,
        root: next.root,
        finishedAt: next.finishedAt,
        status: next.status,
        rulesStale: next.rulesStale,
        depthLimited: next.depthLimited,
        categories: next.categories,
      });
      if (!seededRef.current) {
        setExpanded(defaultExpanded(nextStore));
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
        callbacksRef.current.onLoaded?.(next);
      })
      .catch(() => {
        if (reloadSeqRef.current !== seq) return;
        setError('Couldn\u2019t load results. Reload to try again.');
        callbacksRef.current.onLoadFailed?.();
      });
  }, [api, applySnapshot, root]);

  useEffect(() => {
    setStore(createRowStore(root));
    setState(null);
    setError(null);
    seededRef.current = false;
    setExpanded(new Set());
    setSearch('');
    setReviewToo(false);
    setTreeSelectedPath(null);
    setSelected(new Set());
    setKept(new Set());
    setBulkOpen(false);
    reload();
  }, [reload, root]);

  useEffect(() => {
    setCategoryFilter(initialCategory);
  }, [initialCategory]);

  useEffect(() => {
    return api.onScanEvent((next) => {
      if (next.type !== 'cleaned' || !sameRoot(next.root, root)) return;
      setSelected(new Set());
      setKept(new Set());
      reload();
    });
  }, [api, reload, root]);

  // Every cleanup target in the store, whatever the category filter says.
  // Selection reads this so it survives filter changes.
  const everyContributor = useMemo(() => {
    const startedAt = performance.now();
    const out: Contributor[] = [];
    for (const node of store.nodes.values()) {
      const action = node.action;
      if (action === null) continue;
      out.push({ path: node.path, name: node.name, bytes: node.bytes, grade: action.grade, action });
    }
    out.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
    recordRendererSample('results.contributors', performance.now() - startedAt);
    return out;
  }, [store]);
  const allContributors = useMemo(
    () =>
      categoryFilter === null
        ? everyContributor
        : everyContributor.filter((row) => row.action.category === categoryFilter),
    [categoryFilter, everyContributor],
  );

  const safe = useMemo(() => allContributors.filter((row) => row.grade === 'safe'), [allContributors]);
  const review = useMemo(() => allContributors.filter((row) => row.grade === 'review'), [allContributors]);
  const safeBytes = useMemo(() => safe.reduce((sum, row) => sum + row.bytes, 0), [safe]);
  const reviewBytes = useMemo(() => review.reduce((sum, row) => sum + row.bytes, 0), [review]);

  const query = search.trim().toLowerCase();
  const listed = useMemo(() => {
    const scope = reviewToo ? allContributors : safe;
    const visible = scope.filter((row) => !kept.has(pathKey(row.path)));
    if (query === '') return visible;
    return visible.filter((row) => row.path.toLowerCase().includes(query) || row.name.toLowerCase().includes(query));
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

  // What "Clean all safe" hands to the clean flow: every safe row the user hasn't kept.
  const readySafe = useMemo(() => safe.filter((row) => !kept.has(pathKey(row.path))), [safe, kept]);
  const readySafeBytes = useMemo(() => readySafe.reduce((sum, row) => sum + row.bytes, 0), [readySafe]);
  const cleanAllSafe = useCallback(() => {
    setSelected(new Set(readySafe.map((row) => pathKey(row.path))));
    setBulkOpen(true);
  }, [readySafe]);

  const figureBytes = reviewToo ? safeBytes + reviewBytes : safeBytes;
  const figureCount = reviewToo ? safe.length + review.length : safe.length;
  const emptySafe = safe.length === 0 && !reviewToo;

  // Selection is not scoped to the category filter: switching filters must not
  // drop rows the user already ticked from the bulk bar or the clean request.
  const selection = useMemo(() => {
    const paths: string[] = [];
    let bytes = 0;
    for (const row of everyContributor) {
      if (selected.has(pathKey(row.path))) {
        paths.push(row.path);
        bytes += row.bytes;
      }
    }
    return { paths, bytes, count: paths.length };
  }, [everyContributor, selected]);

  const categoryVisible = useMemo(() => {
    const startedAt = performance.now();
    const next = filterPaths(store, categoryFilter);
    recordRendererSample('results.filterPaths', performance.now() - startedAt);
    return next;
  }, [categoryFilter, store]);
  const matchSet = useMemo(() => matchedPaths(store, categoryFilter), [categoryFilter, store]);

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
  }, [query, store]);
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
    const next = flattenVisible(store, treeExpanded, sort, treeFilter, query === '' ? matchSet : null);
    recordRendererSample('results.flattenVisible', performance.now() - startedAt);
    return next;
  }, [treeExpanded, sort, treeFilter, matchSet, query, treeOpen, store]);
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
  }, [flatRows, showDanger, root, store]);
  const totalBytes = useMemo(() => store.nodes.get(pathKey(root))?.bytes ?? 0, [root, store]);

  const categories = state?.categories;
  const stripCategories = useMemo(() => {
    const rows = categories ?? [];
    return onOpenDevCleanup !== undefined ? rows : rows.filter((row) => row.category !== 'npm-projects');
  }, [categories, onOpenDevCleanup]);
  const source = state === null ? 'loading' : state.source;

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
        <Alert
          tone="danger"
          className="mt-8"
          action={
            <Button size="sm" onClick={reload}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      </section>
    );
  }

  const notices: string[] = [];
  if (source === 'snapshot' && state?.finishedAt != null) {
    notices.push(
      `Snapshot from ${formatRelativeTime(state.finishedAt)} — the tree is limited to depth 4 plus top contributors. Rescan for the full tree.`,
    );
  }
  if (state?.rulesStale === true) notices.push('Rules updated — rescan for accuracy.');
  if (state?.status === 'cancelled') notices.push('The last scan was cancelled — results are partial.');

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
      {query !== '' ? (
        <p className="text-sm text-ink-muted">No contributors match “{search.trim()}”.</p>
      ) : emptySafe ? (
        <>
          <p className="text-sm text-ink-muted">
            {review.length > 0
              ? `${formatCount(review.length)} ${review.length === 1 ? 'item needs' : 'items need'} review.`
              : 'Nothing matched a cleanup rule.'}
          </p>
          <Button className="mt-4" onClick={() => (review.length > 0 ? setReviewToo(true) : setTreeOpen(true))}>
            {review.length > 0 ? 'Show review items' : 'Browse everything'}
          </Button>
        </>
      ) : (
        <p className="text-sm text-ink-muted">Nothing to clean here.</p>
      )}
    </div>
  );

  return (
    <section aria-label="Results">
      {!embedded && (
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <Heading className="text-2xl font-semibold tracking-tight text-ink">
            Results <span className="font-normal text-ink-muted">—</span> <span className="font-mono">{root}</span>
          </Heading>
          {state?.finishedAt != null ? (
            <p className="text-sm text-ink-muted">{analyzedLabel(state.finishedAt)}</p>
          ) : null}
        </header>
      )}

      {notices.length > 0 && (
        <div className="mt-6 space-y-2.5">
          {notices.map((notice) => (
            <Alert key={notice}>{notice}</Alert>
          ))}
        </div>
      )}

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {source === 'loading' ? (
        <ResultsLoading />
      ) : source === 'empty' ? (
        <Card className="mt-8 px-4 py-14 text-center text-sm text-ink-muted">
          No results yet — run an Analyze from the dashboard.
        </Card>
      ) : (
        <>
          <div className={`grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] ${embedded ? '' : 'mt-8'}`}>
            <aside className="flex flex-col gap-4 self-start lg:sticky lg:top-6">
              <Card className="overflow-hidden">
                <section aria-label="Reclaimable summary" className="p-5">
                  {emptySafe ? (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">All clear</p>
                      <p className="mt-2 text-lg font-semibold tracking-tight text-ink">Nothing safe to clean here</p>
                      <p className="mt-1.5 text-sm text-ink-muted">
                        {review.length > 0
                          ? 'Switch to Safe + review to see what needs a closer look, or browse the full tree.'
                          : 'Browse everything to look for reclaimable folders.'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                        You can free up
                      </p>
                      <p className="mt-2 font-mono text-[2.5rem] font-semibold leading-none tracking-tight text-accent-strong">
                        {formatBytes(figureBytes)}
                      </p>
                      <p className="mt-2 text-sm text-ink-muted">
                        reclaimable across {formatCount(figureCount)} {figureCount === 1 ? 'item' : 'items'}
                      </p>
                    </>
                  )}
                  <div className="mt-5">
                    <BreakdownBar safeBytes={safeBytes} reviewBytes={reviewBytes} totalBytes={totalBytes} />
                  </div>
                  <dl className="mt-4 space-y-2">
                    <StatTile label="Safe" tone="safe" count={safe.length} bytes={safeBytes} />
                    <StatTile label="Review" tone="review" count={review.length} bytes={reviewBytes} />
                  </dl>
                  {readySafe.length > 0 && (
                    <>
                      <Button variant="primary" size="lg" className="mt-5 w-full" onClick={cleanAllSafe}>
                        <SparkleIcon className="h-4 w-4" />
                        Clean all safe · {formatBytes(readySafeBytes)}
                      </Button>
                      <p className="mt-2 text-center text-xs text-ink-muted">
                        You&rsquo;ll see the full list before anything is deleted.
                      </p>
                    </>
                  )}
                </section>
                <p className="border-t border-hairline bg-canvas/50 px-5 py-2.5 text-xs leading-relaxed text-ink-muted">
                  {RESULTS_SCOPE_NOTE}
                </p>
              </Card>
              <Card className="p-2 pt-3">
                <CategoryStrip categories={stripCategories} active={categoryFilter} onSelect={selectCategory} />
              </Card>
            </aside>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-surface p-2 shadow-card">
                <div className="relative min-w-[12rem] flex-1">
                  <SearchGlyph />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search paths and names"
                    aria-label="Search paths and names"
                    className={`h-9 w-full rounded-lg bg-canvas/60 pl-9 pr-9 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${EASE}`}
                  />
                  {search !== '' && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      aria-label="Clear search"
                      className={`absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-accent-soft hover:text-ink ${FOCUS}`}
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p role="status" aria-live="polite" aria-atomic="true" className="text-xs text-ink-muted empty:hidden">
                  {query !== '' && (
                    <>
                      <span className="font-mono tabular-nums text-ink">{formatCount(listed.length)}</span>{' '}
                      {listed.length === 1 ? 'match' : 'matches'}
                    </>
                  )}
                </p>
                <div role="group" aria-label="Which items to list" className="inline-flex rounded-lg bg-canvas/60 p-0.5">
                  {[
                    { on: false, label: 'Safe', count: safe.length, active: 'bg-surface text-ink shadow-card' },
                    {
                      on: true,
                      label: 'Safe + review',
                      count: safe.length + review.length,
                      active: 'bg-grade-review-soft text-grade-review',
                    },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={reviewToo === option.on}
                      onClick={() => setReviewToo(option.on)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${EASE} ${FOCUS} ${
                        reviewToo === option.on ? option.active : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {option.label}
                      <span className="font-mono text-xs tabular-nums opacity-70">{formatCount(option.count)}</span>
                    </button>
                  ))}
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
                  className={`flex w-full items-center gap-3 rounded-2xl border border-dashed border-hairline-strong px-4 py-3 text-left text-sm font-medium text-ink transition-colors duration-150 ${EASE} hover:border-accent hover:bg-accent-soft/40 ${FOCUS}`}
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
            </div>
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

function StatTile({
  label,
  tone,
  count,
  bytes,
}: {
  label: string;
  tone: 'safe' | 'review';
  count: number;
  bytes: number;
}) {
  const dot = tone === 'safe' ? 'bg-accent' : 'bg-grade-review-dot';
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <dt className="font-medium text-ink">{label}</dt>
      <dd className="ml-auto flex items-baseline gap-2">
        <span className="text-xs text-ink-muted">
          <span className="font-mono tabular-nums">{formatCount(count)}</span> {count === 1 ? 'item' : 'items'}
        </span>
        <span className="font-mono font-semibold tabular-nums text-ink">{formatBytes(bytes)}</span>
      </dd>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
      focusable={false}
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** Share of the scanned total that is safe, needs review, or stays. */
function BreakdownBar({
  safeBytes,
  reviewBytes,
  totalBytes,
}: {
  safeBytes: number;
  reviewBytes: number;
  totalBytes: number;
}) {
  const total = Math.max(totalBytes, safeBytes + reviewBytes);
  const pct = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  const safePct = pct(safeBytes);
  const reviewPct = pct(reviewBytes);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-ink-muted">
        <span>Of {formatBytes(total)} scanned</span>
        <span className="font-mono tabular-nums">{Math.round(safePct + reviewPct)}% reclaimable</span>
      </div>
      <div
        role="img"
        aria-label={`${Math.round(safePct)}% safe, ${Math.round(reviewPct)}% needs review`}
        className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-track"
      >
        <div className="dust-bar-fill h-full bg-accent" style={{ width: `${safePct}%` }} />
        <div className="dust-bar-fill h-full bg-grade-review-dot" style={{ width: `${reviewPct}%` }} />
      </div>
    </div>
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
