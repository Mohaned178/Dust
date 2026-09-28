import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNINSTALL_BACKUP_TTL_MS } from './types';
import type { RegistryCandidate, UninstallHive } from './types';

export const REG_HEADER = 'Windows Registry Editor Version 5.00';

const MISSING_KEY_PATTERN = /unable to find|cannot find|can not find|not exist/i;

export interface BackupEnv {
  backupDir: string;
  now?: () => number;
  runReg?: (args: string[]) => Promise<string>;
}

export type BackupResult =
  | { ok: true; path: string; restoreCommand: string; exportedKeys: string[] }
  | { ok: false; reason: 'no-keys' | 'export-failed'; detail?: string };

export interface PruneOptions {
  now?: () => number;
  ttlMs?: number;
  list?: (dir: string) => string[];
  mtimeMs?: (path: string) => number;
  remove?: (path: string) => void;
}

export function backupDirFor(userDataDir: string): string {
  return join(userDataDir, 'uninstall-backups');
}

export function restoreCommandFor(path: string): string {
  return `reg import "${path}"`;
}

export function decodeRegistryText(input: Buffer | string): string {
  if (typeof input === 'string') return input;
  if (input.length >= 2 && input[0] === 0xff && input[1] === 0xfe) {
    return input.subarray(2).toString('utf16le');
  }
  return input.toString('utf8');
}

export function encodeRegistryText(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

export function backupFileName(appId: string, at: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  const stamp =
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
  return `${appId}-${stamp}.reg`;
}

export function fullRegistryPath(hive: UninstallHive, path: string): string {
  const trimmed = path.replace(/\\+$/, '');
  if (hive === 'hkcu') return `HKCU\\${trimmed}`;
  if (hive === 'hklm-wow64') {
    return `HKLM\\Software\\WOW6432Node\\${trimmed.replace(/^Software\\/i, '')}`;
  }
  return `HKLM\\${trimmed}`;
}

export function mergeRegistryExports(parts: readonly string[]): string {
  const sections: string[] = [];
  for (const part of parts) {
    const lines = part
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''))
      .filter((line) => line.length > 0 && line !== REG_HEADER);
    if (lines.length > 0) sections.push(lines.join('\r\n'));
  }
  return [REG_HEADER, '', ...sections].join('\r\n') + '\r\n';
}

function defaultRunReg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'reg.exe',
      args,
      { encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function createRegistryBackup(
  candidates: readonly RegistryCandidate[],
  appId: string,
  env: BackupEnv,
): Promise<BackupResult> {
  const keys = [...new Set(candidates.map((candidate) => fullRegistryPath(candidate.hive, candidate.path)))];
  if (keys.length === 0) return { ok: false, reason: 'no-keys' };

  const now = env.now ?? Date.now;
  const runReg = env.runReg ?? defaultRunReg;
  mkdirSync(env.backupDir, { recursive: true });
  const base = backupFileName(appId, new Date(now())).replace(/\.reg$/, '');
  let finalPath = join(env.backupDir, `${base}.reg`);
  for (let suffix = 1; existsSync(finalPath) && suffix < 100; suffix += 1) {
    finalPath = join(env.backupDir, `${base}-${suffix}.reg`);
  }
  const tempFiles: string[] = [];
  const exportedKeys: string[] = [];
  const parts: string[] = [];

  try {
    for (const key of keys) {
      const tempPath = `${finalPath}.${tempFiles.length}.tmp`;
      try {
        await runReg(['export', key, tempPath, '/y']);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (MISSING_KEY_PATTERN.test(message)) continue;
        return { ok: false, reason: 'export-failed', detail: message };
      }
      tempFiles.push(tempPath);
      try {
        parts.push(decodeRegistryText(readFileSync(tempPath)));
      } catch {
        /* an unreadable export is treated like a missing key */
        continue;
      }
      exportedKeys.push(key);
    }
    writeFileSync(finalPath, encodeRegistryText(mergeRegistryExports(parts)));
  } catch (error) {
    return {
      ok: false,
      reason: 'export-failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    for (const tempPath of tempFiles) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        /* temp cleanup is best effort */
      }
    }
  }

  return {
    ok: true,
    path: finalPath,
    restoreCommand: restoreCommandFor(finalPath),
    exportedKeys,
  };
}

export function pruneRegistryBackups(backupDir: string, options: PruneOptions = {}): string[] {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? UNINSTALL_BACKUP_TTL_MS;
  const list =
    options.list ??
    ((dir: string): string[] => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    });
  const mtimeMs = options.mtimeMs ?? ((path: string) => statSync(path).mtimeMs);
  const remove = options.remove ?? ((path: string) => rmSync(path, { force: true }));
  const removed: string[] = [];
  for (const name of list(backupDir)) {
    if (!name.toLowerCase().endsWith('.reg')) continue;
    const path = join(backupDir, name);
    try {
      if (now() - mtimeMs(path) >= ttlMs) {
        remove(path);
        removed.push(name);
      }
    } catch {
      /* unreadable entries are left alone */
    }
  }
  return removed;
}
