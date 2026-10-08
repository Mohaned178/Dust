import { join } from 'node:path';
import { SnapshotStore, volumeRootOf } from '@dust/core';
import type { SaveResult, SnapshotData, SnapshotLoadResult } from '@dust/core';

/**
 * What the engine host needs from snapshot storage. `load(root)` returns the
 * snapshot of the volume holding `root`; without a root it is the system
 * drive's. A plain SnapshotStore satisfies this too (it ignores the root and
 * callers compare `snapshot.root`), which keeps single-volume tests simple.
 */
export interface SnapshotStoreLike {
  load(root?: string): SnapshotLoadResult;
  save(snapshot: SnapshotData): SaveResult;
  saveAsync(snapshot: SnapshotData): Promise<SaveResult>;
  getPins(): string[];
  setPins(pins: string[]): SaveResult;
  getAppsChangedAt(): number | null;
  markAppsChanged(at?: number): SaveResult;
}

/**
 * One snapshot file per analyzed volume. The system drive keeps the original
 * `snapshot.json` so existing installs keep their results; other volumes use
 * `snapshot-<letter>.json`. Pins and app-change markers live in the shared
 * `user.json`.
 */
export class VolumeSnapshotStore implements SnapshotStoreLike {
  private readonly stores = new Map<string, SnapshotStore>();
  private readonly userPath: string;

  constructor(
    private readonly userDataDir: string,
    private readonly systemRoot: string,
  ) {
    this.userPath = join(userDataDir, 'user.json');
  }

  private storeFor(root: string | undefined): SnapshotStore {
    const volume = (volumeRootOf(root ?? this.systemRoot) ?? this.systemRoot).toLowerCase();
    const existing = this.stores.get(volume);
    if (existing) return existing;
    const system = volume === (volumeRootOf(this.systemRoot) ?? this.systemRoot).toLowerCase();
    const letter = volume.replace(/[^a-z]/g, '').toUpperCase();
    const snapshotPath = join(this.userDataDir, system ? 'snapshot.json' : `snapshot-${letter}.json`);
    const store = new SnapshotStore({ snapshotPath, userPath: this.userPath });
    this.stores.set(volume, store);
    return store;
  }

  load(root?: string): SnapshotLoadResult {
    return this.storeFor(root).load();
  }

  save(snapshot: SnapshotData): SaveResult {
    return this.storeFor(snapshot.root).save(snapshot);
  }

  saveAsync(snapshot: SnapshotData): Promise<SaveResult> {
    return this.storeFor(snapshot.root).saveAsync(snapshot);
  }

  getPins(): string[] {
    return this.storeFor(undefined).getPins();
  }

  setPins(pins: string[]): SaveResult {
    return this.storeFor(undefined).setPins(pins);
  }

  getAppsChangedAt(): number | null {
    return this.storeFor(undefined).getAppsChangedAt();
  }

  markAppsChanged(at?: number): SaveResult {
    return this.storeFor(undefined).markAppsChanged(at);
  }
}
