import type { Marker } from '../model/types';
import type { ExclusionConfig } from '../scanner/exclusions';

export const PROTOCOL_VERSION = 2;

export interface PoolLimits {
  splitAfterEntries: number;
  batchIntervalMs: number;
  batchMaxItems: number;
}

export interface WorkerInit {
  workerId: number;
  root: string;
  exclusions: ExclusionConfig;
  limits: PoolLimits;
  clusterSize: number;
  abortFlag: SharedArrayBuffer;
}

export interface DirOpen {
  path: string;
  isRoot: boolean;
  directBytes: number;
  directAllocatedBytes: number;
  directFileCount: number;
  linkCount: number;
  errorCount: number;
  newestMtimeMs: number;
  partial: boolean;
  childDirs: string[];
}

export interface WorkerBatch {
  dirOpens: DirOpen[];
  markers: Marker[];
  submits: string[];
  progress: { filesSeen: number; bytesSeen: number; errors: number; currentPath: string } | null;
}

export type WorkerCommand =
  | { type: 'task'; path: string; isRoot: boolean }
  | { type: 'abort' }
  | { type: 'stop' };

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'batch'; batch: WorkerBatch }
  | { type: 'fatal'; message: string };
