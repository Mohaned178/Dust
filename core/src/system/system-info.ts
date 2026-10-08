import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import koffi from 'koffi';
import { readRegistryValues, registryValueToString } from './win-registry';
import type { RegistryValue } from './win-registry';

export interface SystemInfoGpu {
  name: string;
  driverVersion: string | null;
  vramBytes: number | null;
  vramUncertain: boolean;
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
  /** True while the slow hardware part (GPUs) is still loading. */
  hardwarePending: boolean;
  os: SystemInfoOs;
  hostname: string | null;
  uptimeMs: number | null;
  cpu: SystemInfoCpu | null;
  gpus: SystemInfoGpu[];
  board: SystemInfoBoard | null;
  bios: SystemInfoBios | null;
}

/** The fast part of the machine description, read without PowerShell. */
export interface SystemInfoBase {
  /** False when the registry could not be read and only `os`-module values are present. */
  detailsAvailable: boolean;
  os: SystemInfoOs;
  hostname: string | null;
  uptimeMs: number | null;
  cpu: SystemInfoCpu | null;
  board: SystemInfoBoard | null;
  bios: SystemInfoBios | null;
}

/** The slow part, which has no simple Win32 API. JSON-serialisable so callers can cache it. */
export interface SystemHardware {
  physicalCores: number | null;
  logicalThreads: number | null;
  gpus: SystemInfoGpu[];
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

const GPU_SCRIPT_LINES = [
  '$gpus = @(Get-CimInstance -ClassName Win32_VideoController | Select-Object Name, DriverVersion, PNPDeviceID, AdapterRAM)',
  '$vram = @()',
  "$base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'",
  'foreach ($key in Get-ChildItem -Path $base -ErrorAction SilentlyContinue) {',
  "  if ($key.PSChildName -notmatch '^\\d{4}$') { continue }",
  '  try {',
  '    $props = Get-ItemProperty -Path $key.PSPath -ErrorAction SilentlyContinue',
  "    $qw = $props.'HardwareInformation.qwMemorySize'",
  '    $match = [string]$props.MatchingDeviceId',
  '    if ($qw -is [byte[]]) { $qw = [System.BitConverter]::ToUInt64($qw, 0) }',
  '    if ($qw -and $match) { $vram += [pscustomobject]@{ matchingDeviceId = $match; qwMemorySize = [long]$qw } }',
  '  } catch {}',
  '}',
];

export const SYSTEM_HARDWARE_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  ...GPU_SCRIPT_LINES,
  'ConvertTo-Json -InputObject ([pscustomobject]@{ gpus = $gpus; vram = $vram }) -Compress -Depth 4',
].join('\n');

export const SYSTEM_INFO_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$os = $null',
  "try { $cv = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -ErrorAction Stop; $os = [pscustomobject]@{ displayVersion = $cv.DisplayVersion; currentBuild = [string]$cv.CurrentBuild; ubr = $cv.UBR } } catch {}",
  '$cpu = @(Get-CimInstance -ClassName Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, Architecture)',
  ...GPU_SCRIPT_LINES,
  '$board = Get-CimInstance -ClassName Win32_BaseBoard | Select-Object Manufacturer, Product | Select-Object -First 1',
  "$bios = Get-CimInstance -ClassName Win32_BIOS | Select-Object SMBIOSBIOSVersion, @{n='ReleaseDate';e={ if ($_.ReleaseDate) { $_.ReleaseDate.ToString('yyyy-MM-dd') } }} | Select-Object -First 1",
  'ConvertTo-Json -InputObject ([pscustomobject]@{ os = $os; cpu = $cpu; gpus = $gpus; vram = $vram; board = $board; bios = $bios }) -Compress -Depth 4',
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
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function toPositiveInt(value: unknown): number | null {
  const numeric = toInt(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function matchVramBytes(
  records: Array<{ matchingDeviceId: string; bytes: number }>,
  pnpDeviceId: string | null,
): number | null {
  if (pnpDeviceId === null) return null;
  const device = pnpDeviceId.toLowerCase();
  for (const record of records) {
    const match = record.matchingDeviceId.toLowerCase();
    if (match.length > 0 && device.startsWith(match)) return record.bytes;
  }
  return null;
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
  const cpuNames = cpuEntries.map((entry) => cleanString(entry.Name)).filter((name): name is string => name !== null);
  const coreCounts = cpuEntries
    .map((entry) => toPositiveInt(entry.NumberOfCores))
    .filter((count): count is number => count !== null);
  const threadCounts = cpuEntries
    .map((entry) => toPositiveInt(entry.NumberOfLogicalProcessors))
    .filter((count): count is number => count !== null);
  const firstCpu = cpuEntries[0];

  const vramRecords = asArray(record.vram)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => {
      const matchingDeviceId = cleanString(entry.matchingDeviceId);
      const bytes = toPositiveInt(entry.qwMemorySize);
      return matchingDeviceId === null || bytes === null ? null : { matchingDeviceId, bytes };
    })
    .filter((entry): entry is { matchingDeviceId: string; bytes: number } => entry !== null);

  const gpus = asArray(record.gpus)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => {
      const name = cleanString(entry.Name);
      if (name === null) return null;
      const driverVersion = cleanString(entry.DriverVersion);
      const registryBytes = matchVramBytes(vramRecords, cleanString(entry.PNPDeviceID));
      if (registryBytes !== null) {
        return { name, driverVersion, vramBytes: registryBytes, vramUncertain: false };
      }
      const adapterRam = toPositiveInt(entry.AdapterRAM);
      if (adapterRam !== null) {
        return { name, driverVersion, vramBytes: adapterRam, vramUncertain: true };
      }
      return { name, driverVersion, vramBytes: null, vramUncertain: false };
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

export type NativeSystemInfo = Omit<ParsedSystemInfo, 'gpus'>;

export interface SystemInfoBaseOptions {
  osInfo?: SystemInfoOsInfo;
  platform?: string;
  readNative?: () => NativeSystemInfo | null;
}

export interface SystemHardwareOptions {
  query?: () => Promise<string>;
  timeoutMs?: number;
}

export interface ComposeSystemInfoOptions {
  pending: boolean;
  now?: () => number;
}

interface ProcessorApi {
  info: (relationship: number, buffer: Buffer | null, length: number[]) => boolean;
}

let cachedProcessorApi: ProcessorApi | null = null;

function loadProcessorApi(): ProcessorApi | null {
  if (cachedProcessorApi) return cachedProcessorApi;
  try {
    const kernel32 = koffi.load('kernel32.dll');
    cachedProcessorApi = {
      info: kernel32.func(
        'bool __stdcall GetLogicalProcessorInformationEx(uint32 RelationshipType, _Out_ void *Buffer, _Inout_ uint32 *ReturnedLength)',
      ) as ProcessorApi['info'],
    };
  } catch {
    return null;
  }
  return cachedProcessorApi;
}

const RELATION_PROCESSOR_CORE = 0;

function nativePhysicalCores(): number | null {
  const api = loadProcessorApi();
  if (api === null) return null;
  const length = [0];
  api.info(RELATION_PROCESSOR_CORE, null, length);
  const size = Number(length[0]);
  if (size === 0) return null;
  const buffer = Buffer.alloc(size);
  if (!api.info(RELATION_PROCESSOR_CORE, buffer, [size])) return null;
  let cores = 0;
  let offset = 0;
  while (offset + 8 <= size) {
    const recordSize = buffer.readUInt32LE(offset + 4);
    if (recordSize === 0) break;
    if (buffer.readUInt32LE(offset) === RELATION_PROCESSOR_CORE) cores += 1;
    offset += recordSize;
  }
  return cores > 0 ? cores : null;
}

const NATIVE_ARCHITECTURES: Readonly<Record<string, number>> = {
  x86: 0,
  arm: 5,
  amd64: 9,
  arm64: 12,
};

function textValue(values: Map<string, RegistryValue> | null, name: string): string | null {
  const value = values?.get(name);
  return value === undefined ? null : cleanString(registryValueToString(value));
}

function nativeBiosDate(raw: string | null): string | null {
  if (raw === null) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (match === null) return raw;
  return `${match[3]}-${match[1]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}`;
}

function readNativeSystemInfo(): NativeSystemInfo | null {
  try {
    const current = readRegistryValues('HKLM', 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion');
    if (current === null) return null;
    const currentBuild = textValue(current, 'CurrentBuild');
    const updateRevision = current.get('UBR');
    const ubr = updateRevision?.type === 'dword' ? toPositiveInt(updateRevision.value) : null;

    const environment = readRegistryValues('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');
    const architecture = textValue(environment, 'PROCESSOR_ARCHITECTURE');

    const bios = readRegistryValues('HKLM', 'HARDWARE\\DESCRIPTION\\System\\BIOS');
    const manufacturer = textValue(bios, 'BaseBoardManufacturer');
    const product = textValue(bios, 'BaseBoardProduct');
    const biosVersion = textValue(bios, 'BIOSVersion');
    const biosDate = nativeBiosDate(textValue(bios, 'BIOSReleaseDate'));

    const processor = readRegistryValues('HKLM', 'HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0');
    return {
      displayVersion: textValue(current, 'DisplayVersion'),
      build: currentBuild === null ? null : ubr === null ? currentBuild : `${currentBuild}.${ubr}`,
      architecture: architecture === null ? null : (NATIVE_ARCHITECTURES[architecture.toLowerCase()] ?? null),
      cpuModel: textValue(processor, 'ProcessorNameString'),
      physicalCores: nativePhysicalCores(),
      logicalThreads: null,
      board: manufacturer === null && product === null ? null : { manufacturer, product },
      bios: biosVersion === null && biosDate === null ? null : { version: biosVersion, date: biosDate },
    };
  } catch {
    return null;
  }
}

function buildSystemInfoBase(native: NativeSystemInfo | null, info: SystemInfoOsInfo): SystemInfoBase {
  const cpus = info.cpus();
  const firstCpu = cpus[0];
  const fallbackModel = firstCpu === undefined ? null : cleanString(firstCpu.model);
  const model = native?.cpuModel ?? fallbackModel;
  const cpu: SystemInfoCpu | null =
    model === null
      ? null
      : {
          model,
          physicalCores: native?.physicalCores ?? null,
          logicalThreads: native?.logicalThreads ?? (cpus.length > 0 ? cpus.length : null),
        };

  const build = native?.build ?? cleanString(info.release());
  const arch = mapProcessorArchitecture(native?.architecture ?? null) ?? normalizeOsArch(info.arch());
  const uptimeSeconds = info.uptimeSeconds();

  return {
    detailsAvailable: native !== null,
    os: { name: cleanString(info.version()), version: native?.displayVersion ?? null, build, arch },
    hostname: cleanString(info.hostname()),
    uptimeMs: Number.isFinite(uptimeSeconds) ? Math.max(uptimeSeconds, 0) * 1000 : null,
    cpu,
    board: native?.board ?? null,
    bios: native?.bios ?? null,
  };
}

/** The fast, PowerShell-free part of the machine description. */
export function readSystemInfoBase(options: SystemInfoBaseOptions = {}): SystemInfoBase {
  const info = options.osInfo ?? defaultOsInfo;
  const platform = options.platform ?? process.platform;
  const native = platform === 'win32' ? (options.readNative ?? readNativeSystemInfo)() : null;
  return buildSystemInfoBase(native, info);
}

function runPowerShellScript(script: string, timeoutMs: number): Promise<string> {
  const powershell =
    process.platform === 'win32' && process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe';
  const executable = existsSync(powershell) ? powershell : 'powershell.exe';
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
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

function hardwareOf(parsed: ParsedSystemInfo): SystemHardware {
  return { physicalCores: parsed.physicalCores, logicalThreads: parsed.logicalThreads, gpus: parsed.gpus };
}

/** GPUs, which only WMI lists. Throws when PowerShell fails or its output cannot be read. */
export async function querySystemHardware(options: SystemHardwareOptions = {}): Promise<SystemHardware> {
  const query = options.query ?? (() => runPowerShellScript(SYSTEM_HARDWARE_SCRIPT, options.timeoutMs ?? 20_000));
  const parsed = parseSystemInfoJson(await query());
  if (parsed === null) throw new Error('Could not read hardware details');
  return hardwareOf(parsed);
}

export function composeSystemInfo(
  base: SystemInfoBase,
  hardware: SystemHardware | null,
  options: ComposeSystemInfoOptions,
): SystemInfoStatic {
  const now = options.now ?? Date.now;
  const cpu: SystemInfoCpu | null =
    base.cpu === null
      ? null
      : {
          model: base.cpu.model,
          physicalCores: base.cpu.physicalCores ?? hardware?.physicalCores ?? null,
          logicalThreads: base.cpu.logicalThreads ?? hardware?.logicalThreads ?? null,
        };
  return {
    capturedAt: now(),
    hardwareAvailable: hardware !== null || (options.pending && base.detailsAvailable),
    hardwarePending: hardware === null && options.pending,
    os: base.os,
    hostname: base.hostname,
    uptimeMs: base.uptimeMs,
    cpu,
    gpus: hardware?.gpus ?? [],
    board: base.board,
    bios: base.bios,
  };
}

export async function getSystemInfoStatic(options: SystemInfoStaticOptions = {}): Promise<SystemInfoStatic> {
  const info = options.osInfo ?? defaultOsInfo;
  const platform = options.platform ?? process.platform;
  const compose = { pending: false, now: options.now };

  if (options.query !== undefined) {
    let parsed: ParsedSystemInfo | null;
    try {
      parsed = parseSystemInfoJson(await options.query());
    } catch {
      parsed = null;
    }
    const base = buildSystemInfoBase(parsed, info);
    return composeSystemInfo(base, parsed === null ? null : hardwareOf(parsed), compose);
  }

  const base = readSystemInfoBase({ osInfo: info, platform });
  let hardware: SystemHardware | null = null;
  if (platform === 'win32') {
    try {
      hardware = await querySystemHardware();
    } catch {
      hardware = null;
    }
  }
  return composeSystemInfo(base, hardware, compose);
}

export interface CpuTimesSample {
  idle: number;
  total: number;
}

export function readCpuTimes(): CpuTimesSample {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

export function createCpuUsageSampler(readTimes: () => CpuTimesSample = readCpuTimes): () => number | null {
  let previous: CpuTimesSample | null = null;
  return () => {
    const current = readTimes();
    const prior = previous;
    previous = current;
    if (prior === null) return null;
    const idleDelta = current.idle - prior.idle;
    const totalDelta = current.total - prior.total;
    if (totalDelta <= 0 || idleDelta < 0) return null;
    const usage = (1 - idleDelta / totalDelta) * 100;
    return Math.min(Math.max(Math.round(usage), 0), 100);
  };
}

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
}

export function readMemoryInfo(): MemoryInfo {
  const totalBytes = os.totalmem();
  const availableBytes = os.freemem();
  return { totalBytes, availableBytes, usedBytes: Math.max(totalBytes - availableBytes, 0) };
}
