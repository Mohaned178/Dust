import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { UninstallHive } from '../uninstall/types';
import { readPersistentCache, removePersistentCache, writePersistentCache } from './persistent-cache';

export interface InstalledApp {
  id: string;
  hive: UninstallHive;
  keyName: string;
  displayName: string;
  publisher: string;
  installLocation: string;
  version: string;
  installDate: string;
  estimatedSizeKb: number | null;
  uninstallString: string;
  quietUninstallString: string;
  displayIcon: string;
  windowsInstaller: boolean;
  systemComponent: boolean;
  noRemove: boolean;
  uninstallable: boolean;
  parentKeyName: string;
  releaseType: string;
}

export interface InstalledAppMatch {
  app: InstalledApp;
  strength: 'product' | 'publisher';
}

export interface InstalledAppsSnapshot {
  apps: InstalledApp[];
  trusted: boolean;
}

export interface InstalledAppsOptions {
  ttlMs?: number;
  now?: () => number;
  query?: () => Promise<string>;
  cacheFile?: string;
  diskTtlMs?: number;
}

export const INSTALLED_APPS_TTL_MS = 5 * 60_000;
export const INSTALLED_APPS_DISK_TTL_MS = 12 * 60 * 60_000;

const QUERY_TIMEOUT_MS = 15_000;

const QUERY_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$roots = @(',
  "  [pscustomobject]@{ hive = 'hklm'; path = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' },",
  "  [pscustomobject]@{ hive = 'hklm-wow64'; path = 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' },",
  "  [pscustomobject]@{ hive = 'hkcu'; path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' }",
  ')',
  '$items = foreach ($root in $roots) {',
  '  $keys = Get-ItemProperty -Path $root.path | Where-Object { $_.DisplayName }',
  '  foreach ($key in @($keys)) {',
  '    [pscustomobject]@{',
  '      hive = $root.hive',
  '      keyName = [string]$key.PSChildName',
  '      DisplayName = [string]$key.DisplayName',
  '      Publisher = [string]$key.Publisher',
  '      InstallLocation = [string]$key.InstallLocation',
  '      DisplayVersion = [string]$key.DisplayVersion',
  '      InstallDate = [string]$key.InstallDate',
  '      EstimatedSize = $key.EstimatedSize',
  '      UninstallString = [string]$key.UninstallString',
  '      QuietUninstallString = [string]$key.QuietUninstallString',
  '      DisplayIcon = [string]$key.DisplayIcon',
  '      WindowsInstaller = [bool]$key.WindowsInstaller',
  '      SystemComponent = [bool]$key.SystemComponent',
  '      NoRemove = [bool]$key.NoRemove',
  '      Uninstallable = [bool]($key.Uninstallable -ne 0)',
  '      ParentKeyName = [string]$key.ParentKeyName',
  '      ReleaseType = [string]$key.ReleaseType',
  '    }',
  '  }',
  '}',
  'ConvertTo-Json -InputObject @($items) -Compress -Depth 3',
].join('\n');

const PUBLISHER_STOPWORDS = new Set([
  'the',
  'inc',
  'llc',
  'ltd',
  'corp',
  'corporation',
  'company',
  'technologies',
  'technology',
  'software',
  'limited',
  'gmbh',
  'pty',
  'group',
  'team',
  'foundation',
  'project',
  'systems',
  'solutions',
  'studios',
  'interactive',
  'entertainment',
]);

export function vendorKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function appId(hive: UninstallHive, keyName: string): string {
  return createHash('sha1').update(`${hive}\u0000${keyName.trim().toLowerCase()}`).digest('hex').slice(0, 16);
}

function wordTokens(value: string, minimumLength: number): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= minimumLength);
}

export function appDisplayTokens(app: InstalledApp): string[] {
  const tokens = wordTokens(app.displayName, 3);
  const compact = vendorKey(app.displayName);
  if (compact.length >= 3) tokens.push(compact);
  const installLeaf = app.installLocation ? vendorKey(basename(app.installLocation)) : '';
  if (installLeaf.length >= 3) tokens.push(installLeaf);
  return [...new Set(tokens)];
}

export function appPublisherTokens(app: InstalledApp): string[] {
  return wordTokens(app.publisher, 4).filter((word) => !PUBLISHER_STOPWORDS.has(word));
}

export function appMatchesTokens(app: InstalledApp, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const available = new Set(appDisplayTokens(app));
  return tokens.some((token) => available.has(vendorKey(token)));
}

export function matchInstalledApp(vendor: string, apps: readonly InstalledApp[]): InstalledAppMatch | null {
  const key = vendorKey(vendor);
  if (key.length === 0) return null;
  let publisherMatch: InstalledAppMatch | null = null;
  for (const app of apps) {
    if (appDisplayTokens(app).includes(key)) return { app, strength: 'product' };
    if (publisherMatch === null && appPublisherTokens(app).includes(key)) {
      publisherMatch = { app, strength: 'publisher' };
    }
  }
  return publisherMatch;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readBool(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function readEstimatedSize(record: Record<string, unknown>): number | null {
  const value = record.EstimatedSize;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
  }
  return null;
}

function readHive(record: Record<string, unknown>): UninstallHive {
  const value = readString(record, 'hive').toLowerCase();
  if (value === 'hkcu') return 'hkcu';
  if (value === 'hklm-wow64') return 'hklm-wow64';
  return 'hklm';
}

export function parseInstalledApps(raw: string): InstalledApp[] | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === 'null') return [];
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  const out: InstalledApp[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const displayName = readString(record, 'DisplayName');
    if (displayName.length === 0) continue;
    const hive = readHive(record);
    const rawKey = readString(record, 'keyName');
    const keyName = rawKey.length > 0 ? rawKey : vendorKey(displayName);
    const identity = `${hive}\u0000${keyName.toLowerCase()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push({
      id: appId(hive, keyName),
      hive,
      keyName,
      displayName,
      publisher: readString(record, 'Publisher'),
      installLocation: readString(record, 'InstallLocation'),
      version: readString(record, 'DisplayVersion'),
      installDate: readString(record, 'InstallDate'),
      estimatedSizeKb: readEstimatedSize(record),
      uninstallString: readString(record, 'UninstallString'),
      quietUninstallString: readString(record, 'QuietUninstallString'),
      displayIcon: readString(record, 'DisplayIcon'),
      windowsInstaller: readBool(record, 'WindowsInstaller', false),
      systemComponent: readBool(record, 'SystemComponent', false),
      noRemove: readBool(record, 'NoRemove', false),
      uninstallable: readBool(record, 'Uninstallable', true),
      parentKeyName: readString(record, 'ParentKeyName'),
      releaseType: readString(record, 'ReleaseType'),
    });
  }
  return out;
}

function queryInstalledAppsJson(): Promise<string> {
  const powershell =
    process.platform === 'win32' && process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe';
  const executable = existsSync(powershell) ? powershell : 'powershell.exe';
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ['-NoProfile', '-NonInteractive', '-Command', QUERY_SCRIPT],
      { encoding: 'utf8', timeout: QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
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

let cache: { at: number; snapshot: InstalledAppsSnapshot } | null = null;
let inFlight: Promise<InstalledAppsSnapshot> | null = null;
let diskCacheFile: string | null = null;

async function load(query: () => Promise<string>): Promise<InstalledAppsSnapshot> {
  if (process.platform !== 'win32') return { apps: [], trusted: false };
  try {
    const raw = await query();
    const apps = parseInstalledApps(raw);
    if (apps === null) return { apps: [], trusted: false };
    return { apps, trusted: true };
  } catch {
    return { apps: [], trusted: false };
  }
}

export async function listInstalledApps(options: InstalledAppsOptions = {}): Promise<InstalledAppsSnapshot> {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? INSTALLED_APPS_TTL_MS;
  if (options.cacheFile !== undefined) diskCacheFile = options.cacheFile;
  if (cache !== null && now() - cache.at < ttlMs) return cache.snapshot;
  if (inFlight !== null) return inFlight;

  if (options.cacheFile !== undefined) {
    const persisted = readPersistentCache<InstalledAppsSnapshot>(
      options.cacheFile,
      options.diskTtlMs ?? INSTALLED_APPS_DISK_TTL_MS,
      now,
    );
    if (persisted !== null && Array.isArray(persisted.apps)) {
      cache = { at: now(), snapshot: persisted };
      return persisted;
    }
  }

  const pending = load(options.query ?? queryInstalledAppsJson);
  inFlight = pending;
  try {
    const snapshot = await pending;
    cache = { at: now(), snapshot };
    if (options.cacheFile !== undefined && snapshot.trusted) {
      writePersistentCache(options.cacheFile, snapshot, now);
    }
    return snapshot;
  } finally {
    inFlight = null;
  }
}

export function resetInstalledAppsCache(): void {
  cache = null;
  inFlight = null;
  if (diskCacheFile !== null) removePersistentCache(diskCacheFile);
}
