import { dirname } from 'node:path';
import type { FolderRecord, Marker, ProgressUpdate } from '../model/types';
import type { WorkerTransport } from './node-worker';
import type { DirOpen, PoolLimits, WorkerCommand, WorkerEvent } from './protocol';

export interface CoordinatorOptions {
  root: string;
  workerCount: number;
  limits: PoolLimits;
  abortFlag: Int32Array;
  createTransport: (workerId: number) => WorkerTransport;
  onFolder?: (record: FolderRecord) => void;
  onMarker?: (marker: Marker) => void;
  onProgress?: (update: ProgressUpdate) => void;
}

export interface CoordinatorResult {
  rootRecord: FolderRecord;
  filesScanned: number;
  bytesSeen: number;
  errors: number;
  markers: Marker[];
  aborted: boolean;
}

interface Task {
  path: string;
  isRoot: boolean;
}

interface Accumulator {
  path: string;
  isRoot: boolean;
  opened: boolean;
  finalized: boolean;
  directBytes: number;
  directFileCount: number;
  linkCount: number;
  errorCount: number;
  newestMtimeMs: number;
  partial: boolean;
  childDirs: string[];
  finalizedChildren: Set<string>;
  sumBytes: number;
  sumFiles: number;
  sumFolders: number;
  sumLinks: number;
  sumErrors: number;
  sumNewest: number;
  childPartial: boolean;
}

export class ScanCoordinator {
  // Accumulators are retained for the whole scan by design: finalization needs
  // the full child rollup, so there is no release until a path is finalized.
  // At 1M-directory scale this is unmeasured — the spec §8 real-disk spike
  // (Defender enabled) must record peak RSS with `--root` mode before Plans 3-9
  // build on this. Revisit with a finalized-paths release strategy only if the
  // spike shows a problem.
  private readonly accumulators = new Map<string, Accumulator>();
  private readonly queue: Task[] = [];
  private readonly idle: number[] = [];
  private readonly inflight = new Map<number, Task>();
  private readonly transports = new Map<number, WorkerTransport>();
  private readonly restarts = new Map<number, number>();
  private stopping = false;
  private aborted = false;
  private rootRecord: FolderRecord | null = null;
  private resolveRun: ((result: CoordinatorResult) => void) | null = null;
  private filesScanned = 0;
  private bytesSeen = 0;
  private errors = 0;
  private finalizedCount = 0;
  private readonly markers: Marker[] = [];

  constructor(private readonly options: CoordinatorOptions) {}

  run(): Promise<CoordinatorResult> {
    return new Promise<CoordinatorResult>((resolve) => {
      this.resolveRun = resolve;
      this.queue.push({ path: this.options.root, isRoot: true });
      for (let workerId = 0; workerId < this.options.workerCount; workerId += 1) {
        this.spawn(workerId);
      }
      if (this.options.workerCount === 0) {
        this.forceFinalize(this.options.root);
      }
    });
  }

  cancel(): void {
    if (this.aborted || this.rootRecord) return;
    this.aborted = true;
    Atomics.store(this.options.abortFlag, 0, 1);
    for (const transport of this.transports.values()) {
      transport.postMessage({ type: 'abort' });
    }
    if (this.inflight.size === 0) {
      this.forceFinalizeAll();
    }
  }

  private spawn(workerId: number): void {
    const transport = this.options.createTransport(workerId);
    transport.onMessage((event) => this.onEvent(workerId, event));
    transport.onExit((code) => this.onExit(workerId, code));
    this.transports.set(workerId, transport);
  }

  private onEvent(workerId: number, event: WorkerEvent): void {
    if (event.type === 'batch') {
      this.onBatch(event);
      return;
    }
    if (event.type === 'fatal') {
      this.onExit(workerId, 1);
      return;
    }
    this.inflight.delete(workerId);
    if (this.stopping || this.aborted) {
      this.send(workerId, { type: 'stop' });
      this.checkDrained();
      return;
    }
    this.assign(workerId);
  }

  private onBatch(event: Extract<WorkerEvent, { type: 'batch' }>): void {
    for (const open of event.batch.dirOpens) this.onDirOpen(open);
    for (const marker of event.batch.markers) {
      this.markers.push(marker);
      this.options.onMarker?.(marker);
    }
    if (!this.aborted) {
      for (const path of event.batch.submits) this.enqueue({ path, isRoot: false });
    }
    if (event.batch.progress) {
      const update = event.batch.progress;
      this.filesScanned += update.filesSeen;
      this.bytesSeen += update.bytesSeen;
      this.errors += update.errors;
      this.options.onProgress?.({
        filesScanned: this.filesScanned,
        bytesSeen: this.bytesSeen,
        currentPath: update.currentPath,
        dirsCompleted: this.finalizedCount,
        errors: this.errors,
      });
    }
  }

  private onDirOpen(open: DirOpen): void {
    const accumulator = this.ensure(open.path);
    if (!accumulator.opened) {
      accumulator.opened = true;
      accumulator.isRoot = open.isRoot;
      accumulator.directBytes = open.directBytes;
      accumulator.directFileCount = open.directFileCount;
      accumulator.linkCount = open.linkCount;
      accumulator.errorCount = open.errorCount;
      accumulator.newestMtimeMs = this.isMtimeTrackedPath(open.path) ? open.newestMtimeMs : 0;
      accumulator.partial = open.partial;
      accumulator.childDirs = open.childDirs;
    }
    this.tryFinalize(open.path);
  }

  private assign(workerId: number): void {
    const task = this.queue.shift();
    if (task) {
      this.inflight.set(workerId, task);
      this.send(workerId, { type: 'task', path: task.path, isRoot: task.isRoot });
      return;
    }
    if (!this.idle.includes(workerId)) this.idle.push(workerId);
    if (this.queue.length === 0 && this.inflight.size === 0) {
      this.stopAll();
    }
  }

  private enqueue(task: Task): void {
    this.queue.push(task);
    while (this.queue.length > 0 && this.idle.length > 0) {
      const workerId = this.idle.shift()!;
      const next = this.queue.shift()!;
      this.inflight.set(workerId, next);
      this.send(workerId, { type: 'task', path: next.path, isRoot: next.isRoot });
    }
  }

  private tryFinalize(path: string): void {
    let current: string | null = path;
    while (current) {
      const accumulator = this.ensure(current);
      if (!accumulator.opened || accumulator.finalized) return;
      const pending = accumulator.childDirs.filter((child) => !accumulator.finalizedChildren.has(child));
      if (pending.length > 0) return;

      accumulator.finalized = true;
      this.finalizedCount += 1;
      const record = this.buildRecord(accumulator);

      if (accumulator.isRoot) {
        this.rootRecord = record;
        this.finish();
        return;
      }

      this.options.onFolder?.(record);
      const parent = this.ensure(dirname(accumulator.path));
      parent.finalizedChildren.add(accumulator.path);
      parent.sumBytes += record.bytes;
      parent.sumFiles += record.fileCount;
      parent.sumFolders += record.folderCount;
      parent.sumLinks += record.linkCount;
      parent.sumErrors += record.errorCount;
      parent.sumNewest = Math.max(parent.sumNewest, record.newestMtimeMs);
      if (record.partial) parent.childPartial = true;
      current = parent.path;
    }
  }

  private buildRecord(accumulator: Accumulator): FolderRecord {
    return {
      path: accumulator.path,
      bytes: accumulator.directBytes + accumulator.sumBytes,
      fileCount: accumulator.directFileCount + accumulator.sumFiles,
      folderCount: accumulator.childDirs.length + accumulator.sumFolders,
      linkCount: accumulator.linkCount + accumulator.sumLinks,
      newestMtimeMs: Math.max(accumulator.newestMtimeMs, accumulator.sumNewest),
      errorCount: accumulator.errorCount + accumulator.sumErrors,
      partial: accumulator.partial || accumulator.childPartial,
    };
  }

  private ensure(path: string): Accumulator {
    const existing = this.accumulators.get(path);
    if (existing) return existing;
    const accumulator: Accumulator = {
      path,
      isRoot: false,
      opened: false,
      finalized: false,
      directBytes: 0,
      directFileCount: 0,
      linkCount: 0,
      errorCount: 0,
      newestMtimeMs: 0,
      partial: false,
      childDirs: [],
      finalizedChildren: new Set(),
      sumBytes: 0,
      sumFiles: 0,
      sumFolders: 0,
      sumLinks: 0,
      sumErrors: 0,
      sumNewest: 0,
      childPartial: false,
    };
    this.accumulators.set(path, accumulator);
    return accumulator;
  }

  private isMtimeTrackedPath(path: string): boolean {
    return !path
      .toLowerCase()
      .split(/[\\/]/)
      .some((segment) => segment === 'node_modules' || segment === '.git');
  }

  private send(workerId: number, command: WorkerCommand): void {
    this.transports.get(workerId)?.postMessage(command);
  }

  private stopAll(): void {
    if (this.stopping) return;
    this.stopping = true;
    for (const [workerId, transport] of this.transports) {
      transport.postMessage({ type: 'stop' });
      void transport.terminate().catch(() => {});
      this.transports.delete(workerId);
    }
  }

  private checkDrained(): void {
    if (this.inflight.size === 0) this.forceFinalizeAll();
  }

  private forceFinalizeAll(): void {
    if (!this.aborted || this.rootRecord) return;
    this.forceFinalize(this.options.root);
  }

  private forceFinalize(path: string): void {
    const accumulator = this.ensure(path);
    if (accumulator.finalized) return;
    if (path === this.options.root) accumulator.isRoot = true;
    for (const child of accumulator.childDirs) {
      if (!accumulator.finalizedChildren.has(child)) this.forceFinalize(child);
    }
    accumulator.opened = true;
    accumulator.partial = true;
    this.tryFinalize(path);
  }

  private finish(): void {
    const resolve = this.resolveRun;
    if (!resolve || !this.rootRecord) return;
    this.resolveRun = null;
    const rootRecord = this.rootRecord;
    queueMicrotask(() => {
      this.stopAll();
      resolve({
        rootRecord,
        filesScanned: this.filesScanned,
        bytesSeen: this.bytesSeen,
        errors: this.errors,
        markers: [...this.markers],
        aborted: this.aborted,
      });
    });
  }

  private onExit(workerId: number, _code: number): void {
    const transport = this.transports.get(workerId);
    if (!transport) return;
    this.transports.delete(workerId);
    const idleIndex = this.idle.indexOf(workerId);
    if (idleIndex >= 0) this.idle.splice(idleIndex, 1);
    if (this.stopping || this.resolveRun === null) return;

    const task = this.inflight.get(workerId);
    this.inflight.delete(workerId);
    const restarts = this.restarts.get(workerId) ?? 0;

    if (restarts < 1) {
      this.restarts.set(workerId, restarts + 1);
      if (task) this.queue.unshift(task);
      this.spawn(workerId);
      return;
    }

    if (task) {
      const accumulator = this.ensure(task.path);
      if (!accumulator.opened) accumulator.opened = true;
      if (task.isRoot) accumulator.isRoot = true;
      accumulator.partial = true;
      accumulator.errorCount += 1;
      this.tryFinalize(task.path);
    }

    if (this.transports.size === 0 || (this.queue.length === 0 && this.inflight.size === 0)) {
      if (!this.aborted && !this.rootRecord) this.forceFinalize(this.options.root);
      this.stopAll();
    }
  }
}
