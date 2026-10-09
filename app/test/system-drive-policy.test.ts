import { join } from 'node:path';
import { SnapshotStore } from '@dust/core';
import type { VolumeInfo } from '@dust/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngineHost } from '../src/main/host/engine-host';
import type { EngineHostDeps } from '../src/main/host/engine-host';
import { FakeSession, emptyScanResult, nextEvent } from './fakes';
import { TempTree } from './fixtures';
import { VolumeSnapshotStore } from '../src/main/host/volume-store';

const SYSTEM = 'C:\\';
const DATA = 'T:\\';

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
});
