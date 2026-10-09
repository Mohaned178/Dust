import { create } from 'zustand';
import type { DustApi, ResultRow } from '../../../src/shared/ipc';
import { PAGE_SIZE, ROOT_KEY, folderKey } from '../lib/explore';
import type { Crumb, FolderNode } from '../lib/explore';

export type ExploreTab = 'folders' | 'map';

interface ExploreStore {
  /** Which scan the cached folders belong to ("root|finishedAt"); a different scan drops them. */
  scanKey: string | null;
  nodes: Record<string, FolderNode | undefined>;
  expanded: ReadonlySet<string>;
  showProtected: boolean;
  tab: ExploreTab;
  /** The folders drilled into on the map, drive root first. */
  mapStack: Crumb[];
  /** Starts a fresh tree when the scan changed. Returns true when it did. */
  syncScan: (scanKey: string, rootName: string) => boolean;
  loadFolder: (api: DustApi, root: string, path: string, more?: boolean) => Promise<void>;
  toggle: (api: DustApi, root: string, row: ResultRow) => void;
  collapse: (row: ResultRow) => void;
  setShowProtected: (value: boolean) => void;
  setTab: (tab: ExploreTab) => void;
  drillTo: (api: DustApi, root: string, crumb: Crumb) => void;
  /** Back to the crumb at `index`. */
  popTo: (index: number) => void;
  showOnMap: (api: DustApi, root: string, row: ResultRow) => void;
  reset: () => void;
}

// A load that finishes after the tree was reset or protected items were switched must not write into the new tree.
let generation = 0;

const initial = () => ({
  scanKey: null as string | null,
  nodes: {} as Record<string, FolderNode | undefined>,
  expanded: new Set<string>(),
  showProtected: false,
  tab: 'folders' as ExploreTab,
  mapStack: [] as Crumb[],
});

export const useExploreStore = create<ExploreStore>()((set, get) => ({
  ...initial(),
  syncScan: (scanKey, rootName) => {
    if (get().scanKey === scanKey) return false;
    generation += 1;
    const { showProtected, tab } = get();
    set({ ...initial(), scanKey, showProtected, tab, mapStack: [{ path: '', name: rootName, bytes: null }] });
    return true;
  },
  loadFolder: async (api, root, path, more = false) => {
    const key = path === '' ? ROOT_KEY : folderKey(path);
    const current = get().nodes[key];
    if (current?.status === 'loading') return;
    if (current !== undefined && current.status === 'ready' && !more) return;
    const rows = more ? (current?.rows ?? []) : [];
    const total = current?.total ?? 0;
    const started = generation;
    set((state) => ({ nodes: { ...state.nodes, [key]: { rows, total, status: 'loading' } } }));
    try {
      const result = await api.getFolderChildren(root, path, {
        limit: PAGE_SIZE,
        offset: rows.length,
        sort: 'size',
        hideDanger: !get().showProtected,
      });
      if (started !== generation) return;
      set((state) => ({
        nodes: { ...state.nodes, [key]: { rows: [...rows, ...result.rows], total: result.total, status: 'ready' } },
      }));
    } catch {
      if (started !== generation) return;
      set((state) => ({ nodes: { ...state.nodes, [key]: { rows, total, status: 'error' } } }));
    }
  },
  toggle: (api, root, row) => {
    const key = folderKey(row.path);
    const open = get().expanded.has(key);
    set((state) => {
      const expanded = new Set(state.expanded);
      if (open) expanded.delete(key);
      else expanded.add(key);
      return { expanded };
    });
    // A folder that failed to load is tried again each time it is opened.
    if (!open) void get().loadFolder(api, root, row.path);
  },
  collapse: (row) =>
    set((state) => {
      const key = folderKey(row.path);
      if (!state.expanded.has(key)) return state;
      const expanded = new Set(state.expanded);
      expanded.delete(key);
      return { expanded };
    }),
  setShowProtected: (value) => {
    if (get().showProtected === value) return;
    generation += 1;
    // Folders already loaded were filtered the old way; start again from the drive root.
    set((state) => ({
      showProtected: value,
      nodes: {},
      expanded: new Set(),
      mapStack: state.mapStack.slice(0, 1),
    }));
  },
  setTab: (tab) => set({ tab }),
  drillTo: (api, root, crumb) => {
    set((state) => ({ mapStack: [...state.mapStack, crumb] }));
    void get().loadFolder(api, root, crumb.path);
  },
  popTo: (index) => set((state) => ({ mapStack: state.mapStack.slice(0, index + 1) })),
  showOnMap: (api, root, row) => {
    const rootCrumb = get().mapStack[0] ?? { path: '', name: root, bytes: null };
    const crumbs: Crumb[] = [rootCrumb];
    // The folders on the way are rebuilt from the path, so jumping from deep in the tree still gives a way back out.
    const parts = row.path
      .slice(root.length)
      .split(/[\\/]+/)
      .filter(Boolean);
    let prefix = row.path.slice(0, root.length).replace(/[\\/]+$/, '');
    parts.forEach((part, index) => {
      prefix = `${prefix}\\${part}`;
      const last = index === parts.length - 1;
      crumbs.push({ path: prefix, name: part, bytes: last ? row.bytes : null });
    });
    set({ mapStack: crumbs, tab: 'map' });
    void get().loadFolder(api, root, row.path);
  },
  reset: () => {
    generation += 1;
    const { showProtected, tab, mapStack } = get();
    set({ ...initial(), showProtected, tab, mapStack: mapStack.slice(0, 1) });
  },
}));

export function resetExploreStore(): void {
  generation += 1;
  useExploreStore.setState(initial());
}
