import { create } from 'zustand';
import type { DevCleanupState, DustApi } from '../../../src/shared/ipc';
import { emptyResource, loadResource } from '../lib/resource';
import type { Resource } from '../lib/resource';

interface DevStore {
  cleanup: Resource<DevCleanupState>;
  load: (api: DustApi, root: string, force?: boolean) => Promise<void>;
}

// Identifies this store's load to loadResource.
const loadKey = {};

const initial = () => ({ cleanup: emptyResource<DevCleanupState>() });

export const useDevStore = create<DevStore>()((set, get) => ({
  ...initial(),
  load: (api, root, force = false) =>
    loadResource(
      loadKey,
      { get: () => get().cleanup, set: (cleanup) => set({ cleanup }) },
      () => api.getDevCleanup(root),
      { force },
    ),
}));

export function resetDevStore(): void {
  useDevStore.setState(initial());
}
