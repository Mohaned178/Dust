import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';

export const SKELETON_DELAY_MS = 150;

/**
 * A placeholder block. It reserves its space at once but only becomes visible
 * after 150 ms, so data that arrives instantly never flashes a loading state.
 */
export function Skeleton({ className, delay = SKELETON_DELAY_MS }: { className?: string; delay?: number }) {
  const [shown, setShown] = useState(delay <= 0);
  useEffect(() => {
    if (delay <= 0) return;
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return (
    <div
      aria-hidden="true"
      data-shown={shown}
      className={cn('rounded-control bg-surface-pressed', shown ? 'dust-pulse' : 'invisible', className)}
    />
  );
}
