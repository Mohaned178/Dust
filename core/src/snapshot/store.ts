import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SnapshotCorruptError, parseSnapshot } from './schema';
import type { SnapshotData } from './schema';

export interface StorePaths {
  snapshotPath: string;
  userPath: string;
}

export interface UserPreferences {
  pins: string[];
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export type SnapshotLoadResult =
  | { kind: 'ok'; snapshot: SnapshotData }
  | { kind: 'missing' }
  | { kind: 'corrupt'; reason: string };

export class SnapshotStore {
  constructor(private readonly paths: StorePaths) {}

  load(): SnapshotLoadResult {
    let raw: string;
    try {
      if (!existsSync(this.paths.snapshotPath)) return { kind: 'missing' };
      raw = readFileSync(this.paths.snapshotPath, 'utf8');
    } catch {
      return { kind: 'corrupt', reason: 'read-error' };
    }
    try {
      return { kind: 'ok', snapshot: parseSnapshot(raw) };
    } catch (error) {
      if (error instanceof SnapshotCorruptError) {
        return { kind: 'corrupt', reason: error.reason };
      }
      return { kind: 'corrupt', reason: 'unknown' };
    }
  }

  save(snapshot: SnapshotData): SaveResult {
    try {
      mkdirSync(dirname(this.paths.snapshotPath), { recursive: true });
      const tmp = `${this.paths.snapshotPath}.tmp`;
      writeFileSync(tmp, JSON.stringify(snapshot));
      renameSync(tmp, this.paths.snapshotPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  async saveAsync(snapshot: SnapshotData): Promise<SaveResult> {
    try {
      await mkdir(dirname(this.paths.snapshotPath), { recursive: true });
      const tmp = `${this.paths.snapshotPath}.tmp`;
      await writeFile(tmp, JSON.stringify(snapshot));
      await rename(tmp, this.paths.snapshotPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  getPins(): string[] {
    try {
      if (!existsSync(this.paths.userPath)) return [];
      const parsed: unknown = JSON.parse(readFileSync(this.paths.userPath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) return [];
      const pins = (parsed as { pins?: unknown }).pins;
      if (!Array.isArray(pins)) return [];
      return pins.filter((pin): pin is string => typeof pin === 'string');
    } catch {
      return [];
    }
  }

  setPins(pins: string[]): SaveResult {
    try {
      mkdirSync(dirname(this.paths.userPath), { recursive: true });
      const tmp = `${this.paths.userPath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ pins } satisfies UserPreferences));
      renameSync(tmp, this.paths.userPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'unknown error';
}
