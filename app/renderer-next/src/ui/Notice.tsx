import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { InfoIcon, WarningIcon } from './icons';

export function Notice({
  variant = 'info',
  children,
  action,
  className,
}: {
  variant?: 'info' | 'warning';
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = variant === 'info' ? InfoIcon : WarningIcon;
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-3 rounded-overlay border px-3 py-2 text-body',
        variant === 'info' ? 'border-accent-border bg-accent-soft' : 'border-border bg-review-soft',
        className,
      )}
    >
      <Icon className={cn('size-5 shrink-0', variant === 'info' ? 'text-accent' : 'text-review')} aria-hidden="true" />
      <p className="min-w-0 flex-1">{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
