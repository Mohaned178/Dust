import type { ReactNode } from 'react';
import { Skeleton } from '../../ui/Skeleton';

/** A summary tile that opens its page. It shows a skeleton until its own data arrives. */
export function Tile({
  title,
  loading,
  figure,
  detail,
  onOpen,
}: {
  title: string;
  loading: boolean;
  figure: ReactNode;
  detail: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="dur-faster flex min-h-28 flex-col items-start gap-1 rounded-overlay border border-border bg-surface p-4 text-left shadow-card hover:border-border-strong hover:bg-surface-hover active:bg-surface-pressed"
    >
      <span className="text-caption text-ink-2">{title}</span>
      {loading ? (
        <>
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-4 w-32" />
        </>
      ) : (
        <>
          <span className="text-subtitle font-semibold">{figure}</span>
          <span className="text-body text-ink-2">{detail}</span>
        </>
      )}
    </button>
  );
}
