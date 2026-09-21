import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';

export interface VolumeUsage {
  volume: string;
  label: string | null;
  totalBytes: number | null;
  freeBytes: number | null;
}

export function getVolumeUsage(volumes: string[]): VolumeUsage[] {
  return volumes.map((volume) => {
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
}

export function listFixedVolumes(): string[] {
  if (process.platform !== 'win32') return [];
  try {
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Volume | Where-Object { $_.DriveType -eq 'Fixed' -and $_.DriveLetter } | ForEach-Object { "$($_.DriveLetter):\\" }`,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
    return raw
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Za-z]:\\$/.test(line));
  } catch {
    return [];
  }
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
