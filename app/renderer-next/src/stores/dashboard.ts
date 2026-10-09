import { create } from 'zustand';
import type { DashboardState, DustApi } from '../../../src/shared/ipc';
import { emptyResource, loadResource } from '../lib/resource';
import type { Resource } from '../lib/resource';

interface DashboardStore {
  dashboard: Resource<DashboardState>;
  load: (api: DustApi, force?: boolean) => Promise<void>;
}

// Identifies this store's load to loadResource.
const loadKey = {};

const initial = () => ({ dashboard: emptyResource<DashboardState>() });

export const useDashboardStore = create<DashboardStore>()((set, get) => ({
  ...initial(),
  load: (api, force = false) =>
    loadResource(
      loadKey,
      { get: () => get().dashboard, set: (dashboard) => set({ dashboard }) },
      () => api.getDashboard(),
      { force },
    ),
}));

export function resetDashboardStore(): void {
  useDashboardStore.setState(initial());
}
