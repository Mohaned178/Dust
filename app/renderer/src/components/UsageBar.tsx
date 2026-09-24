import { formatBytes } from '../format';

export interface UsageBarProps {
  usedBytes: number | null;
  totalBytes: number | null;
  label?: string;
  size?: 'md' | 'lg';
}

export function UsageBar({ usedBytes, totalBytes, label = 'Disk usage', size = 'md' }: UsageBarProps) {
  const percent =
    usedBytes !== null && totalBytes !== null && totalBytes > 0
      ? Math.min(Math.max((usedBytes / totalBytes) * 100, 0), 100)
      : 0;
  const valueText =
    usedBytes !== null && totalBytes !== null
      ? `${formatBytes(usedBytes)} of ${formatBytes(totalBytes)} used`
      : 'Usage unavailable';

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={valueText}
      className={`w-full overflow-hidden rounded-full bg-track ${size === 'lg' ? 'h-2.5' : 'h-2'}`}
    >
      <div className="dust-bar-fill h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
    </div>
  );
}
