export interface MockVirtualItem {
  index: number;
  key: string | number;
  start: number;
  size: number;
  end: number;
  lane: number;
}

export function useVirtualizer(options: { count: number; estimateSize: (index: number) => number }) {
  const items: MockVirtualItem[] = [];
  let start = 0;
  for (let index = 0; index < options.count; index += 1) {
    const size = options.estimateSize(index);
    items.push({ index, key: index, start, size, end: start + size, lane: 0 });
    start += size;
  }
  return {
    getTotalSize: () => start,
    getVirtualItems: () => items,
    measureElement: () => {},
  };
}
