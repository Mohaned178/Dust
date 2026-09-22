import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AggregateTree, SnapshotStore, volumeRootOf } from '@dust/core';
import type { FolderRecord, ScanResult } from '@dust/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngineHost } from '../src/main/host/engine-host';
import { registerIpcHandlers } from '../src/main/ipc';
import type { IpcRegistrar } from '../src/main/ipc';
import { IPC } from '../src/shared/ipc';
import type { BrowseDeleteResult, BrowseState, StartAnalyzeResult } from '../src/shared/ipc';
import { FakeSession, emptyScanResult, nextEvent } from './fakes';
import { TempTree } from './fixtures';

class FakeRegistrar implements IpcRegistrar {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler registered for ${channel}`);
    return handler({}, ...args);
  }
}

function folder(path: string, bytes = 10): FolderRecord {
  return {
    path,
    bytes,
    allocatedBytes: bytes,
    fileCount: 1,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
  };
}

describe('browse IPC', () => {
  let tree: TempTree;
  let store: SnapshotStore;

  beforeEach(() => {
    tree = new TempTree();
    store = new SnapshotStore({
      snapshotPath: join(tree.root, 'snapshot.json'),
      userPath: join(tree.root, 'user.json'),
    });
  });

  afterEach(() => {
    tree.cleanup();
  });

  function volumeRoot(): string {
    return volumeRootOf(tree.root)!;
  }

  function makeHost(holder: { session?: FakeSession }) {
    return createEngineHost({
      store,
      pool: false,
      systemRoot: 'Z:\\',
      env: {
        temp: join(tree.root, 'temp'),
        localAppData: join(tree.root, 'local'),
        appData: join(tree.root, 'roaming'),
        userProfile: join(tree.root, 'profile'),
        windowsDir: join(tree.root, 'windows'),
        programData: join(tree.root, 'program-data'),
      },
      listVolumes: () => [{ root: volumeRoot(), label: 'Data', driveType: 'fixed' }],
      getVolumeUsage: () => [],
      createRules: () => [],
      createSession: (options) => (holder.session = new FakeSession(options)),
      folderIntervalMs: 0,
    });
  }

  function makeRegistrar(host: ReturnType<typeof makeHost>) {
    const registrar = new FakeRegistrar();
    const unsubscribe = registerIpcHandlers(
      registrar,
      host,
      { send: () => {} },
      { revealPath: async () => {}, relaunchElevated: async () => {} },
    );
    return { registrar, unsubscribe };
  }

  it('routes browse start, results and delete through IPC', async () => {
    tree.file('junk/a.txt', 'abcdef');
    const holder: { session?: FakeSession } = {};
    const host = makeHost(holder);
    const { registrar, unsubscribe } = makeRegistrar(host);

    const started = (await registrar.invoke(IPC.browseStart, volumeRoot())) as StartAnalyzeResult;
    expect(started.ok).toBe(true);
    holder.session!.options.onFolder?.(folder(join(tree.root, 'junk')));
    holder.session!.finish(emptyScanResult(volumeRoot(), 'complete'));
    await nextEvent(host, 'browse-finished');

    const state = (await registrar.invoke(IPC.browseResultsGet, volumeRoot())) as BrowseState;
    expect(state.source).toBe('live');
    expect(state.rows.map((row) => row.path)).toContain(join(tree.root, 'junk'));

    const deleted = (await registrar.invoke(IPC.browseDelete, join(tree.root, 'junk', 'a.txt'))) as BrowseDeleteResult;
    expect(deleted).toMatchObject({ status: 'done', deletedBytes: 6 });
    expect(existsSync(join(tree.root, 'junk', 'a.txt'))).toBe(false);

    unsubscribe();
    host.dispose();
  });

  it('refuses a delete outside the browsed root', async () => {
    const holder: { session?: FakeSession } = {};
    const host = makeHost(holder);
    const { registrar, unsubscribe } = makeRegistrar(host);

    const deleted = (await registrar.invoke(IPC.browseDelete, 'Q:\\outside')) as BrowseDeleteResult;
    expect(deleted).toMatchObject({ status: 'refused', refusal: 'not-browsed' });

    unsubscribe();
    host.dispose();
  });

  it('refuses a protected path inside the browsed root', async () => {
    tree.dir('windows/Temp');
    const holder: { session?: FakeSession } = {};
    const host = makeHost(holder);
    const { registrar, unsubscribe } = makeRegistrar(host);

    await registrar.invoke(IPC.browseStart, volumeRoot());
    holder.session!.finish(emptyScanResult(volumeRoot(), 'complete'));
    await nextEvent(host, 'browse-finished');

    const deleted = (await registrar.invoke(IPC.browseDelete, join(tree.root, 'windows', 'Temp'))) as BrowseDeleteResult;
    expect(deleted).toMatchObject({ status: 'refused', refusal: 'inside-protected' });
    expect(existsSync(join(tree.root, 'windows', 'Temp'))).toBe(true);

    unsubscribe();
    host.dispose();
  });

  it('refuses a delete while a scan is running', async () => {
    tree.dir('junk');
    const holder: { session?: FakeSession } = {};
    const host = makeHost(holder);

    await host.startBrowse(volumeRoot());
    const deleted = await host.deleteBrowsePath(join(tree.root, 'junk'));
    expect(deleted).toMatchObject({ status: 'refused', refusal: 'busy' });

    holder.session!.finish(emptyScanResult(volumeRoot(), 'cancelled'));
    await nextEvent(host, 'browse-finished');
  });

  it('prunes deleted rows and updates ancestor sizes', async () => {
    tree.file('junk/a.txt', 'abcdef');
    const holder: { session?: FakeSession } = {};
    const host = makeHost(holder);
    const junk = join(tree.root, 'junk');

    await host.startBrowse(volumeRoot());
    holder.session!.options.onFolder?.(folder(junk));
    const resultTree = new AggregateTree();
    resultTree.addFolder(folder(junk));
    resultTree.addFolder(folder(volumeRoot()));
    const result: ScanResult = {
      root: volumeRoot(),
      status: 'complete',
      tree: resultTree,
      startedAt: 0,
      finishedAt: 1,
      filesScanned: 1,
      bytesSeen: 10,
      errors: 0,
      markers: [],
    };
    holder.session!.finish(result);
    await nextEvent(host, 'browse-finished');

    const deleted = await host.deleteBrowsePath(junk);
    expect(deleted).toMatchObject({ status: 'done', deletedBytes: 6 });

    const state = host.getBrowseResults(volumeRoot());
    expect(state.rows.map((row) => row.path)).not.toContain(junk);
    expect(state.rows.find((row) => row.path === volumeRoot())?.bytes).toBe(4);
  });
});
