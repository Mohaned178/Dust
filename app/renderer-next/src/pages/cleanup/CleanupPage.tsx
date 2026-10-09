import { Suspense, lazy, useEffect, useRef } from 'react';
import { useNavStore } from '../../app/nav';
import { useApi } from '../../lib/api';
import { useDashboardStore } from '../../stores/dashboard';
import { useScanStore } from '../../stores/scan';
import { Card } from '../../ui/Card';
import { ErrorState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { Skeleton } from '../../ui/Skeleton';
import { ResultsView } from './ResultsView';
import { ScanView } from './ScanView';

// The explorer (and its treemap library) is fetched only when someone opens it.
const ExploreView = lazy(() => import('../explore/ExploreView').then((m) => ({ default: m.ExploreView })));

export function CleanupPage() {
  const view = useNavStore((state) => state.params.cleanup?.view ?? 'auto');
  const wrapper = useRef<HTMLDivElement>(null);

  // Moving between the results and the explorer replaces the button that was pressed; the heading takes focus.
  useEffect(() => {
    if (useNavStore.getState().focusTarget !== 'cleanup') return;
    const heading = wrapper.current?.querySelector('h1');
    if (heading == null) return;
    heading.focus({ preventScroll: true });
    useNavStore.getState().clearFocusTarget('cleanup');
  }, [view]);

  return (
    <div ref={wrapper}>
      <CleanupView />
    </div>
  );
}

function CleanupView() {
  const api = useApi();
  const params = useNavStore((state) => state.params.cleanup);
  const dashboard = useDashboardStore((state) => state.dashboard);
  const loadDashboard = useDashboardStore((state) => state.load);
  const latestRun = useScanStore((state) => (state.latestRunId === null ? undefined : state.runs[state.latestRunId]));

  useEffect(() => {
    void loadDashboard(api);
  }, [api, loadDashboard]);

  const system = dashboard.data?.volumes.find((volume) => volume.role === 'system') ?? null;
  const usedBytes =
    system?.totalBytes != null && system.freeBytes != null ? Math.max(system.totalBytes - system.freeBytes, 0) : null;

  // Opened from the sidebar there are no parameters: a scan in progress wins, otherwise the system drive's results.
  if (params?.view === 'scan') {
    return <ScanView root={params.root} runId={params.runId} usedBytes={params.usedBytes} />;
  }
  if (params === undefined && latestRun !== undefined && latestRun.outcome === null && latestRun.root !== null) {
    return <ScanView root={latestRun.root} runId={latestRun.runId} usedBytes={usedBytes} />;
  }

  const root = params?.root ?? system?.root ?? null;
  if (root === null) {
    if (dashboard.error !== null && dashboard.data === null) {
      return (
        <>
          <PageHeader title="Clean up" />
          <Card>
            <ErrorState title="Dust could not read your drives" onRetry={() => void loadDashboard(api, true)} />
          </Card>
        </>
      );
    }
    return (
      <>
        <PageHeader title="Clean up" />
        <Card className="flex flex-col gap-4 p-4" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      </>
    );
  }
  if (params?.view === 'explore') {
    return (
      <Suspense
        fallback={
          <>
            <PageHeader title="Explore disk" />
            <Skeleton className="h-80 w-full" />
          </>
        }
      >
        <ExploreView root={root} />
      </Suspense>
    );
  }
  return <ResultsView root={root} category={params?.view === 'results' ? params.category : undefined} />;
}
