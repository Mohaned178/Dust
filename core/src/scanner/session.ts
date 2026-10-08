import { normalize, sep } from 'node:path';
import { AggregateTree } from '../model/tree';
import type { FolderRecord, Marker, ProgressUpdate } from '../model/types';
import { NodeFsEnumerator } from './enumerator';
import type { Enumerator } from './enumerator';
import { createExclusionPredicate } from './exclusions';
import type { ExclusionConfig } from './exclusions';
import { scanTree } from './scanner';
import { DEFAULT_POOL_LIMITS, defaultWorkerCount } from '../scan/limits';
import { createNodeWorkerTransport, createScanWorker } from '../scan/node-worker';
import type { MftWorkerEvent, MftWorkerInit } from '../scan/mft-worker';
import { ScanCoordinator } from '../scan/coordinator';
import { volumeClusterSize } from '../system/cluster';

export interface PoolOptions {
  workers?: number;
  splitAfterEntries?: number;
  batchIntervalMs?: number;
  batchMaxItems?: number;
  workerPath?: URL | string;
  execArgv?: string[];
}

export interface SessionOptions {
  root: string;
  tree?: AggregateTree;
  enumerator?: Enumerator;
  exclusions?: ExclusionConfig;
  pool?: false | PoolOptions;
  clusterSize?: number;
  progressEvery?: number;
  onFolder?: (record: FolderRecord) => void;
  onMarker?: (marker: Marker) => void;
  onProgress?: (update: ProgressUpdate) => void;
  /**
   * Read the NTFS Master File Table directly when the root is a volume root
   * and the process may open the raw volume (administrator). Defaults to on;
   * any failure falls back to the directory walk before a folder is emitted.
   */
  mft?: boolean;
}

export type ScanMethod = 'mft' | 'walk';

export interface ScanResult {
  root: string;
  status: 'complete' | 'cancelled';
  tree: AggregateTree;
  startedAt: number;
  finishedAt: number;
  filesScanned: number;
  bytesSeen: number;
  errors: number;
  markers: Marker[];
  method?: ScanMethod;
}

export class ScanSession {
  private readonly controller = new AbortController();
  private readonly abortFlag = new Int32Array(new SharedArrayBuffer(4));
  private coordinator: ScanCoordinator | null = null;

  constructor(private readonly options: SessionOptions) {}

  cancel(): void {
    this.controller.abort();
    Atomics.store(this.abortFlag, 0, 1);
    this.coordinator?.cancel();
  }

  async start(): Promise<ScanResult> {
    const startedAt = Date.now();
    const tree = this.options.tree ?? new AggregateTree();
    const isExcluded = createExclusionPredicate(this.options.exclusions);
    const root = normalizeRoot(this.options.root);
    const clusterSize = this.options.clusterSize ?? volumeClusterSize(root);

    if (this.options.pool === false || this.options.enumerator) {
      return this.startLegacy(startedAt, tree, isExcluded, root, clusterSize);
    }

    if (this.controller.signal.aborted) {
      tree.addFolder({
        path: root,
        bytes: 0,
        allocatedBytes: 0,
        fileCount: 0,
        folderCount: 0,
        linkCount: 0,
        newestMtimeMs: 0,
        errorCount: 0,
        partial: true,
      });
      return {
        root,
        status: 'cancelled',
        tree,
        startedAt,
        finishedAt: Date.now(),
        filesScanned: 0,
        bytesSeen: 0,
        errors: 0,
        markers: [],
      };
    }

    const pool = this.options.pool ?? {};
    if (this.mftEligible(root)) {
      const viaMft = await this.startMft(root, tree, pool, startedAt);
      if (viaMft) return viaMft;
      if (this.controller.signal.aborted) {
        tree.addFolder(emptyPartialRecord(root));
        return {
          root,
          status: 'cancelled',
          tree,
          startedAt,
          finishedAt: Date.now(),
          filesScanned: 0,
          bytesSeen: 0,
          errors: 0,
          markers: [],
          method: 'walk',
        };
      }
    }
    const limits = {
      splitAfterEntries: pool.splitAfterEntries ?? DEFAULT_POOL_LIMITS.splitAfterEntries,
      batchIntervalMs: pool.batchIntervalMs ?? DEFAULT_POOL_LIMITS.batchIntervalMs,
      batchMaxItems: pool.batchMaxItems ?? DEFAULT_POOL_LIMITS.batchMaxItems,
    };
    const abortFlag = this.abortFlag;

    const coordinator = new ScanCoordinator({
      root,
      workerCount: pool.workers ?? defaultWorkerCount(),
      limits,
      abortFlag,
      createTransport: (workerId) =>
        createNodeWorkerTransport(
          {
            workerId,
            root,
            exclusions: this.options.exclusions ?? {},
            limits,
            clusterSize,
            abortFlag: abortFlag.buffer,
          },
          { workerPath: pool.workerPath, execArgv: pool.execArgv },
        ),
      onFolder: (record) => {
        tree.addFolder(record);
        this.options.onFolder?.(record);
      },
      onMarker: this.options.onMarker,
      onProgress: this.options.onProgress,
    });
    this.coordinator = coordinator;

    const pooled = await coordinator.run();
    tree.addFolder(pooled.rootRecord);

    return {
      root,
      status: pooled.aborted ? 'cancelled' : 'complete',
      tree,
      startedAt,
      finishedAt: Date.now(),
      filesScanned: pooled.filesScanned,
      bytesSeen: pooled.bytesSeen,
      errors: pooled.errors,
      markers: pooled.markers,
      method: 'walk',
    };
  }

  private mftEligible(root: string): boolean {
    if (this.options.mft === false || process.platform !== 'win32') return false;
    if (process.env.DUST_SCAN_METHOD === 'walk') return false;
    return /^[a-zA-Z]:\\$/.test(root);
  }

  // Resolves null when the MFT is unavailable (not NTFS, not elevated, or an
  // unexpected layout). The worker posts nothing until it has fully
  // succeeded, so the caller can fall back to the walker with an untouched tree.
  private startMft(
    root: string,
    tree: AggregateTree,
    pool: PoolOptions,
    startedAt: number,
  ): Promise<ScanResult | null> {
    return new Promise<ScanResult | null>((resolve) => {
      const init: MftWorkerInit = {
        mode: 'mft',
        root,
        exclusions: this.options.exclusions ?? {},
        abortFlag: this.abortFlag.buffer as SharedArrayBuffer,
      };
      let worker: ReturnType<typeof createScanWorker>;
      try {
        worker = createScanWorker(init, { workerPath: pool.workerPath, execArgv: pool.execArgv });
      } catch {
        resolve(null);
        return;
      }
      const markers: Marker[] = [];
      let settled = false;
      const settle = (result: ScanResult | null): void => {
        if (settled) return;
        settled = true;
        void worker.terminate().catch(() => {});
        resolve(result);
      };
      worker.on('message', (event: MftWorkerEvent) => {
        if (settled) return;
        switch (event.type) {
          case 'mft-unavailable':
            settle(null);
            return;
          case 'mft-progress':
            this.options.onProgress?.({
              filesScanned: event.filesScanned,
              bytesSeen: event.bytesSeen,
              currentPath: root,
              dirsCompleted: 0,
              errors: event.errors,
            });
            return;
          case 'mft-batch':
            for (const record of event.folders) {
              tree.addFolder(record);
              this.options.onFolder?.(record);
            }
            for (const marker of event.markers) {
              markers.push(marker);
              this.options.onMarker?.(marker);
            }
            return;
          case 'mft-done':
            tree.addFolder(event.rootRecord);
            settle({
              root,
              status: event.aborted ? 'cancelled' : 'complete',
              tree,
              startedAt,
              finishedAt: Date.now(),
              filesScanned: event.filesScanned,
              bytesSeen: event.bytesSeen,
              errors: event.errors,
              markers,
              method: 'mft',
            });
            return;
        }
      });
      worker.on('error', () => settle(null));
      worker.on('exit', () => settle(null));
    });
  }

  private startLegacy(
    startedAt: number,
    tree: AggregateTree,
    isExcluded: (absPath: string) => boolean,
    root: string,
    clusterSize: number,
  ): ScanResult {
    const stats = scanTree({
      root,
      enumerator: this.options.enumerator ?? new NodeFsEnumerator(),
      isExcluded,
      clusterSize,
      progressEvery: this.options.progressEvery,
      signal: this.controller.signal,
      onFolder: (record) => {
        tree.addFolder(record);
        this.options.onFolder?.(record);
      },
      onMarker: (marker) => {
        this.options.onMarker?.(marker);
      },
      onProgress: (update) => {
        this.options.onProgress?.(update);
      },
    });

    tree.addFolder(stats.rootRecord);

    return {
      root,
      status: stats.aborted ? 'cancelled' : 'complete',
      tree,
      startedAt,
      finishedAt: Date.now(),
      filesScanned: stats.filesScanned,
      bytesSeen: stats.bytesSeen,
      errors: stats.errors,
      markers: stats.markers,
    };
  }
}

function emptyPartialRecord(path: string): FolderRecord {
  return {
    path,
    bytes: 0,
    allocatedBytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: true,
  };
}

export function normalizeRoot(input: string): string {
  const normalized = normalize(input);
  const trimmed = normalized.replace(/[\\/]+$/, '');
  if (trimmed.length === 0 || trimmed === normalized) return normalized;
  return trimmed.endsWith(':') ? trimmed + sep : trimmed;
}
