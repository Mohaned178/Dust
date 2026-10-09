import type { CategoryId } from '@dust/core';
import { useEffect, useMemo } from 'react';
import { QUICK_CLEAN_CATEGORY_IDS } from '../../../../src/shared/categories';
import type { DashboardVolumeCard } from '../../../../src/shared/ipc';
import { useDialogs } from '../../app/dialogs';
import { useNavStore } from '../../app/nav';
import { useStartScan } from '../../app/useStartScan';
import { useApi } from '../../lib/api';
import { QUICK_CLEAN_NOTE } from '../../lib/categories';
import { useDashboardStore } from '../../stores/dashboard';
import { useResultsStore } from '../../stores/results';
import { useScanStore } from '../../stores/scan';
import { Notice } from '../../ui/Notice';
import { PageHeader } from '../../ui/PageHeader';
import { openCleanDialog } from '../cleanup/openClean';
import { Hero } from './Hero';
import type { HeroState } from './Hero';
import { OtherDrives } from './OtherDrives';
import { AppsTile, DeveloperTile, HealthTile, StartupTile } from './Tiles';
import { greetingFor } from './useGreeting';

function usedBytes(volume: DashboardVolumeCard): number | null {
  if (volume.totalBytes === null || volume.freeBytes === null) return null;
  return Math.max(volume.totalBytes - volume.freeBytes, 0);
}

/** Home's headline covers the categories Quick Clean covers: the ones that are safe to remove by default. */
const HEADLINE_CATEGORIES = new Set<CategoryId>(QUICK_CLEAN_CATEGORY_IDS);

export function HomePage() {
  const api = useApi();
  const navigate = useNavStore((state) => state.navigate);
  const dashboard = useDashboardStore((state) => state.dashboard);
  const loadDashboard = useDashboardStore((state) => state.load);
  const loadCategories = useResultsStore((state) => state.loadCategories);
  const run = useScanStore((state) => (state.latestRunId === null ? undefined : state.runs[state.latestRunId]));
  const scan = useStartScan();
  const dialogs = useDialogs();

  const system = dashboard.data?.volumes.find((volume) => volume.role === 'system') ?? null;
  const root = system?.root ?? null;
  const scanned = system !== null && system.lastAnalyzedAt !== null;
  const categories = useResultsStore((state) => (root === null ? undefined : state.categories[root.toLowerCase()]));

  // Effects stop while Home is hidden and start again when it is shown, so coming back refreshes quietly
  // while the last data is already on screen.
  useEffect(() => {
    void loadDashboard(api);
  }, [api, loadDashboard]);
  useEffect(() => {
    if (root !== null && scanned) void loadCategories(api, root);
  }, [api, loadCategories, root, scanned]);

  // A scan that just ended changes the drive card and the totals.
  const settledRunId = run?.outcome ? run.runId : null;
  useEffect(() => {
    if (settledRunId === null) return;
    void loadDashboard(api, true);
    if (root !== null) void loadCategories(api, root, true);
  }, [api, loadDashboard, loadCategories, settledRunId, root]);

  // This session's own run is the freshest word; the dashboard only knows about a scan that began earlier.
  const scanning = run !== undefined ? run.outcome === null : dashboard.data?.scan?.kind === 'analyze';

  const hero = useMemo<HeroState>(() => {
    if (dashboard.data === null) {
      return dashboard.error !== null
        ? { kind: 'error', onRetry: () => void loadDashboard(api, true) }
        : { kind: 'loading' };
    }
    if (system === null) return { kind: 'no-drive' };
    const used = usedBytes(system);
    if (scanning) {
      return {
        kind: 'scanning',
        root: system.root,
        progress: run?.progress ?? null,
        usedBytes: used,
        onOpen:
          run !== undefined && run.outcome === null
            ? () => navigate('cleanup', { view: 'scan', root: system.root, runId: run.runId, usedBytes: used })
            : null,
      };
    }
    const data = categories?.data ?? null;
    if (!scanned || (data !== null && data.source === 'empty')) {
      return { kind: 'never', root: system.root, usedBytes: used, totalBytes: system.totalBytes };
    }
    if (data === null) {
      return {
        kind: 'checking',
        root: system.root,
        finishedAt: system.lastAnalyzedAt,
        usedBytes: used,
        totalBytes: system.totalBytes,
        failed: categories?.error != null,
      };
    }

    const notes: string[] = [];
    if (data.status === 'cancelled') notes.push('The last scan was cancelled, so these figures may be incomplete.');
    if (data.rulesStale) notes.push('Dust’s cleanup rules changed after this scan. Scan again for current figures.');
    if (data.depthLimited) notes.push('Some very deep folders were not checked.');
    const rows = data.categories
      .filter((row) => HEADLINE_CATEGORIES.has(row.category) && row.bytes > 0)
      .sort((a, b) => QUICK_CLEAN_CATEGORY_IDS.indexOf(a.category) - QUICK_CLEAN_CATEGORY_IDS.indexOf(b.category))
      .map((row) => ({ category: row.category, bytes: row.bytes }));
    return {
      kind: 'results',
      root: system.root,
      rows,
      finishedAt: data.finishedAt ?? system.lastAnalyzedAt,
      usedBytes: used,
      totalBytes: system.totalBytes,
      notes,
      onSelectCategory: (category) => navigate('cleanup', { view: 'results', root: system.root, category }),
      onOpen: () => navigate('cleanup', { view: 'results', root: system.root }),
    };
  }, [
    api,
    categories?.data,
    categories?.error,
    dashboard.data,
    dashboard.error,
    loadDashboard,
    navigate,
    run,
    scanned,
    scanning,
    system,
  ]);

  // For the "window shown to first content" budget. The hero shows real information as soon as the drives are
  // known; the scan figure follows when the backend has read the last scan, which can take a moment on a cold start.
  const heroReady = hero.kind !== 'loading';
  const figureReady = hero.kind === 'results';
  useEffect(() => {
    if (heroReady && performance.getEntriesByName('dust:home-ready').length === 0) performance.mark('dust:home-ready');
  }, [heroReady]);
  useEffect(() => {
    if (figureReady && performance.getEntriesByName('dust:home-figure').length === 0)
      performance.mark('dust:home-figure');
  }, [figureReady]);

  const otherDrives = useMemo(
    () => dashboard.data?.volumes.filter((volume) => volume.role !== 'system') ?? [],
    [dashboard.data],
  );

  const onScan = () => {
    if (system !== null) void scan.start({ root: system.root, usedBytes: usedBytes(system) });
  };

  return (
    <div className="flex flex-col gap-6 [&>header]:pb-0">
      <PageHeader title={greetingFor(new Date())} />
      {scan.error !== null ? <Notice variant="warning">Dust could not start the scan: {scan.error}</Notice> : null}
      <Hero
        state={hero}
        onScan={onScan}
        scanStarting={scan.starting}
        onQuickClean={() =>
          openCleanDialog(dialogs, { title: 'Quick clean', request: { scope: 'quick' }, scopeNote: QUICK_CLEAN_NOTE })
        }
      />
      <OtherDrives volumes={otherDrives} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StartupTile />
        <AppsTile />
        <HealthTile />
        <DeveloperTile root={root} scanned={scanned} />
      </div>
    </div>
  );
}
