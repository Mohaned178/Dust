import { create } from 'zustand';
import type { DustApi, StartupListResult } from '../../../src/shared/ipc';
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
  load: (api: DustApi) => Promise<void>;
  mergeDetails: (details: ReadonlyMap<string, StartupDetail>) => void;
}

// Identifies this store's load to loadResource.
const loadKey = {};

const initial = () => ({ list: emptyResource<StartupListResult>(), details: new Map<string, StartupDetail>() });

export const useStartupStore = create<StartupStore>()((set, get) => ({
  ...initial(),
  load: (api) =>
    loadResource(loadKey, { get: () => get().list, set: (list) => set({ list }) }, () => api.getStartup()),
  mergeDetails: (details) => set((state) => ({ details: new Map([...state.details, ...details]) })),
}));

export function resetStartupStore(): void {
  useStartupStore.setState(initial());
}
