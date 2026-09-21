import { join } from 'node:path';
import { SnapshotStore, volumeRootOf } from '@dust/core';
import type { ProjectOptions, Rule, RuleContext, RuleEnv, VolumeInfo } from '@dust/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngineHost } from '../src/main/host/engine-host';
import { FakeSession, emptyScanResult, nextEvent } from './fakes';
import { TempTree } from './fixtures';

function ruleEnvFor(root: string): RuleEnv {
  return {
    temp: join(root, 'temp'),
    localAppData: join(root, 'local'),
    appData: join(root, 'roaming'),
    userProfile: join(root, 'profile'),
    windowsDir: join(root, 'windows'),
    programData: join(root, 'program-data'),
  };
}

function tempRule(root: string): Rule {
  return {
    id: 'fixture-temp',
    category: 'temp',
    title: 'Fixture temp',
    action: { kind: 'delete-path' },
    match: (ctx: RuleContext) => {
      const path = join(root, 'temp');
      return [
        {
          path,
          bytes: ctx.tree.get(path)?.bytes ?? 0,
          grade: 'safe',
          recovery: { kind: 'junk', reason: 'fixture junk' },
          evidence: 'fixture',
        },
      ];
    },
  };
}

describe('createEngineHost', () => {
  let tree: TempTree;
  let storeTree: TempTree;
  let store: SnapshotStore;

  beforeEach(() => {
    tree = new TempTree();
    storeTree = new TempTree();
    store = new SnapshotStore({
      snapshotPath: join(storeTree.root, 'snapshot.json'),
      userPath: join(storeTree.root, 'user.json'),
    });
  });

  afterEach(() => {
    tree.cleanup();
    storeTree.cleanup();
  });

  function volumeList(): VolumeInfo[] {
    return [{ root: volumeRootOf(tree.root)!, label: 'Fixtures', driveType: 'fixed' }];
  }

  it('runs a real scan end to end and persists the snapshot', async () => {
    tree.file('temp/junk.bin', 'abcdefghij');
    tree.file('proj/package.json', JSON.stringify({ name: 'proj' }));
    tree.file('proj/package-lock.json', '{}');
    tree.file('proj/node_modules/dep/index.js', '0123');

    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [{ volume: volumeList()[0]!.root, label: 'Fixtures', totalBytes: 1000, freeBytes: 400 }],
      createRules: () => [tempRule(tree.root)],
    });

    const finished = nextEvent(host, 'finished');
    const started = await host.startAnalyze(tree.root);
    expect(started.ok).toBe(true);

    const event = await finished;
    expect(event).toMatchObject({ type: 'finished', status: 'complete', saved: true, projects: 1, reclaimableBytes: 10 });

    const loaded = store.load();
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.snapshot.root).toBe(tree.root);
    expect(loaded.snapshot.categories).toEqual([{ ruleId: 'fixture-temp', category: 'temp', bytes: 10, items: 1 }]);
    expect(loaded.snapshot.projects.map((project) => project.name)).toContain('proj');
    expect(loaded.snapshot.folders.some((folder) => folder.path === join(tree.root, 'temp'))).toBe(true);

    const card = host.getDashboard().volumes.find((volume) => volume.root.toLowerCase() === volumeList()[0]!.root.toLowerCase());
    expect(card?.lastAnalyzedAt).not.toBeNull();
    expect(card?.reclaimableBytes).toBe(10);
  });

  it('refuses a second analyze while the first is running', async () => {
    const fake = new FakeSession({ root: tree.root });
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
      createSession: () => fake,
    });

    const first = await host.startAnalyze(tree.root);
    expect(first.ok).toBe(true);
    const second = await host.startAnalyze(tree.root);
    expect(second).toEqual({ ok: false, reason: 'busy', running: 'analyze' });
    expect(host.getDashboard().scan).toMatchObject({ kind: 'analyze', root: volumeList()[0]!.root });

    const cancelled = host.cancelScan();
    fake.finish(emptyScanResult(tree.root, 'cancelled'));
    await nextEvent(host, 'finished');
    expect(await cancelled).toBe(true);
    expect(host.getDashboard().scan).toBeNull();
  });

  it('cancels a running scan and persists a cancelled snapshot', async () => {
    const fake = new FakeSession({ root: tree.root });
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
      createSession: () => fake,
    });

    const finished = nextEvent(host, 'finished');
    await host.startAnalyze(tree.root);
    const cancelled = host.cancelScan();
    expect(fake.cancelled).toBe(true);
    fake.finish(emptyScanResult(tree.root, 'cancelled'));
    expect(await cancelled).toBe(true);

    const event = await finished;
    expect(event).toMatchObject({ status: 'cancelled', saved: true });
    const loaded = store.load();
    expect(loaded.kind === 'ok' && loaded.snapshot.status).toBe('cancelled');
  });

  it('waits for lock release on cancel so an immediate retry is not busy', async () => {
    const fake = new FakeSession({ root: tree.root });
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
      createSession: () => fake,
    });

    await host.startAnalyze(tree.root);
    const cancelled = host.cancelScan();
    expect(fake.cancelled).toBe(true);
    expect(host.getDashboard().scan).not.toBeNull();

    fake.finish(emptyScanResult(tree.root, 'cancelled'));
    expect(await cancelled).toBe(true);
    expect(host.getDashboard().scan).toBeNull();
    expect(await host.startAnalyze(tree.root)).toMatchObject({ ok: true });

    const retried = host.cancelScan();
    fake.finish(emptyScanResult(tree.root, 'cancelled'));
    expect(await retried).toBe(true);
  });

  it('reports a failed run and releases the lock', async () => {
    const fake = new FakeSession({ root: tree.root });
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
      createSession: () => fake,
    });

    const failed = nextEvent(host, 'failed');
    await host.startAnalyze(tree.root);
    fake.fail(new Error('worker exploded'));
    const event = await failed;

    expect(event).toMatchObject({ type: 'failed', message: 'worker exploded' });
    expect(host.getDashboard().scan).toBeNull();
  });

  it('passes pins and an external-drive predicate into rule creation', async () => {
    store.setPins([join(tree.root, 'pinned')]);
    const captured: ProjectOptions[] = [];
    const externalRoot = 'R:\\';
    const fake = new FakeSession({ root: tree.root });
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: () => [...volumeList(), { root: externalRoot, label: 'USB', driveType: 'removable' }],
      getVolumeUsage: () => [],
      createRules: (_env, projects) => {
        captured.push(projects);
        return [];
      },
      createSession: () => fake,
    });

    const finished = nextEvent(host, 'finished');
    await host.startAnalyze(tree.root);
    fake.finish(emptyScanResult(tree.root, 'complete'));
    await finished;

    expect(captured).toHaveLength(1);
    const projects = captured[0]!;
    expect(projects.pins).toEqual([join(tree.root, 'pinned')]);
    expect(projects.isExternal!(join(externalRoot, 'proj'))).toBe(true);
    expect(projects.isExternal!(join(tree.root, 'proj'))).toBe(false);
  });

  it('rejects an unknown volume without acquiring the lock', async () => {
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
    });
    expect(await host.startAnalyze('Z:\\')).toEqual({
      ok: false,
      reason: 'invalid-volume',
      message: 'unknown volume: Z:\\',
    });
    expect(host.getDashboard().scan).toBeNull();
  });

  it('reports a start failure and releases the lock', async () => {
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
      createSession: () => {
        throw new Error('no worker');
      },
    });

    expect(await host.startAnalyze(tree.root)).toEqual({ ok: false, reason: 'start-failed', message: 'no worker' });
    expect(host.getDashboard().scan).toBeNull();
  });

  it('isolates a throwing listener from the run outcome', async () => {
    const fake = new FakeSession({ root: tree.root });
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
      createSession: () => fake,
    });

    const seen: string[] = [];
    host.onEvent(() => {
      throw new Error('listener exploded');
    });
    host.onEvent((event) => {
      seen.push(event.type);
    });

    const finished = nextEvent(host, 'finished');
    const started = await host.startAnalyze(tree.root);
    expect(started.ok).toBe(true);
    fake.finish(emptyScanResult(tree.root, 'complete'));
    const event = await finished;

    expect(event).toMatchObject({ type: 'finished', status: 'complete', saved: true });
    expect(seen).toEqual(['started', 'finalizing', 'finished']);
    expect(seen).not.toContain('failed');
  });
});
