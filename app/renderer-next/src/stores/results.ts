import { create } from 'zustand';
import type { DustApi, ResultsSummaryState } from '../../../src/shared/ipc';
import { emptyResource, loadResource } from '../lib/resource';
import type { Resource } from '../lib/resource';

/** The Clean up page's data: category totals and top contributors, never the full folder tree. */
interface ResultsStore {
  summaries: Record<string, Resource<ResultsSummaryState>>;
  load: (api: DustApi, root: string, force?: boolean) => Promise<void>;
}

const initial = () => ({ summaries: {} });

// loadResource tracks a running load per key object; each root needs its own, and it must outlive store writes.
const loadKeys = new Map<string, object>();
function loadKeyFor(root: string): object {
  let key = loadKeys.get(root);
  if (key === undefined) {
    key = {};
    loadKeys.set(root, key);
  }
  return key;
}

export const useResultsStore = create<ResultsStore>()((set, get) => ({
  ...initial(),
  load: (api, root, force = false) => {
    const key = root.toLowerCase();
    return loadResource(
      loadKeyFor(key),
      {
        get: () => get().summaries[key] ?? emptyResource<ResultsSummaryState>(),
        set: (resource) => set((state) => ({ summaries: { ...state.summaries, [key]: resource } })),
      },
      () => api.getResultsSummary(root),
      { force },
    );
  },
}));

export function resetResultsStore(): void {
  useResultsStore.setState(initial());
  loadKeys.clear();
}
