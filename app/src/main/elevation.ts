import { join } from 'node:path';

export const ELEVATED_FLAG = '--dust-elevated';

export function buildElevationCommand(execPath: string, args: string[]): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const file = quote(execPath);
  if (args.length === 0) return `Start-Process -FilePath ${file} -Verb RunAs`;
  return `Start-Process -FilePath ${file} -ArgumentList ${args.map(quote).join(',')} -Verb RunAs`;
}

export function buildElevationLaunchCommand(execPath: string, args: string[], ackPath: string): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const argList = args.length === 0 ? '' : ` -ArgumentList ${args.map(quote).join(',')}`;
  const note = (text: string): string => `[Console]::Error.WriteLine(${quote(text)})`;
  return [
    "$ErrorActionPreference = 'Stop'",
    note('launcher: start'),
    `$ack = ${quote(ackPath)}`,
    'try {',
    `  $p = Start-Process -FilePath ${quote(execPath)}${argList} -Verb RunAs -PassThru`,
    '} catch {',
    '  [Console]::Error.WriteLine("launcher: cancel or failure: " + $_.Exception.Message)',
    '  exit 2',
    '}',
    'if ($null -eq $p) {',
    '  [Console]::Error.WriteLine("launcher: elevation did not start")',
    '  exit 3',
    '}',
    note('launcher: elevated process started'),
    '$deadline = (Get-Date).AddSeconds(300)',
    'while ((Get-Date) -lt $deadline) {',
    '  if (Test-Path -LiteralPath $ack) {',
    '    [Console]::Error.WriteLine("launcher: ready signal seen")',
    '    exit 0',
    '  }',
    '  if ($p.HasExited) {',
    '    [Console]::Error.WriteLine("launcher: elevated process exited before ready")',
    '    exit 3',
    '  }',
    '  Start-Sleep -Milliseconds 250',
    '}',
    'exit 4',
  ].join('\n');
}

export function hasElevatedFlag(argv: readonly string[]): boolean {
  return argv.includes(ELEVATED_FLAG);
}

export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function elevationArgs(input: { packaged: boolean; appPath: string; argv: readonly string[] }): string[] {
  const forwarded = (input.packaged ? input.argv.slice(1) : input.argv.slice(2)).filter((arg) => arg !== ELEVATED_FLAG);
  const base = input.packaged ? [] : [input.appPath];
  return [...base, ...forwarded, ELEVATED_FLAG];
}

export function decideElevation(input: {
  platform: string;
  argv: readonly string[];
  isElevated: boolean;
}): 'run' | 'relaunch' {
  if (input.platform !== 'win32') return 'run';
  if (input.isElevated) return 'run';
  if (hasElevatedFlag(input.argv)) return 'run';
  return 'relaunch';
}

export function elevationAckPath(userDataDir: string): string {
  return join(userDataDir, 'elevated.ready');
}

export interface AwaitElevatedStartupInput {
  spawn: () => { exited: Promise<number | null> };
  ackExists: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  timeoutMs?: number;
  ackGraceMs?: number;
}

export type ElevatedStartupOutcome = 'ready' | 'declined' | 'failed';

export async function awaitElevatedStartup(input: AwaitElevatedStartupInput): Promise<ElevatedStartupOutcome> {
  const now = input.now ?? Date.now;
  const pollMs = input.pollMs ?? 250;
  const timeoutMs = input.timeoutMs ?? 300_000;
  const ackGraceMs = input.ackGraceMs ?? 30_000;
  const startedAt = now();
  const spawned = input.spawn();

  let exitSettled = false;
  let exitCode: number | null = null;
  void spawned.exited.then((code) => {
    exitSettled = true;
    exitCode = code;
  });
  let exitedAt: number | null = null;

  for (;;) {
    if (input.ackExists()) return 'ready';
    const stamp = now();
    if (exitSettled) {
      if (exitCode === 2) return 'declined';
      if (exitCode !== 0) return 'failed';
      if (exitedAt === null) exitedAt = stamp;
      if (stamp - exitedAt >= ackGraceMs) return 'failed';
    }
    if (stamp - startedAt >= timeoutMs) return 'failed';
    await input.sleep(pollMs);
  }
}
