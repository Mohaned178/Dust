import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useImperativeHandle, useRef } from 'react';
import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../lib/cn';

export interface VirtualListHandle {
  /** Scrolls so the row is on screen. Rows outside the window do not exist in the page until this has run. */
  scrollToIndex: (index: number) => void;
}

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
  /** `tree` gives the list tree semantics; `itemProps` then carries each row's level, state and focus. */
  semantics?: 'list' | 'tree';
  /** Extra attributes for a row's wrapper, e.g. `aria-level`, `aria-expanded`, `tabIndex`. */
  itemProps?: (item: T, index: number) => HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
  /** Called for key presses inside the list, for roving focus. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  ref?: Ref<VirtualListHandle>;
}

interface RowProps<T> {
  item: T;
  index: number;
  top: number;
  height: number;
  count: number;
  renderRow: (item: T, index: number) => ReactNode;
  role: 'listitem' | 'treeitem';
  extra?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
}

function RowInner<T>({ item, index, top, height, count, renderRow, role, extra }: RowProps<T>) {
  return (
    <div
      role={role}
      aria-setsize={count}
      aria-posinset={index + 1}
      {...extra}
      className="absolute inset-x-0 top-0 outline-none"
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
  semantics = 'list',
  itemProps,
  onKeyDown,
  ref,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
    getItemKey: (index) => getKey(items[index]!, index),
  });
  useImperativeHandle(ref, () => ({ scrollToIndex: (index) => virtualizer.scrollToIndex(index) }), [virtualizer]);
  const tree = semantics === 'tree';
  return (
    <div ref={scrollRef} className={cn('h-full overflow-y-auto', className)} onKeyDown={onKeyDown}>
      <div
        role={tree ? 'tree' : 'list'}
        aria-label={label}
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <Row
            key={virtualItem.key}
            item={items[virtualItem.index]!}
            index={virtualItem.index}
            top={virtualItem.start}
            height={rowHeight}
            count={items.length}
            renderRow={renderRow}
            role={tree ? 'treeitem' : 'listitem'}
            extra={itemProps?.(items[virtualItem.index]!, virtualItem.index)}
          />
        ))}
      </div>
    </div>
  );
}
