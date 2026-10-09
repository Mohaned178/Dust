import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { ErrorIcon, RefreshIcon } from './icons';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
      {icon ? <div className="text-ink-3 [&_svg]:size-8">{icon}</div> : null}
      <p className="text-body font-semibold">{title}</p>
      {description ? <p className="max-w-sm text-body text-ink-2">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Says what went wrong in plain words and always offers a retry. */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
      <ErrorIcon className="size-8 text-ink-3" aria-hidden="true" />
      <p className="text-body font-semibold">{title}</p>
      {description ? <p className="max-w-sm text-body text-ink-2">{description}</p> : null}
      <Button className="mt-2" icon={<RefreshIcon className="size-4" aria-hidden="true" />} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
