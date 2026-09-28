import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { disableStartupEntry, enableStartupEntry, listStartupEntries, removeStartupBackup } from '@dust/core';
import type { StartupEntryRecord, StartupStore } from '@dust/core';
import type { StartupEntry, StartupListResult, StartupListState, StartupToggleResult } from '../../shared/ipc';

export const PUBLISHER_TTL_MS = 5 * 60_000;

export interface StartupService {
  list(): Promise<StartupListResult>;
  disable(id: string): Promise<StartupToggleResult>;
  enable(id: string): Promise<StartupToggleResult>;
  removeBackup(id: string): Promise<StartupToggleResult>;
  records(): Promise<StartupEntryRecord[]>;
}

export interface StartupServiceDeps {
  store: StartupStore;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  loadPublisher?: (executablePaths: string[]) => Promise<Map<string, string>>;
  loadIcon?: (executablePath: string) => Promise<string | null>;
}

function cleanupPath(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/^\\\\\?\\/, '');
  return cleaned.length > 0 ? cleaned : null;
}

export function executableFromCommand(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const expanded = command
    .replace(/%([^%]+)%/g, (match, name: string) => {
      const value = env[name] ?? env[name.toUpperCase()] ?? env[name.toLowerCase()];
      return value ?? match;
    })
    .trim();
  if (expanded.length === 0) return null;
  if (expanded.startsWith('"')) {
    const end = expanded.indexOf('"', 1);
    if (end > 1) return cleanupPath(expanded.slice(1, end));
  }
  const exeMatch = /\.exe(\s|$)/i.exec(expanded);
  if (exeMatch !== null && exeMatch.index > 0) {
    return cleanupPath(expanded.slice(0, exeMatch.index + 4));
  }
  const token = expanded.split(/\s+/)[0] ?? '';
  return cleanupPath(token);
}

export function toStartupState(
  records: StartupEntryRecord[],
  loads: { publisherFor: (path: string) => string | null; iconFor: (path: string) => string | null },
  env: NodeJS.ProcessEnv,
  now: () => number,
): StartupListState {
  const entries: StartupEntry[] = records.map((record) => {
    const executable = executableFromCommand(record.command, env);
    return {
      id: record.id,
      name: record.name,
      publisher: executable === null ? null : loads.publisherFor(executable),
      command: record.command,
      source: record.source,
      state: record.state,
      disabledKind: record.disabledKind,
      protected: record.protected,
      requiresAdmin: record.requiresAdmin,
      disabledAt: record.disabledAt,
      iconDataUrl: executable === null ? null : loads.iconFor(executable),
    };
  });
  return {
    entries,
    counts: {
      total: entries.length,
      enabled: entries.filter((entry) => entry.state === 'enabled').length,
      disabled: entries.filter((entry) => entry.state === 'disabled').length,
    },
    loadedAt: now(),
  };
}

export function createStartupService(deps: StartupServiceDeps): StartupService {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const loadPublisher = deps.loadPublisher ?? (async () => new Map<string, string>());
  const loadIcon = deps.loadIcon ?? (async () => null);
  const publisherCache = new Map<string, string>();
  const iconCache = new Map<string, string | null>();
  let cacheLoadedAt = now();

  function uniqueExecutables(records: StartupEntryRecord[]): string[] {
    const paths = new Set<string>();
    for (const record of records) {
      const executable = executableFromCommand(record.command, env);
      if (executable !== null) paths.add(executable);
    }
    return [...paths];
  }

  async function refreshCaches(records: StartupEntryRecord[]): Promise<void> {
    if (now() - cacheLoadedAt >= PUBLISHER_TTL_MS) {
      publisherCache.clear();
      iconCache.clear();
      cacheLoadedAt = now();
    }
    const paths = uniqueExecutables(records);

    const missing = paths.filter((path) => !publisherCache.has(path));
    if (missing.length > 0) {
      try {
        const loaded = await loadPublisher(missing);
        for (const path of missing) publisherCache.set(path, loaded.get(path) ?? '');
      } catch {
        for (const path of missing) publisherCache.set(path, '');
      }
    }

    await Promise.all(
      paths.map(async (path) => {
        if (iconCache.has(path)) return;
        let icon: string | null = null;
        try {
          icon = await loadIcon(path);
        } catch {
          icon = null;
        }
        iconCache.set(path, icon);
      }),
    );
  }

  async function toState(records: StartupEntryRecord[]): Promise<StartupListState> {
    await refreshCaches(records);
    return toStartupState(
      records,
      {
        publisherFor: (path) => {
          const publisher = publisherCache.get(path) ?? '';
          return publisher.length > 0 ? publisher : null;
        },
        iconFor: (path) => iconCache.get(path) ?? null,
      },
      env,
      now,
    );
  }

  async function list(): Promise<StartupListResult> {
    try {
      const records = await listStartupEntries(deps.store);
      return { ok: true, state: await toState(records) };
    } catch {
      return { ok: false, message: "Couldn't read startup entries." };
    }
  }

  async function apply(result: Awaited<ReturnType<typeof disableStartupEntry>>): Promise<StartupToggleResult> {
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
    return { ok: true, state: await toState(result.entries) };
  }

  return {
    list,
    disable: async (id) => apply(await disableStartupEntry(id, deps.store)),
    enable: async (id) => apply(await enableStartupEntry(id, deps.store)),
    removeBackup: async (id) => apply(await removeStartupBackup(id, deps.store)),
    records: async () => {
      try {
        return await listStartupEntries(deps.store);
      } catch {
        return [];
      }
    },
  };
}

const QUERY_TIMEOUT_MS = 20_000;

function powershellExecutable(): string {
  const candidate =
    process.platform === 'win32' && process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe';
  return existsSync(candidate) ? candidate : 'powershell.exe';
}

const PUBLISHER_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$paths = $env:DUST_PUBLISHER_PATHS | ConvertFrom-Json',
  '$out = foreach ($p in @($paths)) {',
  '  if (Test-Path -LiteralPath $p) {',
  '    $info = (Get-Item -LiteralPath $p).VersionInfo',
  '    [pscustomobject]@{ path = [string]$p; company = [string]$info.CompanyName }',
  '  }',
  '}',
  'ConvertTo-Json -InputObject @($out) -Compress',
].join('\n');

export function createFilePublisherLoader(): (paths: string[]) => Promise<Map<string, string>> {
  return async (paths) => {
    const map = new Map<string, string>();
    if (paths.length === 0 || process.platform !== 'win32') return map;
    const raw = await new Promise<string>((resolve, reject) => {
      execFile(
        powershellExecutable(),
        ['-NoProfile', '-NonInteractive', '-Command', PUBLISHER_SCRIPT],
        {
          encoding: 'utf8',
          timeout: QUERY_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
          env: { ...process.env, DUST_PUBLISHER_PATHS: JSON.stringify(paths) },
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim().length === 0 ? '[]' : raw);
    } catch {
      return map;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;
      if (typeof record.path !== 'string' || typeof record.company !== 'string') continue;
      const company = record.company.trim();
      if (company.length > 0) map.set(record.path, company);
    }
    return map;
  };
}
