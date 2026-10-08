import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  disableStartupEntry,
  enableStartupEntry,
  listStartupEntries,
  readFileCompanyNames,
  removeStartupBackup,
} from '@dust/core';
import type { StartupEntryRecord, StartupStore } from '@dust/core';
import type {
  StartupDetailsEvent,
  StartupEntry,
  StartupListResult,
  StartupListState,
  StartupToggleResult,
} from '../../shared/ipc';

export const PUBLISHER_TTL_MS = 5 * 60_000;

export interface StartupService {
  list(): Promise<StartupListResult>;
  disable(id: string): Promise<StartupToggleResult>;
  enable(id: string): Promise<StartupToggleResult>;
  removeBackup(id: string): Promise<StartupToggleResult>;
  records(): Promise<StartupEntryRecord[]>;
  /** Publishers and icons arrive after list() returns; this reports them as they become known. */
  onDetails(listener: (event: StartupDetailsEvent) => void): () => void;
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
  // After the TTL the old values stay on screen while they are loaded again.
  const stalePublishers = new Set<string>();
  const staleIcons = new Set<string>();
  const publisherLoads = new Map<string, Promise<void>>();
  const iconLoads = new Map<string, Promise<void>>();
  const listeners = new Set<(event: StartupDetailsEvent) => void>();
  let idsByPath = new Map<string, string[]>();
  let cacheLoadedAt = now();

  function publisherFor(path: string): string | null {
    const publisher = publisherCache.get(path) ?? '';
    return publisher.length > 0 ? publisher : null;
  }

  function iconFor(path: string): string | null {
    return iconCache.get(path) ?? null;
  }

  function emitDetails(paths: string[]): void {
    const details: StartupDetailsEvent['details'] = [];
    for (const path of paths) {
      for (const id of idsByPath.get(path) ?? []) {
        details.push({ id, publisher: publisherFor(path), iconDataUrl: iconFor(path) });
      }
    }
    if (details.length === 0) return;
    for (const listener of [...listeners]) {
      try {
        listener({ details });
      } catch {
        /* a broken listener must not break the startup list */
      }
    }
  }

  async function loadPublishers(missing: string[]): Promise<void> {
    let loaded: Map<string, string> | null = null;
    try {
      loaded = await loadPublisher(missing);
    } catch {
      /* unknown publishers are shown as blank */
    }
    const changed: string[] = [];
    for (const path of missing) {
      const value = loaded?.get(path) ?? '';
      if (publisherCache.get(path) !== value) changed.push(path);
      publisherCache.set(path, value);
      stalePublishers.delete(path);
      publisherLoads.delete(path);
    }
    emitDetails(changed);
  }

  async function loadIcons(missing: string[]): Promise<void> {
    const changed: string[] = [];
    await Promise.all(
      missing.map(async (path) => {
        let icon: string | null;
        try {
          icon = await loadIcon(path);
        } catch {
          icon = null;
        }
        if (iconCache.get(path) !== icon) changed.push(path);
        iconCache.set(path, icon);
        staleIcons.delete(path);
        iconLoads.delete(path);
      }),
    );
    emitDetails(changed);
  }

  // Starts whatever is not known yet in the background; callers never wait for it.
  function loadMissingDetails(records: StartupEntryRecord[]): void {
    if (now() - cacheLoadedAt >= PUBLISHER_TTL_MS) {
      cacheLoadedAt = now();
      for (const path of publisherCache.keys()) stalePublishers.add(path);
      for (const path of iconCache.keys()) staleIcons.add(path);
    }
    const ids = new Map<string, string[]>();
    for (const record of records) {
      const executable = executableFromCommand(record.command, env);
      if (executable !== null) ids.set(executable, [...(ids.get(executable) ?? []), record.id]);
    }
    idsByPath = ids;
    const paths = [...ids.keys()];

    const missingPublishers = paths.filter(
      (path) => !publisherLoads.has(path) && (!publisherCache.has(path) || stalePublishers.has(path)),
    );
    if (missingPublishers.length > 0) {
      const batch = loadPublishers(missingPublishers);
      for (const path of missingPublishers) publisherLoads.set(path, batch);
    }
    const missingIcons = paths.filter((path) => !iconLoads.has(path) && (!iconCache.has(path) || staleIcons.has(path)));
    if (missingIcons.length > 0) {
      const batch = loadIcons(missingIcons);
      for (const path of missingIcons) iconLoads.set(path, batch);
    }
  }

  function toState(records: StartupEntryRecord[]): StartupListState {
    loadMissingDetails(records);
    return toStartupState(records, { publisherFor, iconFor }, env, now);
  }

  async function list(): Promise<StartupListResult> {
    try {
      return { ok: true, state: toState(await listStartupEntries(deps.store)) };
    } catch {
      return { ok: false, message: "Couldn't read startup entries." };
    }
  }

  function apply(result: Awaited<ReturnType<typeof disableStartupEntry>>): StartupToggleResult {
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
    return { ok: true, state: toState(result.entries) };
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
    onDetails: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
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
    const native = readFileCompanyNames(paths);
    if (native !== null) return native;
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
