import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotStore } from '../src/snapshot/store';
import { buildSnapshot } from '../src/snapshot/build';
import { ScanSession } from '../src/scanner/session';
import type { SnapshotData } from '../src/snapshot/schema';
import { Fixture } from './fixtures';

describe('SnapshotStore', () => {
  let dir: string;
  let store: SnapshotStore;

  beforeEach(() => {
    dir = join(tmpdir(), `dust-store-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    mkdirSync(dir, { recursive: true });
    store = new SnapshotStore({
      snapshotPath: join(dir, 'snapshot.json'),
      userPath: join(dir, 'user.json'),
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function scannedSnapshot(): Promise<SnapshotData> {
    const fixture = new Fixture();
    try {
      fixture.file('a/f1.txt', '0123456789');
      const result = await new ScanSession({ root: fixture.root, pool: false }).start();
      return buildSnapshot({
        root: fixture.root,
        startedAt: 1,
        finishedAt: 2,
        status: 'complete',
        tree: result.tree,
        projects: [],
        categories: [],
        disks: [],
      });
    } finally {
      fixture.cleanup();
    }
  }

  it('reports missing for a fresh store and roundtrips a snapshot', async () => {
    expect(store.load()).toEqual({ kind: 'missing' });

    const snapshot = await scannedSnapshot();
    expect(store.save(snapshot)).toEqual({ ok: true });
    const loaded = store.load();
    expect(loaded).toEqual({ kind: 'ok', snapshot });
  });

  it('reports corrupt for garbage and for wrong shapes without throwing', () => {
    writeFileSync(join(dir, 'snapshot.json'), '{oops');
    expect(store.load()).toEqual({ kind: 'corrupt', reason: 'invalid-json' });

    writeFileSync(join(dir, 'snapshot.json'), JSON.stringify({ schemaVersion: 999 }));
    const versioned = store.load();
    expect(versioned).toEqual({ kind: 'corrupt', reason: 'schema-version' });

    writeFileSync(join(dir, 'snapshot.json'), '5');
    expect(store.load()).toEqual({ kind: 'corrupt', reason: 'not-an-object' });
  });

  it('reports save failure instead of throwing when the path is unusable', () => {
    const blocked = new SnapshotStore({
      snapshotPath: join(dir, 'unwritable'),
      userPath: join(dir, 'user.json'),
    });
    mkdirSync(join(dir, 'unwritable'));
    const result = blocked.save({
      schemaVersion: 2,
      rulesVersion: '1',
      root: 'F:\\x',
      startedAt: 0,
      finishedAt: 0,
      status: 'complete',
      cleanedAt: null,
      disks: [],
      categories: [],
      matches: [],
      projects: [],
      folders: [],
    });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('stores pins separately so rescans never wipe them', async () => {
    expect(store.getPins()).toEqual([]);
    expect(store.setPins(['C:\\dev\\old'])).toEqual({ ok: true });
    expect(store.getPins()).toEqual(['C:\\dev\\old']);

    const snapshot = await scannedSnapshot();
    expect(store.save(snapshot)).toEqual({ ok: true });
    expect(store.getPins()).toEqual(['C:\\dev\\old']);
  });

  it('returns empty pins for missing or corrupt preference files', () => {
    expect(store.getPins()).toEqual([]);
    writeFileSync(join(dir, 'user.json'), '{oops');
    expect(store.getPins()).toEqual([]);
    writeFileSync(join(dir, 'user.json'), JSON.stringify({ pins: 'not-an-array' }));
    expect(store.getPins()).toEqual([]);
  });
});
