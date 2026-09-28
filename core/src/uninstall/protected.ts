import { normalize } from 'node:path';
import { vendorKey } from '../system/installed-apps';

export interface ProtectedAppInput {
  displayName: string;
  publisher: string;
  installLocation: string;
}

export interface ProtectedAppOptions {
  systemRoot?: string;
  programFiles?: string[];
  dustInstallPath?: string;
}

const PROTECTED_PUBLISHER_TOKENS = new Set([
  'microsoft',
  'windows',
  'nvidia',
  'amd',
  'intel',
  'realtek',
  'defender',
  'windefend',
  'eset',
  'kaspersky',
  'bitdefender',
  'malwarebytes',
  'mcafee',
  'norton',
  'symantec',
  'crowdstrike',
  'sentinelone',
  'sophos',
  'trendmicro',
  'avast',
  'avg',
  'avira',
  'comodo',
]);

const PROTECTED_PUBLISHER_PHRASES = ['advancedmicrodevices'];

const PROTECTED_NAME_PHRASES = [
  'windowsdefender',
  'windowssecurity',
  'windefend',
  'malicioussoftware',
  'redistributable',
];

function canonical(value: string): string {
  return normalize(value).replace(/[\\/]+$/, '').toLowerCase();
}

function underRoot(target: string, root: string): boolean {
  const candidate = canonical(target);
  const base = canonical(root);
  if (candidate.length === 0 || base.length === 0) return false;
  return candidate === base || candidate.startsWith(`${base}\\`) || candidate.startsWith(`${base}/`);
}

function publisherTokens(publisher: string): string[] {
  return publisher
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function defaultProgramFiles(): string[] {
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

export function protectedAppReason(
  app: ProtectedAppInput,
  options: ProtectedAppOptions = {},
): string | null {
  const location = app.installLocation;
  const dustInstallPath = options.dustInstallPath;
  if (dustInstallPath !== undefined && underRoot(location, dustInstallPath)) return 'dust-app';

  const systemRoot = options.systemRoot ?? process.env.SystemRoot;
  if (systemRoot !== undefined && underRoot(location, systemRoot)) return 'system-location';

  const programFiles = options.programFiles ?? defaultProgramFiles();
  for (const root of programFiles) {
    if (underRoot(location, `${root}\\WindowsApps`)) return 'protected-location';
    if (underRoot(location, `${root}\\Windows Defender`)) return 'protected-location';
  }

  const tokens = publisherTokens(app.publisher);
  if (tokens.some((token) => PROTECTED_PUBLISHER_TOKENS.has(token))) return 'protected-publisher';

  const compactPublisher = vendorKey(app.publisher);
  if (PROTECTED_PUBLISHER_PHRASES.some((phrase) => compactPublisher.includes(phrase))) {
    return 'protected-publisher';
  }

  const compactName = vendorKey(`${app.displayName} ${location}`);
  if (PROTECTED_NAME_PHRASES.some((phrase) => compactName.includes(phrase))) {
    return 'protected-product';
  }

  return null;
}

export function isProtectedApp(
  app: ProtectedAppInput,
  options: ProtectedAppOptions = {},
): boolean {
  return protectedAppReason(app, options) !== null;
}
