import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { listVolumes } from './drive-type';

export interface VolumeUsage {
  volume: string;
  label: string | null;
  totalBytes: number | null;
  freeBytes: number | null;
}

const USAGE_CACHE_TTL_MS = 5 * 60_000;

let usageCache: { at: number; key: string; usage: VolumeUsage[] } | null = null;

export function resetVolumeUsageCache(): void {
  usageCache = null;
}

export function getVolumeUsage(volumes: string[]): VolumeUsage[] {
  const key = volumes.join('\n');
  const now = Date.now();
  if (usageCache !== null && usageCache.key === key && now - usageCache.at < USAGE_CACHE_TTL_MS) {
    return usageCache.usage.map((entry) => ({ ...entry }));
  }
  const usage = volumes.map((volume) => {
    try {
      const stats = statfsSync(volume);
      return {
        volume,
        label: null,
        totalBytes: stats.blocks * stats.bsize,
        freeBytes: stats.bavail * stats.bsize,
      };
    } catch {
      return powershellVolumeUsage(volume);
    }
  });
  usageCache = { at: now, key, usage };
  return usage.map((entry) => ({ ...entry }));
}

export function listFixedVolumes(): string[] {
  return listVolumes()
    .filter((volume) => volume.driveType === 'fixed')
    .map((volume) => volume.root);
}

function powershellVolumeUsage(volume: string): VolumeUsage {
  const fallback: VolumeUsage = { volume, label: null, totalBytes: null, freeBytes: null };
  if (process.platform !== 'win32') return fallback;
  const letterMatch = /^([A-Za-z]):/.exec(volume);
  if (!letterMatch) return fallback;
  try {
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Volume -DriveLetter ${letterMatch[1]} | Select-Object -First 1 | ConvertTo-Json -Compress`,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    const parsed = JSON.parse(raw) as { FileSystemLabel?: unknown; Size?: unknown; SizeRemaining?: unknown };
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
