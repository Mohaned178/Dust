import type { DashboardVolumeCard } from '../../../src/shared/ipc';
import { formatBytes } from '../format';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const ROW_BUTTON = `shrink-0 rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;

function usedBytesOf(volume: DashboardVolumeCard): number | null {
  return volume.totalBytes !== null && volume.freeBytes !== null ? volume.totalBytes - volume.freeBytes : null;
}

export interface DriveRowProps {
  volume: DashboardVolumeCard;
  busy: boolean;
  locked: boolean;
  onBrowse: () => void;
}

export function DriveRow({ volume, busy, locked, onBrowse }: DriveRowProps) {
  const used = usedBytesOf(volume);
  return (
    <li className="flex items-center gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-ink">{volume.root}</span>
          {volume.label !== null && <span className="truncate text-sm text-ink-muted">{volume.label}</span>}
          {volume.external && (
            <span className="shrink-0 rounded-full border border-hairline bg-canvas px-2 py-0.5 text-xs font-medium tracking-wide text-ink-muted">
              external
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-xs text-ink-muted sm:hidden">
          {formatBytes(used)} used · {formatBytes(volume.freeBytes)} free
        </p>
      </div>
      <p className="ml-auto hidden shrink-0 whitespace-nowrap font-mono text-sm text-ink-muted sm:block">
        {formatBytes(used)} used · {formatBytes(volume.freeBytes)} free
      </p>
      <button
        type="button"
        aria-label={`Browse ${volume.root}`}
        disabled={busy || locked}
        onClick={onBrowse}
        className={ROW_BUTTON}
      >
        Browse
      </button>
    </li>
  );
}
