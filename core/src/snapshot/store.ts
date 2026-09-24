import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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
  private cache: { key: string; result: SnapshotLoadResult } | null = null;

  constructor(private readonly paths: StorePaths) {}

  load(): SnapshotLoadResult {
    let key: string;
    try {
      const stat = statSync(this.paths.snapshotPath);
      key = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      this.cache = null;
      return { kind: 'missing' };
    }
    if (this.cache !== null && this.cache.key === key) return this.cache.result;

    let raw: string;
    try {
      raw = readFileSync(this.paths.snapshotPath, 'utf8');
    } catch {
      return { kind: 'corrupt', reason: 'read-error' };
    }
    let result: SnapshotLoadResult;
    try {
      result = { kind: 'ok', snapshot: parseSnapshot(raw) };
    } catch (error) {
      result =
        error instanceof SnapshotCorruptError
          ? { kind: 'corrupt', reason: error.reason }
          : { kind: 'corrupt', reason: 'unknown' };
    }
    this.cache = { key, result };
    return result;
  }

  save(snapshot: SnapshotData): SaveResult {
    try {
      mkdirSync(dirname(this.paths.snapshotPath), { recursive: true });
      const tmp = `${this.paths.snapshotPath}.tmp`;
      writeFileSync(tmp, JSON.stringify(snapshot));
      renameSync(tmp, this.paths.snapshotPath);
      this.cache = null;
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
