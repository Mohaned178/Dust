import { useState } from 'react';
import type { DustApi, ScanEvent } from '../../../src/shared/ipc';
import { formatBytes, formatCount, formatDuration } from '../format';
import { ResultsView } from './ResultsView';

export interface ScanViewProps {
  api: DustApi;
  root: string;
  runId: string;
  event: ScanEvent | null;
  onBack: () => void;
}

export function ScanView({ api, root, runId, event, onBack }: ScanViewProps) {
  const [cancelError, setCancelError] = useState<string | null>(null);
  const current = event !== null && 'runId' in event && event.runId === runId ? event : null;
  const finished = current?.type === 'finished' ? current : null;
  const failed = current?.type === 'failed' ? current : null;
  const progress = current?.type === 'progress' ? current.progress : null;
  const finalizing = current?.type === 'finalizing';

  const title = finished
    ? finished.status === 'complete'
      ? 'Scan complete'
      : 'Scan cancelled'
    : failed
      ? 'Scan failed'
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

      {!finished && !failed && (
        <section aria-label="Scan progress" className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat label="Files scanned" value={formatCount(progress?.filesScanned ?? 0)} />
            <Stat label="Bytes seen" value={formatBytes(progress?.bytesSeen ?? 0)} />
            <Stat label="Errors" value={formatCount(progress?.errors ?? 0)} />
            <Stat label="Elapsed" value={formatDuration(progress?.elapsedMs ?? 0)} />
          </dl>
          <p className="mt-4 truncate text-xs text-neutral-500">{progress?.currentPath ?? 'Preparing…'}</p>
          {finalizing && <p className="mt-2 text-sm text-emerald-300">Analyzing results…</p>}
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

      {finished && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat label="Files scanned" value={formatCount(finished.filesScanned)} />
            <Stat label="Bytes seen" value={formatBytes(finished.bytesSeen)} />
            <Stat label="Projects" value={formatCount(finished.projects)} />
            <Stat label="Elapsed" value={formatDuration(finished.finishedAt - finished.startedAt)} />
          </dl>
          <p className="mt-4 text-sm text-neutral-300">{formatBytes(finished.reclaimableBytes)} reclaimable found.</p>
          {!finished.saved && (
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
        <ResultsView api={api} root={root} runId={runId} key={runId} />
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
