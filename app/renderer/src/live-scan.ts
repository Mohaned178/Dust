import { useEffect, useSyncExternalStore } from 'react';
import type { CategoryId, DisplayGrade } from '@dust/core';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../src/shared/categories';
import type { BrowseRow, CategorySummaryRow, DustApi, ResultMatch, ResultRow, ScanEvent } from '../../src/shared/ipc';
import { createBrowseStore, upsertBrowseRows } from './browse-tree';
import type { BrowseStore } from './browse-tree';
import { createRowStore, mergeMatches, pathKey, pathName, upsertRows } from './tree';
import type { RowStore } from './tree';

export const LIVE_FLUSH_MS = 500;
export const TRAY_CAP = 8;

export type LiveMode = 'analyze' | 'browse';
export type LivePhase = 'scanning' | 'finalizing' | 'done' | 'failed';

export interface LiveFinished {
  status: 'complete' | 'cancelled';
  finishedAt: number;
  filesScanned: number;
  bytesSeen: number;
  errors: number;
  reclaimableBytes: number | null;
}

export interface TrayContributor {
  path: string;
  name: string;
  bytes: number;
  grade: DisplayGrade;
  category: CategoryId;
}

export interface LiveScanHandle {
  store: RowStore;
  browseStore: BrowseStore;
  matches: ReadonlyMap<string, ResultMatch>;
  folders: ReadonlyMap<string, BrowseRow>;
  categories: CategorySummaryRow[];
  categoriesVersion: number;
  version: number;
  phase: LivePhase;
  finished: LiveFinished | null;
  failedMessage: string | null;
}

interface LiveScan {
  api: DustApi;
  root: string;
  runId: string;
  mode: LiveMode;
  phase: LivePhase;
  rowStore: RowStore;
  browseStore: BrowseStore;
  matches: Map<string, ResultMatch>;
  folders: Map<string, BrowseRow>;
  categories: CategorySummaryRow[];
  categoriesVersion: number;
  finished: LiveFinished | null;
  failedMessage: string | null;
  version: number;
  pendingRows: ResultRow[];
  pendingMatches: ResultMatch[];
  pendingBrowse: BrowseRow[];
  timer: ReturnType<typeof setTimeout> | null;
  unsubscribe: (() => void) | null;
  consumers: number;
}

let active: LiveScan | null = null;
let globalVersion = 0;
const listeners = new Set<() => void>();
let disposeTimer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  globalVersion += 1;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): number {
  return globalVersion;
}

export function emptyCategories(): CategorySummaryRow[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    bytes: 0,
    items: 0,
    ruleIds: [],
  }));
}

function createLiveScan(api: DustApi, root: string, runId: string, mode: LiveMode): LiveScan {
  return {
    api,
    root,
    runId,
    mode,
    phase: 'scanning',
    rowStore: createRowStore(root),
    browseStore: createBrowseStore(root),
    matches: new Map(),
    folders: new Map(),
    categories: emptyCategories(),
    categoriesVersion: 0,
    finished: null,
    failedMessage: null,
    version: 0,
    pendingRows: [],
    pendingMatches: [],
    pendingBrowse: [],
    timer: null,
    unsubscribe: null,
    consumers: 0,
  };
}

function ensureLiveScan(api: DustApi, root: string, runId: string, mode: LiveMode): void {
  if (active !== null && active.runId === runId) {
    active.root = root;
    active.mode = mode;
    return;
  }
  resetLiveScan();
  const store = createLiveScan(api, root, runId, mode);
  store.unsubscribe = api.onScanEvent((event) => ingestScanEvent(event));
  active = store;
}

export function resetLiveScan(): void {
  if (active !== null && active.timer !== null) clearTimeout(active.timer);
  if (active !== null && active.unsubscribe !== null) active.unsubscribe();
  if (disposeTimer !== null) {
    clearTimeout(disposeTimer);
    disposeTimer = null;
  }
  active = null;
}

function retainLiveScan(runId: string): void {
  if (active !== null && active.runId === runId) active.consumers += 1;
}

function releaseLiveScan(runId: string): void {
  if (active === null || active.runId !== runId) return;
  active.consumers = Math.max(active.consumers - 1, 0);
  if (active.consumers > 0) return;
  const store = active;
  if (disposeTimer !== null) clearTimeout(disposeTimer);
  disposeTimer = setTimeout(() => {
    disposeTimer = null;
    if (active === store && store.consumers <= 0) resetLiveScan();
  }, 0);
}

function scheduleFlush(store: LiveScan): void {
  if (store.timer !== null) return;
  store.timer = setTimeout(() => {
    store.timer = null;
    flushNow(store);
  }, LIVE_FLUSH_MS);
}

function flushNow(store: LiveScan): void {
  if (store.timer !== null) {
    clearTimeout(store.timer);
    store.timer = null;
  }

  let changed = false;
  if (store.pendingRows.length > 0) {
    upsertRows(store.rowStore, store.pendingRows);
    store.pendingRows = [];
    changed = true;
  }
  if (store.pendingBrowse.length > 0) {
    upsertBrowseRows(store.browseStore, store.pendingBrowse);
    for (const row of store.pendingBrowse) store.folders.set(pathKey(row.path), row);
    store.pendingBrowse = [];
    changed = true;
  }
  if (store.pendingMatches.length > 0) {
    const deferred: ResultMatch[] = [];
    let applied = false;
    for (const match of store.pendingMatches) {
      const key = pathKey(match.path);
      store.matches.set(key, match);
      if (store.rowStore.nodes.has(key)) {
        mergeMatches(store.rowStore, [match]);
        applied = true;
      } else {
        deferred.push(match);
      }
    }
    store.pendingMatches = deferred;
    changed = true;
    if (applied) scheduleFlush(store);
  }

  if (!changed) return;
  store.version += 1;
  emit();
}

export function flushLiveScan(): void {
  if (active !== null) flushNow(active);
}

export function ingestScanEvent(event: ScanEvent): void {
  const store = active;
  if (store === null) return;
  if (!('runId' in event) || event.runId !== store.runId) return;

  switch (event.type) {
    case 'folders':
      if (event.folders.length === 0) break;
      for (const folder of event.folders) store.pendingRows.push(folder);
      scheduleFlush(store);
      break;
    case 'browse-folders':
      if (event.folders.length === 0) break;
      for (const folder of event.folders) store.pendingBrowse.push(folder);
      scheduleFlush(store);
      break;
    case 'matches':
      if (event.matches.length === 0) break;
      for (const match of event.matches) store.pendingMatches.push(match);
      scheduleFlush(store);
      break;
    case 'categories':
      store.categories = event.categories;
      store.categoriesVersion += 1;
      emit();
      break;
    case 'finalizing':
      flushNow(store);
      store.phase = 'finalizing';
      emit();
      break;
    case 'finished':
      flushNow(store);
      store.phase = 'done';
      store.finished = {
        status: event.status,
        finishedAt: event.finishedAt,
        filesScanned: event.filesScanned,
        bytesSeen: event.bytesSeen,
        errors: event.errors,
        reclaimableBytes: event.reclaimableBytes,
      };
      emit();
      break;
    case 'browse-finished':
      flushNow(store);
      store.phase = 'done';
      store.finished = {
        status: event.status,
        finishedAt: event.finishedAt,
        filesScanned: event.filesScanned,
        bytesSeen: event.bytesSeen,
        errors: event.errors,
        reclaimableBytes: null,
      };
      emit();
      break;
    case 'failed':
      flushNow(store);
      store.phase = 'failed';
      store.failedMessage = event.message;
      emit();
      break;
    default:
      break;
  }
}

export function selectContributorRows(
  matches: ReadonlyMap<string, ResultMatch>,
  category: CategoryId | null,
  limit = TRAY_CAP,
): { rows: TrayContributor[]; total: number } {
  const all: TrayContributor[] = [];
  for (const match of matches.values()) {
    if (category !== null && match.category !== category) continue;
    all.push({
      path: match.path,
      name: pathName(match.path),
      bytes: match.bytes,
      grade: match.grade,
      category: match.category,
    });
  }
  all.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { rows: all.slice(0, limit), total: all.length };
}

export function selectSafeTotals(matches: ReadonlyMap<string, ResultMatch>): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const match of matches.values()) {
    if (match.grade === 'safe') {
      count += 1;
      bytes += match.bytes;
    }
  }
  return { count, bytes };
}

export function selectFolderRows(
  folders: ReadonlyMap<string, BrowseRow>,
  root: string,
  limit = TRAY_CAP,
): { rows: BrowseRow[]; total: number; bytes: number } {
  const rootKey = pathKey(root);
  const all: BrowseRow[] = [];
  let bytes = 0;
  for (const row of folders.values()) {
    if (pathKey(row.path) === rootKey) {
      bytes = row.bytes;
      continue;
    }
    all.push(row);
  }
  all.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { rows: all.slice(0, limit), total: all.length, bytes };
}

const EMPTY_ROWS = createRowStore('');
const EMPTY_BROWSE = createBrowseStore('');
const EMPTY_HANDLE: LiveScanHandle = {
  store: EMPTY_ROWS,
  browseStore: EMPTY_BROWSE,
  matches: new Map(),
  folders: new Map(),
  categories: emptyCategories(),
  categoriesVersion: 0,
  version: 0,
  phase: 'scanning',
  finished: null,
  failedMessage: null,
};

export function useLiveScan(api: DustApi, root: string, runId: string | null, mode: LiveMode): LiveScanHandle {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  if (runId !== null) ensureLiveScan(api, root, runId, mode);

  useEffect(() => {
    if (runId === null) return;
    ensureLiveScan(api, root, runId, mode);
    retainLiveScan(runId);
    return () => releaseLiveScan(runId);
  }, [api, root, runId, mode]);

  const store = runId !== null && active !== null && active.runId === runId ? active : null;
  if (store === null) return EMPTY_HANDLE;
  return {
    store: store.rowStore,
    browseStore: store.browseStore,
    matches: store.matches,
    folders: store.folders,
    categories: store.categories,
    categoriesVersion: store.categoriesVersion,
    version: store.version,
    phase: store.phase,
    finished: store.finished,
    failedMessage: store.failedMessage,
  };
}
