import { useCallback, useEffect, useState } from 'react';
import type { CategoryId } from '@dust/core';
import type { DustApi, ScanEvent, StartAnalyzeResult } from '../../src/shared/ipc';
import { bumpRendererCount, recordRendererSample } from './instrument';
import { Sidebar } from './components/Sidebar';
import type { NavKey } from './components/Sidebar';
import { SettingsDialog } from './components/SettingsDialog';
import { BrowseView } from './pages/BrowseView';
import { Dashboard } from './pages/Dashboard';
import { DevCleanupView } from './pages/DevCleanupView';
import { DrivesView } from './pages/DrivesView';
import { QuickCleanView } from './pages/QuickCleanView';
import { ResultsView } from './pages/ResultsView';
import { ScanView } from './pages/ScanView';

export interface AppProps {
  api: DustApi;
}

type View =
  | { name: 'dashboard' }
  | { name: 'drives' }
  | { name: 'scan'; root: string; runId: string; mode: 'analyze' | 'browse' }
  | { name: 'results'; root: string; category: CategoryId | null }
  | { name: 'browse'; root: string }
  | { name: 'dev-cleanup'; root: string };

function navFor(view: View): NavKey {
  switch (view.name) {
    case 'dev-cleanup':
      return 'dev-cleanup';
    case 'drives':
    case 'browse':
      return 'drives';
    case 'scan':
      return view.mode === 'browse' ? 'drives' : 'dashboard';
    default:
      return 'dashboard';
  }
}

export function App({ api }: AppProps) {
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [quickCleanOpen, setQuickCleanOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemRoot, setSystemRoot] = useState<string | null>(null);
  const [event, setEvent] = useState<ScanEvent | null>(null);

  useEffect(
    () =>
      api.onScanEvent((next) => {
        const startedAt = performance.now();
        setEvent(next);
        recordRendererSample('app.event', performance.now() - startedAt);
        bumpRendererCount(`app.event.${next.type}`);
        if (next.type === 'folders') bumpRendererCount('app.event.folders.rows', next.folders.length);
        if (next.type === 'browse-folders') bumpRendererCount('app.event.browse.rows', next.folders.length);
      }),
    [api],
  );

  const startScan = useCallback(
    async (root: string, mode: 'analyze' | 'browse'): Promise<StartAnalyzeResult> => {
      const result = await (mode === 'analyze' ? api.startAnalyze(root) : api.startBrowse(root));
      if (result.ok) {
        setEvent(null);
        setView({ name: 'scan', root, runId: result.runId, mode });
      }
      return result;
    },
    [api],
  );

  const analyze = useCallback((root: string) => startScan(root, 'analyze'), [startScan]);
  const browse = useCallback((root: string) => startScan(root, 'browse'), [startScan]);

  const back = useCallback(() => setView({ name: 'dashboard' }), []);

  const navigate = useCallback(
    (key: NavKey) => {
      if (key === 'dashboard') setView({ name: 'dashboard' });
      else if (key === 'drives') setView({ name: 'drives' });
      else if (key === 'dev-cleanup' && systemRoot !== null) setView({ name: 'dev-cleanup', root: systemRoot });
    },
    [systemRoot],
  );

  const closeQuickClean = useCallback(() => setQuickCleanOpen(false), []);
  const viewResults = useCallback((root: string, category: CategoryId | null = null) => {
    setQuickCleanOpen(false);
    setView({ name: 'results', root, category });
  }, []);
  const openDevCleanup = useCallback((root: string) => setView({ name: 'dev-cleanup', root }), []);
  const browseDone = useCallback((root: string) => setView({ name: 'browse', root }), []);

  let content;
  if (view.name === 'scan') {
    content = (
      <ScanView
        api={api}
        root={view.root}
        runId={view.runId}
        mode={view.mode}
        event={event}
        onBack={back}
        onBrowseComplete={view.mode === 'browse' ? browseDone : undefined}
      />
    );
  } else if (view.name === 'dev-cleanup') {
    content = (
      <DevCleanupView api={api} root={view.root} onBack={back} onViewResults={viewResults} />
    );
  } else if (view.name === 'drives') {
    content = <DrivesView api={api} onBrowse={browse} />;
  } else if (view.name === 'browse') {
    content = <BrowseView api={api} root={view.root} runId={null} onBack={back} />;
  } else if (view.name === 'results') {
    content = (
      <main className="dust-dashboard min-h-screen bg-canvas text-ink">
        <div className="mx-auto max-w-6xl px-6 py-10 sm:px-8">
          <ResultsView
            key={`${view.root}|${view.category ?? 'all'}`}
            api={api}
            root={view.root}
            runId={null}
            initialCategory={view.category}
            onOpenDevCleanup={() => setView({ name: 'dev-cleanup', root: view.root })}
          />
          <button
            type="button"
            onClick={back}
            className="mt-6 inline-flex items-center rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Back to dashboard
          </button>
        </div>
      </main>
    );
  } else {
    content = (
      <Dashboard
        api={api}
        onAnalyze={analyze}
        onViewResults={viewResults}
        onQuickClean={() => setQuickCleanOpen(true)}
        onOpenDevCleanup={openDevCleanup}
        onSystemDrive={setSystemRoot}
        shortcutsEnabled={!quickCleanOpen && !settingsOpen}
      />
    );
  }

  return (
    <div className="dust-dashboard flex h-screen overflow-hidden bg-canvas text-ink">
      <Sidebar
        active={navFor(view)}
        devCleanupDisabled={systemRoot === null}
        onNavigate={navigate}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="min-w-0 flex-1 overflow-y-auto">{content}</div>
      {quickCleanOpen && <QuickCleanView api={api} onDone={closeQuickClean} onViewResults={viewResults} />}
      {settingsOpen && <SettingsDialog api={api} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
