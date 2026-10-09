import { create } from 'zustand';
import type { DustApi, SystemInfoLive, SystemInfoStatic } from '../../../src/shared/ipc';
import { emptyResource, loadResource } from '../lib/resource';
import type { Resource } from '../lib/resource';

interface HealthStore {
  info: Resource<SystemInfoStatic>;
  live: Resource<SystemInfoLive>;
  loadInfo: (api: DustApi, force?: boolean) => Promise<void>;
  /** Polled by the PC Health page while it is visible. */
  loadLive: (api: DustApi) => Promise<void>;
}

const infoKey = {};
const liveKey = {};

const initial = () => ({ info: emptyResource<SystemInfoStatic>(), live: emptyResource<SystemInfoLive>() });

export const useHealthStore = create<HealthStore>()((set, get) => ({
  ...initial(),
  loadInfo: (api, force = false) =>
    loadResource(
      infoKey,
      { get: () => get().info, set: (info) => set({ info }) },
      () => api.getSystemInfo(force),
      { force },
    ),
  loadLive: (api) =>
    loadResource(
      liveKey,
      { get: () => get().live, set: (live) => set({ live }) },
      () => api.getSystemInfoLive(),
    ),
}));

export function resetHealthStore(): void {
  useHealthStore.setState(initial());
}
