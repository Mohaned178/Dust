import { create } from 'zustand';
import type { DustApi, StartupListResult, StartupListState } from '../../../src/shared/ipc';
import { emptyResource, loadResource } from '../lib/resource';
import type { Resource } from '../lib/resource';

export interface StartupDetail {
  publisher: string | null;
  iconDataUrl: string | null;
}

interface StartupStore {
  list: Resource<StartupListResult>;
  /** Publishers and icons that became known after the entries were listed. */
  details: ReadonlyMap<string, StartupDetail>;
  load: (api: DustApi, force?: boolean) => Promise<void>;
  /** Replaces the entries, e.g. with the state a toggle returned or the optimistic one before it. */
  setState: (state: StartupListState) => void;
  mergeDetails: (details: ReadonlyMap<string, StartupDetail>) => void;
}

// Identifies this store's load to loadResource.
const loadKey = {};

const initial = () => ({ list: emptyResource<StartupListResult>(), details: new Map<string, StartupDetail>() });

export const useStartupStore = create<StartupStore>()((set, get) => ({
  ...initial(),
  load: (api, force = false) =>
    loadResource(
      loadKey,
      { get: () => get().list, set: (list) => set({ list }) },
      async () => {
        const result = await api.getStartup();
        // A refused read is a failure, so the last good list stays on screen behind it.
        if (!result.ok) throw new Error(result.message);
        return result;
      },
      { force },
    ),
  setState: (state) =>
    set((current) => ({
      list: { ...current.list, data: { ok: true, state }, error: null, loadedAt: Date.now() },
    })),
  mergeDetails: (details) => set((state) => ({ details: new Map([...state.details, ...details]) })),
}));

export function resetStartupStore(): void {
  useStartupStore.setState(initial());
}
