import { execFile } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { promisify } from 'node:util';
import { listVolumes } from './drive-type';

export interface VolumeUsage {
  volume: string;
  label: string | null;
  totalBytes: number | null;
  freeBytes: number | null;
}

const execFileAsync = promisify(execFile);
const USAGE_CACHE_TTL_MS = 5 * 60_000;

let usageCache: { at: number; key: string; usage: VolumeUsage[] } | null = null;

export function resetVolumeUsageCache(): void {
  usageCache = null;
}

export function getVolumeUsage(volumes: string[]): VolumeUsage[] {
  return volumes.map((volume) => statfsUsage(volume) ?? emptyUsage(volume));
}

export async function getVolumeUsageAsync(volumes: string[]): Promise<VolumeUsage[]> {
  const key = volumes.join('\n');
  const now = Date.now();
  if (usageCache !== null && usageCache.key === key && now - usageCache.at < USAGE_CACHE_TTL_MS) {
    return usageCache.usage.map((entry) => ({ ...entry }));
  }
  const usage = await Promise.all(
    volumes.map(async (volume) => statfsUsage(volume) ?? (await powershellVolumeUsage(volume))),
  );
  usageCache = { at: now, key, usage };
  return usage.map((entry) => ({ ...entry }));
}

export function listFixedVolumes(): string[] {
  return listVolumes()
    .filter((volume) => volume.driveType === 'fixed')
    .map((volume) => volume.root);
}

function emptyUsage(volume: string): VolumeUsage {
  return { volume, label: null, totalBytes: null, freeBytes: null };
}

function statfsUsage(volume: string): VolumeUsage | null {
  try {
    const stats = statfsSync(volume);
    return {
      volume,
      label: null,
      totalBytes: stats.blocks * stats.bsize,
      freeBytes: stats.bavail * stats.bsize,
    };
  } catch {
    return null;
  }
}

async function powershellVolumeUsage(volume: string): Promise<VolumeUsage> {
  const fallback = emptyUsage(volume);
  if (process.platform !== 'win32') return fallback;
  const letterMatch = /^([A-Za-z]):/.exec(volume);
  if (!letterMatch) return fallback;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Volume -DriveLetter ${letterMatch[1]} | Select-Object -First 1 | ConvertTo-Json -Compress`,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    const parsed = JSON.parse(stdout) as { FileSystemLabel?: unknown; Size?: unknown; SizeRemaining?: unknown };
    return {
      volume,
      label: typeof parsed.FileSystemLabel === 'string' ? parsed.FileSystemLabel : null,
      totalBytes: numberOrNull(parsed.Size),
      freeBytes: numberOrNull(parsed.SizeRemaining),
    };
  } catch {
    return fallback;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
