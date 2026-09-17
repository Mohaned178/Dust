import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScanCoordinator } from '../src/scan/coordinator';
import type { WorkerTransport } from '../src/scan/node-worker';
import type { DirOpen, WorkerCommand, WorkerEvent } from '../src/scan/protocol';
import type { FolderRecord } from '../src/model/types';

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

  lastTask(): { path: string; isRoot: boolean } | null {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const command = this.sent[i]!;
      if (command.type === 'task') return { path: command.path, isRoot: command.isRoot };
    }
    return null;
  }
}

function open(path: string, isRoot: boolean, overrides: Partial<DirOpen> = {}): DirOpen {
  return {
    path,
    isRoot,
    directBytes: 0,
    directFileCount: 0,
    linkCount: 0,
    errorCount: 0,
    newestMtimeMs: 0,
    partial: false,
    childDirs: [],
    ...overrides,
  };
}

function batch(dirOpens: DirOpen[], extra: Partial<{ submits: string[]; markers: Array<{ kind: 'package-json'; path: string }> }> = {}): WorkerEvent {
  return {
    type: 'batch',
    batch: { dirOpens, markers: extra.markers ?? [], submits: extra.submits ?? [], progress: null },
  };
}

interface Harness {
  transports: FakeTransport[];
  folders: FolderRecord[];
  progress: unknown[];
  make: () => ScanCoordinator;
}

function harness(workerCount = 1): Harness {
  const transports: FakeTransport[] = [];
  const folders: FolderRecord[] = [];
  const progress: unknown[] = [];
  const root = 'F:\\synthetic';
  const make = (): ScanCoordinator =>
    new ScanCoordinator({
      root,
      workerCount,
      limits: { splitAfterEntries: 20_000, batchIntervalMs: 200, batchMaxItems: 500 },
      abortFlag: new Int32Array(new SharedArrayBuffer(4)),
      createTransport: () => {
        const transport = new FakeTransport();
        transports.push(transport);
        return transport;
      },
      onFolder: (record) => folders.push(record),
      onProgress: (update) => progress.push(update),
    });
  return { transports, folders, progress, make };
}

const ROOT = 'F:\\synthetic';

describe('ScanCoordinator', () => {
  it('assigns the root task when a worker reports ready', async () => {
    const h = harness();
    const run = h.make().run();
    h.transports[0]!.emit({ type: 'ready' });
    expect(h.transports[0]!.lastTask()).toEqual({ path: ROOT, isRoot: true });
    h.transports[0]!.emit(batch([open(ROOT, true)]));
    const result = await run;
    expect(result.rootRecord.path).toBe(ROOT);
  });

  it('finalizes children before parents and never streams the root record', async () => {
    const h = harness();
    const order: string[] = [];
    const coordinator = new ScanCoordinator({
      root: ROOT,
      workerCount: 1,
      limits: { splitAfterEntries: 20_000, batchIntervalMs: 200, batchMaxItems: 500 },
      abortFlag: new Int32Array(new SharedArrayBuffer(4)),
      createTransport: () => {
        const transport = new FakeTransport();
        h.transports.push(transport);
        return transport;
      },
      onFolder: (record) => order.push(record.path),
    });
    const run = coordinator.run();
    const t = h.transports[0]!;
    t.emit({ type: 'ready' });
    t.emit(batch([open(ROOT, true, { childDirs: [join(ROOT, 'a')], directBytes: 1 })]));
    t.emit(batch([open(join(ROOT, 'a'), false, { directBytes: 5, directFileCount: 1, childDirs: [join(ROOT, 'a', 'b')] })]));
    t.emit(batch([open(join(ROOT, 'a', 'b'), false, { directBytes: 7, directFileCount: 1 })]));

    const result = await run;
    expect(order).toEqual([join(ROOT, 'a', 'b'), join(ROOT, 'a')]);
    expect(result.rootRecord).toMatchObject({
      path: ROOT,
      bytes: 13,
      fileCount: 2,
      folderCount: 2,
      partial: false,
    });
  });

  it('waits for every child before finalizing a parent', async () => {
    // Root has children a and b; a arrives complete first, root must wait for b.
    const h = harness();
    const coordinator = new ScanCoordinator({
      root: ROOT,
      workerCount: 1,
      limits: { splitAfterEntries: 20_000, batchIntervalMs: 200, batchMaxItems: 500 },
      abortFlag: new Int32Array(new SharedArrayBuffer(4)),
      createTransport: () => {
        const transport = new FakeTransport();
        h.transports.push(transport);
        return transport;
      },
      onFolder: (record) => h.folders.push(record),
    });
    const run = coordinator.run();
    const t = h.transports[0]!;
    t.emit({ type: 'ready' });
    t.emit(batch([open(ROOT, true, { childDirs: [join(ROOT, 'a'), join(ROOT, 'b')] })]));
    t.emit(batch([open(join(ROOT, 'a'), false, { directBytes: 2 })]));
    expect(h.folders.map((f) => f.path)).toEqual([join(ROOT, 'a')]);
    t.emit(batch([open(join(ROOT, 'b'), false, { directBytes: 3 })]));
    const result = await run;
    expect(h.folders.map((f) => f.path)).toEqual([join(ROOT, 'a'), join(ROOT, 'b')]);
    expect(result.rootRecord.bytes).toBe(5);
  });

  it('handles a child that finalizes before its parent has been opened', async () => {
    const h = harness();
    const coordinator = new ScanCoordinator({
      root: ROOT,
      workerCount: 1,
      limits: { splitAfterEntries: 20_000, batchIntervalMs: 200, batchMaxItems: 500 },
      abortFlag: new Int32Array(new SharedArrayBuffer(4)),
      createTransport: () => {
        const transport = new FakeTransport();
        h.transports.push(transport);
        return transport;
      },
      onFolder: (record) => h.folders.push(record),
    });
    const run = coordinator.run();
    const t = h.transports[0]!;
    t.emit({ type: 'ready' });
    t.emit(batch([open(join(ROOT, 'late'), false, { directBytes: 4 })]));
    t.emit(batch([open(ROOT, true, { childDirs: [join(ROOT, 'late')] })]));
    const result = await run;
    expect(result.rootRecord.bytes).toBe(4);
    expect(h.folders.map((f) => f.path)).toEqual([join(ROOT, 'late')]);
  });

  it('queues submitted tasks and dispatches to idle workers', async () => {
    const h = harness(2);
    const coordinator = h.make();
    const run = coordinator.run();
    const [w0, w1] = h.transports;
    w0!.emit({ type: 'ready' });
    w0!.emit(batch([open(ROOT, true, { childDirs: [join(ROOT, 'a'), join(ROOT, 'b')] })], { submits: [join(ROOT, 'a'), join(ROOT, 'b')] }));
    // w0 stays busy with the root task; the idle w1 claims the first queued task.
    w1!.emit({ type: 'ready' });
    expect(w1!.lastTask()?.path).toBe(join(ROOT, 'a'));

    w1!.emit(batch([open(join(ROOT, 'a'), false, { directBytes: 1 })]));
    w1!.emit({ type: 'ready' });
    expect(w1!.lastTask()?.path).toBe(join(ROOT, 'b'));

    w1!.emit(batch([open(join(ROOT, 'b'), false, { directBytes: 1 })]));
    const result = await run;
    expect(result.rootRecord.bytes).toBe(2);
  });

  it('forwards markers and aggregates progress', async () => {
    const h = harness();
    const coordinator = h.make();
    const run = coordinator.run();
    const t = h.transports[0]!;
    t.emit({ type: 'ready' });
    t.emit({
      type: 'batch',
      batch: {
        dirOpens: [open(ROOT, true)],
        markers: [{ kind: 'package-json', path: join(ROOT, 'package.json') }],
        submits: [],
        progress: { filesSeen: 3, bytesSeen: 30, errors: 1, currentPath: ROOT },
      },
    });
    const result = await run;
    expect(result.markers).toEqual([{ kind: 'package-json', path: join(ROOT, 'package.json') }]);
    expect(result.filesScanned).toBe(3);
    expect(result.bytesSeen).toBe(30);
    expect(result.errors).toBe(1);
  });

  it('terminates transports once the root record is final', async () => {
    const h = harness();
    const coordinator = h.make();
    const run = coordinator.run();
    h.transports[0]!.emit({ type: 'ready' });
    h.transports[0]!.emit(batch([open(ROOT, true)]));
    await run;
    expect(h.transports[0]!.terminated).toBe(true);
  });
});
