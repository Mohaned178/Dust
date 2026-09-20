import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';

export interface RecycleBinInfo {
  fileCount: number;
  bytes: number;
  oldestMs: number | null;
  newestMs: number | null;
  volume: string | null;
  error?: string;
}

const ENUMERATE_SCRIPT = [
  '$ErrorActionPreference = "SilentlyContinue"',
  "$binRoot = Join-Path $env:SystemDrive '$Recycle.Bin'",
  '$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  '$userFolders = @(Get-ChildItem -LiteralPath $binRoot -Force -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name.EndsWith($sid) })',
  '$items = $userFolders | ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Force -Recurse -File -ErrorAction SilentlyContinue }',
  '$bytes = ($items | Measure-Object -Property Length -Sum).Sum',
  '$count = @($items).Count',
  '$oldest = ($items | Sort-Object LastWriteTime | Select-Object -First 1).LastWriteTime',
  '$newest = ($items | Sort-Object LastWriteTime | Select-Object -Last 1).LastWriteTime',
  '$oldestMs = if ($oldest) { [long]([DateTimeOffset]$oldest).ToUnixTimeMilliseconds() } else { 0 }',
  '$newestMs = if ($newest) { [long]([DateTimeOffset]$newest).ToUnixTimeMilliseconds() } else { 0 }',
  'ConvertTo-Json -Compress -InputObject @{ count = $count; bytes = [long]$bytes; oldestMs = $oldestMs; newestMs = $newestMs; volume = $env:SystemDrive }',
].join('\n');

function resolvePowerShell(): string {
  const candidate = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return existsSync(candidate) ? candidate : 'powershell.exe';
}

function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}

export function defaultRecycleBinEnumeration(): RecycleBinInfo {
  if (process.platform !== 'win32') {
    return { fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null };
  }
  try {
    const raw = execFileSync(resolvePowerShell(), ['-NoProfile', '-NonInteractive', '-Command', ENUMERATE_SCRIPT], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const parsed = JSON.parse(raw) as { count?: number; bytes?: number; oldestMs?: number; newestMs?: number; volume?: string };
    return {
      fileCount: parsed.count ?? 0,
      bytes: parsed.bytes ?? 0,
      oldestMs: parsed.oldestMs ? parsed.oldestMs : null,
      newestMs: parsed.newestMs ? parsed.newestMs : null,
      volume: parsed.volume ?? null,
    };
  } catch (error) {
    return { fileCount: 0, bytes: 0, oldestMs: null, newestMs: null, volume: null, error: codeOf(error) };
  }
}

export function recycleBinRule(
  options: { enumerate?: () => RecycleBinInfo | Promise<RecycleBinInfo> } = {},
): Rule {
  const enumerate = options.enumerate ?? defaultRecycleBinEnumeration;
  return {
    id: 'recycle-bin',
    category: 'recycle-bin',
    title: 'Recycle Bin',
    action: { kind: 'empty-recycle-bin' },
    async match(_ctx: RuleContext): Promise<RuleMatch[]> {
      const info = await enumerate();
      if (info.fileCount === 0 || !info.volume) return [];
      const oldest = info.oldestMs ? new Date(info.oldestMs).toISOString().slice(0, 10) : 'unknown';
      const newest = info.newestMs ? new Date(info.newestMs).toISOString().slice(0, 10) : 'unknown';
      return [
        {
          path: join(`${info.volume}\\`, '$Recycle.Bin'),
          bytes: info.bytes,
          grade: 'review',
          recovery: { kind: 'junk', reason: 'Emptied items are permanently gone' },
          evidence: `${info.fileCount} items, ${info.bytes} bytes on ${info.volume} for the current user, dated ${oldest} to ${newest}`,
        },
      ];
    },
  };
}
