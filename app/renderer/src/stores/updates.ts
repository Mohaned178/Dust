import { create } from 'zustand';
import type { UpdateStatus } from '../../../src/shared/ipc';

interface UpdatesStore {
  status: UpdateStatus;
  setStatus: (status: UpdateStatus) => void;
}

const initial = (): { status: UpdateStatus } => ({
  status: { phase: 'idle', version: null, percent: null, message: null },
});

export const useUpdatesStore = create<UpdatesStore>()((set) => ({
  ...initial(),
  setStatus: (status) => set({ status }),
}));

export function resetUpdatesStore(): void {
  useUpdatesStore.setState(initial());
}
