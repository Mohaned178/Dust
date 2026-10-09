import { create } from 'zustand';
import type { DustApi, ResultsCategoriesState, ResultsSummaryState } from '../../../src/shared/ipc';
import { emptyResource, loadResource } from '../lib/resource';
import type { Resource } from '../lib/resource';

/** The Clean up page's data: category totals and top contributors, never the full folder tree. */
interface ResultsStore {
  summaries: Record<string, Resource<ResultsSummaryState>>;
  /** Totals only, for screens that do not list items (Home). Keyed by lower-cased root. */
  categories: Record<string, Resource<ResultsCategoriesState>>;
  load: (api: DustApi, root: string, force?: boolean) => Promise<void>;
  loadCategories: (api: DustApi, root: string, force?: boolean) => Promise<void>;
}

const initial = () => ({ summaries: {}, categories: {} });

// loadResource tracks a running load per key object; each root needs its own, and it must outlive store writes.
const loadKeys = new Map<string, object>();
function loadKeyFor(name: string): object {
  let key = loadKeys.get(name);
  if (key === undefined) {
    key = {};
    loadKeys.set(name, key);
  }
  return key;
}

export const useResultsStore = create<ResultsStore>()((set, get) => ({
  ...initial(),
  load: (api, root, force = false) => {
    const key = root.toLowerCase();
    return loadResource(
      loadKeyFor(`summary:${key}`),
      {
        get: () => get().summaries[key] ?? emptyResource<ResultsSummaryState>(),
        set: (resource) => set((state) => ({ summaries: { ...state.summaries, [key]: resource } })),
      },
      () => api.getResultsSummary(root),
      { force },
    );
  },
  loadCategories: (api, root, force = false) => {
    const key = root.toLowerCase();
    return loadResource(
      loadKeyFor(`categories:${key}`),
      {
        get: () => get().categories[key] ?? emptyResource<ResultsCategoriesState>(),
        set: (resource) => set((state) => ({ categories: { ...state.categories, [key]: resource } })),
      },
      () => api.getResultCategories(root),
      { force },
    );
  },
}));

export function resetResultsStore(): void {
  useResultsStore.setState(initial());
  loadKeys.clear();
}
