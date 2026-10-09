import type { CategoryId } from '@dust/core';
import { create } from 'zustand';
import type { StartupNotice, UninstallLaunchHint } from '../../../src/shared/ipc';

export type PageId = 'home' | 'cleanup' | 'apps' | 'startup' | 'health' | 'developer' | 'settings';

export type CleanupParams =
  | { view: 'results'; root: string; category?: CategoryId }
  | { view: 'scan'; root: string; runId: string; usedBytes: number | null }
  | { view: 'explore'; root: string };

/** What a page may be opened with. A page without an entry takes no parameters. */
export interface PageParams {
  home: undefined;
  cleanup: CleanupParams;
  apps: { hint: UninstallLaunchHint };
  startup: { notice: StartupNotice | null };
  health: undefined;
  developer: { root: string };
  settings: undefined;
}

/** The page on screen plus this many hidden ones stay mounted; the least recently used is dropped first. */
export const MAX_HIDDEN_PAGES = 4;

/** Most recent first, capped at the visible page plus the hidden ones. */
export function touchVisited(visited: readonly PageId[], page: PageId): PageId[] {
  return [page, ...visited.filter((id) => id !== page)].slice(0, MAX_HIDDEN_PAGES + 1);
}

interface NavStore {
  page: PageId;
  /** Parameters last given to each page. Kept when the page is left, so returning shows the same view. */
  params: { [P in PageId]?: PageParams[P] };
  visited: PageId[];
  /** The page whose heading should take keyboard focus once it is on screen. */
  focusTarget: PageId | null;
  navigate: <P extends PageId>(page: P, params?: PageParams[P]) => void;
  /** Forget a page's parameters once it has used them (a launch hint, say). */
  clearParams: (page: PageId) => void;
  clearFocusTarget: (page: PageId) => void;
}

const initial = (): Pick<NavStore, 'page' | 'params' | 'visited' | 'focusTarget'> => ({
  page: 'home',
  params: {},
  visited: ['home'],
  focusTarget: null,
});

export const useNavStore = create<NavStore>()((set, get) => ({
  ...initial(),
  navigate: (page, params) => {
    const state = get();
    const paramsChanged = params !== undefined;
    if (state.page === page && !paramsChanged) return;
    set({
      page,
      params: paramsChanged ? { ...state.params, [page]: params } : state.params,
      visited: touchVisited(state.visited, page),
      focusTarget: state.page === page ? state.focusTarget : page,
    });
  },
  clearParams: (page) =>
    set((state) => {
      if (state.params[page] === undefined) return state;
      const { [page]: _dropped, ...rest } = state.params;
      return { params: rest };
    }),
  clearFocusTarget: (page) => set((state) => (state.focusTarget === page ? { focusTarget: null } : state)),
}));

export function resetNavStore(): void {
  useNavStore.setState(initial());
}
