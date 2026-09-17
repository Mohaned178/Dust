import { join } from 'node:path';
import type { Entry, FolderRecord, Marker, ProgressUpdate } from '../model/types';
import type { Enumerator } from './enumerator';

export interface ScanConfig {
  root: string;
  enumerator: Enumerator;
  isExcluded: (absPath: string) => boolean;
  signal?: AbortSignal;
  progressEvery?: number;
  onFolder?: (record: FolderRecord) => void;
  onMarker?: (marker: Marker) => void;
  onProgress?: (update: ProgressUpdate) => void;
}

export interface ScanStats {
  rootRecord: FolderRecord;
  filesScanned: number;
  bytesSeen: number;
  errors: number;
  aborted: boolean;
  markers: Marker[];
}

interface ScanState {
  filesScanned: number;
  bytesSeen: number;
  errors: number;
  dirsCompleted: number;
  entriesSeen: number;
  aborted: boolean;
  markers: Marker[];
}

export function scanTree(config: ScanConfig): ScanStats {
  const state: ScanState = {
    filesScanned: 0,
    bytesSeen: 0,
    errors: 0,
    dirsCompleted: 0,
    entriesSeen: 0,
    aborted: false,
    markers: [],
  };
  const rootRecord = scanDir(config.root, true, config, state);
  return {
    rootRecord,
    filesScanned: state.filesScanned,
    bytesSeen: state.bytesSeen,
    errors: state.errors,
    aborted: state.aborted,
    markers: state.markers,
  };
}

function scanDir(dir: string, trackMtime: boolean, config: ScanConfig, state: ScanState): FolderRecord {
  if (config.signal?.aborted) {
    state.aborted = true;
    return emptyRecord(dir, true);
  }

  let entries: Entry[];
  let entryErrors: number;
  try {
    const listing = config.enumerator.list(dir);
    entries = listing.entries;
    entryErrors = listing.entryErrors;
  } catch {
    state.errors += 1;
    state.dirsCompleted += 1;
    return emptyRecord(dir, true, 1);
  }
  state.errors += entryErrors;

  let bytes = 0;
  let fileCount = 0;
  let folderCount = 0;
  let linkCount = 0;
  let newestMtimeMs = 0;
  let errorCount = entryErrors;
  let partial = false;

  for (const entry of entries) {
    if (config.signal?.aborted) {
      state.aborted = true;
      partial = true;
      break;
    }
    const abs = join(dir, entry.name);

    if (!config.isExcluded(abs)) {
      if (entry.kind === 'link') {
        linkCount += 1;
        config.onFolder?.({
          path: abs,
          bytes: 0,
          fileCount: 0,
          folderCount: 0,
          linkCount: 1,
          newestMtimeMs: 0,
          errorCount: 0,
          partial: false,
        });
      } else if (entry.kind === 'file') {
        bytes += entry.size;
        fileCount += 1;
        state.filesScanned += 1;
        state.bytesSeen += entry.size;
        if (trackMtime && entry.mtimeMs > newestMtimeMs) newestMtimeMs = entry.mtimeMs;
        if (entry.name.toLowerCase() === 'package.json' && !pathHasNodeModules(dir)) {
          emitMarker(config, state, { kind: 'package-json', path: abs });
        }
      } else {
        if (entry.name.toLowerCase() === 'node_modules' && !pathHasNodeModules(dir)) {
          emitMarker(config, state, { kind: 'node-modules', path: abs });
        }
        if (entry.name.toLowerCase() === '.git') {
          emitMarker(config, state, { kind: 'git-dir', path: abs });
        }

        const childTrackMtime =
          trackMtime &&
          entry.name.toLowerCase() !== 'node_modules' &&
          entry.name.toLowerCase() !== '.git';
        const child = scanDir(abs, childTrackMtime, config, state);

        bytes += child.bytes;
        fileCount += child.fileCount;
        folderCount += 1 + child.folderCount;
        linkCount += child.linkCount;
        errorCount += child.errorCount;
        if (child.partial) partial = true;
        if (trackMtime && child.newestMtimeMs > newestMtimeMs) newestMtimeMs = child.newestMtimeMs;
        config.onFolder?.(child);
      }
    }

    state.entriesSeen += 1;
    emitProgress(config, state, dir);
  }

  state.dirsCompleted += 1;
  return {
    path: dir,
    bytes,
    fileCount,
    folderCount,
    linkCount,
    newestMtimeMs,
    errorCount,
    partial: partial || state.aborted,
  };
}

function emptyRecord(path: string, partial: boolean, errorCount = 0): FolderRecord {
  return {
    path,
    bytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount,
    partial,
  };
}

function emitMarker(config: ScanConfig, state: ScanState, marker: Marker): void {
  state.markers.push(marker);
  config.onMarker?.(marker);
}

function emitProgress(config: ScanConfig, state: ScanState, currentPath: string): void {
  const configured = config.progressEvery ?? 0;
  const every = Number.isFinite(configured) && configured > 0 ? configured : 500;
  if (state.entriesSeen % every !== 0) return;
  config.onProgress?.({
    filesScanned: state.filesScanned,
    bytesSeen: state.bytesSeen,
    currentPath,
    dirsCompleted: state.dirsCompleted,
    errors: state.errors,
  });
}

function pathHasNodeModules(dir: string): boolean {
  return dir.toLowerCase().split(/[\\/]/).includes('node_modules');
}
