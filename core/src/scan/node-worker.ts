import { Worker } from 'node:worker_threads';
import type { WorkerCommand, WorkerEvent, WorkerInit } from './protocol';

export interface WorkerTransport {
  postMessage(command: WorkerCommand): void;
  onMessage(handler: (event: WorkerEvent) => void): void;
  onExit(handler: (code: number) => void): void;
  terminate(): Promise<number>;
}

export interface NodeTransportOptions {
  workerPath?: URL | string;
  execArgv?: string[];
}

export function createNodeWorkerTransport(init: WorkerInit, options: NodeTransportOptions = {}): WorkerTransport {
  const workerPath = options.workerPath ?? new URL('./worker-entry.ts', import.meta.url);
  if (!options.workerPath && !options.execArgv && String(workerPath).endsWith('.ts')) {
    throw new Error(
      'createNodeWorkerTransport: the default TypeScript worker entry cannot run under plain Node ' +
        'type-stripping (extensionless imports are unresolvable). Pass `workerPath` and `execArgv` ' +
        "explicitly, e.g. execArgv: ['--import', 'tsx'] in dev, or a compiled JS worker path in production.",
    );
  }
  const worker = new Worker(workerPath, {
    workerData: init,
    execArgv: options.execArgv ?? [],
  });
  return {
    postMessage: (command) => worker.postMessage(command),
    onMessage: (handler) => worker.on('message', handler),
    onExit: (handler) => worker.on('exit', (code) => handler(code)),
    terminate: () => worker.terminate(),
  };
}
