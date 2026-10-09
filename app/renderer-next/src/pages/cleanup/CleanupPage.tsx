import { useEffect } from 'react';
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

export function CleanupPage() {
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
  return <ResultsView root={root} category={params?.view === 'results' ? params.category : undefined} />;
}
