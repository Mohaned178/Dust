import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { formatBytes, formatRelativeTime } from '../lib/format';

/** A label above a tabular figure. */
export function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col', className)}>
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd className="text-subtitle font-semibold">{children}</dd>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-control border border-border-strong bg-surface px-1 text-caption text-ink-2">
      {children}
    </kbd>
  );
}

export function FileSize({ bytes, className }: { bytes: number | null | undefined; className?: string }) {
  return <span className={className}>{formatBytes(bytes)}</span>;
}

/** "5 minutes ago", with the exact date and time on hover. */
export function RelativeTime({ ms, className }: { ms: number | null; className?: string }) {
  if (ms === null) return <span className={className}>never</span>;
  const date = new Date(ms);
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} className={className}>
      {formatRelativeTime(ms)}
    </time>
  );
}
