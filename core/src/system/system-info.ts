import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as os from 'node:os';

export interface SystemInfoGpu {
  name: string;
  driverVersion: string | null;
}

export interface SystemInfoOs {
  name: string | null;
  version: string | null;
  build: string | null;
  arch: string | null;
}

export interface SystemInfoCpu {
  model: string;
  physicalCores: number | null;
  logicalThreads: number | null;
}

export interface SystemInfoBoard {
  manufacturer: string | null;
  product: string | null;
}

export interface SystemInfoBios {
  version: string | null;
  date: string | null;
}

export interface SystemInfoStatic {
  capturedAt: number;
  hardwareAvailable: boolean;
  os: SystemInfoOs;
  hostname: string | null;
  uptimeMs: number | null;
  cpu: SystemInfoCpu | null;
  gpus: SystemInfoGpu[];
  board: SystemInfoBoard | null;
  bios: SystemInfoBios | null;
}

export interface SystemInfoLive {
  cpuPercent: number | null;
  memTotalBytes: number;
  memUsedBytes: number;
  memAvailableBytes: number;
}

export interface ParsedSystemInfo {
  displayVersion: string | null;
  build: string | null;
  architecture: number | null;
  cpuModel: string | null;
  physicalCores: number | null;
  logicalThreads: number | null;
  gpus: SystemInfoGpu[];
  board: SystemInfoBoard | null;
  bios: SystemInfoBios | null;
}

export const SYSTEM_INFO_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$os = $null',
  "try { $cv = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -ErrorAction Stop; $os = [pscustomobject]@{ displayVersion = $cv.DisplayVersion; currentBuild = [string]$cv.CurrentBuild; ubr = $cv.UBR } } catch {}",
  '$cpu = @(Get-CimInstance -ClassName Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, Architecture)',
  '$gpus = @(Get-CimInstance -ClassName Win32_VideoController | Select-Object Name, DriverVersion)',
  '$board = Get-CimInstance -ClassName Win32_BaseBoard | Select-Object Manufacturer, Product | Select-Object -First 1',
  "$bios = Get-CimInstance -ClassName Win32_BIOS | Select-Object SMBIOSBIOSVersion, @{n='ReleaseDate';e={ if ($_.ReleaseDate) { $_.ReleaseDate.ToString('yyyy-MM-dd') } }} | Select-Object -First 1",
  "ConvertTo-Json -InputObject ([pscustomobject]@{ os = $os; cpu = $cpu; gpus = $gpus; board = $board; bios = $bios }) -Compress -Depth 4",
].join('\n');

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const list = asArray(value);
  return list.length === 0 ? null : asRecord(list[0]);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toInt(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function toPositiveInt(value: unknown): number | null {
  const numeric = toInt(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

export function parseSystemInfoJson(raw: string): ParsedSystemInfo | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const record = asRecord(value);
  if (record === null) return null;

  const osRecord = asRecord(record.os);
  const currentBuild = cleanString(osRecord?.currentBuild);
  const ubr = toPositiveInt(osRecord?.ubr);
  const build = currentBuild === null ? null : ubr === null ? currentBuild : `${currentBuild}.${ubr}`;

  const cpuEntries = asArray(record.cpu)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const cpuNames = cpuEntries
    .map((entry) => cleanString(entry.Name))
    .filter((name): name is string => name !== null);
  const coreCounts = cpuEntries
    .map((entry) => toPositiveInt(entry.NumberOfCores))
    .filter((count): count is number => count !== null);
  const threadCounts = cpuEntries
    .map((entry) => toPositiveInt(entry.NumberOfLogicalProcessors))
    .filter((count): count is number => count !== null);
  const firstCpu = cpuEntries[0];

  const gpus = asArray(record.gpus)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => {
      const name = cleanString(entry.Name);
      return name === null ? null : { name, driverVersion: cleanString(entry.DriverVersion) };
    })
    .filter((gpu): gpu is SystemInfoGpu => gpu !== null);

  const boardRecord = firstRecord(record.board);
  const manufacturer = cleanString(boardRecord?.Manufacturer);
  const product = cleanString(boardRecord?.Product);

  const biosRecord = firstRecord(record.bios);
  const biosVersion = cleanString(biosRecord?.SMBIOSBIOSVersion);
  const biosDate = cleanString(biosRecord?.ReleaseDate);

  return {
    displayVersion: cleanString(osRecord?.displayVersion),
    build,
    architecture: firstCpu === undefined ? null : toInt(firstCpu.Architecture),
    cpuModel: cpuNames[0] ?? null,
    physicalCores: coreCounts.length === 0 ? null : coreCounts.reduce((sum, count) => sum + count, 0),
    logicalThreads: threadCounts.length === 0 ? null : threadCounts.reduce((sum, count) => sum + count, 0),
    gpus,
    board: manufacturer === null && product === null ? null : { manufacturer, product },
    bios: biosVersion === null && biosDate === null ? null : { version: biosVersion, date: biosDate },
  };
}

const PROCESSOR_ARCHITECTURES: Readonly<Record<number, string>> = {
  0: 'x86',
  5: 'ARM',
  9: 'x64',
  12: 'ARM64',
};

export function mapProcessorArchitecture(value: number | null): string | null {
  if (value === null) return null;
  return PROCESSOR_ARCHITECTURES[value] ?? null;
}

export function normalizeOsArch(raw: string): string | null {
  const value = raw.trim();
  const key = value.toLowerCase();
  if (key.length === 0) return null;
  if (key === 'ia32') return 'x86';
  if (key === 'x64') return 'x64';
  if (key === 'arm64') return 'ARM64';
  if (key === 'arm') return 'ARM';
  return value;
}

export interface SystemInfoOsInfo {
  hostname(): string;
  uptimeSeconds(): number;
  version(): string;
  release(): string;
  arch(): string;
  cpus(): Array<{ model: string }>;
}

const defaultOsInfo: SystemInfoOsInfo = {
  hostname: () => os.hostname(),
  uptimeSeconds: () => os.uptime(),
  version: () => os.version(),
  release: () => os.release(),
  arch: () => os.arch(),
  cpus: () => os.cpus(),
};

export interface SystemInfoStaticOptions {
  query?: () => Promise<string>;
  now?: () => number;
  osInfo?: SystemInfoOsInfo;
  platform?: string;
}

function querySystemInfoJson(): Promise<string> {
  const powershell =
    process.platform === 'win32' && process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe';
  const executable = existsSync(powershell) ? powershell : 'powershell.exe';
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ['-NoProfile', '-NonInteractive', '-Command', SYSTEM_INFO_SCRIPT],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
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

export async function getSystemInfoStatic(
  options: SystemInfoStaticOptions = {},
): Promise<SystemInfoStatic> {
  const now = options.now ?? Date.now;
  const info = options.osInfo ?? defaultOsInfo;
  const platform = options.platform ?? process.platform;

  let parsed: ParsedSystemInfo | null = null;
  if (options.query !== undefined || platform === 'win32') {
    try {
      parsed = parseSystemInfoJson(await (options.query ?? querySystemInfoJson)());
    } catch {
      parsed = null;
    }
  }

  const cpus = info.cpus();
  const firstCpu = cpus[0];
  const fallbackModel = firstCpu === undefined ? null : cleanString(firstCpu.model);
  const model = parsed?.cpuModel ?? fallbackModel;
  const cpu: SystemInfoCpu | null =
    model === null
      ? null
      : {
          model,
          physicalCores: parsed?.physicalCores ?? null,
          logicalThreads: parsed?.logicalThreads ?? (cpus.length > 0 ? cpus.length : null),
        };

  const build = parsed?.build ?? cleanString(info.release());
  const arch = mapProcessorArchitecture(parsed?.architecture ?? null) ?? normalizeOsArch(info.arch());
  const uptimeSeconds = info.uptimeSeconds();

  return {
    capturedAt: now(),
    hardwareAvailable: parsed !== null,
    os: { name: cleanString(info.version()), version: parsed?.displayVersion ?? null, build, arch },
    hostname: cleanString(info.hostname()),
    uptimeMs: Number.isFinite(uptimeSeconds) ? Math.max(uptimeSeconds, 0) * 1000 : null,
    cpu,
    gpus: parsed?.gpus ?? [],
    board: parsed?.board ?? null,
    bios: parsed?.bios ?? null,
  };
}
