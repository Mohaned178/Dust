import { basename } from 'node:path';
import type { FolderRecord, Marker, ProgressUpdate } from '../model/types';
import type { Enumerator } from './enumerator';
import { isMtimeTrackedChild, scanDirectory } from './dir-scan';

export interface ScanConfig {
  root: string;
  enumerator: Enumerator;
  isExcluded: (absPath: string) => boolean;
  signal?: AbortSignal;
  clusterSize?: number;
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

  const result = scanDirectory(dir, trackMtime, {
    enumerator: config.enumerator,
    isExcluded: config.isExcluded,
    clusterSize: config.clusterSize,
    shouldAbort: () => config.signal?.aborted === true,
    onEntry: (c) => {
      state.entriesSeen += 1;
      state.filesScanned += c.files;
      state.bytesSeen += c.bytes;
      emitProgress(config, state, dir);
    },
  });
  state.errors += result.errorCount;
  if (result.aborted) state.aborted = true;

  let bytes = result.directBytes;
  let allocatedBytes = result.directAllocatedBytes;
  let fileCount = result.directFileCount;
  let folderCount = 0;
  let linkCount = result.linkCount;
  let errorCount = result.errorCount;
  let newestMtimeMs = result.newestMtimeMs;
  let partial = result.partial;

  for (const marker of result.markers) {
    state.markers.push(marker);
    config.onMarker?.(marker);
  }
  for (const linkPath of result.linkPaths) {
    config.onFolder?.({
      path: linkPath,
      bytes: 0,
      allocatedBytes: 0,
      fileCount: 0,
      folderCount: 0,
      linkCount: 1,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: false,
    });
  }

  for (const childPath of result.childDirs) {
    if (config.signal?.aborted) {
      state.aborted = true;
      partial = true;
      break;
    }
    const child = scanDir(childPath, trackMtime && isMtimeTrackedChild(basename(childPath)), config, state);
    bytes += child.bytes;
    allocatedBytes += child.allocatedBytes;
    fileCount += child.fileCount;
    folderCount += 1 + child.folderCount;
    linkCount += child.linkCount;
    errorCount += child.errorCount;
    if (child.partial) partial = true;
    if (trackMtime && child.newestMtimeMs > newestMtimeMs) newestMtimeMs = child.newestMtimeMs;
    config.onFolder?.(child);
  }

  state.dirsCompleted += 1;
  if (config.signal?.aborted) {
    state.aborted = true;
    partial = true;
  }

  return {
    path: dir,
    bytes,
    allocatedBytes,
    fileCount,
    folderCount,
    linkCount,
    newestMtimeMs,
    errorCount,
    partial,
  };
}

function emptyRecord(path: string, partial: boolean, errorCount = 0): FolderRecord {
  return {
    path,
    bytes: 0,
    allocatedBytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount,
    partial,
  };
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
