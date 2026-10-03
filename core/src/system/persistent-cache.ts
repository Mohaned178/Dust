import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export interface PersistentCacheFile<T> {
  at: number;
  value: T;
}

export function readPersistentCache<T>(file: string, ttlMs: number, now: () => number = Date.now): T | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PersistentCacheFile<T>>;
    if (typeof parsed.at !== 'number') return null;
    if (now() - parsed.at >= ttlMs) return null;
    return (parsed.value ?? null) as T | null;
  } catch {
    return null;
  }
}

export function writePersistentCache<T>(file: string, value: T, now: () => number = Date.now): void {
  try {
    const temp = `${file}.tmp`;
    const payload: PersistentCacheFile<T> = { at: now(), value };
    writeFileSync(temp, JSON.stringify(payload), 'utf8');
    renameSync(temp, file);
  } catch {
    return;
  }
}

export function removePersistentCache(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    return;
  }
}
