import { normalize, sep } from 'node:path';
import { AggregateTree } from '../model/tree';
import type { FolderRecord, Marker, ProgressUpdate } from '../model/types';
import { NodeFsEnumerator } from './enumerator';
import type { Enumerator } from './enumerator';
import { createExclusionPredicate } from './exclusions';
import type { ExclusionConfig } from './exclusions';
import { scanTree } from './scanner';

export interface SessionOptions {
  root: string;
  enumerator?: Enumerator;
  exclusions?: ExclusionConfig;
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

  constructor(private readonly options: SessionOptions) {}

  cancel(): void {
    this.controller.abort();
  }

  async start(): Promise<ScanResult> {
    const startedAt = Date.now();
    const tree = new AggregateTree();
    const isExcluded = createExclusionPredicate(this.options.exclusions);
    const root = normalizeRoot(this.options.root);

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

function normalizeRoot(input: string): string {
  const normalized = normalize(input);
  const trimmed = normalized.replace(/[\\/]+$/, '');
  if (trimmed.length === 0 || trimmed === normalized) return normalized;
  return trimmed.endsWith(':') ? trimmed + sep : trimmed;
}
