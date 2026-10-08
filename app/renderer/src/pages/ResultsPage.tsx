import { useEffect, useState } from 'react';
import type { CategoryId } from '@dust/core';
import type { DustApi, ResultsCategoriesState } from '../../../src/shared/ipc';
import { formatBytes, formatRelativeTime } from '../format';
import { ResultsView } from './ResultsView';
import { SpaceMap } from '../components/SpaceMap';
import { Button, PageHeader, Tabs } from '../components/ui';
import { GridIcon, ListIcon, RefreshIcon } from '../components/icons';

export type ResultsTab = 'clean' | 'map';

export interface ResultsPageProps {
  api: DustApi;
  root: string;
  initialCategory?: CategoryId | null;
  initialTab?: ResultsTab;
  onRescan: (root: string) => void;
  onBack: () => void;
  onOpenDevCleanup: (root: string) => void;
}

export function ResultsPage({
  api,
  root,
  initialCategory = null,
  initialTab = 'clean',
  onRescan,
  onBack,
  onOpenDevCleanup,
}: ResultsPageProps) {
  const [tab, setTab] = useState<ResultsTab>(initialTab);
  const [summary, setSummary] = useState<ResultsCategoriesState | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, root]);

  useEffect(() => {
    let active = true;
    api
      .getResultCategories(root)
      .then((state) => {
        if (active) setSummary(state);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, root]);

  const reclaimable = (summary?.categories ?? []).reduce((sum, row) => sum + row.bytes, 0);

  return (
    <main className="min-h-full bg-canvas text-ink">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 rounded text-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ← Home
        </button>
        <PageHeader
          title={<>Results for {root}</>}
          subtitle={
            summary?.finishedAt != null
              ? `Scanned ${formatRelativeTime(summary.finishedAt)}${
                  reclaimable > 0 ? ` · up to ${formatBytes(reclaimable)} can be cleaned` : ''
                }${summary.status === 'cancelled' ? ' · scan was cancelled, results are partial' : ''}`
              : undefined
          }
          actions={
            <Button onClick={() => onRescan(root)}>
              <RefreshIcon className="h-4 w-4" />
              Rescan
            </Button>
          }
        />

        <div className="mt-6">
          <Tabs<ResultsTab>
            label="Results views"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'clean', label: 'Clean up', icon: <ListIcon className="h-4 w-4" /> },
              { value: 'map', label: 'Space map', icon: <GridIcon className="h-4 w-4" /> },
            ]}
          />
        </div>

        <div className="mt-6">
          {tab === 'clean' ? (
            <ResultsView
              key={root}
              api={api}
              root={root}
              runId={null}
              embedded
              initialCategory={initialCategory}
              onOpenDevCleanup={() => onOpenDevCleanup(root)}
            />
          ) : (
            <SpaceMap api={api} root={root} />
          )}
        </div>
      </div>
    </main>
  );
}
