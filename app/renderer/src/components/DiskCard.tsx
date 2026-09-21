import type { DashboardVolumeCard } from '../../../src/shared/ipc';
import { formatBytes, formatRelativeTime } from '../format';
import { UsageBar } from './UsageBar';

export interface DiskCardProps {
  volume: DashboardVolumeCard;
  busy: boolean;
  onAnalyze: () => void;
  onViewResults: () => void;
}

export function DiskCard({ volume, busy, onAnalyze, onViewResults }: DiskCardProps) {
  const used =
    volume.totalBytes !== null && volume.freeBytes !== null ? volume.totalBytes - volume.freeBytes : null;

  return (
    <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium text-neutral-100">{volume.label ?? volume.root}</h2>
        {volume.label !== null && <span className="text-xs text-neutral-500">{volume.root}</span>}
      </div>
      {volume.external && (
        <span className="mt-1 inline-block rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
          external
        </span>
      )}
      <div className="mt-4">
        <UsageBar usedBytes={used} totalBytes={volume.totalBytes} />
      </div>
      <p className="mt-2 text-sm text-neutral-400">
        {formatBytes(used)} used of {formatBytes(volume.totalBytes)} · {formatBytes(volume.freeBytes)} free
      </p>
      {volume.lastAnalyzedAt !== null && (
        <p className="mt-1 text-sm text-neutral-400">
          Last analyzed {formatRelativeTime(volume.lastAnalyzedAt)} · {formatBytes(volume.reclaimableBytes)} reclaimable
        </p>
      )}
      {volume.lastCleanedAt !== null && (
        <p className="mt-1 text-sm text-neutral-500">Last cleaned {formatRelativeTime(volume.lastCleanedAt)}</p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          aria-label={`Analyze ${volume.root}`}
          disabled={busy}
          onClick={onAnalyze}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Analyze
        </button>
        {volume.lastAnalyzedAt !== null && (
          <button
            type="button"
            aria-label={`View results for ${volume.root}`}
            onClick={onViewResults}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
          >
            View results
          </button>
        )}
      </div>
    </article>
  );
}
