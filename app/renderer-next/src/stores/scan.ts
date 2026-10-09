import { create } from 'zustand';
import type { CategorySummaryRow, ScanProgressPayload } from '../../../src/shared/ipc';

export type ScanOutcome = { type: 'finished'; status: 'complete' | 'cancelled' } | { type: 'failed'; message: string };

/** Everything one scan run has reported. The store is the record, so a screen that mounts late still sees all of it. */
export interface ScanRun {
  runId: string;
  root: string | null;
  startedAt: number | null;
  progress: ScanProgressPayload | null;
  categories: CategorySummaryRow[];
  finalizing: boolean;
  finalizeStep: string | null;
  outcome: ScanOutcome | null;
}

/** Only the current run matters; a couple are kept spare for ordering races. */
const KEPT_RUNS = 3;

interface ScanStore {
  runs: Record<string, ScanRun>;
  /** Insertion order of `runs`, oldest first. */
  order: string[];
  latestRunId: string | null;
  /** Progress of a quick clean, which has no run id. */
  quickProgress: ScanProgressPayload | null;
  /** Folds patches into the runs with a single store update. */
  applyPatches: (patches: ReadonlyMap<string, Partial<ScanRun>>, quickProgress?: ScanProgressPayload | null) => void;
}

function emptyRun(runId: string): ScanRun {
  return {
    runId,
    root: null,
    startedAt: null,
    progress: null,
    categories: [],
    finalizing: false,
    finalizeStep: null,
    outcome: null,
  };
}

const initial = () => ({ runs: {}, order: [], latestRunId: null, quickProgress: null });

export const useScanStore = create<ScanStore>()((set) => ({
  ...initial(),
  applyPatches: (patches, quickProgress) =>
    set((state) => {
      const runs = { ...state.runs };
      let order = state.order;
      let latestRunId = state.latestRunId;
      for (const [runId, patch] of patches) {
        if (runs[runId] === undefined) {
          order = [...order, runId];
          latestRunId = runId;
        }
        runs[runId] = { ...(runs[runId] ?? emptyRun(runId)), ...patch };
      }
      while (order.length > KEPT_RUNS) {
        const oldest = order[0];
        if (oldest === undefined) break;
        delete runs[oldest];
        order = order.slice(1);
      }
      return {
        runs,
        order,
        latestRunId,
        quickProgress: quickProgress === undefined ? state.quickProgress : quickProgress,
      };
    }),
}));

export function resetScanStore(): void {
  useScanStore.setState(initial());
}
