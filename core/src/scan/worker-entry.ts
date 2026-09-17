import { parentPort, workerData } from 'node:worker_threads';
import { NodeFsEnumerator } from '../scanner/enumerator';
import { createExclusionPredicate } from '../scanner/exclusions';
import type { WorkerCommand, WorkerInit } from './protocol';
import { createWorkerRuntime } from './worker-runtime';

const port = parentPort;
if (!port) throw new Error('worker-entry must run inside a worker thread');

const init = workerData as WorkerInit;
const abortFlag = new Int32Array(init.abortFlag);
const isExcluded = createExclusionPredicate(init.exclusions);

const runtime = createWorkerRuntime({
  send: (event) => port.postMessage(event),
  enumerator: new NodeFsEnumerator(),
  isExcluded,
  shouldAbort: () => Atomics.load(abortFlag, 0) === 1,
  splitAfterEntries: init.limits.splitAfterEntries,
  batchIntervalMs: init.limits.batchIntervalMs,
  batchMaxItems: init.limits.batchMaxItems,
  exitThread: () => process.exit(1),
});

port.on('message', (command: WorkerCommand) => {
  if (command.type === 'stop') {
    runtime.flush();
    runtime.dispose();
    port.close();
    process.exit(0);
  }
  runtime.handleCommand(command);
});

// Surface a non-traversal crash to the host before the thread dies. Traversal
// errors are handled inside the runtime (flush + fatal event + exitThread), so
// this handler never double-sends a fatal for those.
process.on('uncaughtException', (error) => {
  try {
    port.postMessage({ type: 'fatal', message: String(error) });
  } finally {
    process.exit(1);
  }
});

runtime.start();
