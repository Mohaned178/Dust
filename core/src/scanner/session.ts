import { normalize, sep } from 'node:path';
import { AggregateTree } from '../model/tree';
import type { FolderRecord, Marker, ProgressUpdate } from '../model/types';
import { NodeFsEnumerator } from './enumerator';
import type { Enumerator } from './enumerator';
import { createExclusionPredicate } from './exclusions';
import type { ExclusionConfig } from './exclusions';
import { scanTree } from './scanner';
import { DEFAULT_POOL_LIMITS, defaultWorkerCount } from '../scan/limits';
import { createNodeWorkerTransport } from '../scan/node-worker';
import { ScanCoordinator } from '../scan/coordinator';

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
  enumerator?: Enumerator;
  exclusions?: ExclusionConfig;
  pool?: false | PoolOptions;
  progressEvery?: number;
  onFolder?: (record: FolderRecord) => void;
  onMarker?: (marker: Marker) => void;
  onProgress?: (update: ProgressUpdate) => void;
}

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
}

export class ScanSession {
  private readonly controller = new AbortController();
  private coordinator: ScanCoordinator | null = null;

  constructor(private readonly options: SessionOptions) {}

  cancel(): void {
    this.controller.abort();
    this.coordinator?.cancel();
  }

  async start(): Promise<ScanResult> {
    const startedAt = Date.now();
    const tree = new AggregateTree();
    const isExcluded = createExclusionPredicate(this.options.exclusions);
    const root = normalizeRoot(this.options.root);

    if (this.options.pool === false || this.options.enumerator) {
      return this.startLegacy(startedAt, tree, isExcluded, root);
    }

    if (this.controller.signal.aborted) {
      tree.addFolder({
        path: root,
        bytes: 0,
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
    const limits = {
      splitAfterEntries: pool.splitAfterEntries ?? DEFAULT_POOL_LIMITS.splitAfterEntries,
      batchIntervalMs: pool.batchIntervalMs ?? DEFAULT_POOL_LIMITS.batchIntervalMs,
      batchMaxItems: pool.batchMaxItems ?? DEFAULT_POOL_LIMITS.batchMaxItems,
    };
    const abortFlag = new Int32Array(new SharedArrayBuffer(4));

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
    };
  }

  private startLegacy(
    startedAt: number,
    tree: AggregateTree,
    isExcluded: (absPath: string) => boolean,
    root: string,
  ): ScanResult {
    const stats = scanTree({
      root,
      enumerator: this.options.enumerator ?? new NodeFsEnumerator(),
      isExcluded,
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

export function normalizeRoot(input: string): string {
  const normalized = normalize(input);
  const trimmed = normalized.replace(/[\\/]+$/, '');
  if (trimmed.length === 0 || trimmed === normalized) return normalized;
  return trimmed.endsWith(':') ? trimmed + sep : trimmed;
}
