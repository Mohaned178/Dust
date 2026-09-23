import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AggregateTree, SnapshotStore, volumeRootOf } from '@dust/core';
import type { ProjectOptions, Rule, RuleContext, RuleEnv, VolumeInfo } from '@dust/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    const card = (await host.getDashboard()).volumes.find(
      (volume) => volume.root.toLowerCase() === volumeList()[0]!.root.toLowerCase(),
    );
    expect(card?.lastAnalyzedAt).not.toBeNull();
    expect(card?.reclaimableBytes).toBe(10);
  });

  it('resolves volumes once per session', async () => {
    const listVolumes = vi.fn(volumeList);
    const fake = new FakeSession({ root: tree.root });
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes,
      getVolumeUsage: () => [],
      createRules: () => [],
      createSession: () => fake,
    });

    await host.getDashboard();
    const finished = nextEvent(host, 'finished');
    await host.startAnalyze(tree.root);
    fake.finish(emptyScanResult(tree.root, 'complete'));
    await finished;

    expect(listVolumes).toHaveBeenCalledTimes(1);
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
    expect((await host.getDashboard()).scan).toMatchObject({ kind: 'analyze', root: volumeList()[0]!.root });

    const cancelled = host.cancelScan();
    fake.finish(emptyScanResult(tree.root, 'cancelled'));
    await nextEvent(host, 'finished');
    expect(await cancelled).toBe(true);
    expect((await host.getDashboard()).scan).toBeNull();
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
    expect((await host.getDashboard()).scan).not.toBeNull();

    fake.finish(emptyScanResult(tree.root, 'cancelled'));
    expect(await cancelled).toBe(true);
    expect((await host.getDashboard()).scan).toBeNull();
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
    expect((await host.getDashboard()).scan).toBeNull();
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
    expect((await host.getDashboard()).scan).toBeNull();
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
    expect((await host.getDashboard()).scan).toBeNull();
  });

  it('releases the lock when rule creation throws', async () => {
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => {
        throw new Error('no rules');
      },
    });

    expect(await host.startAnalyze(tree.root)).toEqual({ ok: false, reason: 'start-failed', message: 'no rules' });
    expect((await host.getDashboard()).scan).toBeNull();
    expect(await host.startAnalyze(tree.root)).toMatchObject({ ok: false, reason: 'start-failed' });
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

  it('keeps retained live results when a later start fails', async () => {
    tree.file('temp/junk.bin', 'abcdefghij');
    let fake!: FakeSession;
    let failNext = false;
    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [tempRule(tree.root)],
      createSession: (options) => {
        if (failNext) throw new Error('no worker');
        return (fake = new FakeSession(options));
      },
    });

    const finished = nextEvent(host, 'finished');
    await host.startAnalyze(tree.root);
    fake.finish(emptyScanResult(tree.root, 'complete'));
    await finished;
    expect(host.getResults(tree.root).source).toBe('live');

    failNext = true;
    expect(await host.startAnalyze(tree.root)).toEqual({ ok: false, reason: 'start-failed', message: 'no worker' });
    expect(host.getResults(tree.root).source).toBe('live');
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

    const settledTree = new AggregateTree();
    settledTree.addFolder({
      path: join(tree.root, 'b'),
      bytes: 20,
      allocatedBytes: 4096,
      fileCount: 1,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 1,
      errorCount: 0,
      partial: false,
    });
    settledTree.addFolder({
      path: tree.root,
      bytes: 30,
      allocatedBytes: 8192,
      fileCount: 2,
      folderCount: 1,
      linkCount: 0,
      newestMtimeMs: 1,
      errorCount: 0,
      partial: false,
    });
    const finished = nextEvent(host, 'finished');
    fake.finish({ ...emptyScanResult(tree.root, 'complete'), tree: settledTree, bytesSeen: 30 });
    await finished;

    const folderEvents = events.filter((event) => event.type === 'folders');
    const lastFolders = folderEvents.at(-1);
    expect(lastFolders?.type === 'folders' && lastFolders.folders.map((row) => row.path)).toEqual([tree.root]);
    expect(lastFolders?.type === 'folders' && lastFolders.folders[0]?.bytes).toBe(30);

    const matches = events.find((event) => event.type === 'matches');
    expect(matches?.type === 'matches' && matches.matches[0]?.path).toBe(join(tree.root, 'b'));
    expect(matches?.type === 'matches' && matches.matches[0]).not.toHaveProperty('recovery');
  });

  it('skips npm-projects rules on live ticks and runs them at finalize', async () => {
    let fake!: FakeSession;
    let clock = 0;
    let projectsCalls = 0;
    const projectsRule: Rule = {
      id: 'fixture-projects',
      category: 'npm-projects',
      title: 'Fixture projects',
      action: { kind: 'delete-path' },
      match: () => {
        projectsCalls += 1;
        return [];
      },
    };
    const host = createEngineHost({
      store,
      pool: false,
      now: () => clock,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [projectsRule],
      createSession: (options) => (fake = new FakeSession(options)),
      categoryIntervalMs: 1,
    });

    await host.startAnalyze(tree.root);
    clock = 100;
    fake.options.onFolder?.({
      path: join(tree.root, 'a'),
      bytes: 10,
      allocatedBytes: 4096,
      fileCount: 1,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 1,
      errorCount: 0,
      partial: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(projectsCalls).toBe(0);

    const finished = nextEvent(host, 'finished');
    fake.finish(emptyScanResult(tree.root, 'complete'));
    await finished;
    expect(projectsCalls).toBe(1);
  });

  it('previews and executes a quick clean from live results', async () => {
    tree.file('temp/junk.bin', 'abcdefghij');
    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [tempRule(tree.root)],
      now: () => 1000,
    });

    const finished = nextEvent(host, 'finished');
    await host.startAnalyze(tree.root);
    await finished;

    const preview = await host.previewClean({ scope: 'quick' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.source).toBe('live');
    expect(preview.preview.items.map((entry) => entry.path)).toEqual([join(tree.root, 'temp')]);
    expect(preview.preview.totals.bytes).toBe(10);
    expect(preview.preview.items[0]?.recovery.kind).toBe('junk');

    const result = await host.executeClean({ cleanId: 'clean-1', planId: preview.preview.planId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.deletedBytes).toBe(10);
    expect(result.report.items[0]).toMatchObject({ status: 'done', category: 'temp' });
    expect(existsSync(join(tree.root, 'temp'))).toBe(false);

    const loaded = store.load();
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.snapshot.cleanedAt).toBe(1000);
    expect(loaded.snapshot.categories[0]).toMatchObject({ ruleId: 'fixture-temp', bytes: 0, items: 0 });
    expect(loaded.snapshot.folders.some((folder) => folder.path === join(tree.root, 'temp'))).toBe(false);

    const live = host.getResults(tree.root);
    expect(live.rows.some((row) => row.path === join(tree.root, 'temp'))).toBe(false);
  });

  it('refuses a cleanup while a scan holds the lock', async () => {
    const fake = new FakeSession({ root: tree.root });
    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [tempRule(tree.root)],
      createSession: () => fake,
    });

    const finished = nextEvent(host, 'finished');
    await host.startAnalyze(tree.root);
    expect(await host.previewClean({ scope: 'quick' })).toEqual({ ok: false, reason: 'busy', running: 'analyze' });

    fake.finish(emptyScanResult(tree.root, 'cancelled'));
    await finished;
  });

  it('cleans selected projects from a snapshot and records recently cleaned', async () => {
    const projectDir = tree.dir('proj');
    tree.file('proj/package.json', '{}');
    tree.file('proj/node_modules/dep/index.js', '0123456789');
    const nodeModules = join(projectDir, 'node_modules');

    store.save({
      schemaVersion: 2,
      rulesVersion: '1',
      root: tree.root,
      startedAt: 1,
      finishedAt: 2,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [{ ruleId: 'npm-project-modules', category: 'npm-projects', bytes: 10, items: 1 }],
      matches: [
        {
          path: nodeModules,
          ruleId: 'npm-project-modules',
          category: 'npm-projects',
          bytes: 10,
          grade: 'safe',
          evidence: 'Project',
        },
      ],
      projects: [
        {
          path: projectDir,
          name: 'proj',
          kind: 'project',
          packageManager: 'npm',
          pinned: false,
          workspaceCount: 0,
          nodeModules: { paths: [{ path: nodeModules, bytes: 10 }], bytes: 10 },
          activity: { ms: 100, source: 'files' },
          recency: 'dead',
          restorability: { grade: 'green', reasons: [], restoreCommand: 'npm ci' },
          offered: true,
          evidence: ['npm'],
        },
      ],
      folders: [
        { path: tree.root, name: tree.root, bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 1, newestMtimeMs: 5, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: projectDir, name: 'proj', bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 1, newestMtimeMs: 5, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: nodeModules, name: 'node_modules', bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 0, newestMtimeMs: 5, errorCount: 0, partial: false, complete: true, childCount: 0 },
      ],
    });

    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
      now: () => 1000,
    });

    const dev = host.getDevCleanup(tree.root);
    expect(dev.source).toBe('snapshot');
    expect(dev.groups.find((group) => group.id === 'dead')?.projects.map((entry) => entry.path)).toEqual([
      projectDir,
    ]);

    const preview = await host.previewClean({ scope: 'dev', root: tree.root, paths: [projectDir] });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.totals.bytes).toBe(10);

    const executed = await host.executeClean({ cleanId: 'clean-2', planId: preview.preview.planId });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.report.items[0]).toMatchObject({ status: 'done', restoreCommand: 'npm ci' });
    expect(existsSync(nodeModules)).toBe(false);

    const after = host.getDevCleanup(tree.root);
    expect(after.recentlyCleaned.map((entry) => [entry.path, entry.restoreCommand])).toEqual([
      [projectDir, 'npm ci'],
    ]);
    expect(after.groups.flatMap((group) => group.projects)).toEqual([]);

    const loaded = store.load();
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.snapshot.projects).toEqual([]);
    expect(loaded.snapshot.matches).toEqual([]);
  });

  it('previews a row clean from the saved snapshot', async () => {
    const temp = tree.dir('temp');
    tree.file('temp/junk.bin', '0123456789');

    store.save({
      schemaVersion: 2,
      rulesVersion: '1',
      root: tree.root,
      startedAt: 1,
      finishedAt: 2,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 10, items: 1 }],
      matches: [
        { path: temp, ruleId: 'system-temp', category: 'temp', bytes: 10, grade: 'safe', evidence: 'temp' },
      ],
      projects: [],
      folders: [
        { path: tree.root, name: tree.root, bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 1, newestMtimeMs: 5, errorCount: 0, partial: false, complete: true, childCount: 1 },
        { path: temp, name: 'temp', bytes: 10, allocatedBytes: 4096, fileCount: 1, folderCount: 0, newestMtimeMs: 5, errorCount: 0, partial: false, complete: true, childCount: 0 },
      ],
    });

    const host = createEngineHost({
      store,
      pool: false,
      env: ruleEnvFor(tree.root),
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
    });

    const preview = await host.previewClean({ scope: 'row', root: tree.root, paths: [temp] });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.source).toBe('snapshot');

    const executed = await host.executeClean({ cleanId: 'clean-3', planId: preview.preview.planId });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.report.items[0]).toMatchObject({ ruleId: 'system-temp', deletedBytes: 10 });
    expect(existsSync(temp)).toBe(false);
  });

  it('requires an acknowledgement for review-grade project matches', async () => {
    const appPath = join(tree.root, 'ghost-app');
    const nodeModules = join(appPath, 'node_modules');
    store.save({
      schemaVersion: 2,
      rulesVersion: '1',
      root: tree.root,
      startedAt: 1,
      finishedAt: 2,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [{ ruleId: 'npm-project-modules', category: 'npm-projects', bytes: 5, items: 1 }],
      matches: [
        {
          path: nodeModules,
          ruleId: 'npm-project-modules',
          category: 'npm-projects',
          bytes: 5,
          grade: 'review',
          evidence: 'no lockfile',
        },
      ],
      projects: [
        {
          path: appPath,
          name: 'app',
          kind: 'project',
          packageManager: 'npm',
          pinned: false,
          workspaceCount: 0,
          nodeModules: { paths: [{ path: nodeModules, bytes: 5 }], bytes: 5 },
          activity: { ms: 100, source: 'files' },
          recency: 'dead',
          restorability: { grade: 'yellow', reasons: ['no lockfile'], restoreCommand: 'npm install' },
          offered: true,
          evidence: ['npm'],
        },
      ],
      folders: [],
    });

    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [],
    });

    const preview = await host.previewClean({ scope: 'dev', root: tree.root, paths: [appPath] });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.totals.reviewItems).toBe(1);

    expect(await host.executeClean({ cleanId: 'clean-4', planId: preview.preview.planId })).toEqual({
      ok: false,
      reason: 'unacknowledged-review',
    });

    const acknowledged = await host.executeClean({
      cleanId: 'clean-4',
      planId: preview.preview.planId,
      acknowledge: [nodeModules],
    });
    expect(acknowledged.ok).toBe(true);
    if (!acknowledged.ok) return;
    expect(acknowledged.report.items[0]?.status).toBe('already-gone');
  });

  it('keeps the recycle-bin rule off live ticks and runs it at finalize', async () => {
    let fake!: FakeSession;
    let clock = 0;
    let recycleCalls = 0;
    const recycleRule: Rule = {
      id: 'recycle-bin',
      category: 'recycle-bin',
      title: 'Recycle Bin',
      action: { kind: 'empty-recycle-bin' },
      match: () => {
        recycleCalls += 1;
        return [];
      },
    };
    const host = createEngineHost({
      store,
      pool: false,
      now: () => clock,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [recycleRule],
      createSession: (options) => (fake = new FakeSession(options)),
      categoryIntervalMs: 1,
    });

    await host.startAnalyze(tree.root);
    clock = 100;
    fake.options.onFolder?.({
      path: join(tree.root, 'a'),
      bytes: 10,
      allocatedBytes: 4096,
      fileCount: 1,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 1,
      errorCount: 0,
      partial: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recycleCalls).toBe(0);

    const finished = nextEvent(host, 'finished');
    fake.finish(emptyScanResult(tree.root, 'complete'));
    await finished;
    expect(recycleCalls).toBe(1);
  });

  it('runs live category ticks on the slower default interval', async () => {
    let fake!: FakeSession;
    let clock = 0;
    const events: ScanEvent[] = [];
    const rule: Rule = {
      id: 'fixture-temp',
      category: 'temp',
      title: 'Fixture temp',
      action: { kind: 'delete-path' },
      match: () => [],
    };
    const host = createEngineHost({
      store,
      pool: false,
      now: () => clock,
      listVolumes: volumeList,
      getVolumeUsage: () => [],
      createRules: () => [rule],
      createSession: (options) => (fake = new FakeSession(options)),
    });
    host.onEvent((event) => events.push(event));

    await host.startAnalyze(tree.root);
    clock = 5_000;
    fake.options.onFolder?.({
      path: join(tree.root, 'a'),
      bytes: 10,
      allocatedBytes: 4096,
      fileCount: 1,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 1,
      errorCount: 0,
      partial: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.filter((event) => event.type === 'categories')).toHaveLength(1);

    clock = 9_000;
    fake.options.onFolder?.({
      path: join(tree.root, 'b'),
      bytes: 10,
      allocatedBytes: 4096,
      fileCount: 1,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 1,
      errorCount: 0,
      partial: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.filter((event) => event.type === 'categories')).toHaveLength(1);

    clock = 10_000;
    fake.options.onFolder?.({
      path: join(tree.root, 'c'),
      bytes: 10,
      allocatedBytes: 4096,
      fileCount: 1,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 1,
      errorCount: 0,
      partial: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.filter((event) => event.type === 'categories')).toHaveLength(2);

    const finished = nextEvent(host, 'finished');
    fake.finish(emptyScanResult(tree.root, 'complete'));
    await finished;
  });
});
