import { useCallback, useEffect, useState } from 'react';
import type { DustApi, ScanEvent, StartAnalyzeResult } from '../../src/shared/ipc';
import { bumpRendererCount, recordRendererSample } from './instrument';
import { Dashboard } from './pages/Dashboard';
import { DevCleanupView } from './pages/DevCleanupView';
import { QuickCleanView } from './pages/QuickCleanView';
import { ResultsView } from './pages/ResultsView';
import { ScanView } from './pages/ScanView';

export interface AppProps {
  api: DustApi;
}

type View =
  | { name: 'dashboard' }
  | { name: 'scan'; root: string; runId: string }
  | { name: 'results'; root: string }
  | { name: 'quick-clean' }
  | { name: 'dev-cleanup'; root: string };

export function App({ api }: AppProps) {
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [event, setEvent] = useState<ScanEvent | null>(null);

  useEffect(
    () =>
      api.onScanEvent((next) => {
        const startedAt = performance.now();
        setEvent(next);
        recordRendererSample('app.event', performance.now() - startedAt);
        bumpRendererCount(`app.event.${next.type}`);
        if (next.type === 'folders') bumpRendererCount('app.event.folders.rows', next.folders.length);
      }),
    [api],
  );

  const analyze = useCallback(
    async (root: string): Promise<StartAnalyzeResult> => {
      const result = await api.startAnalyze(root);
      if (result.ok) {
        setEvent(null);
        setView({ name: 'scan', root, runId: result.runId });
      }
      return result;
    },
    [api],
  );

  const back = useCallback(() => setView({ name: 'dashboard' }), []);

  if (view.name === 'scan') {
    return <ScanView api={api} root={view.root} runId={view.runId} event={event} onBack={back} />;
  }
  if (view.name === 'quick-clean') {
    return (
      <QuickCleanView api={api} onDone={back} onViewResults={(root) => setView({ name: 'results', root })} />
    );
  }
  if (view.name === 'dev-cleanup') {
    return (
      <DevCleanupView
        api={api}
        root={view.root}
        onBack={back}
        onViewResults={(root) => setView({ name: 'results', root })}
      />
    );
  }
  if (view.name === 'results') {
    return (
      <main className="mx-auto max-w-6xl px-8 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-100">Results</h1>
          <p className="mt-1 text-sm text-neutral-400">{view.root}</p>
        </header>
        <ResultsView
          api={api}
          root={view.root}
          runId={null}
          onOpenDevCleanup={() => setView({ name: 'dev-cleanup', root: view.root })}
        />
        <button
          type="button"
          onClick={back}
          className="mt-6 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200"
        >
          Back to dashboard
        </button>
      </main>
    );
  }
  return (
    <Dashboard
      api={api}
      onAnalyze={analyze}
      onViewResults={(root) => setView({ name: 'results', root })}
      onQuickClean={() => setView({ name: 'quick-clean' })}
    />
  );
}
