import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import type { VirtualListHandle } from '../../ui/VirtualList';

const PAGE_STEP = 10;

/**
 * Roving focus for a virtualized list: one row is the tab stop, and arrow keys move it. A row that is not in the
 * page cannot take focus, so moving scrolls it into view first and focuses it once it has been drawn.
 */
export function useRoving<T>(
  items: ReadonlyArray<T>,
  getKey: (item: T) => string,
  list: RefObject<VirtualListHandle | null>,
) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pendingKey = useRef<string | null>(null);

  const activeIndex = useMemo(() => {
    if (activeKey === null) return 0;
    const index = items.findIndex((item) => getKey(item) === activeKey);
    return index < 0 ? 0 : index;
  }, [activeKey, items, getKey]);
  const tabStopKey = items[activeIndex] === undefined ? null : getKey(items[activeIndex]!);

  const moveTo = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), items.length - 1);
      const item = items[clamped];
      if (item === undefined) return;
      const key = getKey(item);
      setActiveKey(key);
      pendingKey.current = key;
      list.current?.scrollToIndex(clamped);
    },
    [items, getKey, list],
  );

  // Runs after every draw: once the wanted row exists in the page, focus it.
  useEffect(() => {
    const wanted = pendingKey.current;
    if (wanted === null || container.current === null) return;
    const rows = container.current.querySelectorAll<HTMLElement>('[data-key]');
    for (const row of rows) {
      if (row.getAttribute('data-key') === wanted) {
        pendingKey.current = null;
        row.focus({ preventScroll: true });
        return;
      }
    }
  });

  /** Handles the movement keys. `extra` gets first refusal and returns true when it used the key. */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, extra?: (index: number) => boolean) => {
      // Keys inside a button on the row belong to the button.
      if (!(event.target instanceof HTMLElement) || event.target.getAttribute('data-key') === null) return;
      if (extra?.(activeIndex)) {
        event.preventDefault();
        return;
      }
      const targets: Record<string, number> = {
        ArrowDown: activeIndex + 1,
        ArrowUp: activeIndex - 1,
        PageDown: activeIndex + PAGE_STEP,
        PageUp: activeIndex - PAGE_STEP,
        Home: 0,
        End: items.length - 1,
      };
      const target = targets[event.key];
      if (target === undefined) return;
      event.preventDefault();
      moveTo(target);
    },
    [activeIndex, items.length, moveTo],
  );

  return { containerRef: container, tabStopKey, activeIndex, setActiveKey, moveTo, onKeyDown };
}
