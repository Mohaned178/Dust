import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanCoordinator } from '../src/scan/coordinator';
import { createNodeWorkerTransport } from '../src/scan/node-worker';
import type { WorkerInit } from '../src/scan/protocol';
import { AggregateTree } from '../src/model/tree';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { createExclusionPredicate } from '../src/scanner/exclusions';
import { scanTree } from '../src/scanner/scanner';
import { DEFAULT_POOL_LIMITS } from '../src/scan/limits';
import { Fixture } from './fixtures';

const workerPath = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'scan', 'worker-entry.ts');
const DAY = 24 * 60 * 60 * 1000;

function minimalInit(root: string): WorkerInit {
  const abortFlag = new Int32Array(new SharedArrayBuffer(4));
  return {
    workerId: 0,
    root,
    exclusions: {},
    limits: DEFAULT_POOL_LIMITS,
    abortFlag: abortFlag.buffer,
  };
}

describe('createNodeWorkerTransport options', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('throws an instructive error when neither workerPath nor execArgv is provided', () => {
    expect(() => createNodeWorkerTransport(minimalInit(fixture.root))).toThrow(
      /default TypeScript worker entry cannot run under plain Node/,
    );
  });

  it('does not throw at construction with explicit workerPath and execArgv', async () => {
    const transport = createNodeWorkerTransport(minimalInit(fixture.root), {
      workerPath,
      execArgv: ['--import', 'tsx'],
    });
    await transport.terminate();
  });
});

describe('pool integration (real worker threads)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('produces the same aggregate tree as the single-threaded walker', async () => {
    fixture.file('project/package.json', '{}');
    fixture.file('project/src/index.ts', 'xxxx');
    fixture.file('project/node_modules/dep/a.js', 'yyyyyy');
    fixture.file('project/node_modules/dep/node_modules/inner/b.js', 'zz');
    fixture.file('other/data.txt', 'q');
    fixture.file('other/deep/nested/file.bin', '0123456789', 1_750_000_000_000);

    const legacy = scanTree({
      root: fixture.root,
      enumerator: new NodeFsEnumerator(),
      isExcluded: createExclusionPredicate(),
    });

    const abortFlag = new Int32Array(new SharedArrayBuffer(4));
    const coordinator = new ScanCoordinator({
      root: fixture.root,
      workerCount: 2,
      limits: DEFAULT_POOL_LIMITS,
      abortFlag,
      createTransport: (workerId) =>
        createNodeWorkerTransport(
          {
            workerId,
            root: fixture.root,
            exclusions: {},
            limits: DEFAULT_POOL_LIMITS,
            abortFlag: abortFlag.buffer,
          },
          { workerPath, execArgv: ['--import', 'tsx'] },
        ),
    });

    const pooled = await coordinator.run();

    expect(pooled.rootRecord).toEqual(legacy.rootRecord);
    expect(new Set(pooled.markers.map((m) => `${m.kind}:${m.path}`))).toEqual(
      new Set(legacy.markers.map((m) => `${m.kind}:${m.path}`)),
    );
    expect(pooled.filesScanned).toBe(legacy.filesScanned);
    expect(pooled.bytesSeen).toBe(legacy.bytesSeen);
  }, 30_000);

  it('splits large trees into multiple tasks without changing the result', async () => {
    for (let d = 0; d < 12; d += 1) {
      for (let f = 0; f < 10; f += 1) {
        fixture.file(`dir-${d}/file-${f}.txt`, 'abc');
      }
    }

    const legacy = scanTree({
      root: fixture.root,
      enumerator: new NodeFsEnumerator(),
      isExcluded: createExclusionPredicate(),
    });

    const limits = { ...DEFAULT_POOL_LIMITS, splitAfterEntries: 8 };
    const abortFlag = new Int32Array(new SharedArrayBuffer(4));
    const coordinator = new ScanCoordinator({
      root: fixture.root,
      workerCount: 2,
      limits,
      abortFlag,
      createTransport: (workerId) =>
        createNodeWorkerTransport(
          {
            workerId,
            root: fixture.root,
            exclusions: {},
            limits,
            abortFlag: abortFlag.buffer,
          },
          { workerPath, execArgv: ['--import', 'tsx'] },
        ),
    });

    const pooled = await coordinator.run();
    expect(pooled.rootRecord).toEqual(legacy.rootRecord);
  }, 30_000);

  it('ignores node_modules and .git mtimes after task splits', async () => {
    const old = Math.floor(Date.now() / 1000) * 1000 - 200 * DAY;
    fixture.file('app/package.json', '{}', old);
    fixture.file('app/src/index.ts', 'x', old);
    fixture.file('app/node_modules/dep/index.js', 'yyyy');

    const legacy = scanTree({
      root: fixture.root,
      enumerator: new NodeFsEnumerator(),
      isExcluded: createExclusionPredicate(),
    });

    const limits = { ...DEFAULT_POOL_LIMITS, splitAfterEntries: 1 };
    const abortFlag = new Int32Array(new SharedArrayBuffer(4));
    const tree = new AggregateTree();
    const coordinator = new ScanCoordinator({
      root: fixture.root,
      workerCount: 2,
      limits,
      abortFlag,
      createTransport: (workerId) =>
        createNodeWorkerTransport(
          {
            workerId,
            root: fixture.root,
            exclusions: {},
            limits,
            abortFlag: abortFlag.buffer,
          },
          { workerPath, execArgv: ['--import', 'tsx'] },
        ),
      onFolder: (record) => tree.addFolder(record),
    });

    const pooled = await coordinator.run();
    tree.addFolder(pooled.rootRecord);

    expect(pooled.rootRecord.newestMtimeMs).toBe(legacy.rootRecord.newestMtimeMs);
    expect(tree.get(join(fixture.root, 'app'))!.newestMtimeMs).toBe(old);
  }, 30_000);
});
