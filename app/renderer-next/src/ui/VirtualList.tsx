import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface VirtualListProps<T> {
  items: ReadonlyArray<T>;
  /** Fixed row height in px. */
  rowHeight: number;
  /** A stable identity per item, so rows keep their state when the list changes. */
  getKey: (item: T, index: number) => string;
  /** Keep this callback stable (module level or useCallback) so unchanged rows are not re-rendered. */
  renderRow: (item: T, index: number) => ReactNode;
  /** Names the list for screen readers. */
  label: string;
  overscan?: number;
  className?: string;
}

interface RowProps<T> {
  item: T;
  index: number;
  top: number;
  height: number;
  count: number;
  renderRow: (item: T, index: number) => ReactNode;
}

function RowInner<T>({ item, index, top, height, count, renderRow }: RowProps<T>) {
  return (
    <div
      role="listitem"
      aria-setsize={count}
      aria-posinset={index + 1}
      className="absolute inset-x-0 top-0"
      style={{ height, transform: `translateY(${top}px)` }}
    >
      {renderRow(item, index)}
    </div>
  );
}

// A row re-renders only when its own item, position or renderer changes.
const Row = memo(RowInner) as typeof RowInner;

/** Renders only the rows in view. Fill a parent with a definite height. */
export function VirtualList<T>({
  items,
  rowHeight,
  getKey,
  renderRow,
  label,
  overscan = 8,
  className,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
    getItemKey: (index) => getKey(items[index]!, index),
  });
  return (
    <div ref={scrollRef} className={cn('h-full overflow-y-auto', className)}>
      <div role="list" aria-label={label} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <Row
            key={virtualItem.key}
            item={items[virtualItem.index]!}
            index={virtualItem.index}
            top={virtualItem.start}
            height={rowHeight}
            count={items.length}
            renderRow={renderRow}
          />
        ))}
      </div>
    </div>
  );
}
