import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultProtectedPaths } from '../cleaner/guard';
import { vendorKey } from '../system/installed-apps';
import type { InstalledApp } from '../system/installed-apps';
import { matchAppName } from './apps';
import { assertUninstallTarget, defaultUninstallParents, normalizePlanPath } from './path-policy';
import type { UninstallTargetDenial } from './path-policy';
import { uninstallItemId } from './types';
import type { KeptItem, LeftoverCandidate, LeftoverClass, UninstallGrade } from './types';

export const LEFTOVER_MAX_DEPTH = 1;

export interface LeftoverRoots {
  localAppData: string;
  appData: string;
  localLow: string;
  programData: string;
  temp: string;
}

export interface LeftoverDiscoveryOptions {
  roots: LeftoverRoots;
  installLocation?: string;
  installParents?: string[];
  home?: string;
  oneDrive?: string[];
  programFiles?: string[];
  systemRoot?: string;
  dustInstallPath?: string;
  measure?: (path: string) => number | null;
  maxDepth?: number;
}

export interface LeftoversResult {
  candidates: LeftoverCandidate[];
  skipped: KeptItem[];
}

interface RootClass {
  key: keyof LeftoverRoots;
  class: LeftoverClass;
}

const ROOT_CLASSES: readonly RootClass[] = [
  { key: 'localAppData', class: 'app-data' },
  { key: 'localLow', class: 'app-data' },
  { key: 'appData', class: 'user-data' },
  { key: 'programData', class: 'program-data' },
  { key: 'temp', class: 'temp' },
];

const USER_DATA_PATTERNS = ['saves', 'savegames', 'savedgames', 'profiles', 'userdata', 'chatlogs'];

type MatchStrength = 'product' | 'publisher' | 'partial';

interface DirMatch {
  strength: MatchStrength;
  evidence: string;
}

interface CandidateInput {
  path: string;
  class: LeftoverClass;
  match: DirMatch;
  sharedWith: string[];
  syncRoot: boolean;
  adminRequired: boolean;
}

function canonical(value: string): string {
  return value.replace(/[\\/]+$/, '').toLowerCase();
}

function underRoot(candidate: string, root: string): boolean {
  const target = canonical(candidate);
  const base = canonical(root);
  if (target.length === 0 || base.length === 0) return false;
  return target === base || target.startsWith(`${base}\\`) || target.startsWith(`${base}/`);
}

function defaultProgramFiles(): string[] {
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

function defaultOneDrive(home: string | undefined): string[] {
  const list = [process.env.OneDrive, process.env.OneDriveCommercial].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (home !== undefined && home.length > 0) list.push(join(home, 'OneDrive'));
  return list;
}

export function defaultDirectorySize(path: string): number | null {
  if (!existsSync(path)) return null;
  let total = 0;
  let failed = false;
  const stack: string[] = [path];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      failed = true;
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
        continue;
      }
      try {
        total += statSync(child).size;
      } catch {
        failed = true;
      }
    }
  }
  return failed ? null : total;
}

const FILE_STAT_CONCURRENCY = 64;
const CANDIDATE_MEASURE_CONCURRENCY = 4;

export async function defaultDirectorySizeAsync(path: string): Promise<number | null> {
  try {
    await stat(path);
  } catch {
    return null;
  }
  let total = 0;
  let failed = false;
  const stack: string[] = [path];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      failed = true;
      continue;
    }
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else files.push(child);
    }
    for (let index = 0; index < files.length; index += FILE_STAT_CONCURRENCY) {
      const chunk = files.slice(index, index + FILE_STAT_CONCURRENCY);
      const sizes = await Promise.all(
        chunk.map((file) =>
          stat(file)
            .then((stats) => stats.size)
            .catch(() => {
              failed = true;
              return 0;
            }),
        ),
      );
      for (const size of sizes) total += size;
    }
  }
  return failed ? null : total;
}

export async function measureLeftoverCandidates(
  candidates: readonly LeftoverCandidate[],
  measure: (path: string) => Promise<number | null> = defaultDirectorySizeAsync,
  concurrency = CANDIDATE_MEASURE_CONCURRENCY,
): Promise<void> {
  const queue = candidates.filter((candidate) => candidate.link === null);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const candidate = queue[index];
      if (candidate === undefined) return;
      candidate.bytes = await measure(candidate.path);
    }
  });
  await Promise.all(workers);
}

function detectLink(path: string): 'junction' | 'symlink' | null {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      return process.platform === 'win32' ? 'junction' : 'symlink';
    }
  } catch {
    return null;
  }
  return null;
}

function installSkipReason(reason: UninstallTargetDenial): string {
  switch (reason) {
    case 'invalid-path':
      return 'invalid-location';
    case 'protected':
      return 'protected-location';
    case 'root-itself':
    case 'too-broad':
      return 'location-too-broad';
    default:
      return 'untrusted-location';
  }
}

function matchDirName(name: string, app: InstalledApp): DirMatch | null {
  const strength = matchAppName(name, app);
  if (strength === null) return null;
  if (strength === 'publisher') {
    return { strength, evidence: `Folder name matches publisher ${app.publisher}` };
  }
  if (strength === 'partial') {
    return { strength, evidence: `Folder name partially matches ${app.displayName}` };
  }
  return { strength: 'product', evidence: `Folder name matches ${app.displayName}` };
}

function classify(rootClass: LeftoverClass, name: string): LeftoverClass {
  const key = vendorKey(name);
  if (USER_DATA_PATTERNS.some((pattern) => key.includes(pattern))) return 'user-data';
  return rootClass;
}

function collectDirs(root: string, maxDepth: number): Array<{ path: string; name: string; link: boolean }> {
  const out: Array<{ path: string; name: string; link: boolean }> = [];
  const stack: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const link = entry.isSymbolicLink();
      if (!entry.isDirectory() && !link) continue;
      const child = join(current.path, entry.name);
      const depth = current.depth + 1;
      out.push({ path: child, name: entry.name, link });
      if (!link && depth < maxDepth) stack.push({ path: child, depth });
    }
  }
  return out;
}

export function discoverLeftovers(
  app: InstalledApp,
  apps: readonly InstalledApp[],
  options: LeftoverDiscoveryOptions,
): LeftoversResult {
  const candidates: LeftoverCandidate[] = [];
  const skipped: KeptItem[] = [];
  const seen = new Set<string>();
  const measure = options.measure ?? defaultDirectorySize;
  const maxDepth = options.maxDepth ?? LEFTOVER_MAX_DEPTH;
  const others = apps.filter((entry) => entry.id !== app.id);
  const programFiles = options.programFiles ?? defaultProgramFiles();
  const oneDrive = options.oneDrive ?? defaultOneDrive(options.home);
  const protectedPaths = defaultProtectedPaths({
    systemRoot: options.systemRoot,
    programFiles,
    programData: options.roots.programData,
    userProfile: options.home,
  }).map(canonical);
  const rootKeys = ROOT_CLASSES.map((spec) => canonical(options.roots[spec.key])).filter((key) => key.length > 0);

  function requiresAdmin(path: string): boolean {
    if (underRoot(path, options.roots.programData)) return true;
    if (programFiles.some((root) => underRoot(path, root))) return true;
    if (options.systemRoot !== undefined && underRoot(path, options.systemRoot)) return true;
    return false;
  }

  function makeCandidate(input: CandidateInput): LeftoverCandidate {
    const link = detectLink(input.path);
    const syncRoot = oneDrive.some((prefix) => underRoot(input.path, prefix));
    let grade: UninstallGrade = input.match.strength === 'product' ? 'safe' : 'review';
    if (input.class === 'program-data' || input.class === 'user-data') grade = 'review';
    if (input.sharedWith.length > 0 || syncRoot || link !== null) grade = 'review';
    const evidence = [input.match.evidence];
    if (input.class === 'program-data') evidence.push('Shared location: other apps may use this folder');
    if (input.class === 'user-data') evidence.push('User data: review before deleting');
    if (input.sharedWith.length > 0) evidence.push(`Shared with ${input.sharedWith.join(', ')}`);
    if (syncRoot) evidence.push('Inside a OneDrive-synced folder');
    if (link !== null) evidence.push('Reparse point: not followed, never deleted');
    return {
      id: uninstallItemId('file', input.path),
      path: input.path,
      bytes: link === null ? measure(input.path) : null,
      class: input.class,
      grade,
      evidence,
      adminRequired: input.adminRequired,
      defaultSelected: grade === 'safe' && input.class !== 'user-data',
      syncRoot,
      link,
      sharedWith: input.sharedWith,
    };
  }

  const installParents = options.installParents ?? defaultUninstallParents();
  const rawInstall = (options.installLocation ?? app.installLocation).trim();
  const normalizedInstall = rawInstall.length > 0 ? normalizePlanPath(rawInstall) : null;
  if (rawInstall.length > 0 && normalizedInstall === null) {
    skipped.push({ target: rawInstall, reason: 'invalid-location' });
  } else if (normalizedInstall !== null) {
    const installLocation = normalizedInstall;
    const location = canonical(installLocation);
    const policy = assertUninstallTarget(installLocation, {
      roots: installParents,
      systemRoot: options.systemRoot,
      userProfile: options.home,
      dustInstallPath: options.dustInstallPath,
    });
    if (!existsSync(installLocation)) {
      skipped.push({ target: installLocation, reason: 'missing-location' });
    } else if (options.dustInstallPath !== undefined && underRoot(installLocation, options.dustInstallPath)) {
      skipped.push({ target: installLocation, reason: 'dust-location' });
    } else if (!policy.ok) {
      skipped.push({ target: installLocation, reason: installSkipReason(policy.reason) });
    } else if (protectedPaths.includes(location)) {
      skipped.push({ target: installLocation, reason: 'protected-location' });
    } else if (
      rootKeys.includes(location) ||
      protectedPaths.some((root) => root.startsWith(`${location}\\`) || root.startsWith(`${location}/`))
    ) {
      skipped.push({ target: installLocation, reason: 'location-too-broad' });
    } else if (
      others.some((other) => {
        const otherLocation = other.installLocation.trim();
        if (otherLocation.length === 0) return false;
        return underRoot(installLocation, otherLocation) || underRoot(otherLocation, installLocation);
      })
    ) {
      skipped.push({ target: installLocation, reason: 'shared-install-location' });
    } else {
      candidates.push(
        makeCandidate({
          path: installLocation,
          class: 'install-dir',
          match: {
            strength: 'product',
            evidence: `Registered install location for ${app.displayName}`,
          },
          sharedWith: [],
          syncRoot: false,
          adminRequired: requiresAdmin(installLocation),
        }),
      );
      seen.add(location);
    }
  }

  for (const spec of ROOT_CLASSES) {
    const root = options.roots[spec.key];
    if (root.trim().length === 0 || !existsSync(root)) continue;
    for (const entry of collectDirs(root, maxDepth)) {
      const key = canonical(entry.path);
      if (seen.has(key)) continue;
      const match = matchDirName(entry.name, app);
      if (match === null) continue;
      seen.add(key);
      if (options.dustInstallPath !== undefined && underRoot(entry.path, options.dustInstallPath)) {
        skipped.push({ target: entry.path, reason: 'dust-location' });
        continue;
      }
      const sharedWith = others
        .filter((other) => matchDirName(entry.name, other) !== null)
        .map((other) => other.displayName);
      candidates.push(
        makeCandidate({
          path: entry.path,
          class: classify(spec.class, entry.name),
          match,
          sharedWith,
          syncRoot: false,
          adminRequired: requiresAdmin(entry.path),
        }),
      );
    }
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates, skipped };
}
