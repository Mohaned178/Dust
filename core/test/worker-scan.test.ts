import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanTask } from '../src/scan/worker-scan';
import type { DirOpen } from '../src/scan/protocol';
import type { Marker } from '../src/model/types';
import type { Entry } from '../src/model/types';
import type { Enumerator } from '../src/scanner/enumerator';

const root = 'F:\\synthetic';

interface Tree {
  dirs?: string[];
  files?: Array<[string, number]>;
}

function mockEnumerator(tree: Record<string, Tree>): Enumerator {
  return {
    list: (dir: string) => {
      const spec = tree[dir];
      if (!spec) throw new Error(`ENOENT: ${dir}`);
      const entries: Entry[] = [
        ...(spec.dirs ?? []).map((name) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0 })),
        ...(spec.files ?? []).map(([name, size]) => ({ name, kind: 'file' as const, size, mtimeMs: 1000 })),
      ];
      return { entries, entryErrors: 0 };
    },
  };
}

interface Sink {
  opens: DirOpen[];
  submits: string[];
  markers: Marker[];
  progress: number;
}

function run(
  tree: Record<string, Tree>,
  splitAfterEntries: number,
  path = root,
  isRoot = true,
  shouldAbort?: () => boolean,
): Sink {
  const sink: Sink = { opens: [], submits: [], markers: [], progress: 0 };
  scanTask(path, isRoot, {
    enumerator: mockEnumerator(tree),
    isExcluded: () => false,
    shouldAbort: shouldAbort ?? (() => false),
    splitAfterEntries,
    clusterSize: 4096,
    openDir: (open) => sink.opens.push(open),
    submitTasks: (paths) => sink.submits.push(...paths),
    marker: (marker) => sink.markers.push(marker),
    progress: () => {
      sink.progress += 1;
    },
  });
  return sink;
}

const tree: Record<string, Tree> = {
  [root]: { dirs: ['a', 'b'] },
  [join(root, 'a')]: { dirs: ['c'] },
  [join(root, 'a', 'c')]: { files: [['f1', 5], ['f2', 7]] },
  [join(root, 'b')]: { files: [['f3', 3]] },
};

describe('scanTask', () => {
  it('opens every directory and never submits when the budget lasts', () => {
    const rootSink = run(tree, 1000);
    expect(rootSink.opens.map((o) => o.path)).toEqual([root]);
    expect(rootSink.submits).toEqual([join(root, 'a'), join(root, 'b')]);
    const rootOpen = rootSink.opens[0]!;
    expect(rootOpen.isRoot).toBe(true);
    expect(rootOpen.childDirs).toEqual([join(root, 'a'), join(root, 'b')]);

    const sink = run(tree, 1000, join(root, 'a'), false);
    expect(sink.opens.map((o) => o.path)).toEqual([join(root, 'a'), join(root, 'a', 'c')]);
    expect(sink.submits).toEqual([]);
    expect(sink.progress).toBe(3);
    expect(sink.opens[0]!.isRoot).toBe(false);
    expect(sink.opens.find((o) => o.path === join(root, 'a', 'c'))!.directAllocatedBytes).toBe(8192);
  });

  it('splits a directory whose children exceed the remaining budget', () => {
    const sink = run(tree, 1, join(root, 'a'), false);
    expect(sink.opens.map((o) => o.path)).toEqual([join(root, 'a')]);
    expect(sink.submits).toEqual([join(root, 'a', 'c')]);
    const a = sink.opens.find((o) => o.path === join(root, 'a'))!;
    expect(a.childDirs).toEqual([join(root, 'a', 'c')]);
  });

  it('does not descend into directories handed off as tasks', () => {
    const sink = run(tree, 1);
    expect(sink.opens.map((o) => o.path)).toEqual([root]);
    expect(sink.submits).toEqual([join(root, 'a'), join(root, 'b')]);
  });

  it('submits a non-root task path and marks isRoot false', () => {
    const sink = run(tree, 1000, join(root, 'a'), false);
    expect(sink.opens[0]!.isRoot).toBe(false);
    expect(sink.opens.map((o) => o.path)).toEqual([join(root, 'a'), join(root, 'a', 'c')]);
  });

  it('stops immediately when shouldAbort is already true', () => {
    const sink = run(tree, 1000, root, true, () => true);
    expect(sink.opens).toEqual([]);
    expect(sink.submits).toEqual([]);
  });

  it('submits the root children immediately', () => {
    const sink = run(
      {
        'F:\\synthetic': { dirs: ['a', 'b'] },
        'F:\\synthetic\\a': {},
        'F:\\synthetic\\b': {},
      },
      20_000,
    );
    expect(sink.submits).toEqual([join(root, 'a'), join(root, 'b')]);
  });
});
