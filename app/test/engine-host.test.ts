import { join } from 'node:path';
import { SnapshotStore, volumeRootOf } from '@dust/core';
import type { ProjectOptions, Rule, RuleContext, RuleEnv, VolumeInfo } from '@dust/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngineHost } from '../src/main/host/engine-host';
import type { ScanEvent } from '../src/shared/ipc';
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

  it('serves retained live results after a run and reports empty for other roots', async () => {
    tree.file('temp/junk.bin', 'abcdefghij');

    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [tempRule(tree.root)],
    });

    const empty = host.getResults(tree.root);
    expect(empty.source).toBe('empty');
    expect(empty.categories).toHaveLength(5);

    const finished = nextEvent(host, 'finished');
    await host.startAnalyze(tree.root);
    await finished;

    const live = host.getResults(tree.root);
    expect(live.source).toBe('live');
    expect(live.depthLimited).toBe(false);
    expect(live.rows.some((row) => row.path === join(tree.root, 'temp'))).toBe(true);
    expect(live.categories.find((row) => row.category === 'temp')?.bytes).toBe(10);

    expect(host.getResults('Z:\\').source).toBe('empty');
  });

  it('builds a depth-limited view from a saved snapshot when no live run matches', () => {
    store.save({
      schemaVersion: 2,
      rulesVersion: '1',
      root: 'C:\\',
      startedAt: 1,
      finishedAt: 2,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 25, items: 1 }],
      projects: [],
      folders: [
        { path: 'C:\\', name: 'C:\\', bytes: 25, allocatedBytes: 4096, fileCount: 1, folderCount: 1, newestMtimeMs: 0, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: 'C:\\Temp', name: 'Temp', bytes: 25, allocatedBytes: 4096, fileCount: 1, folderCount: 0, newestMtimeMs: 0, errorCount: 0, partial: false, complete: true, childCount: 0 },
      ],
      matches: [
        { path: 'C:\\Temp', ruleId: 'system-temp', category: 'temp', bytes: 25, grade: 'safe', evidence: 'fixture' },
      ],
    });

    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
    });

    const results = host.getResults('c:\\');
    expect(results.source).toBe('snapshot');
    expect(results.depthLimited).toBe(true);
    expect(results.categories.find((row) => row.category === 'temp')?.bytes).toBe(25);
    expect(results.rows.find((row) => row.path === 'C:\\Temp')?.action).toMatchObject({ ruleId: 'system-temp' });
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
    expect(seen).toEqual(['started', 'finalizing', 'categories', 'matches', 'finished']);
    expect(seen).not.toContain('failed');
  });

  it('streams completed folders, live categories and final matches during a scan', async () => {
    let fake!: FakeSession;
    let clock = 0;
    const liveRule: Rule = {
      id: 'fixture-live',
      category: 'temp',
      title: 'Fixture live',
      action: { kind: 'delete-path' },
      match: (ctx: RuleContext) => {
        const path = join(tree.root, 'b');
        return [
          {
            path,
            bytes: ctx.tree.get(path)?.bytes ?? 0,
            grade: 'safe',
            recovery: { kind: 'junk', reason: 'fixture junk' },
            evidence: 'live fixture',
          },
        ];
      },
    };
    const host = createEngineHost({
      store,
      pool: false,
      now: () => clock,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [liveRule],
      createSession: (options) => (fake = new FakeSession(options)),
      folderIntervalMs: 100,
      categoryIntervalMs: 50,
    });

    const events: ScanEvent[] = [];
    host.onEvent((event) => events.push(event));
    const started = await host.startAnalyze(tree.root);
    expect(started.ok).toBe(true);

    const record = (path: string, bytes: number) => ({
      path,
      bytes,
      allocatedBytes: 4096,
      fileCount: 1,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 1,
      errorCount: 0,
      partial: false,
    });

    fake.options.onFolder?.(record(join(tree.root, 'a'), 10));
    clock = 500;
    fake.options.onFolder?.(record(join(tree.root, 'b'), 20));

    const folderEvent = events.find((event) => event.type === 'folders');
    expect(folderEvent?.type === 'folders' && folderEvent.folders.map((row) => row.path)).toEqual([
      join(tree.root, 'a'),
      join(tree.root, 'b'),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const liveCategories = events.filter((event) => event.type === 'categories');
    expect(liveCategories.length).toBeGreaterThan(0);
    const live = liveCategories.at(-1);
    expect(live?.type === 'categories' && live.categories.find((row) => row.category === 'temp')?.bytes).toBe(20);

    const finished = nextEvent(host, 'finished');
    fake.finish(emptyScanResult(tree.root, 'complete'));
    await finished;

    const matches = events.find((event) => event.type === 'matches');
    expect(matches?.type === 'matches' && matches.matches[0]?.path).toBe(join(tree.root, 'b'));
  });
});
