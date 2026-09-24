import { useCallback, useEffect, useState } from 'react';
import type { DashboardState, DustApi, StartAnalyzeResult } from '../../../src/shared/ipc';
import { CleanDialog } from '../components/CleanDialog';
import { DriveRow } from '../components/DiskCard';
import { InfoIcon } from '../components/icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const PRIMARY = `inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;

export interface DrivesViewProps {
  api: DustApi;
  onBrowse: (root: string) => Promise<StartAnalyzeResult>;
}

export function DrivesView({ api, onBrowse }: DrivesViewProps) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [busyRoot, setBusyRoot] = useState<string | null>(null);
  const [pendingRoot, setPendingRoot] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    setState(null);
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
  }, [api, reloadKey]);

  const retryLoad = useCallback(() => {
    setError(null);
    setState(null);
    setReloadKey((key) => key + 1);
  }, []);

  const start = useCallback(
    async (root: string) => {
      setBusyRoot(root);
      setStartError(null);
      try {
        const result = await onBrowse(root);
        if (!result.ok) {
          if (result.reason === 'busy') setPendingRoot(root);
          else if (result.reason === 'start-failed' || result.reason === 'not-system-drive') {
            setStartError(result.message);
          }
        }
      } catch (cause) {
        setStartError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyRoot(null);
      }
    },
    [onBrowse],
  );

  const cancelAndRetry = useCallback(async () => {
    const target = pendingRoot;
    setPendingRoot(null);
    if (target === null) return;
    try {
      await api.cancelScan();
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    await start(target);
  }, [api, pendingRoot, start]);

  if (error !== null) {
    return (
      <main className="dust-dashboard flex min-h-screen items-center justify-center bg-canvas p-8">
        <div className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-8 text-center shadow-card">
          <h1 className="text-lg font-semibold text-ink">Couldn't load your drives.</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Dust couldn't read the drive list from this machine. Try again — if it keeps failing, restart Dust.
          </p>
          <button type="button" onClick={retryLoad} className={`mt-6 ${PRIMARY}`}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  const otherDrives = state === null ? [] : state.volumes.filter((volume) => volume.role !== 'system');
  const locked = state !== null && state.scan !== null;

  return (
    <main className="dust-dashboard min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Drives</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Fixed, removable, and network volumes other than the system drive. Dust shows what is on them, but only
          browses — there is no safety grading and no cleanup here.
        </p>

        {startError !== null && (
          <div
            role="alert"
            className="mt-8 flex items-start gap-2.5 rounded-xl border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink"
          >
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="min-w-0">Could not start the scan: {startError}</p>
          </div>
        )}

        {state === null ? (
          <DrivesLoading />
        ) : otherDrives.length === 0 ? (
          <p className="mt-10 text-sm text-ink-muted">No other drives.</p>
        ) : (
          <ul className="mt-8 divide-y divide-hairline border-t border-hairline">
            {otherDrives.map((volume) => (
              <DriveRow
                key={volume.root}
                volume={volume}
                busy={busyRoot === volume.root}
                locked={locked}
                onBrowse={() => void start(volume.root)}
              />
            ))}
          </ul>
        )}
      </div>

      {pendingRoot !== null && (
        <CleanDialog label="Scan already running" onClose={() => setPendingRoot(null)}>
          <p className="text-sm text-ink">A scan is already running. Cancel it first?</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingRoot(null)}
              className={`rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`}
            >
              Wait
            </button>
            <button
              type="button"
              onClick={() => void cancelAndRetry()}
              className={`rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong ${FOCUS}`}
            >
              Cancel it
            </button>
          </div>
        </CleanDialog>
      )}
    </main>
  );
}

function DrivesLoading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse motion-reduce:animate-none">
      <span className="sr-only">Loading drives…</span>
      <div aria-hidden="true" className="mt-8 divide-y divide-hairline border-t border-hairline">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 py-3.5">
            <div className="h-4 w-16 rounded bg-track" />
            <div className="ml-auto h-3.5 w-32 rounded bg-track/70" />
            <div className="h-8 w-20 rounded-lg bg-track" />
          </div>
        ))}
      </div>
    </div>
  );
}
