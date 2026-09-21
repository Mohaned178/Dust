export interface UsageBarProps {
  usedBytes: number | null;
  totalBytes: number | null;
}

export function UsageBar({ usedBytes, totalBytes }: UsageBarProps) {
  const percent =
    usedBytes !== null && totalBytes !== null && totalBytes > 0
      ? Math.min(Math.max((usedBytes / totalBytes) * 100, 0), 100)
      : 0;
  return (
    <div
      role="progressbar"
      aria-label="Disk usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-2 w-full overflow-hidden rounded-full bg-neutral-800"
    >
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
    </div>
  );
}
