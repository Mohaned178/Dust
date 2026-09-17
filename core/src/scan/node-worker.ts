import type { WorkerCommand, WorkerEvent } from './protocol';

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
