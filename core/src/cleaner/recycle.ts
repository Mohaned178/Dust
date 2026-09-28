import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface StageResult {
  ok: boolean;
  code?: string;
}

export type RecycleRunner = (path: string) => Promise<StageResult>;

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
