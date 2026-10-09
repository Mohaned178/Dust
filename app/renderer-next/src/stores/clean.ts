import { create } from 'zustand';
import type { CleanItemResult } from '../../../src/shared/ipc';

/** The per-item results of one clean as they arrive, kept for the progress and summary screens. */
export interface CleanRun {
  cleanId: string;
  root: string | null;
  items: CleanItemResult[];
  done: boolean;
}

const KEPT_RUNS = 3;

interface CleanStore {
  runs: Record<string, CleanRun>;
  order: string[];
  /** Appends items and marks finished cleans (clean id to root) with a single store update. */
  applyBatch: (items: ReadonlyMap<string, CleanItemResult[]>, finished: ReadonlyMap<string, string>) => void;
}

const initial = () => ({ runs: {}, order: [] });

export const useCleanStore = create<CleanStore>()((set) => ({
  ...initial(),
  applyBatch: (items, finished) =>
    set((state) => {
      const runs = { ...state.runs };
      let order = state.order;
      const touch = (cleanId: string): CleanRun => {
        const existing = runs[cleanId];
        if (existing !== undefined) return existing;
        order = [...order, cleanId];
        return { cleanId, root: null, items: [], done: false };
      };
      for (const [cleanId, added] of items) {
        const run = touch(cleanId);
        runs[cleanId] = { ...run, items: [...run.items, ...added] };
      }
      for (const [cleanId, root] of finished) {
        runs[cleanId] = { ...touch(cleanId), root, done: true };
      }
      while (order.length > KEPT_RUNS) {
        const oldest = order[0];
        if (oldest === undefined) break;
        delete runs[oldest];
        order = order.slice(1);
      }
      return { runs, order };
    }),
}));

export function resetCleanStore(): void {
  useCleanStore.setState(initial());
}
