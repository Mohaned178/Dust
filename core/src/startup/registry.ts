import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { RunSource, RunValue, StartupSource } from './types';
import { RUN_SOURCES, STARTUP_SOURCES } from './types';

export const RUN_REGISTRY_KEYS: Record<RunSource, string> = {
  'hkcu-run': 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'hklm-run': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'hklm-run-wow64': 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
};

export const BACKUP_REGISTRY_KEYS: Record<RunSource, string> = {
  'hkcu-run': 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run-Dust-Disabled',
  'hklm-run': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run-Dust-Disabled',
  'hklm-run-wow64': 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run-Dust-Disabled',
};

const APPROVED_REGISTRY_KEYS: Record<StartupSource, string> = {
  'hkcu-run': 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  'hklm-run': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  'hklm-run-wow64': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32',
  'startup-folder-user':
    'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
  'startup-folder-common':
    'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
};

export interface RegistrySnapshot {
  run: Record<RunSource, RunValue[]>;
  backups: Array<{ source: RunSource; raw: string }>;
  windowsDisabled: Record<StartupSource, string[]>;
}

export interface RegistryStore {
  readSnapshot(): Promise<RegistrySnapshot>;
  readRunValue(source: RunSource, name: string): Promise<string | null>;
  writeRunValue(source: RunSource, name: string, command: string): Promise<void>;
  deleteRunValue(source: RunSource, name: string): Promise<void>;
  readBackupValue(source: RunSource, id: string): Promise<string | null>;
  writeBackupValue(source: RunSource, id: string, raw: string): Promise<void>;
  deleteBackupValue(source: RunSource, id: string): Promise<void>;
  writeApprovedEnabled(source: StartupSource, name: string): Promise<void>;
}

const QUERY_TIMEOUT_MS = 20_000;
const SNAPSHOT_TTL_MS = 30_000;

const READ_SNAPSHOT_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  'function Read-Run([string]$path) {',
  '  $props = Get-ItemProperty -Path $path',
  '  if ($null -eq $props) { return @() }',
  "  $skip = @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider')",
  '  $items = @()',
  '  foreach ($p in $props.PSObject.Properties) {',
  '    if ($skip -contains $p.Name) { continue }',
  '    $items += [pscustomobject]@{ name = [string]$p.Name; command = [string]$p.Value }',
  '  }',
  '  return @($items)',
  '}',
  'function Read-Approved([string]$path) {',
  '  $props = Get-ItemProperty -Path $path',
  '  if ($null -eq $props) { return @() }',
  "  $skip = @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider')",
  '  $names = @()',
  '  foreach ($p in $props.PSObject.Properties) {',
  '    if ($skip -contains $p.Name) { continue }',
  '    $value = $p.Value',
  '    if ($value -is [byte[]] -and $value.Length -gt 0 -and ($value[0] % 2) -eq 1) { $names += [string]$p.Name }',
  '  }',
  '  return @($names)',
  '}',
  'function Read-Backup([string]$path) {',
  '  $items = Read-Run $path',
  '  $raw = @()',
  '  foreach ($item in @($items)) { $raw += [string]$item.command }',
  '  return @($raw)',
  '}',
  '$result = [pscustomobject]@{',
  '  run = [pscustomobject]@{',
  `    'hkcu-run' = Read-Run '${RUN_REGISTRY_KEYS['hkcu-run']}'`,
  `    'hklm-run' = Read-Run '${RUN_REGISTRY_KEYS['hklm-run']}'`,
  `    'hklm-run-wow64' = Read-Run '${RUN_REGISTRY_KEYS['hklm-run-wow64']}'`,
  '  }',
  '  backups = [pscustomobject]@{',
  `    'hkcu-run' = Read-Backup '${BACKUP_REGISTRY_KEYS['hkcu-run']}'`,
  `    'hklm-run' = Read-Backup '${BACKUP_REGISTRY_KEYS['hklm-run']}'`,
  `    'hklm-run-wow64' = Read-Backup '${BACKUP_REGISTRY_KEYS['hklm-run-wow64']}'`,
  '  }',
  '  windowsDisabled = [pscustomobject]@{',
  ...STARTUP_SOURCES.map((source) => `    '${source}' = Read-Approved '${APPROVED_REGISTRY_KEYS[source]}'`),
  '  }',
  '}',
  'ConvertTo-Json -InputObject $result -Compress -Depth 5',
].join('\n');

const READ_VALUE_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$value = $null',
  'if (Test-Path -LiteralPath $env:DUST_STARTUP_KEY) {',
  '  $props = Get-ItemProperty -Path $env:DUST_STARTUP_KEY',
  '  if ($null -ne $props -and ($props.PSObject.Properties.Name -contains $env:DUST_STARTUP_NAME)) {',
  '    $value = [string]$props.$($env:DUST_STARTUP_NAME)',
  '  }',
  '}',
  'ConvertTo-Json -InputObject @{ value = $value } -Compress',
].join('\n');

const WRITE_VALUE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'if (-not (Test-Path -LiteralPath $env:DUST_STARTUP_KEY)) { New-Item -Path $env:DUST_STARTUP_KEY -Force | Out-Null }',
  'Set-ItemProperty -Path $env:DUST_STARTUP_KEY -Name $env:DUST_STARTUP_NAME -Value $env:DUST_STARTUP_COMMAND -Type String',
].join('\n');

const DELETE_VALUE_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  'Remove-ItemProperty -Path $env:DUST_STARTUP_KEY -Name $env:DUST_STARTUP_NAME',
].join('\n');

const WRITE_APPROVED_ENABLED_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'if (-not (Test-Path -LiteralPath $env:DUST_STARTUP_KEY)) { New-Item -Path $env:DUST_STARTUP_KEY -Force | Out-Null }',
  'Set-ItemProperty -Path $env:DUST_STARTUP_KEY -Name $env:DUST_STARTUP_NAME -Value ([byte[]](0x02,0,0,0,0,0,0,0,0,0,0,0)) -Type Binary',
].join('\n');

function powershellExecutable(): string {
  const candidate =
    process.platform === 'win32' && process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe';
  return existsSync(candidate) ? candidate : 'powershell.exe';
}

function runPowerShell(script: string, env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      powershellExecutable(),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        timeout: QUERY_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, ...env },
      },
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

function asArray<T>(value: unknown): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseRunValues(value: unknown): RunValue[] {
  return asArray<Record<string, unknown>>(value)
    .map((entry) => ({
      name: typeof entry?.name === 'string' ? entry.name : '',
      command: typeof entry?.command === 'string' ? entry.command : '',
    }))
    .filter((entry) => entry.name.length > 0);
}

function parseNameList(value: unknown): string[] {
  return asArray<unknown>(value).filter((entry): entry is string => typeof entry === 'string');
}

export function parseRegistrySnapshot(raw: string): RegistrySnapshot | null {
  const parsed = parseJson(raw) as Record<string, unknown> | null;
  if (parsed === null || typeof parsed !== 'object') return null;
  const run = (parsed.run ?? {}) as Record<string, unknown>;
  const backups = (parsed.backups ?? {}) as Record<string, unknown>;
  const windowsDisabled = (parsed.windowsDisabled ?? {}) as Record<string, unknown>;

  const runRecord = {} as Record<RunSource, RunValue[]>;
  for (const source of RUN_SOURCES) runRecord[source] = parseRunValues(run[source]);

  const backupEntries: Array<{ source: RunSource; raw: string }> = [];
  for (const source of RUN_SOURCES) {
    for (const rawValue of parseNameList(backups[source])) {
      backupEntries.push({ source, raw: rawValue });
    }
  }

  const disabledRecord = {} as Record<StartupSource, string[]>;
  for (const source of STARTUP_SOURCES) disabledRecord[source] = parseNameList(windowsDisabled[source]);

  return { run: runRecord, backups: backupEntries, windowsDisabled: disabledRecord };
}

export function createPowerShellRegistryStore(): RegistryStore {
  let snapshotCache: { at: number; snapshot: RegistrySnapshot } | null = null;
  let snapshotInFlight: Promise<RegistrySnapshot> | null = null;

  function invalidate(): void {
    snapshotCache = null;
  }

  async function loadSnapshot(): Promise<RegistrySnapshot> {
    const raw = await runPowerShell(READ_SNAPSHOT_SCRIPT);
    const snapshot = parseRegistrySnapshot(raw);
    if (snapshot === null) throw new Error('Could not read startup entries');
    return snapshot;
  }

  async function readValue(key: string, name: string): Promise<string | null> {
    const raw = await runPowerShell(READ_VALUE_SCRIPT, {
      DUST_STARTUP_KEY: key,
      DUST_STARTUP_NAME: name,
    });
    const parsed = parseJson(raw) as { value?: unknown } | null;
    if (parsed === null || parsed.value === null || parsed.value === undefined) return null;
    return typeof parsed.value === 'string' ? parsed.value : String(parsed.value);
  }

  async function writeValue(key: string, name: string, command: string): Promise<void> {
    await runPowerShell(WRITE_VALUE_SCRIPT, {
      DUST_STARTUP_KEY: key,
      DUST_STARTUP_NAME: name,
      DUST_STARTUP_COMMAND: command,
    });
    invalidate();
  }

  return {
    async readSnapshot() {
      if (snapshotCache !== null && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) {
        return snapshotCache.snapshot;
      }
      if (snapshotInFlight !== null) return snapshotInFlight;
      const pending = loadSnapshot();
      snapshotInFlight = pending;
      try {
        const snapshot = await pending;
        snapshotCache = { at: Date.now(), snapshot };
        return snapshot;
      } finally {
        snapshotInFlight = null;
      }
    },
    readRunValue: (source, name) => readValue(RUN_REGISTRY_KEYS[source], name),
    writeRunValue: (source, name, command) => writeValue(RUN_REGISTRY_KEYS[source], name, command),
    deleteRunValue: (source, name) => writeDelete(RUN_REGISTRY_KEYS[source], name),
    readBackupValue: (source, id) => readValue(BACKUP_REGISTRY_KEYS[source], id),
    writeBackupValue: (source, id, raw) => writeValue(BACKUP_REGISTRY_KEYS[source], id, raw),
    deleteBackupValue: (source, id) => writeDelete(BACKUP_REGISTRY_KEYS[source], id),
    writeApprovedEnabled: async (source, name) => {
      await runPowerShell(WRITE_APPROVED_ENABLED_SCRIPT, {
        DUST_STARTUP_KEY: APPROVED_REGISTRY_KEYS[source],
        DUST_STARTUP_NAME: name,
      });
      invalidate();
    },
  };

  async function writeDelete(key: string, name: string): Promise<void> {
    await runPowerShell(DELETE_VALUE_SCRIPT, {
      DUST_STARTUP_KEY: key,
      DUST_STARTUP_NAME: name,
    });
    invalidate();
  }
}
