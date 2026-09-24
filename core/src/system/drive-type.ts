import { execFileSync } from 'node:child_process';
import { normalize, parse } from 'node:path';

export type DriveType = 'fixed' | 'removable' | 'network' | 'cdrom' | 'ram' | 'unknown';

export interface VolumeInfo {
  root: string;
  label: string | null;
  driveType: DriveType;
}

export function mapDriveType(raw: unknown): DriveType {
  if (typeof raw !== 'string') return 'unknown';
  switch (raw.trim().toLowerCase()) {
    case 'fixed':
      return 'fixed';
    case 'removable':
      return 'removable';
    case 'network':
      return 'network';
    case 'cd-rom':
    case 'cdrom':
      return 'cdrom';
    case 'ram':
      return 'ram';
    default:
      return 'unknown';
  }
}

export function parseVolumesJson(raw: string): VolumeInfo[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const entries = Array.isArray(value) ? value : [value];
  const volumes: VolumeInfo[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const root = typeof record.root === 'string' ? record.root : '';
    if (!/^[A-Za-z]:\\$/.test(root)) continue;
    const label =
      typeof record.FileSystemLabel === 'string' && record.FileSystemLabel.length > 0
        ? record.FileSystemLabel
        : null;
    volumes.push({ root: `${root.slice(0, 1).toUpperCase()}:\\`, label, driveType: mapDriveType(record.DriveType) });
  }
  return volumes;
}

const VOLUME_CACHE_TTL_MS = 5 * 60_000;

let volumeCache: { at: number; volumes: VolumeInfo[] } | null = null;

export function resetVolumeCache(): void {
  volumeCache = null;
}

export function listVolumes(): VolumeInfo[] {
  if (process.platform !== 'win32') return [];
  const now = Date.now();
  if (volumeCache !== null && now - volumeCache.at < VOLUME_CACHE_TTL_MS) {
    return volumeCache.volumes.map((volume) => ({ ...volume }));
  }
  try {
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$volumes = @(Get-Volume | Where-Object { $_.DriveLetter } | Select-Object @{n='root';e={"$($_.DriveLetter):\\"}}, FileSystemLabel, DriveType); ConvertTo-Json -InputObject $volumes -Compress`,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    const volumes = parseVolumesJson(raw);
    volumeCache = { at: now, volumes };
    return volumes.map((volume) => ({ ...volume }));
  } catch {
    return [];
  }
}

export function volumeRootOf(path: string): string | null {
  const root = parse(normalize(path)).root;
  return /^[A-Za-z]:\\$/.test(root) ? root : null;
}

export function systemDriveRoot(env: { windowsDir?: string } = {}): string | null {
  const windowsDir = env.windowsDir ?? process.env.SystemRoot ?? process.env.windir ?? '';
  const fromWindows = volumeRootOf(windowsDir);
  if (fromWindows !== null) return upperDrive(fromWindows);

  const systemDrive = process.env.SystemDrive ?? '';
  if (systemDrive.length === 0) return null;
  const root = volumeRootOf(/[\\/]$/.test(systemDrive) ? systemDrive : `${systemDrive}\\`);
  return root === null ? null : upperDrive(root);
}

function upperDrive(root: string): string {
  return `${root.slice(0, 1).toUpperCase()}${root.slice(1)}`;
}

export function createExternalPredicate(volumes: VolumeInfo[]): (path: string) => boolean {
  const kinds = new Map<string, DriveType>();
  for (const volume of volumes) kinds.set(volume.root.toLowerCase(), volume.driveType);
  return (path: string): boolean => {
    const root = volumeRootOf(path);
    if (root === null) return false;
    const kind = kinds.get(root.toLowerCase());
    return kind === 'removable' || kind === 'network';
  };
}
