// Compares the native Win32 readers against the PowerShell scripts they replace
// and times each native call. Run from core/ on Windows:
//
//   npx tsx scripts/compare-native.ts
//
// Exits with code 1 when any comparison differs.
import { execFile } from 'node:child_process';
import {
  getSystemInfoStatic,
  listVolumesAsync,
  parseInstalledApps,
  parseRegistrySnapshot,
  readFileCompanyNames,
  readInstalledAppsNative,
  readNativeRegistrySnapshot,
  readSystemInfoBase,
  resetVolumeCache,
} from '../src/index';
import { LIST_VOLUMES_SCRIPT, parseVolumesJson } from '../src/system/drive-type';
import { INSTALLED_APPS_QUERY_SCRIPT } from '../src/system/installed-apps';
import { READ_SNAPSHOT_SCRIPT } from '../src/startup/registry';
import { SYSTEM_INFO_SCRIPT } from '../src/system/system-info';

const UTF8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n';

const PUBLISHER_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$paths = $env:DUST_PUBLISHER_PATHS | ConvertFrom-Json',
  '$out = foreach ($p in @($paths)) {',
  '  if (Test-Path -LiteralPath $p) {',
  '    $info = (Get-Item -LiteralPath $p).VersionInfo',
  '    [pscustomobject]@{ path = [string]$p; company = [string]$info.CompanyName }',
  '  }',
  '}',
  'ConvertTo-Json -InputObject @($out) -Compress',
].join('\n');

function runPowerShell(script: string, env: Record<string, string> = {}): Promise<{ out: string; ms: number }> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', UTF8 + script],
      {
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, ...env },
      },
      (error, stdout) =>
        error ? reject(error) : resolve({ out: stdout, ms: Math.round(performance.now() - startedAt) }),
    );
  });
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const startedAt = performance.now();
  const value = fn();
  return { value, ms: Number((performance.now() - startedAt).toFixed(2)) };
}

let totalDiffs = 0;

function report(label: string, nativeMs: string, powershellMs: number, diffs: string[]): void {
  totalDiffs += diffs.length;
  console.log(`\n== ${label}: native ${nativeMs} ms, PowerShell ${powershellMs} ms, ${diffs.length} diff(s)`);
  for (const diff of diffs.slice(0, 40)) console.log(`   ${diff}`);
}

function diffLists<T>(native: T[], reference: T[], key: (item: T) => string, ordered = true): string[] {
  const diffs: string[] = [];
  const nativeByKey = new Map(native.map((item) => [key(item), item]));
  const referenceByKey = new Map(reference.map((item) => [key(item), item]));
  for (const [id, item] of referenceByKey) {
    const other = nativeByKey.get(id);
    if (other === undefined) diffs.push(`only in PowerShell: ${id}`);
    else if (JSON.stringify(other) !== JSON.stringify(item)) {
      diffs.push(`differs ${id}\n      native: ${JSON.stringify(other)}\n      ps:     ${JSON.stringify(item)}`);
    }
  }
  for (const id of nativeByKey.keys()) if (!referenceByKey.has(id)) diffs.push(`only in native: ${id}`);
  if (ordered && native.length === reference.length) {
    const nativeOrder = native.map(key).join('\u0000');
    const referenceOrder = reference.map(key).join('\u0000');
    if (nativeOrder !== referenceOrder) diffs.push('same items, different order');
  }
  return diffs;
}

function executableFromCommand(command: string): string | null {
  const expanded = command
    .replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? match)
    .trim();
  if (expanded.length === 0) return null;
  const clean = (value: string): string | null => {
    const cleaned = value
      .trim()
      .replace(/^"|"$/g, '')
      .replace(/^\\\\\?\\/, '');
    return cleaned.length > 0 ? cleaned : null;
  };
  if (expanded.startsWith('"')) {
    const end = expanded.indexOf('"', 1);
    if (end > 1) return clean(expanded.slice(1, end));
  }
  const exeMatch = /\.exe(\s|$)/i.exec(expanded);
  if (exeMatch !== null && exeMatch.index > 0) return clean(expanded.slice(0, exeMatch.index + 4));
  return clean(expanded.split(/\s+/)[0] ?? '');
}

async function compareStartup(): Promise<string[]> {
  const first = timed(readNativeRegistrySnapshot);
  const second = timed(readNativeRegistrySnapshot);
  const powershell = await runPowerShell(READ_SNAPSHOT_SCRIPT);
  const reference = parseRegistrySnapshot(powershell.out);
  if (reference === null) throw new Error('PowerShell snapshot did not parse');
  const native = first.value;
  const diffs: string[] = [];
  for (const source of Object.keys(native.run) as Array<keyof typeof native.run>) {
    diffs.push(
      ...diffLists(native.run[source], reference.run[source], (item) => item.name).map((d) => `run ${source}: ${d}`),
    );
  }
  diffs.push(
    ...diffLists(native.backups, reference.backups, (item) => `${item.source}\u0000${item.raw}`).map(
      (d) => `backups: ${d}`,
    ),
  );
  for (const source of Object.keys(native.windowsDisabled) as Array<keyof typeof native.windowsDisabled>) {
    diffs.push(
      ...diffLists(native.windowsDisabled[source], reference.windowsDisabled[source], (item) => item).map(
        (d) => `approved ${source}: ${d}`,
      ),
    );
  }
  const total = Object.values(native.run).reduce((sum, list) => sum + list.length, 0);
  console.log(`startup: ${total} run values, ${native.backups.length} backups`);
  report('startup snapshot', `${first.ms} cold / ${second.ms} warm`, powershell.ms, diffs);
  return Object.values(native.run).flatMap((list) => list.map((item) => item.command));
}

async function compareInstalledApps(): Promise<void> {
  const first = timed(readInstalledAppsNative);
  const second = timed(readInstalledAppsNative);
  const powershell = await runPowerShell(INSTALLED_APPS_QUERY_SCRIPT);
  const reference = parseInstalledApps(powershell.out) ?? [];
  console.log(`installed apps: ${first.value.length} native, ${reference.length} PowerShell`);
  report(
    'installed apps',
    `${first.ms} cold / ${second.ms} warm`,
    powershell.ms,
    diffLists(first.value, reference, (app) => app.id),
  );
}

async function compareVolumes(): Promise<void> {
  resetVolumeCache();
  const startedAt = performance.now();
  const native = await listVolumesAsync();
  const nativeMs = (performance.now() - startedAt).toFixed(2);
  const powershell = await runPowerShell(LIST_VOLUMES_SCRIPT);
  const reference = parseVolumesJson(powershell.out);
  const strip = (volumes: typeof native) => volumes.map(({ root, label, driveType }) => ({ root, label, driveType }));
  console.log('native volumes (before media lookup):', JSON.stringify(native));
  report(
    'volumes (root, label, driveType)',
    nativeMs,
    powershell.ms,
    diffLists(strip(native), strip(reference), (volume) => volume.root, false),
  );

  const awaited = await (async () => {
    resetVolumeCache();
    const t = performance.now();
    const volumes = await listVolumesAsync({ awaitMediaTypes: true });
    return { volumes, ms: Math.round(performance.now() - t) };
  })();
  const mediaDiffs = diffLists(
    awaited.volumes.map(({ root, mediaType }) => ({ root, mediaType })),
    reference.map(({ root, mediaType }) => ({ root, mediaType })),
    (volume) => volume.root,
    false,
  );
  report('volumes media types (awaitMediaTypes)', `${awaited.ms} (includes PowerShell)`, powershell.ms, mediaDiffs);
}

async function compareCompanies(commands: string[]): Promise<void> {
  const paths = [...new Set(commands.map(executableFromCommand).filter((path): path is string => path !== null))];
  const first = timed(() => readFileCompanyNames(paths));
  const powershell = await runPowerShell(PUBLISHER_SCRIPT, { DUST_PUBLISHER_PATHS: JSON.stringify(paths) });
  const parsed = JSON.parse(powershell.out.trim().length === 0 ? '[]' : powershell.out) as unknown;
  const list = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ path: string; company: string }>;
  const reference = new Map<string, string>();
  for (const item of list) {
    const company = item.company.trim();
    if (company.length > 0) reference.set(item.path, company);
  }
  const native = first.value ?? new Map<string, string>();
  console.log(`company names for ${paths.length} executables: ${native.size} native, ${reference.size} PowerShell`);
  const toList = (map: Map<string, string>) => [...map].map(([path, company]) => ({ path, company }));
  report(
    'file publishers',
    String(first.ms),
    powershell.ms,
    diffLists(toList(native), toList(reference), (item) => item.path),
  );
}

async function compareSystemInfo(): Promise<void> {
  const first = timed(() => readSystemInfoBase());
  const second = timed(() => readSystemInfoBase());
  const powershell = await runPowerShell(SYSTEM_INFO_SCRIPT);
  const reference = await getSystemInfoStatic({ query: async () => powershell.out });
  const base = first.value;
  console.log(
    `system info base: cpu=${JSON.stringify(base.cpu)} os=${JSON.stringify(base.os)} board=${JSON.stringify(base.board)} bios=${JSON.stringify(base.bios)}`,
  );
  const pick = (value: { os: unknown; hostname: unknown; cpu: unknown; board: unknown; bios: unknown }) => ({
    os: value.os,
    hostname: value.hostname,
    cpu: value.cpu,
    board: value.board,
    bios: value.bios,
  });
  const native = pick(base);
  const expected = pick(reference);
  const diffs: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (JSON.stringify(native[key]) !== JSON.stringify(expected[key])) {
      diffs.push(
        `${key}\n      native: ${JSON.stringify(native[key])}\n      ps:     ${JSON.stringify(expected[key])}`,
      );
    }
  }
  report('system info base', `${first.ms} cold / ${second.ms} warm`, powershell.ms, diffs);
}

async function main(): Promise<void> {
  const commands = await compareStartup();
  await compareInstalledApps();
  await compareVolumes();
  await compareCompanies(commands);
  await compareSystemInfo();
  console.log(`\n${totalDiffs === 0 ? 'No diffs.' : `${totalDiffs} diff(s) found.`}`);
  process.exit(totalDiffs === 0 ? 0 : 1);
}

void main();
