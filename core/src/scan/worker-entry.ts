import { parentPort, workerData } from 'node:worker_threads';
import { createExclusionPredicate } from '../scanner/exclusions';
import { createPlatformEnumerator } from '../scanner/win-enumerator';
import { runMftWorker, type MftWorkerInit } from './mft-worker';
import type { WorkerCommand, WorkerInit } from './protocol';
import { createWorkerRuntime } from './worker-runtime';

const port = parentPort;
if (!port) throw new Error('worker-entry must run inside a worker thread');

// One bundled entry serves both scan strategies: the MFT reader when the
// session asks for it, otherwise a directory-walk pool worker.
if ((workerData as { mode?: string }).mode === 'mft') {
  runMftWorker(port, workerData as MftWorkerInit);
  port.close();
} else {
  startPoolWorker(workerData as WorkerInit);
}

function startPoolWorker(init: WorkerInit): void {
  const workerPort = port!;
  const abortFlag = new Int32Array(init.abortFlag);
  const isExcluded = createExclusionPredicate(init.exclusions);

  const runtime = createWorkerRuntime({
    send: (event) => workerPort.postMessage(event),
    enumerator: createPlatformEnumerator(init.clusterSize),
    isExcluded,
    shouldAbort: () => Atomics.load(abortFlag, 0) === 1,
    splitAfterEntries: init.limits.splitAfterEntries,
    clusterSize: init.clusterSize,
    batchIntervalMs: init.limits.batchIntervalMs,
    batchMaxItems: init.limits.batchMaxItems,
    exitThread: () => process.exit(1),
  });

  workerPort.on('message', (command: WorkerCommand) => {
    if (command.type === 'stop') {
      runtime.flush();
      runtime.dispose();
      workerPort.close();
      process.exit(0);
    }
    runtime.handleCommand(command);
  });

  // Surface a non-traversal crash to the host before the thread dies. Traversal
  // errors are handled inside the runtime (flush + fatal event + exitThread), so
  // this handler never double-sends a fatal for those.
  process.on('uncaughtException', (error) => {
    try {
      workerPort.postMessage({ type: 'fatal', message: String(error) });
    } finally {
      process.exit(1);
    }
  });

  runtime.start();
}
