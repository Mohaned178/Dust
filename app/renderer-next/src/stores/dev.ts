import { create } from 'zustand';
import type { DevCleanupState, DustApi } from '../../../src/shared/ipc';
import { emptyResource, loadResource } from '../lib/resource';
import type { Resource } from '../lib/resource';

interface DevStore {
  cleanup: Resource<DevCleanupState>;
  /** Project folders the user has ticked; it outlives the page being hidden. */
  selected: ReadonlySet<string>;
  load: (api: DustApi, root: string, force?: boolean) => Promise<void>;
  /** Ticks or unticks these projects. */
  setSelected: (paths: ReadonlyArray<string>, on: boolean) => void;
  /** Replaces the whole selection. */
  replaceSelection: (paths: ReadonlyArray<string>) => void;
  /** After a clean the old choices no longer describe what is on disk. */
  resetSelection: () => void;
}

// Identifies this store's load to loadResource.
const loadKey = {};

const initial = () => ({ cleanup: emptyResource<DevCleanupState>(), selected: new Set<string>() });

export const useDevStore = create<DevStore>()((set, get) => ({
  ...initial(),
  load: (api, root, force = false) =>
    loadResource(
      loadKey,
      { get: () => get().cleanup, set: (cleanup) => set({ cleanup }) },
      () => api.getDevCleanup(root),
      { force },
    ),
  setSelected: (paths, on) =>
    set((state) => {
      const next = new Set(state.selected);
      for (const path of paths) {
        if (on) next.add(path);
        else next.delete(path);
      }
      return { selected: next };
    }),
  replaceSelection: (paths) => set({ selected: new Set(paths) }),
  resetSelection: () => set({ selected: new Set() }),
}));

export function resetDevStore(): void {
  useDevStore.setState(initial());
}
