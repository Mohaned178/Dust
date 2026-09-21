import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { ScanSession } from '../src/scanner/session';
import { Fixture } from './fixtures';

describe('snapshot pipeline (scan, classify, rule, clean, persist)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('persists accurate state across a scan-clean-rescan cycle', async () => {
    fixture.file('temp/junk.tmp', 'abcdefghij');
    fixture.file('proj/package.json', JSON.stringify({ name: 'proj' }));
    fixture.file('proj/package-lock.json', '{}');
    fixture.file('proj/node_modules/dep/index.js', '0123');

    const env = {
      temp: join(fixture.root, 'temp'),
      localAppData: join(fixture.root, 'local'),
      appData: join(fixture.root, 'roaming'),
      userProfile: join(fixture.root, 'profile'),
      windowsDir: join(fixture.root, 'windows'),
      programData: join(fixture.root, 'program-data'),
    };

    const scan = await new ScanSession({ root: fixture.root, pool: false }).start();
    const analysis = core.classifyProjects({
      root: fixture.root,
      tree: scan.tree,
      markers: scan.markers,
      probe: core.createNodeFsProbe(),
    });

    const rules = core.createInventoryRules(env, {
      recycleBin: {
        enumerate: () => ({ fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null }),
      },
    });
    const matches = (await Promise.all(rules.map((rule) => rule.match({
      root: fixture.root,
      tree: scan.tree,
      markers: scan.markers,
      probe: core.createNodeFsProbe(),
    })))).flat();
    const tempMatches = matches.filter((match) => match.path === env.temp);
    const categories = tempMatches.map((match) => ({ ruleId: 'system-temp', category: 'temp', bytes: match.bytes, items: 1 }));

    const disks = core.getVolumeUsage([fixture.root]);
    expect(disks[0]!.totalBytes).not.toBeNull();

    const snapshot = core.buildSnapshot({
      root: fixture.root,
      startedAt: 100,
      finishedAt: 200,
      status: 'complete',
      tree: scan.tree,
      projects: analysis.projects,
      categories,
      disks,
    });
    expect(snapshot.projects.map((project) => project.name)).toContain('proj');
    expect(snapshot.categories).toHaveLength(1);

    const userDir = fixture.dir('user-data');
    const store = new core.SnapshotStore({
      snapshotPath: join(userDir, 'snapshot.json'),
      userPath: join(userDir, 'user.json'),
    });
    expect(store.save(snapshot)).toEqual({ ok: true });
    expect(store.setPins(['C:\\dev\\old'])).toEqual({ ok: true });

    const loaded = store.load();
    expect(loaded).toEqual({ kind: 'ok', snapshot });

    const cleaner = new core.Cleaner({ guard: { userProfile: env.userProfile, userFolders: [] } });
    const plan = await cleaner.preview(rules, {
      root: fixture.root,
      tree: scan.tree,
      markers: scan.markers,
      probe: core.createNodeFsProbe(),
    });
    const report = await cleaner.execute(plan.id, {
      acknowledge: plan.items.filter((item) => item.grade === 'review').map((item) => item.path),
    });
    const updated = core.applyCleanupReport(snapshot, report, { 'system-temp': 'temp' }, 999);
    expect(updated.cleanedAt).toBe(999);
    expect(updated.categories.find((entry) => entry.ruleId === 'system-temp')!.bytes).toBe(0);
    expect(store.getPins()).toEqual(['C:\\dev\\old']);

    const rescan = await new ScanSession({ root: fixture.root, pool: false }).start();
    const rescanned = core.buildSnapshot({
      root: fixture.root,
      startedAt: 300,
      finishedAt: 400,
      status: 'complete',
      tree: rescan.tree,
      projects: [],
      categories: [],
      disks,
      priorCleanedAt: updated.cleanedAt,
    });
    expect(rescanned.cleanedAt).toBe(999);
    expect(loaded).toEqual({ kind: 'ok', snapshot });
  });

  it('exposes the snapshot, volumes and cleanup surface through the public index', () => {
    expect(typeof core.buildSnapshot).toBe('function');
    expect(typeof core.buildFolderMap).toBe('function');
    expect(typeof core.applyCleanupReport).toBe('function');
    expect(typeof core.SnapshotStore).toBe('function');
    expect(typeof core.getVolumeUsage).toBe('function');
    expect(typeof core.listFixedVolumes).toBe('function');
    expect(typeof core.SnapshotCorruptError).toBe('function');
    expect(core.SNAPSHOT_SCHEMA_VERSION).toBe(2);
    expect(core.RULES_VERSION).toBe('1');
    expect(typeof core.parseSnapshot).toBe('function');
  });
});
