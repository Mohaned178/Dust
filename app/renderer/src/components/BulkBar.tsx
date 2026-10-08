import { formatBytes, formatCount } from '../format';
import { Button } from './ui';

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
        <p role="status" aria-live="polite" aria-label="Selection" className="min-w-0 text-sm text-ink">
          <span className="font-mono">{formatCount(count)}</span> selected
          <span className="mx-1.5 text-ink-muted/60" aria-hidden="true">
            ·
          </span>
          <span className="font-mono">{formatBytes(bytes)}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
          <Button variant="primary" onClick={onClean}>
            Preview &amp; delete
          </Button>
        </div>
      </div>
    </div>
  );
}
