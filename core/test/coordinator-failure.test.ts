import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScanCoordinator } from '../src/scan/coordinator';
import type { FolderRecord } from '../src/model/types';
import type { WorkerTransport } from '../src/scan/node-worker';
import type { DirOpen, WorkerCommand, WorkerEvent } from '../src/scan/protocol';

class FakeTransport implements WorkerTransport {
  readonly sent: WorkerCommand[] = [];
  terminated = false;
  private messageHandler: ((event: WorkerEvent) => void) | null = null;
  private exitHandler: ((code: number) => void) | null = null;

  postMessage(command: WorkerCommand): void {
    this.sent.push(command);
  }

  onMessage(handler: (event: WorkerEvent) => void): void {
    this.messageHandler = handler;
  }

  onExit(handler: (code: number) => void): void {
    this.exitHandler = handler;
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }

  emit(event: WorkerEvent): void {
    this.messageHandler?.(event);
  }

  exit(code: number): void {
    this.exitHandler?.(code);
  }
}

const ROOT = 'F:\\synthetic';

function open(path: string, isRoot: boolean, childDirs: string[] = [], overrides: Partial<DirOpen> = {}): DirOpen {
  return {
    path,
    isRoot,
    directBytes: 0,
    directAllocatedBytes: 0,
    directFileCount: 0,
    linkCount: 0,
    errorCount: 0,
    newestMtimeMs: 0,
    partial: false,
    childDirs,
    ...overrides,
  };
}

function makeHarness(workerCount: number) {
  const transports: FakeTransport[] = [];
  const folders: FolderRecord[] = [];
  const abortFlag = new Int32Array(new SharedArrayBuffer(4));
  const coordinator = new ScanCoordinator({
    root: ROOT,
    workerCount,
    limits: { splitAfterEntries: 20_000, batchIntervalMs: 200, batchMaxItems: 500 },
    abortFlag,
    createTransport: () => {
      const transport = new FakeTransport();
      transports.push(transport);
      return transport;
    },
    onFolder: (record) => {
      folders.push(record);
    },
  });
  return { coordinator, transports, abortFlag, folders };
}

describe('ScanCoordinator failure handling', () => {
  it('restarts a crashed worker once and re-queues its task', async () => {
    const h = makeHarness(1);
    const run = h.coordinator.run();
    const first = h.transports[0]!;
    first.emit({ type: 'ready' });
    first.emit({ type: 'batch', batch: { dirOpens: [open(join(ROOT, 'a'), false)], markers: [], submits: [], progress: null } });
    first.emit({ type: 'batch', batch: { dirOpens: [open(ROOT, true, [join(ROOT, 'a'), join(ROOT, 'b')])], markers: [], submits: [join(ROOT, 'b')], progress: null } });
    first.exit(1);

    expect(h.transports).toHaveLength(2);
    const replacement = h.transports[1]!;
    replacement.emit({ type: 'ready' });
    // The crashed worker's in-flight task (the root) is re-queued at the front.
    expect(replacement.sent.find((c) => c.type === 'task')).toMatchObject({ type: 'task', path: ROOT, isRoot: true });

    replacement.emit({ type: 'ready' });
    expect(replacement.sent.filter((c) => c.type === 'task').at(-1)).toMatchObject({ type: 'task', path: join(ROOT, 'b') });
    replacement.emit({ type: 'batch', batch: { dirOpens: [open(join(ROOT, 'b'), false)], markers: [], submits: [], progress: null } });
    const result = await run;
    expect(result.rootRecord.partial).toBe(false);
  }, 5_000);

  it('marks the subtree partial when the same worker crashes twice', async () => {
    const h = makeHarness(1);
    const run = h.coordinator.run();
    const first = h.transports[0]!;
    first.emit({ type: 'ready' });
    first.emit({ type: 'batch', batch: { dirOpens: [open(ROOT, true, [join(ROOT, 'lost')])], markers: [], submits: [], progress: null } });
    first.exit(1);
    const second = h.transports[1]!;
    second.emit({ type: 'ready' });
    second.exit(1);

    const result = await run;
    expect(result.rootRecord.partial).toBe(true);
    expect(result.rootRecord.errorCount).toBeGreaterThan(0);
  }, 5_000);

  it('aborts running workers, stops them, and returns a partial cancelled result', async () => {
    const h = makeHarness(2);
    const run = h.coordinator.run();
    const [w0, w1] = h.transports;
    w0!.emit({ type: 'ready' });
    w1!.emit({ type: 'ready' });
    w0!.emit({ type: 'batch', batch: { dirOpens: [open(ROOT, true, [join(ROOT, 'a'), join(ROOT, 'b')])], markers: [], submits: [join(ROOT, 'a'), join(ROOT, 'b')], progress: null } });

    h.coordinator.cancel();
    expect(Atomics.load(h.abortFlag, 0)).toBe(1);
    expect(w0!.sent.some((c) => c.type === 'abort')).toBe(true);
    expect(w1!.sent.some((c) => c.type === 'abort')).toBe(true);

    w0!.emit({ type: 'ready' });
    w1!.emit({ type: 'ready' });

    const result = await run;
    expect(result.aborted).toBe(true);
    expect(result.rootRecord.partial).toBe(true);
    expect(result.rootRecord.path).toBe(ROOT);
  }, 5_000);

  it('stops idle workers without waiting for a crash when work is exhausted', async () => {
    const h = makeHarness(1);
    const run = h.coordinator.run();
    h.transports[0]!.emit({ type: 'ready' });
    h.transports[0]!.emit({ type: 'batch', batch: { dirOpens: [open(ROOT, true)], markers: [], submits: [], progress: null } });
    await run;
    expect(h.transports[0]!.terminated).toBe(true);
  });

  it('finalizes the synthesized root as the root record with zero workers', async () => {
    const h = makeHarness(0);
    const result = await h.coordinator.run();

    expect(result.rootRecord.path).toBe(ROOT);
    expect(result.rootRecord.partial).toBe(true);
    expect(h.folders.some((r) => r.path === ROOT)).toBe(false);
  }, 5_000);

  it('resolves with a partial root record when cancelled before any worker is ready', async () => {
    const h = makeHarness(1);
    const run = h.coordinator.run();
    h.coordinator.cancel();
    const result = await run;

    expect(result.aborted).toBe(true);
    expect(result.rootRecord.path).toBe(ROOT);
    expect(result.rootRecord.partial).toBe(true);
  }, 5_000);

  it('does not double-count a finalized directory re-delivered after a restart', async () => {
    const h = makeHarness(1);
    const run = h.coordinator.run();
    const first = h.transports[0]!;
    first.emit({ type: 'ready' });
    // Leaf 'a' finalizes and is released well before the crash.
    first.emit({
      type: 'batch',
      batch: {
        dirOpens: [open(join(ROOT, 'a'), false, [], { directBytes: 7, directAllocatedBytes: 4096, directFileCount: 1 })],
        markers: [],
        submits: [],
        progress: null,
      },
    });
    first.emit({
      type: 'batch',
      batch: {
        dirOpens: [open(ROOT, true, [join(ROOT, 'a'), join(ROOT, 'b')], { directBytes: 1 })],
        markers: [],
        submits: [join(ROOT, 'b')],
        progress: null,
      },
    });
    first.exit(1);

    const replacement = h.transports[1]!;
    replacement.emit({ type: 'ready' });
    // The replacement re-walks the crashed task and re-delivers the finalized leaf.
    replacement.emit({
      type: 'batch',
      batch: {
        dirOpens: [open(join(ROOT, 'a'), false, [], { directBytes: 7, directAllocatedBytes: 4096, directFileCount: 1 })],
        markers: [],
        submits: [],
        progress: null,
      },
    });
    replacement.emit({ type: 'ready' });
    replacement.emit({
      type: 'batch',
      batch: {
        dirOpens: [open(join(ROOT, 'b'), false, [], { directBytes: 3, directAllocatedBytes: 4096, directFileCount: 1 })],
        markers: [],
        submits: [],
        progress: null,
      },
    });

    const result = await run;
    expect(result.rootRecord.bytes).toBe(11);
    expect(result.rootRecord.partial).toBe(false);
    expect(h.folders.filter((record) => record.path === join(ROOT, 'a'))).toHaveLength(1);
  }, 5_000);

  it('does not resurrect a finalized directory when a task crashes twice', async () => {
    const h = makeHarness(1);
    const run = h.coordinator.run();
    const first = h.transports[0]!;
    first.emit({ type: 'ready' });
    first.emit({
      type: 'batch',
      batch: {
        dirOpens: [open(ROOT, true, [join(ROOT, 'a'), join(ROOT, 'b')], { directBytes: 1 })],
        markers: [],
        submits: [join(ROOT, 'a'), join(ROOT, 'b')],
        progress: null,
      },
    });
    first.emit({ type: 'ready' });
    // Leaf 'a' finalizes and is released, then the worker dies before ready.
    first.emit({
      type: 'batch',
      batch: {
        dirOpens: [open(join(ROOT, 'a'), false, [], { directBytes: 7, directAllocatedBytes: 4096, directFileCount: 1 })],
        markers: [],
        submits: [],
        progress: null,
      },
    });
    first.exit(1);

    const replacement = h.transports[1]!;
    replacement.emit({ type: 'ready' });
    replacement.exit(1);

    const result = await run;
    // 'b' was never opened, so only the root's own byte and the finalized leaf count.
    expect(result.rootRecord.bytes).toBe(8);
    expect(h.folders.filter((record) => record.path === join(ROOT, 'a'))).toHaveLength(1);
  }, 5_000);

  it('resolves with a partial root record when the root task crashes twice with no dir-open', async () => {
    const h = makeHarness(1);
    const run = h.coordinator.run();
    h.transports[0]!.emit({ type: 'ready' });
    h.transports[0]!.exit(1);
    const replacement = h.transports[1]!;
    replacement.emit({ type: 'ready' });
    replacement.exit(1);

    const result = await run;
    expect(result.rootRecord.path).toBe(ROOT);
    expect(result.rootRecord.partial).toBe(true);
    expect(result.rootRecord.errorCount).toBeGreaterThan(0);
    expect(h.folders.some((r) => r.path === ROOT)).toBe(false);
  }, 5_000);
});
