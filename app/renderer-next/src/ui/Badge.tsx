import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { DismissIcon } from './icons';

export type Grade = 'safe' | 'review' | 'protected';

const GRADES: Record<Grade, { word: string; pill: string; dot: string }> = {
  safe: { word: 'Safe', pill: 'bg-safe-soft text-safe', dot: 'bg-safe' },
  review: { word: 'Review', pill: 'bg-review-soft text-review', dot: 'bg-review' },
  protected: { word: 'Protected', pill: 'bg-danger-soft text-danger', dot: 'bg-danger' },
};

/** A grade is always a word plus a dot, never color alone. */
export function GradePill({ grade, className }: { grade: Grade; className?: string }) {
  const spec = GRADES[grade];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-semibold',
        spec.pill,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', spec.dot)} aria-hidden="true" />
      {spec.word}
    </span>
  );
}

export type BadgeTone = 'neutral' | 'accent';

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold',
        tone === 'accent' ? 'bg-accent-soft text-accent-hover' : 'bg-surface-pressed text-ink-2',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small outlined chip for facts such as "Registry" or "Re-downloaded when needed". */
export function Tag({
  children,
  onRemove,
  removeLabel,
  className,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-control border border-border bg-surface px-2 py-0.5 text-caption text-ink-2',
        className,
      )}
    >
      {children}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel ?? 'Remove'}
          onClick={onRemove}
          className="dur-faster -mr-1 flex size-4 items-center justify-center rounded-control hover:bg-surface-hover"
        >
          <DismissIcon className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
