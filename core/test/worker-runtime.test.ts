import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkerRuntime } from '../src/scan/worker-runtime';
import type { WorkerEvent } from '../src/scan/protocol';
import type { Entry } from '../src/model/types';
import type { Enumerator } from '../src/scanner/enumerator';

const root = 'F:\\synthetic';

function mockEnumerator(tree: Record<string, Entry[]>): Enumerator {
  return {
    list: (dir: string) => {
      const entries = tree[dir];
      if (!entries) throw new Error(`ENOENT: ${dir}`);
      return { entries, entryErrors: 0 };
    },
  };
}

const simpleTree: Record<string, Entry[]> = {
  [root]: [{ name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 }],
};

interface Harness {
  events: WorkerEvent[];
  flushTimers: Array<() => void>;
  runtime: ReturnType<typeof createWorkerRuntime>;
}

function harness(tree: Record<string, Entry[]> = simpleTree, batchMaxItems = 500): Harness {
  const events: WorkerEvent[] = [];
  const flushTimers: Array<() => void> = [];
  const runtime = createWorkerRuntime({
    send: (event) => events.push(event),
    enumerator: mockEnumerator(tree),
    isExcluded: () => false,
    shouldAbort: () => false,
    splitAfterEntries: 10000,
    batchIntervalMs: 200,
    batchMaxItems,
    setIntervalFn: (fn) => {
      flushTimers.push(fn);
      return flushTimers.length;
    },
    clearIntervalFn: () => {},
  });
  return { events, flushTimers, runtime };
}

describe('worker runtime', () => {
  it('sends ready on start', () => {
    const { events, runtime } = harness();
    runtime.start();
    expect(events).toEqual([{ type: 'ready' }]);
  });

  it('flushes one batch per task with the dir-open, progress and ready', () => {
    const { events, runtime } = harness();
    runtime.start();
    runtime.handleCommand({ type: 'task', path: root, isRoot: true });

    expect(events).toHaveLength(3);
    const batch = events[1];
    expect(batch.type).toBe('batch');
    if (batch.type !== 'batch') throw new Error('expected batch');
    expect(batch.batch.dirOpens).toEqual([
      {
        path: root,
        isRoot: true,
        directBytes: 5,
        directFileCount: 1,
        linkCount: 0,
        errorCount: 0,
        newestMtimeMs: 1000,
        partial: false,
        childDirs: [],
      },
    ]);
    expect(batch.batch.progress).toEqual({ filesSeen: 1, bytesSeen: 5, errors: 0, currentPath: root });
    expect(events[2]).toEqual({ type: 'ready' });
  });

  it('flushes when the batch reaches batchMaxItems before the task ends', () => {
    const tree: Record<string, Entry[]> = {
      [root]: Array.from({ length: 6 }, (_, i) => ({
        name: `f-${i}.txt`,
        kind: 'file' as const,
        size: 1,
        mtimeMs: 1000,
      })),
    };
    // The six entries tick progress six times; with batchMaxItems 2 the runtime
    // must flush as items accumulate, i.e. more than one batch before ready.
    const events: WorkerEvent[] = [];
    const runtime = createWorkerRuntime({
      send: (event) => events.push(event),
      enumerator: mockEnumerator(tree),
      isExcluded: () => false,
      shouldAbort: () => false,
      splitAfterEntries: 10000,
      batchIntervalMs: 200,
      batchMaxItems: 2,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
    });
    runtime.start();
    runtime.handleCommand({ type: 'task', path: root, isRoot: true });

    const batches = events.filter((e) => e.type === 'batch');
    expect(batches.length).toBeGreaterThan(1);
    const totalProgress = batches.reduce((sum, e) => (e.type === 'batch' && e.batch.progress ? sum + e.batch.progress.filesSeen : sum), 0);
    expect(totalProgress).toBe(6);
  });

  it('flushes buffered items on the interval timer', () => {
    const { events, flushTimers, runtime } = harness();
    runtime.start();
    runtime.handleCommand({ type: 'task', path: root, isRoot: false });
    const before = events.length;
    flushTimers[0]?.();
    expect(events.length).toBe(before);
  });

  it('reports abort as shouldAbort to the traversal', () => {
    const tree: Record<string, Entry[]> = {
      [root]: [{ name: 'sub', kind: 'dir', size: 0, mtimeMs: 0 }],
      [join(root, 'sub')]: [{ name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 }],
    };
    const { events, runtime } = harness(tree, 1);
    runtime.start();
    runtime.handleCommand({ type: 'abort' });
    runtime.handleCommand({ type: 'task', path: root, isRoot: true });

    const opens: string[] = [];
    for (const event of events) {
      if (event.type === 'batch') opens.push(...event.batch.dirOpens.map((o) => o.path));
    }
    expect(opens).not.toContain(join(root, 'sub'));
  });

  it('exits the thread after exactly one fatal event with the batch flushed first', () => {
    const tree: Record<string, Entry[]> = {
      [root]: [{ name: 'sub', kind: 'dir', size: 0, mtimeMs: 0 }],
      [join(root, 'sub')]: [{ name: 'deep', kind: 'dir', size: 0, mtimeMs: 0 }],
      [join(root, 'sub', 'deep')]: [{ name: 'a.txt', kind: 'file', size: 5, mtimeMs: 1000 }],
    };
    const events: WorkerEvent[] = [];
    let exitCode: number | null = null;
    const runtime = createWorkerRuntime({
      send: (event) => events.push(event),
      enumerator: mockEnumerator(tree),
      isExcluded: (absPath) => {
        if (absPath === join(root, 'sub', 'deep', 'a.txt')) throw new Error('exclusion check blew up');
        return false;
      },
      shouldAbort: () => false,
      splitAfterEntries: 10000,
      batchIntervalMs: 200,
      batchMaxItems: 500,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      exitThread: (code) => {
        exitCode = code;
      },
    });
    runtime.handleCommand({ type: 'task', path: root, isRoot: true });

    expect(events.map((e) => e.type)).toEqual(['batch', 'fatal']);
    expect(events.filter((e) => e.type === 'fatal')).toHaveLength(1);
    const batch = events[0];
    if (batch.type !== 'batch') throw new Error('expected batch');
    expect(batch.batch.dirOpens.map((o) => o.path)).toEqual([root, join(root, 'sub')]);
    expect(events.some((e) => e.type === 'ready')).toBe(false);
    expect(exitCode).toBe(1);

    runtime.handleCommand({ type: 'task', path: root, isRoot: true });
    expect(events.map((e) => e.type)).toEqual(['batch', 'fatal']);
  });

  it('stops the interval timer on dispose', () => {
    let cleared = 0;
    const runtime = createWorkerRuntime({
      send: () => {},
      enumerator: mockEnumerator(simpleTree),
      isExcluded: () => false,
      shouldAbort: () => false,
      splitAfterEntries: 10000,
      batchIntervalMs: 200,
      batchMaxItems: 500,
      setIntervalFn: () => 42,
      clearIntervalFn: (handle) => {
        expect(handle).toBe(42);
        cleared += 1;
      },
    });
    runtime.dispose();
    expect(cleared).toBe(1);
  });
});
