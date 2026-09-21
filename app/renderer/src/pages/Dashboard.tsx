import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { DashboardState, DustApi, StartAnalyzeResult } from '../../../src/shared/ipc';
import { DiskCard } from '../components/DiskCard';

export interface DashboardProps {
  api: DustApi;
  onAnalyze: (root: string) => Promise<StartAnalyzeResult>;
}

export function Dashboard({ api, onAnalyze }: DashboardProps) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [busyRoot, setBusyRoot] = useState<string | null>(null);
  const [pendingRoot, setPendingRoot] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getDashboard()
      .then((next) => {
        if (active) setState(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [api]);

  const analyze = useCallback(
    async (root: string) => {
      setBusyRoot(root);
      setStartError(null);
      try {
        const result = await onAnalyze(root);
        if (!result.ok) {
          if (result.reason === 'busy') setPendingRoot(root);
          else if (result.reason === 'start-failed') setStartError(result.message);
        }
      } finally {
        setBusyRoot(null);
      }
    },
    [onAnalyze],
  );

  const cancelAndRetry = useCallback(async () => {
    const root = pendingRoot;
    setPendingRoot(null);
    if (!root) return;
    await api.cancelScan();
    await analyze(root);
  }, [api, analyze, pendingRoot]);

  if (error) return <main className="p-8 text-red-300">{error}</main>;
  if (!state) return <main className="p-8 text-neutral-400">Loading volumes…</main>;

  return (
    <main className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-100">Dust</h1>
        <p className="mt-1 text-sm text-neutral-400">Find what is safe to delete.</p>
      </header>

      {state.snapshot.status === 'corrupt' && (
        <Banner>Snapshot unreadable ({state.snapshot.reason}) — run an Analyze to rebuild it.</Banner>
      )}
      {state.snapshot.status === 'ok' && state.snapshot.rulesStale && (
        <Banner>Rules updated — rescan for accuracy.</Banner>
      )}
      {state.snapshot.status === 'ok' && state.snapshot.scanStatus === 'cancelled' && (
        <Banner>The last scan was cancelled — its results are partial.</Banner>
      )}
      {state.scan !== null && (
        <p className="mb-4 text-sm text-emerald-300">A scan is already running on {state.scan.root}.</p>
      )}
      {startError !== null && <Banner>Could not start the scan: {startError}</Banner>}

      <section className="grid gap-4 sm:grid-cols-2">
        {state.volumes.map((volume) => (
          <DiskCard
            key={volume.root}
            volume={volume}
            busy={busyRoot === volume.root}
            onAnalyze={() => void analyze(volume.root)}
          />
        ))}
      </section>

      {state.volumes.length === 0 && <p className="text-neutral-400">No volumes detected.</p>}

      {pendingRoot !== null && (
        <div
          role="dialog"
          aria-label="Scan already running"
          className="fixed inset-0 flex items-center justify-center bg-black/60"
        >
          <div className="w-96 rounded-xl border border-neutral-700 bg-neutral-900 p-6">
            <p className="text-sm text-neutral-200">A scan is already running. Cancel it first?</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void cancelAndRetry()}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
              >
                Cancel it
              </button>
              <button
                type="button"
                onClick={() => setPendingRoot(null)}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300"
              >
                Wait
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
      {children}
    </p>
  );
}
