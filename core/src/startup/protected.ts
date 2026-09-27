import { join, normalize } from 'node:path';

const PROTECTED_PATTERNS: RegExp[] = [
  /securityhealth/i,
  /windows\s+security/i,
  /windows\s+defender/i,
  /windefend/i,
  /nvidia/i,
  /igfxtray|igfxpers|igfxem|intel\s+graphics/i,
  /radeon|amd\s+(graphics|software)|catalyst/i,
  /rthdvcpl|realtek/i,
  /dolby|waves\s+audio/i,
  /ctfmon/i,
  /sihost/i,
  /systemtray/i,
];

export interface ProtectedEntryInput {
  name: string;
  command: string;
  windowsDir?: string | undefined;
}

function system32Prefix(windowsDir: string | undefined): string | null {
  if (windowsDir === undefined || windowsDir.trim().length === 0) return null;
  const normalized = normalize(join(windowsDir, 'System32')).replace(/[\\/]+$/, '').toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function isProtectedStartupEntry(input: ProtectedEntryInput): boolean {
  const haystack = `${input.name}\n${input.command}`;
  if (PROTECTED_PATTERNS.some((pattern) => pattern.test(haystack))) return true;

  const prefix = system32Prefix(input.windowsDir);
  if (prefix === null || input.command.trim().length === 0) return false;
  const command = input.command.trim().replace(/^"/, '').replace(/[\\/]+/g, '\\').toLowerCase();
  return command.startsWith(`${prefix}\\`) || command === prefix;
}
