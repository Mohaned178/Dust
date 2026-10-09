import { cn } from '../lib/cn';
import { formatBytes } from '../lib/format';

export interface UsageSegment {
  id: string;
  label: string;
  bytes: number;
  /** Makes the segment and its legend entry a button, e.g. to jump to that category. */
  onSelect?: () => void;
  /** Neutral grey for "everything else", so it never reads as one of the categories. */
  muted?: boolean;
}

const SWATCHES = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'] as const;
const MUTED_SWATCH = 'bg-border-strong';

export interface UsageBarProps {
  segments: ReadonlyArray<UsageSegment>;
  /** Total capacity. Space not covered by a segment shows as the empty track. */
  totalBytes: number;
  /** Names the bar, e.g. "Space used on C:\". */
  label: string;
  legend?: boolean;
  className?: string;
}

export function UsageBar({ segments, totalBytes, label, legend = true, className }: UsageBarProps) {
  const visible = segments.filter((segment) => segment.bytes > 0);
  const usedBytes = visible.reduce((sum, segment) => sum + segment.bytes, 0);
  const denominator = Math.max(totalBytes, usedBytes, 1);
  // The legend offers the same actions, so the bar's own buttons stay clickable but are not extra tab stops.
  const legendShown = legend && visible.length > 0;
  // Muted segments do not use up a category colour.
  const swatches: string[] = [];
  let colored = 0;
  for (const segment of visible) swatches.push(segment.muted ? MUTED_SWATCH : SWATCHES[colored++ % SWATCHES.length]!);
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        role="group"
        aria-label={label}
        className="flex h-2 w-full gap-px overflow-hidden rounded-control bg-surface-pressed"
      >
        {visible.map((segment, index) => {
          const classes = cn('h-full min-w-px', swatches[index]);
          const basis = { flexBasis: `${(segment.bytes / denominator) * 100}%` };
          return segment.onSelect ? (
            <button
              key={segment.id}
              type="button"
              aria-label={`${segment.label}, ${formatBytes(segment.bytes)}`}
              onClick={segment.onSelect}
              tabIndex={legendShown ? -1 : undefined}
              aria-hidden={legendShown || undefined}
              className={cn(classes, 'hover:brightness-90')}
              style={basis}
            />
          ) : (
            <div
              key={segment.id}
              role="img"
              aria-label={`${segment.label}, ${formatBytes(segment.bytes)}`}
              className={classes}
              style={basis}
            />
          );
        })}
      </div>
      {legendShown ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2">
          {visible.map((segment, index) => {
            const content = (
              <>
                <span className={cn('size-2 shrink-0 rounded-[2px]', swatches[index])} aria-hidden="true" />
                <span>{segment.label}</span>
                <span className="text-ink">{formatBytes(segment.bytes)}</span>
              </>
            );
            return (
              <li key={segment.id}>
                {segment.onSelect ? (
                  <button
                    type="button"
                    onClick={segment.onSelect}
                    className="flex items-center gap-1.5 rounded-control hover:text-ink"
                  >
                    {content}
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5">{content}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
