import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { matchAppName } from './apps';
import { uninstallItemId } from './types';
import type { InstalledApp } from '../system/installed-apps';
import type { RegistryCandidate, UninstallHive } from './types';

export interface RegistryVendor {
  name: string;
  children: string[];
}

export interface RegistryHiveKeys {
  hive: UninstallHive;
  vendors: RegistryVendor[];
}

export interface RegistryKeySnapshot {
  hives: RegistryHiveKeys[];
}

export interface RegistryScanResult {
  candidates: RegistryCandidate[];
  trusted: boolean;
}

export interface RegistryScanOptions {
  read?: () => Promise<string>;
}

const QUERY_TIMEOUT_MS = 20_000;
const SNAPSHOT_TTL_MS = 5 * 60_000;

export const UNINSTALL_KEY_PREFIX = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

const EXCLUDED_VENDOR_KEYS = new Set([
  'microsoft',
  'windows',
  'classes',
  'policies',
  'wow6432node',
  'system',
  'services',
]);

const READ_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$roots = @(',
  "  [pscustomobject]@{ hive = 'hklm'; path = 'HKLM:\\Software' },",
  "  [pscustomobject]@{ hive = 'hklm-wow64'; path = 'HKLM:\\Software\\WOW6432Node' },",
  "  [pscustomobject]@{ hive = 'hkcu'; path = 'HKCU:\\Software' }",
  ')',
  '$out = foreach ($root in $roots) {',
  '  $vendors = @()',
  '  foreach ($key in @(Get-ChildItem -Path $root.path)) {',
  '    if (-not $key.PSChildName) { continue }',
  '    $children = @()',
  '    foreach ($child in @(Get-ChildItem -Path $key.PSPath)) {',
  '      if ($child.PSChildName) { $children += [string]$child.PSChildName }',
  '    }',
  '    $vendors += [pscustomobject]@{ name = [string]$key.PSChildName; children = @($children) }',
  '  }',
  '  [pscustomobject]@{ hive = $root.hive; vendors = @($vendors) }',
  '}',
  'ConvertTo-Json -InputObject @($out) -Compress -Depth 5',
].join('\n');

function powershellExecutable(): string {
  const candidate =
    process.platform === 'win32' && process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe';
  return existsSync(candidate) ? candidate : 'powershell.exe';
}

export function readRegistryKeySnapshot(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      powershellExecutable(),
      ['-NoProfile', '-NonInteractive', '-Command', READ_SCRIPT],
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

let snapshotCache: { at: number; raw: string } | null = null;
let snapshotInFlight: Promise<string> | null = null;

export function resetRegistrySnapshotCache(): void {
  snapshotCache = null;
  snapshotInFlight = null;
}

export function readRegistryKeySnapshotCached(read: () => Promise<string> = readRegistryKeySnapshot): Promise<string> {
  if (snapshotCache !== null && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) {
    return Promise.resolve(snapshotCache.raw);
  }
  if (snapshotInFlight !== null) return snapshotInFlight;
  const pending = read();
  snapshotInFlight = pending;
  return pending.then(
    (raw) => {
      snapshotCache = { at: Date.now(), raw };
      snapshotInFlight = null;
      return raw;
    },
    (error: unknown) => {
      snapshotInFlight = null;
      throw error;
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseRegistryKeySnapshot(raw: string): RegistryKeySnapshot | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (value === null) return { hives: [] };
  const list = Array.isArray(value) ? value : [value];
  const hives: RegistryHiveKeys[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const hive = entry.hive;
    if (hive !== 'hklm' && hive !== 'hklm-wow64' && hive !== 'hkcu') continue;
    const vendorsRaw = Array.isArray(entry.vendors) ? entry.vendors : [];
    const vendors: RegistryVendor[] = [];
    for (const vendorEntry of vendorsRaw) {
      if (!isRecord(vendorEntry)) continue;
      const name = typeof vendorEntry.name === 'string' ? vendorEntry.name.trim() : '';
      if (name.length === 0) continue;
      vendors.push({ name, children: asStringList(vendorEntry.children) });
    }
    hives.push({ hive, vendors });
  }
  return { hives };
}

function uninstallKeyCandidate(app: InstalledApp): RegistryCandidate {
  const path = `${UNINSTALL_KEY_PREFIX}\\${app.keyName}`;
  return {
    id: uninstallItemId('registry', `${app.hive}:${path}`),
    hive: app.hive,
    path,
    scope: 'uninstall-key',
    grade: 'safe',
    adminRequired: app.hive !== 'hkcu',
    excludedReason: null,
  };
}

function candidate(
  hive: UninstallHive,
  path: string,
  scope: RegistryCandidate['scope'],
  grade: RegistryCandidate['grade'],
  excludedReason: string | null,
): RegistryCandidate {
  return {
    id: uninstallItemId('registry', `${hive}:${path}`),
    hive,
    path,
    scope,
    grade,
    adminRequired: hive !== 'hkcu',
    excludedReason,
  };
}

function buildCandidates(
  app: InstalledApp,
  others: readonly InstalledApp[],
  snapshot: RegistryKeySnapshot,
): RegistryCandidate[] {
  const out: RegistryCandidate[] = [];
  for (const hiveKeys of snapshot.hives) {
    for (const vendor of hiveKeys.vendors) {
      const vendorKeyName = vendor.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (vendorKeyName.length === 0 || EXCLUDED_VENDOR_KEYS.has(vendorKeyName)) continue;
      const strength = matchAppName(vendor.name, app);
      if (strength === null) continue;
      const shared = others.some((other) => matchAppName(vendor.name, other) !== null) === true;
      out.push(
        candidate(
          hiveKeys.hive,
          `Software\\${vendor.name}`,
          'vendor-root',
          shared || strength !== 'product' ? 'review' : 'safe',
          shared ? 'shared-vendor-root' : null,
        ),
      );
      for (const child of vendor.children) {
        const childStrength = matchAppName(child, app);
        if (childStrength === null) continue;
        const childShared = others.some((other) => matchAppName(child, other) !== null) === true;
        out.push(
          candidate(
            hiveKeys.hive,
            `Software\\${vendor.name}\\${child}`,
            'product',
            childShared || childStrength !== 'product' ? 'review' : 'safe',
            childShared ? 'shared-product-key' : null,
          ),
        );
      }
    }
  }
  return out;
}

export async function scanRegistry(
  app: InstalledApp,
  apps: readonly InstalledApp[],
  options: RegistryScanOptions = {},
): Promise<RegistryScanResult> {
  const uninstall = [uninstallKeyCandidate(app)];
  const read = options.read;
  if (read === undefined && process.platform !== 'win32') {
    return { candidates: uninstall, trusted: false };
  }
  try {
    const raw = await (read ?? readRegistryKeySnapshotCached)();
    const snapshot = parseRegistryKeySnapshot(raw);
    if (snapshot === null) return { candidates: uninstall, trusted: false };
    const others = apps.filter((entry) => entry.id !== app.id);
    return { candidates: [...buildCandidates(app, others, snapshot), ...uninstall], trusted: true };
  } catch {
    return { candidates: uninstall, trusted: false };
  }
}
