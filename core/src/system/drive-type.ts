import { execFile, execFileSync } from 'node:child_process';
import { normalize, parse } from 'node:path';
import { promisify } from 'node:util';
import koffi from 'koffi';
import { readPersistentCache, removePersistentCache, writePersistentCache } from './persistent-cache';

export const LIST_VOLUMES_SCRIPT = `$parts = @();
try { $parts = @(Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter } | Select-Object @{n='root';e={"$($_.DriveLetter):\\"}}, DiskNumber) } catch {}
$disks = @{};
try { foreach ($disk in Get-PhysicalDisk -ErrorAction SilentlyContinue) { $disks[[string]$disk.DeviceId] = $disk.MediaType } } catch {}
$volumes = @(Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object {
  $root = "$($_.DriveLetter):\\";
  $part = $parts | Where-Object { $_.root -eq $root } | Select-Object -First 1;
  $media = if ($part) { $disks[[string]$part.DiskNumber] } else { $null };
  [pscustomobject]@{ root = $root; FileSystemLabel = $_.FileSystemLabel; DriveType = $_.DriveType; MediaType = $media }
});
ConvertTo-Json -InputObject $volumes -Compress`;

export type DriveType = 'fixed' | 'removable' | 'network' | 'cdrom' | 'ram' | 'unknown';

export type MediaType = 'ssd' | 'hdd' | 'unknown';

export interface VolumeInfo {
  root: string;
  label: string | null;
  driveType: DriveType;
  mediaType: MediaType;
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

export function mapMediaType(raw: unknown): MediaType {
  if (typeof raw !== 'string') return 'unknown';
  switch (raw.trim().toLowerCase()) {
    case 'ssd':
      return 'ssd';
    case 'hdd':
      return 'hdd';
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
      typeof record.FileSystemLabel === 'string' && record.FileSystemLabel.length > 0 ? record.FileSystemLabel : null;
    volumes.push({
      root: `${root.slice(0, 1).toUpperCase()}:\\`,
      label,
      driveType: mapDriveType(record.DriveType),
      mediaType: mapMediaType(record.MediaType),
    });
  }
  return volumes;
}

const VOLUME_CACHE_TTL_MS = 5 * 60_000;
export const VOLUME_DISK_TTL_MS = 60 * 60_000;

export const MEDIA_TYPE_TTL_MS = 7 * 24 * 60 * 60_000;

export interface ListVolumesOptions {
  cacheFile?: string;
  /** How long persisted media types stay valid; also the lifetime of a persisted list when native is unavailable. */
  diskTtlMs?: number;
  now?: () => number;
  /** Wait for the SSD/HDD lookup when a fixed volume has none yet. */
  awaitMediaTypes?: boolean;
}

let volumeCache: { at: number; volumes: VolumeInfo[] } | null = null;
let volumeDiskCacheFile: string | null = null;
let mediaTypes: Map<string, MediaType> | null = null;
let mediaInFlight: Promise<void> | null = null;
let mediaFailedAt: number | null = null;
let volumeGeneration = 0;

export function resetVolumeCache(): void {
  volumeCache = null;
  mediaTypes = null;
  mediaFailedAt = null;
  mediaInFlight = null;
  volumeGeneration += 1;
  if (volumeDiskCacheFile !== null) removePersistentCache(volumeDiskCacheFile);
}

const DRIVE_UNKNOWN = 0;
const DRIVE_REMOVABLE = 2;
const DRIVE_FIXED = 3;
const DRIVE_CDROM = 5;
const DRIVE_RAMDISK = 6;
const SEM_FAILCRITICALERRORS = 1;

interface VolumeApi {
  logicalDrives: (length: number, buffer: Buffer) => number;
  driveType: (root: string) => number;
  volumeInformation: (
    root: string,
    label: Buffer,
    labelLength: number,
    serial: null,
    maxComponent: null,
    flags: null,
    fileSystem: null,
    fileSystemLength: number,
  ) => boolean;
  setErrorMode: (mode: number, previous: number[]) => boolean;
}

let cachedVolumeApi: VolumeApi | null = null;

function loadVolumeApi(): VolumeApi | null {
  if (process.platform !== 'win32') return null;
  if (cachedVolumeApi) return cachedVolumeApi;
  try {
    const kernel32 = koffi.load('kernel32.dll');
    cachedVolumeApi = {
      logicalDrives: kernel32.func(
        'uint32 __stdcall GetLogicalDriveStringsW(uint32 nBufferLength, _Out_ void *lpBuffer)',
      ) as VolumeApi['logicalDrives'],
      driveType: kernel32.func(
        'uint32 __stdcall GetDriveTypeW(const char16_t *lpRootPathName)',
      ) as VolumeApi['driveType'],
      volumeInformation: kernel32.func(
        'bool __stdcall GetVolumeInformationW(const char16_t *lpRootPathName, _Out_ void *lpVolumeNameBuffer, uint32 nVolumeNameSize, void *lpVolumeSerialNumber, void *lpMaximumComponentLength, void *lpFileSystemFlags, void *lpFileSystemNameBuffer, uint32 nFileSystemNameSize)',
      ) as VolumeApi['volumeInformation'],
      setErrorMode: kernel32.func(
        'bool __stdcall SetThreadErrorMode(uint32 dwNewMode, _Out_ uint32 *lpOldMode)',
      ) as VolumeApi['setErrorMode'],
    };
  } catch {
    return null;
  }
  return cachedVolumeApi;
}

function nativeDriveType(code: number): DriveType | null {
  switch (code) {
    case DRIVE_FIXED:
      return 'fixed';
    case DRIVE_REMOVABLE:
      return 'removable';
    case DRIVE_CDROM:
      return 'cdrom';
    case DRIVE_RAMDISK:
      return 'ram';
    case DRIVE_UNKNOWN:
      return 'unknown';
    default:
      return null;
  }
}

/** Local volumes with a drive letter, like Get-Volume; null when the native API is unavailable. */
function listNativeVolumes(): Array<Omit<VolumeInfo, 'mediaType'>> | null {
  const api = loadVolumeApi();
  if (api === null) return null;
  const buffer = Buffer.alloc(1024);
  const length = api.logicalDrives(buffer.length / 2, buffer);
  if (length === 0 || length > buffer.length / 2) return null;
  const roots = buffer
    .toString('utf16le', 0, length * 2)
    .split('\0')
    .filter((root) => /^[A-Za-z]:\\$/.test(root));
  const previous = [0];
  const guarded = api.setErrorMode(SEM_FAILCRITICALERRORS, previous);
  try {
    const volumes: Array<Omit<VolumeInfo, 'mediaType'>> = [];
    for (const root of roots) {
      const driveType = nativeDriveType(api.driveType(root));
      if (driveType === null) continue;
      const label = Buffer.alloc(512);
      const ok = api.volumeInformation(root, label, label.length / 2, null, null, null, null, 0);
      const name = ok ? label.toString('utf16le').split('\0')[0]! : '';
      volumes.push({ root: `${root.slice(0, 1).toUpperCase()}:\\`, label: name.length > 0 ? name : null, driveType });
    }
    return volumes;
  } finally {
    if (guarded) api.setErrorMode(Number(previous[0]), [0]);
  }
}

async function queryVolumesPowerShell(): Promise<VolumeInfo[]> {
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', LIST_VOLUMES_SCRIPT],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  );
  return parseVolumesJson(stdout);
}

function withMediaType(volume: Omit<VolumeInfo, 'mediaType'>): VolumeInfo {
  return { ...volume, mediaType: mediaTypes?.get(volume.root) ?? 'unknown' };
}

function isMediaKnown(volume: VolumeInfo): boolean {
  return volume.driveType !== 'fixed' || (mediaTypes?.has(volume.root) ?? false);
}

function rememberMediaTypes(volumes: readonly VolumeInfo[]): void {
  const next = new Map<string, MediaType>();
  for (const volume of volumes) next.set(volume.root, mapMediaType(volume.mediaType));
  mediaTypes = next;
}

function loadPersistedMediaTypes(options: ListVolumesOptions, now: () => number): void {
  if (mediaTypes !== null || options.cacheFile === undefined) return;
  const persisted = readPersistentCache<VolumeInfo[]>(options.cacheFile, options.diskTtlMs ?? MEDIA_TYPE_TTL_MS, now);
  if (persisted !== null && Array.isArray(persisted)) {
    rememberMediaTypes(persisted.filter((volume) => typeof volume?.root === 'string'));
  }
}

function startMediaQuery(now: () => number): Promise<void> {
  if (mediaInFlight !== null) return mediaInFlight;
  if (mediaFailedAt !== null && now() - mediaFailedAt < VOLUME_CACHE_TTL_MS) return Promise.resolve();
  const generation = volumeGeneration;
  const pending: Promise<void> = queryVolumesPowerShell()
    .then((volumes) => {
      if (generation !== volumeGeneration) return;
      const next = new Map<string, MediaType>();
      for (const volume of volumeCache?.volumes ?? []) {
        if (volume.driveType === 'fixed') next.set(volume.root, 'unknown');
      }
      for (const volume of volumes) next.set(volume.root, volume.mediaType);
      mediaTypes = next;
      if (volumeCache !== null) {
        volumeCache = { at: volumeCache.at, volumes: volumeCache.volumes.map(withMediaType) };
      }
      if (volumeDiskCacheFile !== null && volumes.length > 0) {
        writePersistentCache(volumeDiskCacheFile, volumes, now);
      }
    })
    .catch(() => {
      if (generation === volumeGeneration) mediaFailedAt = now();
    })
    .finally(() => {
      if (mediaInFlight === pending) mediaInFlight = null;
    });
  mediaInFlight = pending;
  return pending;
}

export function listVolumes(): VolumeInfo[] {
  if (process.platform !== 'win32') return [];
  const now = Date.now();
  if (volumeCache !== null && now - volumeCache.at < VOLUME_CACHE_TTL_MS) {
    return volumeCache.volumes.map((volume) => ({ ...volume }));
  }
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LIST_VOLUMES_SCRIPT], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    const volumes = parseVolumesJson(raw);
    volumeCache = { at: now, volumes };
    return volumes.map((volume) => ({ ...volume }));
  } catch {
    return [];
  }
}

async function listVolumesViaPowerShell(options: ListVolumesOptions, now: () => number): Promise<VolumeInfo[]> {
  if (options.cacheFile !== undefined) {
    const persisted = readPersistentCache<VolumeInfo[]>(
      options.cacheFile,
      options.diskTtlMs ?? VOLUME_DISK_TTL_MS,
      now,
    );
    if (persisted !== null && Array.isArray(persisted)) {
      volumeCache = { at: now(), volumes: persisted };
      return persisted.map((volume) => ({ ...volume }));
    }
  }
  try {
    const volumes = await queryVolumesPowerShell();
    volumeCache = { at: now(), volumes };
    rememberMediaTypes(volumes);
    if (options.cacheFile !== undefined && volumes.length > 0) {
      writePersistentCache(options.cacheFile, volumes, now);
    }
    return volumes.map((volume) => ({ ...volume }));
  } catch {
    return [];
  }
}

export async function listVolumesAsync(options: ListVolumesOptions = {}): Promise<VolumeInfo[]> {
  if (process.platform !== 'win32') return [];
  const now = options.now ?? Date.now;
  if (options.cacheFile !== undefined) volumeDiskCacheFile = options.cacheFile;
  if (volumeCache !== null && now() - volumeCache.at < VOLUME_CACHE_TTL_MS) {
    if (options.awaitMediaTypes === true && mediaInFlight !== null) await mediaInFlight;
    return (volumeCache?.volumes ?? []).map((volume) => ({ ...volume }));
  }
  const native = listNativeVolumes();
  if (native === null) return listVolumesViaPowerShell(options, now);

  loadPersistedMediaTypes(options, now);
  const volumes = native.map(withMediaType);
  volumeCache = { at: now(), volumes };
  if (!volumes.every(isMediaKnown)) {
    const pending = startMediaQuery(now);
    if (options.awaitMediaTypes === true) await pending;
  }
  return (volumeCache?.volumes ?? volumes).map((volume) => ({ ...volume }));
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
