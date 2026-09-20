import { parse, sep } from 'node:path';
import { canonicalizePath, defaultProtectedPaths } from '../cleaner/guard';
import type { GuardOptions } from '../cleaner/guard';

export type DisplayGrade = 'safe' | 'review' | 'danger';

export interface DisplayGradeReason {
  grade: DisplayGrade;
  reason: string;
}

const SAFE_PATTERNS: Array<{ segments: string[]; reason: string }> = [
  { segments: ['temp'], reason: 'Temporary files — apps recreate them as needed' },
  { segments: ['cache'], reason: 'Cache directory — re-downloaded on demand' },
  { segments: ['cache_data'], reason: 'Cache directory — re-downloaded on demand' },
  { segments: ['cache2'], reason: 'Cache directory — re-downloaded on demand' },
  { segments: ['node_modules'], reason: 'Installed dependencies — restorable with a package manager' },
  { segments: ['.cache'], reason: 'Cache directory — re-downloaded on demand' },
  { segments: ['$recycle.bin'], reason: 'Recycle Bin contents — already deleted by you' },
];

export function classifyDisplayGrade(
  path: string,
  options: { env?: Partial<GuardOptions> } = {},
): DisplayGradeReason {
  const canonical = canonicalizePath(path);
  const lower = canonical.toLowerCase();
  const root = parse(canonical).root.toLowerCase();

  if (lower === root) {
    return { grade: 'danger', reason: 'System-critical — read-only' };
  }

  const env = options.env ?? {};
  const protectedPaths = defaultProtectedPaths(env).map((entry) => canonicalizePath(entry).toLowerCase());
  const profileRoot = canonicalizePath(env.userProfile ?? process.env.USERPROFILE ?? '').toLowerCase();
  const subtreeCritical = protectedPaths.filter((entry) => entry !== profileRoot);

  if (profileRoot !== '' && lower === profileRoot) {
    return { grade: 'danger', reason: 'System-critical — read-only' };
  }
  const insideCritical = subtreeCritical.some(
    (entry) => lower === entry || lower.startsWith(entry + sep.toLowerCase()),
  );
  if (insideCritical) {
    return { grade: 'danger', reason: 'System-critical — read-only' };
  }

  const segments = lower.split(/[\\/]+/).filter((segment) => segment.length > 0);
  for (const pattern of SAFE_PATTERNS) {
    const hit = pattern.segments.every((segment) => segments.includes(segment));
    if (hit) {
      return { grade: 'safe', reason: pattern.reason };
    }
  }

  return { grade: 'review', reason: 'Unrecognized folder — review before deleting' };
}
