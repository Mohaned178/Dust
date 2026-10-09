import type { RemovalReport } from '@dust/core';
import { create } from 'zustand';
import type { DustApi, UninstallListResult } from '../../../src/shared/ipc';
import { emptyResource, loadResource } from '../lib/resource';
import type { Resource } from '../lib/resource';

/** What one uninstall job has reported so far. Folded from the event stream so a late screen can catch up. */
export interface UninstallJob {
  jobId: string;
  phases: Record<string, { status: 'started' | 'done' | 'failed' | 'skipped'; note?: string }>;
  uninstallerExitCode: number | null | undefined;
  rebootRequired: boolean;
  verifiedGone: boolean | null;
  itemsDone: number;
  bytesRemoved: number;
  outcome: { type: 'finished'; report: RemovalReport } | { type: 'failed'; message: string } | null;
}

export function emptyJob(jobId: string): UninstallJob {
  return {
    jobId,
    phases: {},
    uninstallerExitCode: undefined,
    rebootRequired: false,
    verifiedGone: null,
    itemsDone: 0,
    bytesRemoved: 0,
    outcome: null,
  };
}

const KEPT_JOBS = 3;

export interface AppsBatch {
  sizes: ReadonlyMap<string, number>;
  icons: ReadonlyMap<string, string>;
  jobs: ReadonlyMap<string, (job: UninstallJob) => UninstallJob>;
}

interface AppsStore {
  list: Resource<UninstallListResult>;
  /** Measured install sizes. A row subscribes to its own entry only: `useAppsStore((s) => s.sizes.get(id))`. */
  sizes: ReadonlyMap<string, number>;
  icons: ReadonlyMap<string, string>;
  jobs: Record<string, UninstallJob>;
  jobOrder: string[];
  load: (api: DustApi, force?: boolean) => Promise<void>;
  /** Merges sizes and icons with one new Map each, and folds job updates, in a single store update. */
  applyBatch: (batch: AppsBatch) => void;
}

// Identifies this store's load to loadResource.
const loadKey = {};

const initial = () => ({
  list: emptyResource<UninstallListResult>(),
  sizes: new Map<string, number>(),
  icons: new Map<string, string>(),
  jobs: {},
  jobOrder: [],
});

export const useAppsStore = create<AppsStore>()((set, get) => ({
  ...initial(),
  load: (api, force = false) =>
    loadResource(
      loadKey,
      { get: () => get().list, set: (list) => set({ list }) },
      () => api.listUninstallApps(force),
      { force },
    ),
  applyBatch: ({ sizes, icons, jobs }) =>
    set((state) => {
      const next: Partial<AppsStore> = {};
      if (sizes.size > 0) next.sizes = new Map([...state.sizes, ...sizes]);
      if (icons.size > 0) next.icons = new Map([...state.icons, ...icons]);
      if (jobs.size > 0) {
        const merged = { ...state.jobs };
        let order = state.jobOrder;
        for (const [jobId, update] of jobs) {
          if (merged[jobId] === undefined) order = [...order, jobId];
          merged[jobId] = update(merged[jobId] ?? emptyJob(jobId));
        }
        while (order.length > KEPT_JOBS) {
          const oldest = order[0];
          if (oldest === undefined) break;
          delete merged[oldest];
          order = order.slice(1);
        }
        next.jobs = merged;
        next.jobOrder = order;
      }
      return next;
    }),
}));

export function resetAppsStore(): void {
  useAppsStore.setState(initial());
}
