import { existsSync } from 'node:fs';
import type { SilentOption, UninstallCommand, UninstallKind } from './types';

export interface ParseUninstallCommandOptions {
  exists?: (path: string) => boolean;
  env?: NodeJS.ProcessEnv;
}

export interface SilentOptionInput {
  command: UninstallCommand;
  quietUninstallString: string;
  windowsInstaller: boolean;
}

const GUID_PATTERN = /\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}/;

function expandEnvironment(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => {
    return env[name] ?? env[name.toUpperCase()] ?? env[name.toLowerCase()] ?? match;
  });
}

export function isAbsoluteWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function baseName(value: string): string {
  const parts = value.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

function urlScheme(value: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value.trim());
  if (match === null) return null;
  const scheme = match[1]!;
  if (scheme.length === 1) return null;
  return scheme.toLowerCase();
}

export function tokenizeCommandLine(value: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of value) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function findMsiProductCode(args: readonly string[]): string | null {
  const joined = args.join(' ');
  const verb = /(?:\/(?:i|x|package|uninstall))\s*(\{[0-9a-fA-F-]{36}\})/i.exec(joined);
  if (verb !== null) return verb[1]!;
  const anywhere = GUID_PATTERN.exec(joined);
  return anywhere === null ? null : anywhere[0];
}

function invalid(raw: string, executable = '', args: string[] = []): UninstallCommand {
  return {
    raw,
    kind: 'unknown',
    executable,
    args,
    msiProductCode: null,
    exeExists: false,
    launchable: false,
    blockReason: 'malformed',
  };
}

export function parseUninstallCommand(raw: string, options: ParseUninstallCommandOptions = {}): UninstallCommand {
  const exists = options.exists ?? existsSync;
  const env = options.env ?? process.env;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return invalid(raw);

  const expanded = expandEnvironment(trimmed, env);
  let executable: string;
  let rest: string;

  if (expanded.startsWith('"')) {
    const end = expanded.indexOf('"', 1);
    if (end < 0) return invalid(raw);
    executable = expanded.slice(1, end);
    rest = expanded.slice(end + 1).trim();
  } else {
    const scheme = urlScheme(expanded);
    if (scheme !== null) {
      return {
        raw,
        kind: 'url',
        executable: expanded,
        args: [],
        msiProductCode: null,
        exeExists: false,
        launchable: false,
        blockReason: 'url-protocol',
      };
    }
    const exeMatch = /\.exe(\s|$)/i.exec(expanded);
    if (exeMatch !== null) {
      executable = expanded.slice(0, exeMatch.index + 4);
      rest = expanded.slice(exeMatch.index + 4).trim();
    } else {
      const firstToken = expanded.split(/\s+/)[0] ?? '';
      executable = firstToken;
      rest = expanded.slice(firstToken.length).trim();
    }
  }

  if (executable.length === 0) return invalid(raw);

  const quotedScheme = urlScheme(executable);
  if (quotedScheme !== null && !isAbsoluteWindowsPath(executable)) {
    return {
      raw,
      kind: 'url',
      executable,
      args: [],
      msiProductCode: null,
      exeExists: false,
      launchable: false,
      blockReason: 'url-protocol',
    };
  }

  const name = baseName(executable).toLowerCase();
  let kind: UninstallKind;
  if (name === 'msiexec.exe' || name === 'msiexec') kind = 'msi';
  else if (name === 'rundll32.exe' || name === 'rundll32') kind = 'rundll32';
  else if (/\.exe$/i.test(executable)) kind = 'exe';
  else return invalid(raw, executable, tokenizeCommandLine(rest));

  const args = tokenizeCommandLine(rest);
  const absolute = isAbsoluteWindowsPath(executable);
  const exeExists = absolute ? exists(executable) : kind === 'msi' || kind === 'rundll32';
  const blockReason = exeExists ? null : absolute ? 'missing-exe' : 'not-absolute';

  return {
    raw,
    kind,
    executable,
    args,
    msiProductCode: kind === 'msi' ? findMsiProductCode(args) : null,
    exeExists,
    launchable: exeExists,
    blockReason,
  };
}

export function buildSilentOption(input: SilentOptionInput): SilentOption | null {
  if (!input.windowsInstaller) return null;
  if (input.command.kind !== 'msi' || input.command.msiProductCode === null) return null;
  const quiet = input.quietUninstallString.trim();
  if (quiet.length === 0) return null;
  const parsedQuiet = parseUninstallCommand(quiet, { exists: () => true });
  if (parsedQuiet.kind === 'unknown' || parsedQuiet.kind === 'url') return null;
  return {
    args: ['/x', input.command.msiProductCode, '/qn', '/norestart'],
    source: 'msi-default',
    wellFormed: true,
  };
}
