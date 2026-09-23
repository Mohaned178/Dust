import { useEffect, useState } from 'react';
import type { DustApi, ScanEvent, ScanProgressPayload } from '../../../src/shared/ipc';
import { formatBytes, formatCount, formatDuration } from '../format';
import { BrowseView } from './BrowseView';
import { ResultsView } from './ResultsView';

export interface ScanViewProps {
  api: DustApi;
  root: string;
  runId: string;
  event: ScanEvent | null;
  onBack: () => void;
  mode?: 'analyze' | 'browse';
}

export function ScanView({ api, root, runId, event, onBack, mode = 'analyze' }: ScanViewProps) {
  const browse = mode === 'browse';
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [lastProgress, setLastProgress] = useState<ScanProgressPayload | null>(null);
  const current = event !== null && 'runId' in event && event.runId === runId ? event : null;
  const finished = current?.type === 'finished' ? current : null;
  const browseFinished = current?.type === 'browse-finished' ? current : null;
  const done = finished ?? browseFinished;
  const failed = current?.type === 'failed' ? current : null;
  const progress = current?.type === 'progress' ? current.progress : lastProgress;
  const finalizing = current?.type === 'finalizing';
  const finalizeStep = current?.type === 'finalize-progress' ? current.step : null;

  useEffect(() => {
    setLastProgress(null);
  }, [runId]);

  useEffect(() => {
    if (event !== null && 'runId' in event && event.runId === runId && event.type === 'progress') {
      setLastProgress(event.progress);
    }
  }, [event, runId]);

  const title = done
    ? done.status === 'complete'
      ? browse
        ? 'Browse complete'
        : 'Scan complete'
      : browse
        ? 'Browse cancelled'
        : 'Scan cancelled'
    : failed
      ? browse
        ? 'Browse failed'
        : 'Scan failed'
      : browse
        ? 'Browsing'
        : 'Scanning';

  const cancel = async () => {
    try {
      await api.cancelScan();
    } catch (cause) {
      setCancelError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-8 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-100">{title}</h1>
        <p className="mt-1 text-sm text-neutral-400">{root}</p>
      </header>

      {!done && !failed && (
        <section aria-label="Scan progress" className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat label="Files scanned" value={formatCount(progress?.filesScanned ?? 0)} />
            <Stat label="Bytes seen" value={formatBytes(progress?.bytesSeen ?? 0)} />
            <Stat label="Errors" value={formatCount(progress?.errors ?? 0)} />
            <Stat label="Elapsed" value={formatDuration(progress?.elapsedMs ?? 0)} />
          </dl>
          <p className="mt-4 truncate text-xs text-neutral-500">{progress?.currentPath ?? 'Preparing…'}</p>
          {(finalizing || finalizeStep !== null) && (
            <p className="mt-2 text-sm text-emerald-300">
              Analyzing results…{finalizeStep !== null ? ` (${finalizeStep})` : ''}
            </p>
          )}
          {cancelError !== null && <p className="mt-2 text-sm text-red-300">Cancel failed: {cancelError}</p>}
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={finalizing}
            className="mt-4 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 disabled:opacity-40"
          >
            Cancel scan
          </button>
        </section>
      )}

      {done && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <dl className={`grid grid-cols-2 gap-4 text-sm ${browse ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
            <Stat label="Files scanned" value={formatCount(done.filesScanned)} />
            <Stat label="Bytes seen" value={formatBytes(done.bytesSeen)} />
            {finished && <Stat label="Projects" value={formatCount(finished.projects)} />}
            <Stat label="Elapsed" value={formatDuration(done.finishedAt - done.startedAt)} />
          </dl>
          {finished && (
            <p className="mt-4 text-sm text-neutral-300">{formatBytes(finished.reclaimableBytes)} reclaimable found.</p>
          )}
          {finished && !finished.saved && (
            <p className="mt-2 text-sm text-amber-300">
              Snapshot could not be saved — these results are for this session only.
            </p>
          )}
        </section>
      )}

      {failed && (
        <section className="rounded-xl border border-red-900 bg-red-950/40 p-6 text-sm text-red-200">
          {failed.message}
        </section>
      )}

      <div className="mt-6">
        {browse ? (
          <BrowseView api={api} root={root} runId={runId} key={runId} />
        ) : (
          <ResultsView api={api} root={root} runId={runId} key={runId} />
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="mt-6 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200"
      >
        Back to dashboard
      </button>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-lg font-medium text-neutral-100">{value}</dd>
    </div>
  );
}
