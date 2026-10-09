import { create } from 'zustand';
import { EMPTY_SELECTION } from '../lib/selection';
import type { Selection } from '../lib/selection';

/** What the user has ticked, kept and opened on the Clean up page. It outlives the page being hidden. */
interface CleanupStore {
  selection: Selection;
  /** Categories open in place, so Home's category links and the user's own choice survive a refresh. */
  expanded: ReadonlySet<string>;
  setSelection: (update: (current: Selection) => Selection) => void;
  toggleExpanded: (category: string, open?: boolean) => void;
  /** After a clean or a new scan: the old choices no longer describe what is on disk. */
  resetSelection: () => void;
}

const initial = () => ({ selection: EMPTY_SELECTION, expanded: new Set<string>() });

export const useCleanupStore = create<CleanupStore>()((set) => ({
  ...initial(),
  setSelection: (update) => set((state) => ({ selection: update(state.selection) })),
  toggleExpanded: (category, open) =>
    set((state) => {
      const next = new Set(state.expanded);
      const shouldOpen = open ?? !next.has(category);
      if (shouldOpen) next.add(category);
      else next.delete(category);
      return { expanded: next };
    }),
  resetSelection: () => set({ selection: EMPTY_SELECTION }),
}));

export function resetCleanupStore(): void {
  useCleanupStore.setState(initial());
}
