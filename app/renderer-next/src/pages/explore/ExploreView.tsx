import { useCallback, useEffect, useRef, useState } from 'react';
import type { DustApi } from '../../../../src/shared/ipc';
import { useNavStore } from '../../app/nav';
import { useApi } from '../../lib/api';
import { ROOT_KEY } from '../../lib/explore';
import { useExploreStore } from '../../stores/explore';
import type { ExploreTab } from '../../stores/explore';
import { useResultsStore } from '../../stores/results';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { RelativeTime } from '../../ui/Display';
import { EmptyState, ErrorState } from '../../ui/EmptyState';
import { BackIcon } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { PageHeader } from '../../ui/PageHeader';
import { SearchBox } from '../../ui/SearchBox';
import { Skeleton } from '../../ui/Skeleton';
import { Switch } from '../../ui/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/Tabs';
import { FolderTree } from './FolderTree';
import { SearchResults } from './SearchResults';
import type { SearchState } from './SearchResults';
import { SpaceMap } from './SpaceMap';

/** Never matches a path (Windows forbids these characters), so asking for it only builds the search index. */
const WARM_UP_QUERY = '<dust-index-warm-up>';
const SEARCH_LIMIT = 500;
// Per backend connection: a new connection has a new, empty index.
const warmed = new WeakMap<DustApi, Set<string>>();

export function ExploreView({ root }: { root: string }) {
  const api = useApi();
  const navigate = useNavStore((state) => state.navigate);
  const loadSummary = useResultsStore((state) => state.load);
  const summary = useResultsStore((state) => state.summaries[root.toLowerCase()]);
  const tab = useExploreStore((state) => state.tab);
  const showProtected = useExploreStore((state) => state.showProtected);
  const ready = useExploreStore((state) => state.nodes[ROOT_KEY]?.status === 'ready');
  const rootMissing = useExploreStore((state) => state.nodes[ROOT_KEY] === undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const [search, setSearch] = useState<SearchState | null>(null);
  const searchSeq = useRef(0);
  const queryRef = useRef('');

  const data = summary?.data ?? null;
  const scanKey = data === null ? null : `${root.toLowerCase()}|${data.finishedAt ?? 0}`;
  const synced = useExploreStore((state) => scanKey !== null && state.scanKey === scanKey);

  useEffect(() => {
    void loadSummary(api, root);
  }, [api, loadSummary, root]);

  // The button that brought the user here is gone, so focus goes to the heading.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (scanKey === null || data === null || data.source === 'empty') return;
    useExploreStore.getState().syncScan(scanKey, root);
  }, [root, scanKey, data]);

  // The drive's folders load once the tree belongs to this scan, and again after protected items are switched.
  useEffect(() => {
    if (synced && rootMissing) void useExploreStore.getState().loadFolder(api, root, '');
  }, [api, root, synced, rootMissing]);

  // The first search builds an index of every folder and blocks the backend for a moment, so do that early,
  // once the first screen is already showing.
  useEffect(() => {
    if (!ready || scanKey === null) return;
    const done = warmed.get(api) ?? new Set<string>();
    if (done.has(scanKey)) return;
    warmed.set(api, done.add(scanKey));
    void api.searchResults(root, WARM_UP_QUERY, { limit: 1 }).catch(() => {});
  }, [api, root, ready, scanKey]);

  const runSearch = useCallback(
    (query: string) => {
      const id = ++searchSeq.current;
      queryRef.current = query;
      if (query === '') {
        setSearch(null);
        return;
      }
      setSearch((current) => ({ query, rows: current?.rows ?? [], total: current?.total ?? 0, status: 'loading' }));
      api
        .searchResults(root, query, { limit: SEARCH_LIMIT, hideDanger: !useExploreStore.getState().showProtected })
        .then(
          (result) => {
            // Answers can arrive out of order; only the newest counts.
            if (id === searchSeq.current) setSearch({ query, rows: result.rows, total: result.total, status: 'ready' });
          },
          () => {
            if (id === searchSeq.current) setSearch({ query, rows: [], total: 0, status: 'error' });
          },
        );
    },
    [api, root],
  );

  const onSearch = useCallback((query: string) => runSearch(query.trim()), [runSearch]);

  // Turning protected items on or off changes what a search finds.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (queryRef.current !== '') runSearch(queryRef.current);
  }, [showProtected, runSearch]);

  const back = () => {
    useNavStore.setState({ focusTarget: 'cleanup' });
    navigate('cleanup', { view: 'results', root });
  };

  if (summary?.error != null && data === null) {
    return (
      <>
        <PageHeader title="Explore disk" headingRef={heading} />
        <Card>
          <ErrorState title="Dust could not read the last scan" onRetry={() => void loadSummary(api, root, true)} />
        </Card>
      </>
    );
  }

  if (data !== null && data.source === 'empty') {
    return (
      <>
        <PageHeader
          title="Explore disk"
          headingRef={heading}
          actions={
            <Button icon={<BackIcon className="size-4" aria-hidden="true" />} onClick={back}>
              Clean up
            </Button>
          }
        />
        <Card>
          <EmptyState title="There is no scan to explore yet" description="Scan the drive from Clean up first." />
        </Card>
      </>
    );
  }

  const searching = search !== null;
  return (
    <>
      <PageHeader
        title="Explore disk"
        headingRef={heading}
        subtitle={
          data === null ? (
            root
          ) : (
            <>
              {root} · checked <RelativeTime ms={data.finishedAt} />
            </>
          )
        }
        actions={
          <Button icon={<BackIcon className="size-4" aria-hidden="true" />} onClick={back}>
            Clean up
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        {data?.source === 'snapshot' ? (
          <Notice>
            This is the saved scan, which keeps only the top of each folder tree. Scan again to see everything.
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SearchBox label="Search folders" placeholder="Search folders" onSearch={onSearch} />
          <label className="flex items-center gap-2 text-body">
            <Switch
              checked={showProtected}
              onCheckedChange={(next) => useExploreStore.getState().setShowProtected(next)}
              label="Show protected items"
            />
            Show protected items
          </label>
        </div>
        <Card className="overflow-hidden">
          {searching ? (
            <SearchResults root={root} state={search} />
          ) : !synced ? (
            <div className="flex flex-col gap-3 p-4" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Tabs value={tab} onValueChange={(next) => useExploreStore.getState().setTab(next as ExploreTab)}>
              <TabsList className="px-4">
                <TabsTrigger value="folders">Folders</TabsTrigger>
                <TabsTrigger value="map">Map</TabsTrigger>
              </TabsList>
              <TabsContent value="folders" className="pt-0">
                <FolderTree root={root} />
              </TabsContent>
              <TabsContent value="map" className="p-4">
                <SpaceMap root={root} />
              </TabsContent>
            </Tabs>
          )}
        </Card>
      </div>
    </>
  );
}
