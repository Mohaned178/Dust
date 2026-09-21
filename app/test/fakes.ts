import { AggregateTree } from '@dust/core';
import type { ScanResult, SessionOptions } from '@dust/core';
import type { EngineHost } from '../src/main/host/engine-host';
import type { ScanEvent } from '../src/shared/ipc';

export class FakeSession {
  readonly options: SessionOptions;
  cancelled = false;
  private resolveStart: ((result: ScanResult) => void) | null = null;
  private rejectStart: ((error: Error) => void) | null = null;

  constructor(options: SessionOptions) {
    this.options = options;
  }

  start(): Promise<ScanResult> {
    return new Promise<ScanResult>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
  }

  cancel(): void {
    this.cancelled = true;
  }

  finish(result: ScanResult): void {
    this.resolveStart?.(result);
  }

  fail(error: Error): void {
    this.rejectStart?.(error);
  }
}

export function emptyScanResult(root: string, status: 'complete' | 'cancelled' = 'cancelled'): ScanResult {
  return {
    root,
    status,
    tree: new AggregateTree(),
    startedAt: 0,
    finishedAt: 1,
    filesScanned: 0,
    bytesSeen: 0,
    errors: 0,
    markers: [],
  };
}

export function nextEvent(host: EngineHost, type: ScanEvent['type']): Promise<ScanEvent> {
  return new Promise((resolve) => {
    const unsubscribe = host.onEvent((event) => {
      if (event.type === type) {
        unsubscribe();
        resolve(event);
      }
    });
  });
}
