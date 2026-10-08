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

// Hidden outright: Windows itself, Windows updates, and Dust. Everything
// else is listed; risky software is listed with a caution instead (below).
const PROTECTED_NAME_PHRASES = ['windowsdefender', 'windowssecurity', 'windefend', 'malicioussoftware'];

export type AppCaution = 'hardware' | 'security' | 'runtime';

const SECURITY_TOKENS = new Set([
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
const HARDWARE_TOKENS = new Set(['nvidia', 'amd', 'intel', 'realtek']);
const HARDWARE_PUBLISHER_PHRASES = ['advancedmicrodevices'];
const RUNTIME_NAME_PHRASES = ['redistributable', 'runtime', 'webview2', 'directx', 'netframework', 'xnaframework'];

function canonical(value: string): string {
  return normalize(value)
    .replace(/[\\/]+$/, '')
    .toLowerCase();
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

export function protectedAppReason(app: ProtectedAppInput, options: ProtectedAppOptions = {}): string | null {
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

  if (isWindowsUpdate(app.displayName)) return 'windows-update';

  const compactName = vendorKey(`${app.displayName} ${location}`);
  if (PROTECTED_NAME_PHRASES.some((phrase) => compactName.includes(phrase))) {
    return 'protected-product';
  }

  return null;
}

export function isProtectedApp(app: ProtectedAppInput, options: ProtectedAppOptions = {}): boolean {
  return protectedAppReason(app, options) !== null;
}

export function isWindowsUpdate(displayName: string): boolean {
  return /\(KB\d{6,}\)/i.test(displayName) || /^(security )?update for (microsoft )?windows/i.test(displayName.trim());
}

/**
 * Software that is listed and can run its own uninstaller, but whose
 * leftovers Dust only proposes for review: removing it can affect Windows,
 * hardware, security, or other apps that depend on it.
 */
export function appCaution(app: ProtectedAppInput): AppCaution | null {
  const tokens = publisherTokens(app.publisher);
  if (RUNTIME_NAME_PHRASES.some((phrase) => vendorKey(app.displayName).includes(phrase))) return 'runtime';
  if (tokens.some((token) => SECURITY_TOKENS.has(token))) return 'security';
  const microsoft = tokens.includes('microsoft') || tokens.includes('windows');
  if (
    tokens.some((token) => HARDWARE_TOKENS.has(token)) ||
    HARDWARE_PUBLISHER_PHRASES.some((phrase) => vendorKey(app.publisher).includes(phrase)) ||
    (!microsoft && /\bdrivers?\b/i.test(app.displayName))
  ) {
    return 'hardware';
  }
  // Ordinary Microsoft apps (VS Code, PowerShell, Teams) get no caution:
  // matching is exact, and the shared Microsoft folders are never proposed.
  return null;
}
