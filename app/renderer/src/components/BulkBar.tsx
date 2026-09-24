import { formatBytes, formatCount } from '../format';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface BulkBarProps {
  count: number;
  bytes: number;
  onClear: () => void;
  onClean: () => void;
}

export function BulkBar({ count, bytes, onClear, onClean }: BulkBarProps) {
  return (
    <div className="sticky bottom-0 z-30 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-hairline bg-surface/95 px-4 py-3 shadow-pop backdrop-blur">
        <p
          role="status"
          aria-live="polite"
          aria-label="Selection"
          className="min-w-0 text-sm text-ink"
        >
          Clean <span className="font-mono">{formatCount(count)}</span> selected
          <span className="mx-1.5 text-ink-muted/60" aria-hidden="true">
            ·
          </span>
          <span className="font-mono">{formatBytes(bytes)}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-canvas hover:text-ink ${FOCUS}`}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClean}
            className={`inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-accent-strong ${FOCUS}`}
          >
            Preview &amp; clean
          </button>
        </div>
      </div>
    </div>
  );
}
