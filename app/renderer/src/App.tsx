import { useCallback, useEffect, useState } from 'react';
import type { DustApi, ScanEvent, StartAnalyzeResult } from '../../src/shared/ipc';
import { Dashboard } from './pages/Dashboard';
import { ScanView } from './pages/ScanView';

export interface AppProps {
  api: DustApi;
}

type View = { name: 'dashboard' } | { name: 'scan'; root: string; runId: string };

export function App({ api }: AppProps) {
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [event, setEvent] = useState<ScanEvent | null>(null);

  useEffect(() => api.onScanEvent(setEvent), [api]);

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
  return <Dashboard api={api} onAnalyze={analyze} />;
}
