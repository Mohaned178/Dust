import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { existsSync } from 'node:fs';

export interface InstalledApp {
  displayName: string;
  publisher: string;
  installLocation: string;
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
}

export const INSTALLED_APPS_TTL_MS = 5 * 60_000;

const QUERY_TIMEOUT_MS = 15_000;

const QUERY_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$keys = @(',
  "  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
  ')',
  '$items = foreach ($key in $keys) {',
  '  Get-ItemProperty -Path $key | Where-Object { $_.DisplayName } | Select-Object DisplayName, Publisher, InstallLocation',
  '}',
  "ConvertTo-Json -InputObject @($items) -Compress -Depth 3",
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

export function matchInstalledApp(
  vendor: string,
  apps: readonly InstalledApp[],
): InstalledAppMatch | null {
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
    const displayName = typeof record.DisplayName === 'string' ? record.DisplayName.trim() : '';
    if (displayName.length === 0) continue;
    const key = vendorKey(displayName);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      displayName,
      publisher: typeof record.Publisher === 'string' ? record.Publisher.trim() : '',
      installLocation: typeof record.InstallLocation === 'string' ? record.InstallLocation.trim() : '',
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

export async function listInstalledApps(
  options: InstalledAppsOptions = {},
): Promise<InstalledAppsSnapshot> {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? INSTALLED_APPS_TTL_MS;
  if (cache !== null && now() - cache.at < ttlMs) return cache.snapshot;
  if (inFlight !== null) return inFlight;

  const pending = load(options.query ?? queryInstalledAppsJson);
  inFlight = pending;
  try {
    const snapshot = await pending;
    cache = { at: now(), snapshot };
    return snapshot;
  } finally {
    inFlight = null;
  }
}

export function resetInstalledAppsCache(): void {
  cache = null;
  inFlight = null;
}
