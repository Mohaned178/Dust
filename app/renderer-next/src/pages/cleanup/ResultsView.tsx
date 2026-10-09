import type { CategoryId } from '@dust/core';
import { useEffect, useMemo } from 'react';
import { CATEGORY_ORDER } from '../../../../src/shared/categories';
import { useDialogs } from '../../app/dialogs';
import { useNavStore } from '../../app/nav';
import { useStartScan } from '../../app/useStartScan';
import { useApi } from '../../lib/api';
import { formatBytes, formatCount } from '../../lib/format';
import {
  DEVELOPER_CATEGORY,
  isOffered,
  keepRow,
  needsLookFirst,
  selectionTotals,
  setRows,
  toggleRow,
  unkeepRow,
} from '../../lib/selection';
import type { OfferedRow } from '../../lib/selection';
import { useCleanupStore } from '../../stores/cleanup';
import { useDashboardStore } from '../../stores/dashboard';
import { useResultsStore } from '../../stores/results';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { RelativeTime } from '../../ui/Display';
import { EmptyState, ErrorState } from '../../ui/EmptyState';
import { ChevronRightIcon, RefreshIcon } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { PageHeader } from '../../ui/PageHeader';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/toast-store';
import { CategoryList } from './CategoryList';
import type { CategoryEntry, CategoryListHandlers } from './CategoryList';
import { openCleanDialog } from './openClean';

export interface ResultsViewProps {
  root: string;
  /** Opened from a link on Home: this category starts open. */
  category?: CategoryId;
}

function ListSkeleton() {
  return (
    <Card className="flex flex-col gap-4 p-4" aria-busy="true">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </Card>
  );
}

export function ResultsView({ root, category }: ResultsViewProps) {
  const api = useApi();
  const dialogs = useDialogs();
  const toast = useToast();
  const navigate = useNavStore((state) => state.navigate);
  const scan = useStartScan();
  const loadSummary = useResultsStore((state) => state.load);
  const summary = useResultsStore((state) => state.summaries[root.toLowerCase()]);
  const dashboard = useDashboardStore((state) => state.dashboard.data);
  const selection = useCleanupStore((state) => state.selection);
  const expanded = useCleanupStore((state) => state.expanded);

  // Shows the last results at once and reads them again behind them; hidden pages stop doing this.
  useEffect(() => {
    void loadSummary(api, root);
  }, [api, loadSummary, root]);

  useEffect(() => {
    if (category !== undefined) useCleanupStore.getState().toggleExpanded(category, true);
  }, [category]);

  const data = summary?.data ?? null;

  const { lookFirst, ready } = useMemo(() => {
    const ready: CategoryEntry[] = [];
    const lookFirst: CategoryEntry[] = [];
    if (data === null) return { ready, lookFirst };
    for (const id of CATEGORY_ORDER) {
      if (id === DEVELOPER_CATEGORY) continue;
      const rows = (data.contributors[id] ?? []).filter(isOffered);
      if (rows.length === 0) continue;
      const matched = Math.max(data.categories.find((row) => row.category === id)?.items ?? 0, rows.length);
      (needsLookFirst(rows) ? lookFirst : ready).push({ category: id, rows, matched });
    }
    return { ready, lookFirst };
  }, [data]);

  const totals = useMemo(
    () =>
      selectionTotals(
        [...ready, ...lookFirst].map((entry) => entry.rows),
        selection,
      ),
    [ready, lookFirst, selection],
  );

  const handlers = useMemo<CategoryListHandlers>(
    () => ({
      onToggleCategory: (rows: ReadonlyArray<OfferedRow>, checked: boolean) =>
        useCleanupStore.getState().setSelection((current) => setRows(current, rows, checked)),
      onToggleRow: (row) => useCleanupStore.getState().setSelection((current) => toggleRow(current, row)),
      onKeep: (row) => {
        useCleanupStore.getState().setSelection((current) => keepRow(current, row));
        toast({
          title: `${row.name} will be kept`,
          description: 'Dust will not clean it this time.',
          action: {
            label: 'Undo',
            onAction: () => useCleanupStore.getState().setSelection((current) => unkeepRow(current, row)),
          },
        });
      },
      onReveal: (path) => void api.revealPath(path).catch(() => {}),
      onToggleOpen: (id) => useCleanupStore.getState().toggleExpanded(id),
    }),
    [api, toast],
  );

  const system = dashboard?.volumes.find((volume) => volume.root.toLowerCase() === root.toLowerCase());
  const usedBytes =
    system?.totalBytes != null && system.freeBytes != null ? Math.max(system.totalBytes - system.freeBytes, 0) : null;
  const rescan = () => void scan.start({ root, usedBytes });

  if (data === null) {
    if (summary?.error != null) {
      return (
        <>
          <PageHeader title="Clean up" />
          <Card>
            <ErrorState
              title="Dust could not read the results"
              description="The last scan could not be loaded."
              onRetry={() => void loadSummary(api, root, true)}
            />
          </Card>
        </>
      );
    }
    return (
      <>
        <PageHeader title="Clean up" subtitle={root} />
        <ListSkeleton />
      </>
    );
  }

  if (data.source === 'empty') {
    return (
      <>
        <PageHeader title="Clean up" subtitle={root} />
        {scan.error !== null ? <Notice variant="warning">Dust could not start the scan: {scan.error}</Notice> : null}
        <Card>
          <EmptyState
            title={`Find out what can be freed on ${root}`}
            description="Dust looks at temporary files, caches and the Recycle Bin. Nothing is deleted until you confirm it."
            action={
              <Button variant="primary" size="lg" onClick={rescan} loading={scan.starting}>
                Scan {root}
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const notices: string[] = [];
  if (data.status === 'cancelled') notices.push('Scan cancelled. Showing what was found.');
  if (data.rulesStale) notices.push('Dust’s cleanup rules changed after this scan. Scan again for current figures.');
  if (data.depthLimited) notices.push('Some very deep folders were not checked.');

  const developer = data.categories.find((row) => row.category === DEVELOPER_CATEGORY);
  const empty = ready.length === 0 && lookFirst.length === 0;

  return (
    <>
      <PageHeader
        title="Clean up"
        subtitle={
          <>
            {root} · checked <RelativeTime ms={data.finishedAt} />
          </>
        }
        actions={
          <Button
            variant="secondary"
            icon={<RefreshIcon className="size-4" aria-hidden="true" />}
            onClick={rescan}
            loading={scan.starting}
          >
            Scan again
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        {scan.error !== null ? <Notice variant="warning">Dust could not start the scan: {scan.error}</Notice> : null}
        {notices.map((notice) => (
          <Notice key={notice}>{notice}</Notice>
        ))}
        {empty ? (
          <Card>
            <EmptyState
              title={`${root} is in good shape`}
              description="Nothing to clean right now."
              action={
                <Button onClick={rescan} loading={scan.starting}>
                  Scan again
                </Button>
              }
            />
          </Card>
        ) : null}
        {ready.length > 0 ? (
          <Card className="overflow-hidden">
            <CategoryList
              label="Categories that can be cleaned"
              entries={ready}
              selection={selection}
              expanded={expanded}
              handlers={handlers}
            />
          </Card>
        ) : null}
        {lookFirst.length > 0 ? (
          <section aria-labelledby="look-first" className="flex flex-col gap-2">
            <h2 id="look-first" className="text-body font-semibold">
              Take a look first
              <span className="font-normal text-ink-2"> · not selected</span>
            </h2>
            <Card className="overflow-hidden">
              <CategoryList
                label="Categories to look at first"
                entries={lookFirst}
                selection={selection}
                expanded={expanded}
                handlers={handlers}
              />
            </Card>
          </section>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {developer !== undefined && developer.bytes > 0 ? (
            <Button variant="subtle" onClick={() => navigate('developer', { root })}>
              Developer caches {formatBytes(developer.bytes)}
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          <Button variant="subtle" onClick={() => navigate('cleanup', { view: 'explore', root })}>
            Explore disk
            <ChevronRightIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {empty ? null : (
        <div className="sticky bottom-0 z-10 mt-6 -mb-8 flex items-center justify-between gap-4 border-t border-border bg-canvas py-4">
          <p className="text-body" aria-live="polite">
            {totals.items === 0 ? (
              'Nothing selected'
            ) : (
              <>
                {formatCount(totals.categories)} {totals.categories === 1 ? 'category' : 'categories'} ·{' '}
                <span className="font-semibold tabular-nums">{formatBytes(totals.bytes)}</span> selected
              </>
            )}
          </p>
          <Button
            variant="primary"
            size="lg"
            disabled={totals.items === 0}
            onClick={() =>
              openCleanDialog(dialogs, {
                title: 'Review and clean',
                request: { scope: 'row', root, paths: totals.paths },
              })
            }
          >
            Review and clean
          </Button>
        </div>
      )}
    </>
  );
}
