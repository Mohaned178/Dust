import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface StageResult {
  ok: boolean;
  code?: string;
}

export type RecycleRunner = (path: string) => Promise<StageResult>;
export type RecycleBatchRunner = (paths: string[]) => Promise<StageResult[]>;

export const RECYCLE_BATCH_SIZE = 40;

export const RECYCLE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName Microsoft.VisualBasic',
  '$p = $env:DUST_RECYCLE_PATH',
  'if ([System.IO.Directory]::Exists($p)) {',
  "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')",
  '} elseif ([System.IO.File]::Exists($p)) {',
  "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')",
  '} else {',
  '  exit 2',
  '}',
].join('\n');

function powershellExecutable(): string {
  const candidate =
    process.platform === 'win32' && process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe';
  return existsSync(candidate) ? candidate : 'powershell.exe';
}

export const RECYCLE_BATCH_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  'Add-Type -AssemblyName Microsoft.VisualBasic',
  '$paths = @($env:DUST_RECYCLE_PATHS | ConvertFrom-Json)',
  '$failed = @()',
  'for ($i = 0; $i -lt $paths.Count; $i++) {',
  '  $p = [string]$paths[$i]',
  '  try {',
  '    if ([System.IO.Directory]::Exists($p)) {',
  "      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')",
  '    } elseif ([System.IO.File]::Exists($p)) {',
  "      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')",
  '    } else {',
  '      $failed += $i',
  '    }',
  '  } catch {',
  '    $failed += $i',
  '  }',
  '}',
  'ConvertTo-Json -InputObject @($failed) -Compress',
].join('\n');

export function createPowerShellRecycleRunner(): RecycleRunner {
  return (path: string) =>
    new Promise<StageResult>((resolve) => {
      execFile(
        powershellExecutable(),
        ['-NoProfile', '-NonInteractive', '-Command', RECYCLE_SCRIPT],
        {
          encoding: 'utf8',
          timeout: 60_000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, DUST_RECYCLE_PATH: path },
        },
        (error) => {
          resolve(error ? { ok: false, code: 'RECYCLE-ERROR' } : { ok: true });
        },
      );
    });
}

export async function stageToRecycleBin(path: string, options: { run?: RecycleRunner } = {}): Promise<StageResult> {
  const run = options.run ?? createPowerShellRecycleRunner();
  try {
    return await run(path);
  } catch {
    return { ok: false, code: 'RECYCLE-ERROR' };
  }
}

export function createPowerShellRecycleBatchRunner(): RecycleBatchRunner {
  return (paths: string[]) =>
    new Promise<StageResult[]>((resolve) => {
      execFile(
        powershellExecutable(),
        ['-NoProfile', '-NonInteractive', '-Command', RECYCLE_BATCH_SCRIPT],
        {
          encoding: 'utf8',
          timeout: 60_000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, DUST_RECYCLE_PATHS: JSON.stringify(paths) },
        },
        (error, stdout) => {
          if (error) {
            resolve(paths.map(() => ({ ok: false, code: 'RECYCLE-ERROR' })));
            return;
          }
          const failed = parseFailedIndices(stdout);
          resolve(paths.map((_, index) => (failed.has(index) ? { ok: false, code: 'RECYCLE-ERROR' } : { ok: true })));
        },
      );
    });
}

function parseFailedIndices(stdout: string): Set<number> {
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return new Set(list.filter((value): value is number => typeof value === 'number' && Number.isInteger(value)));
  } catch {
    return new Set();
  }
}

export async function stageManyToRecycleBin(
  paths: readonly string[],
  options: { run?: RecycleBatchRunner } = {},
): Promise<Map<string, StageResult>> {
  const run = options.run ?? createPowerShellRecycleBatchRunner();
  const results = new Map<string, StageResult>();
  for (let start = 0; start < paths.length; start += RECYCLE_BATCH_SIZE) {
    const chunk = paths.slice(start, start + RECYCLE_BATCH_SIZE);
    let staged: StageResult[];
    try {
      staged = await run(chunk);
    } catch {
      staged = chunk.map(() => ({ ok: false, code: 'RECYCLE-ERROR' }));
    }
    chunk.forEach((path, index) => {
      results.set(path, staged[index] ?? { ok: false, code: 'RECYCLE-ERROR' });
    });
  }
  return results;
}
