import { Progress } from 'radix-ui';
import { cn } from '../lib/cn';

export interface ProgressBarProps {
  /** 0 to 1. Omit for an indeterminate bar. */
  value?: number | null;
  /** Spoken to screen readers, e.g. "Scanning 45%". */
  label: string;
  className?: string;
}

export function ProgressBar({ value = null, label, className }: ProgressBarProps) {
  const determinate = value !== null && Number.isFinite(value);
  const fraction = determinate ? Math.min(Math.max(value, 0), 1) : 0;
  return (
    <Progress.Root
      value={determinate ? Math.round(fraction * 100) : null}
      max={100}
      aria-label={label}
      getValueLabel={(percent) => `${label} ${percent}%`}
      className={cn('relative h-1 w-full overflow-hidden rounded-control bg-surface-pressed', className)}
    >
      {determinate ? (
        <Progress.Indicator
          className="h-full w-full origin-left rounded-control bg-accent"
          style={{ transform: `scaleX(${fraction})` }}
        />
      ) : (
        <Progress.Indicator className="dust-indeterminate h-full w-2/5 rounded-control bg-accent" />
      )}
    </Progress.Root>
  );
}
