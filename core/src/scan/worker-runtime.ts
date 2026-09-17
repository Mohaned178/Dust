import type { Marker } from '../model/types';
import type { Enumerator } from '../scanner/enumerator';
import type { DirOpen, WorkerBatch, WorkerCommand, WorkerEvent } from './protocol';
import { scanTask } from './worker-scan';

export interface WorkerRuntimeDeps {
  send: (event: WorkerEvent) => void;
  enumerator: Enumerator;
  isExcluded: (absPath: string) => boolean;
  shouldAbort: () => boolean;
  splitAfterEntries: number;
  batchIntervalMs: number;
  batchMaxItems: number;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export interface WorkerRuntime {
  start(): void;
  handleCommand(command: WorkerCommand): void;
  flush(): void;
  dispose(): void;
}

export function createWorkerRuntime(deps: WorkerRuntimeDeps): WorkerRuntime {
  let disposed = false;
  let localAbort = false;

  const dirOpens: DirOpen[] = [];
  const markers: Marker[] = [];
  const submits: string[] = [];
  let filesSeen = 0;
  let bytesSeen = 0;
  let errors = 0;
  let currentPath = '';
  let flushedFiles = 0;
  let flushedBytes = 0;
  let flushedErrors = 0;
  let flushedPath = '';

  const setIntervalFn = deps.setIntervalFn ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearIntervalFn =
    deps.clearIntervalFn ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  const timer = setIntervalFn(() => flush(), deps.batchIntervalMs);

  const shouldAbort = (): boolean => localAbort || deps.shouldAbort();

  function itemCount(): number {
    return dirOpens.length + markers.length + submits.length;
  }

  function flush(): void {
    if (disposed && itemCount() === 0) return;
    const progressChanged = filesSeen !== flushedFiles || bytesSeen !== flushedBytes || errors !== flushedErrors || currentPath !== flushedPath;
    if (itemCount() === 0 && !progressChanged) return;

    const progress = progressChanged
      ? {
          filesSeen: filesSeen - flushedFiles,
          bytesSeen: bytesSeen - flushedBytes,
          errors: errors - flushedErrors,
          currentPath,
        }
      : null;
    flushedFiles = filesSeen;
    flushedBytes = bytesSeen;
    flushedErrors = errors;
    flushedPath = currentPath;

    const batch: WorkerBatch = {
      dirOpens: dirOpens.splice(0),
      markers: markers.splice(0),
      submits: submits.splice(0),
      progress,
    };
    deps.send({ type: 'batch', batch });
  }

  function pendingItemCount(): number {
    const progressItems =
      filesSeen - flushedFiles + (bytesSeen !== flushedBytes ? 1 : 0) + (errors - flushedErrors);
    return dirOpens.length + markers.length + submits.length + progressItems;
  }

  function maybeAutoFlush(): void {
    if (pendingItemCount() >= deps.batchMaxItems) flush();
  }

  function runTask(path: string, isRoot: boolean): void {
    scanTask(path, isRoot, {
      enumerator: deps.enumerator,
      isExcluded: deps.isExcluded,
      shouldAbort,
      splitAfterEntries: deps.splitAfterEntries,
      openDir: (open) => {
        dirOpens.push(open);
        errors += open.errorCount;
        maybeAutoFlush();
      },
      submitTasks: (paths) => {
        submits.push(...paths);
        maybeAutoFlush();
      },
      marker: (marker) => {
        markers.push(marker);
        maybeAutoFlush();
      },
      progress: (contribution) => {
        filesSeen += contribution.files;
        bytesSeen += contribution.bytes;
        currentPath = contribution.path;
        maybeAutoFlush();
      },
    });
  }

  return {
    start(): void {
      deps.send({ type: 'ready' });
    },

    handleCommand(command: WorkerCommand): void {
      if (disposed) return;
      if (command.type === 'abort') {
        localAbort = true;
        return;
      }
      if (command.type === 'stop') {
        flush();
        return;
      }
      try {
        runTask(command.path, command.isRoot);
      } catch (error) {
        flush();
        deps.send({ type: 'fatal', message: String(error) });
        return;
      }
      flush();
      deps.send({ type: 'ready' });
    },

    flush,

    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearIntervalFn(timer);
    },
  };
}
