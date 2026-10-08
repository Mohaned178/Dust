import { join } from 'node:path';
import { SnapshotStore } from '@dust/core';
import type { FolderRecord, VolumeInfo } from '@dust/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngineHost } from '../src/main/host/engine-host';
import type { EngineHostDeps } from '../src/main/host/engine-host';
import type { ScanEvent } from '../src/shared/ipc';
import { FakeSession, emptyScanResult, nextEvent } from './fakes';
import { TempTree } from './fixtures';
import { VolumeSnapshotStore } from '../src/main/host/volume-store';

const SYSTEM = 'C:\\';
const DATA = 'T:\\';

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

describe('drive policy', () => {
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

  function volumes(): VolumeInfo[] {
    return [
      { root: SYSTEM, label: 'System', driveType: 'fixed', mediaType: 'unknown' },
      { root: DATA, label: 'Data', driveType: 'fixed', mediaType: 'unknown' },
    ];
  }

  function makeHost(overrides: Partial<EngineHostDeps> = {}) {
    return createEngineHost({
      store,
      pool: false,
      systemRoot: SYSTEM,
      listVolumes: volumes,
      getVolumeUsage: () => [],
      createRules: () => [],
      folderIntervalMs: 0,
      ...overrides,
    });
  }

  it('analyzes any volume and keeps a separate snapshot per drive', async () => {
    const volumeStore = new VolumeSnapshotStore(tree.root, SYSTEM);
    const session = new FakeSession({ root: DATA });
    const host = makeHost({ store: volumeStore, createSession: () => session });
    const finished = nextEvent(host, 'finished');

    expect(await host.startAnalyze(DATA)).toMatchObject({ ok: true });
    session.finish(emptyScanResult(DATA, 'complete'));
    await finished;

    expect(volumeStore.load(DATA)).toMatchObject({ kind: 'ok', snapshot: { root: DATA } });
    expect(volumeStore.load(SYSTEM).kind).toBe('missing');
    const card = (await host.getDashboard()).volumes.find((volume) => volume.root === DATA);
    expect(card?.lastAnalyzedAt).not.toBeNull();
  });

  it('allows Analyze for the system volume', async () => {
    const session = new FakeSession({ root: SYSTEM });
    const host = makeHost({ createSession: () => session });
    const finished = nextEvent(host, 'finished');

    expect(await host.startAnalyze(SYSTEM)).toMatchObject({ ok: true });
    session.finish(emptyScanResult(SYSTEM, 'complete'));
    await finished;
  });

  it('refuses cleanup for a non-system root', async () => {
    const host = makeHost();

    expect(await host.previewClean({ scope: 'row', root: DATA, paths: [join(DATA, 'junk')] })).toMatchObject({
      ok: false,
      reason: 'invalid-root',
    });
  });

  it('serves dev cleanup for whichever drive was analyzed', async () => {
    const volumeStore = new VolumeSnapshotStore(tree.root, SYSTEM);
    const seedSession = new FakeSession({ root: DATA });
    const seeder = makeHost({ store: volumeStore, createSession: () => seedSession });
    const finished = nextEvent(seeder, 'finished');
    await seeder.startAnalyze(DATA);
    seedSession.finish(emptyScanResult(DATA, 'complete'));
    await finished;

    const host = makeHost({ store: volumeStore });
    expect(host.getDevCleanup(DATA).source).toBe('snapshot');
    expect(host.getDevCleanup(SYSTEM).source).toBe('empty');
  });

  it('accepts pins on any drive', () => {
    const host = makeHost();

    expect(host.setPin(join(DATA, 'dev'), true)).toMatchObject({ ok: true });
    expect(host.setPin(join(SYSTEM, 'dev'), true)).toMatchObject({ ok: true });
  });

  it('browses a non-system volume without grades and without a snapshot', async () => {
    let session!: FakeSession;
    const host = makeHost({ createSession: (options) => (session = new FakeSession(options)) });
    const events: ScanEvent[] = [];
    host.onEvent((event) => events.push(event));

    expect(await host.startBrowse(DATA)).toMatchObject({ ok: true });
    session.options.onFolder?.(folder(join(DATA, 'Games')));
    session.options.onFolder?.(folder(join(DATA, 'Games', 'save')));
    session.finish(emptyScanResult(DATA, 'complete'));
    await nextEvent(host, 'browse-finished');

    const rows = events
      .filter((event): event is Extract<ScanEvent, { type: 'browse-folders' }> => event.type === 'browse-folders')
      .flatMap((event) => event.folders);
    expect(rows.map((row) => row.path)).toEqual([join(DATA, 'Games'), join(DATA, 'Games', 'save')]);
    expect(rows[0]).not.toHaveProperty('grade');
    expect(events.some((event) => event.type === 'finished')).toBe(false);

    expect(store.load().kind).toBe('missing');
    const state = host.getBrowseResults(DATA);
    expect(state.source).toBe('live');
    expect(state.rows).toHaveLength(2);
    expect(host.getBrowseResults(SYSTEM).source).toBe('empty');
  });

  it('shares the global scan lock between Analyze and Browse', async () => {
    const analyzeSession = new FakeSession({ root: SYSTEM });
    const browseSession = new FakeSession({ root: DATA });
    let created = 0;
    const host = makeHost({
      createSession: () => {
        created += 1;
        return created === 1 ? analyzeSession : browseSession;
      },
    });

    await host.startAnalyze(SYSTEM);
    expect(await host.startBrowse(DATA)).toMatchObject({ ok: false, reason: 'busy' });

    const finished = nextEvent(host, 'finished');
    analyzeSession.finish(emptyScanResult(SYSTEM, 'cancelled'));
    await finished;

    expect(await host.startBrowse(DATA)).toMatchObject({ ok: true });
    const browseFinished = nextEvent(host, 'browse-finished');
    browseSession.finish(emptyScanResult(DATA, 'complete'));
    await browseFinished;
  });
});
