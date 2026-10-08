import { useCallback, useEffect, useState } from 'react';
import type { CategoryId } from '@dust/core';
import type { DustApi, ResultRow, ResultsState } from '../../../src/shared/ipc';
import { formatRelativeTime } from '../format';
import { sameRoot } from '../tree';
import { ResultsView } from './ResultsView';
import { SpaceMap } from '../components/SpaceMap';
import { Button, FOCUS, PageHeader, Tabs } from '../components/ui';
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

interface LoadedResults {
  root: string;
  rows: ResultRow[];
  finishedAt: number | null;
  status: ResultsState['status'];
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
  // Both panels stay mounted once opened, so selection, kept items, search and
  // expanded folders survive a tab switch. The map is only built on first open.
  const [mapOpened, setMapOpened] = useState(initialTab === 'map');
  // ResultsView owns the fetch (and the reload after a clean); the map and the
  // header read the same snapshot instead of asking the main process again.
  const [loaded, setLoaded] = useState<LoadedResults | null>(null);
  const [failedRoot, setFailedRoot] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
    setMapOpened(initialTab === 'map');
  }, [initialTab, root]);

  useEffect(() => {
    if (tab === 'map') setMapOpened(true);
  }, [tab]);

  const handleLoaded = useCallback((state: ResultsState) => {
    setLoaded({ root: state.root, rows: state.rows, finishedAt: state.finishedAt, status: state.status });
    setFailedRoot(null);
  }, []);
  const handleLoadFailed = useCallback(() => setFailedRoot(root), [root]);

  const current = loaded !== null && sameRoot(loaded.root, root) ? loaded : null;
  const showMap = mapOpened || tab === 'map';

  return (
    <main className="min-h-full bg-canvas text-ink">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <button
          type="button"
          onClick={onBack}
          className={`mb-4 rounded text-sm font-medium text-accent hover:underline ${FOCUS}`}
        >
          ← Home
        </button>
        <PageHeader
          title={<>Results for {root}</>}
          subtitle={
            current?.finishedAt != null
              ? `Scanned ${formatRelativeTime(current.finishedAt)}${
                  current.status === 'cancelled' ? ' · scan was cancelled, results are partial' : ''
                }`
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
            idPrefix="results"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'clean', label: 'Clean up', icon: <ListIcon className="h-4 w-4" /> },
              { value: 'map', label: 'Space map', icon: <GridIcon className="h-4 w-4" /> },
            ]}
          />
        </div>

        <div role="tabpanel" id="results-panel-clean" aria-labelledby="results-tab-clean" hidden={tab !== 'clean'} className="mt-6">
          <ResultsView
            key={root}
            api={api}
            root={root}
            embedded
            initialCategory={initialCategory}
            onOpenDevCleanup={() => onOpenDevCleanup(root)}
            onLoaded={handleLoaded}
            onLoadFailed={handleLoadFailed}
          />
        </div>
        {showMap && (
          <div role="tabpanel" id="results-panel-map" aria-labelledby="results-tab-map" hidden={tab !== 'map'} className="mt-6">
            <SpaceMap
              key={root}
              api={api}
              root={root}
              rows={current?.rows ?? null}
              failed={failedRoot !== null && sameRoot(failedRoot, root)}
            />
          </div>
        )}
      </div>
    </main>
  );
}
