import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultProtectedPaths } from '../cleaner/guard';
import { vendorKey } from '../system/installed-apps';
import type { InstalledApp } from '../system/installed-apps';
import { appIdentity, matchIdentity } from './identity';
import type { AppIdentity, IdentityMatch } from './identity';
import { assertUninstallTarget, defaultUninstallParents, normalizePlanPath } from './path-policy';
import type { UninstallTargetDenial } from './path-policy';
import { uninstallItemId } from './types';
import type { KeptItem, LeftoverCandidate, LeftoverClass, UninstallGrade } from './types';

/** Root children are matched directly; vendor folders and containers one level deeper. */
export const LEFTOVER_MAX_DEPTH = 2;

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
  /** Start Menu "Programs" folders, searched for the app's folder and shortcuts. */
  startMenu?: string[];
  /**
   * Microsoft, driver, security, and runtime software: every leftover is
   * review-only and vendor folders are never proposed.
   */
  caution?: boolean;
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
  emptyParent?: string;
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

export function defaultStartMenuRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots: string[] = [];
  if (env.APPDATA) roots.push(join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (env.ProgramData) roots.push(join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return roots;
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

function describeMatch(match: IdentityMatch, app: InstalledApp, shortcut: boolean): DirMatch {
  const what = shortcut ? 'Shortcut' : 'Folder name';
  if (match === 'product') return { strength: 'product', evidence: `${what} matches ${app.displayName}` };
  if (match === 'exe')
    return { strength: 'partial', evidence: `${what} matches the program file of ${app.displayName}` };
  return { strength: 'publisher', evidence: `${what} matches publisher ${app.publisher}` };
}

function isUserDataName(name: string): boolean {
  const key = vendorKey(name);
  return USER_DATA_PATTERNS.some((pattern) => key.includes(pattern));
}

// A leftover holding a profile or saves folder (Chrome's "User Data",
// Firefox's "Profiles") is the user's data, whatever root it sits under.
function holdsUserData(path: string): boolean {
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => entry.isDirectory() && isUserDataName(entry.name));
}

function classify(rootClass: LeftoverClass, name: string, path: string): LeftoverClass {
  if (isUserDataName(name)) return 'user-data';
  if (rootClass !== 'install-dir' && rootClass !== 'temp' && holdsUserData(path)) return 'user-data';
  return rootClass;
}

// Drops candidates nested inside another candidate: the outer folder already
// covers them, and counting both would double the reported size.
function collapseNested(candidates: LeftoverCandidate[]): LeftoverCandidate[] {
  const sorted = [...candidates].sort((a, b) => canonical(a.path).length - canonical(b.path).length);
  const kept: LeftoverCandidate[] = [];
  for (const candidate of sorted) {
    if (kept.some((outer) => outer.link === null && underRoot(candidate.path, outer.path))) continue;
    kept.push(candidate);
  }
  return kept;
}

interface ListedEntry {
  path: string;
  name: string;
  link: boolean;
  shortcut: boolean;
}

function listEntries(dir: string, shortcuts: boolean): ListedEntry[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ListedEntry[] = [];
  for (const entry of entries) {
    const link = entry.isSymbolicLink();
    if (entry.isDirectory() || link) {
      out.push({ path: join(dir, entry.name), name: entry.name, link, shortcut: false });
    } else if (shortcuts && /\.(lnk|url)$/i.test(entry.name)) {
      out.push({
        path: join(dir, entry.name),
        name: entry.name.replace(/\.(lnk|url)$/i, ''),
        link: false,
        shortcut: true,
      });
    }
  }
  return out;
}

// Folders that hold per-app folders without belonging to any vendor.
const CONTAINER_NAMES = new Set(['programs']);

interface ScanRoot {
  path: string;
  class: LeftoverClass;
  shortcuts: boolean;
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
    if (options.caution === true) grade = 'review';
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
      ...(input.emptyParent === undefined ? {} : { emptyParent: input.emptyParent }),
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

  const identity = appIdentity(app);
  const otherIdentities: Array<{ app: InstalledApp; identity: AppIdentity }> = others.map((other) => ({
    app: other,
    identity: appIdentity(other),
  }));
  const otherInstallLocations = others
    .map((other) => normalizePlanPath(other.installLocation.trim()))
    .filter((location): location is string => location !== null);

  // Another installed app claims this name too: its folder, not this one's.
  function claimedBy(name: string, levels: readonly IdentityMatch[]): string[] {
    return otherIdentities
      .filter((other) => {
        const match = matchIdentity(name, other.identity);
        return match !== null && levels.includes(match);
      })
      .map((other) => other.app.displayName);
  }

  function propose(entry: ListedEntry, rootClass: LeftoverClass, match: IdentityMatch, emptyParent?: string): void {
    const key = canonical(entry.path);
    if (seen.has(key)) return;
    seen.add(key);
    if (options.dustInstallPath !== undefined && underRoot(entry.path, options.dustInstallPath)) {
      skipped.push({ target: entry.path, reason: 'dust-location' });
      return;
    }
    if (protectedPaths.includes(key)) {
      skipped.push({ target: entry.path, reason: 'protected-location' });
      return;
    }
    if (otherInstallLocations.some((location) => underRoot(location, entry.path) || underRoot(entry.path, location))) {
      skipped.push({ target: entry.path, reason: 'shared-install-location' });
      return;
    }
    const candidate = makeCandidate({
      path: entry.path,
      class: entry.shortcut ? 'app-data' : classify(rootClass, entry.name, entry.path),
      match: describeMatch(match, app, entry.shortcut),
      sharedWith: claimedBy(entry.name, ['product', 'exe', 'vendor']),
      syncRoot: false,
      adminRequired: requiresAdmin(entry.path),
      emptyParent,
    });
    if (entry.shortcut) candidate.evidence.push('Start menu shortcut');
    candidates.push(candidate);
  }

  const scanRoots: ScanRoot[] = [
    ...ROOT_CLASSES.map((spec) => ({ path: options.roots[spec.key], class: spec.class, shortcuts: false })),
    ...programFiles.map((path) => ({ path, class: 'install-dir' as const, shortcuts: false })),
    ...(options.startMenu ?? defaultStartMenuRoots()).map((path) => ({
      path,
      class: 'app-data' as const,
      shortcuts: true,
    })),
  ];
  const visitedRoots = new Set<string>();

  for (const root of scanRoots) {
    const rootKey = canonical(root.path);
    if (rootKey.length === 0 || visitedRoots.has(rootKey) || !existsSync(root.path)) continue;
    visitedRoots.add(rootKey);
    for (const entry of listEntries(root.path, root.shortcuts)) {
      if (entry.shortcut) {
        if (matchIdentity(entry.name, identity) === 'product') propose(entry, root.class, 'product');
        continue;
      }
      const match = matchIdentity(entry.name, identity);
      if (match === 'product' || match === 'exe') {
        propose(entry, root.class, match);
        continue;
      }
      const container = CONTAINER_NAMES.has(entry.name.toLowerCase());
      if ((match !== 'vendor' && !container) || entry.link || maxDepth < 2) continue;

      // A vendor folder (or a plain container like LocalAppData\Programs):
      // look one level in for this app's own folders.
      const inside = listEntries(entry.path, root.shortcuts);
      const own = inside.filter((child) => {
        const childMatch = matchIdentity(child.name, identity);
        return child.shortcut ? childMatch === 'product' : childMatch === 'product' || childMatch === 'exe';
      });
      // The vendor folder itself goes only when nothing else lives in it and
      // no other installed app shares the vendor; it is then removed after
      // its contents, and only if empty by then.
      const vendorOnlyHere =
        match === 'vendor' &&
        !options.caution &&
        own.length > 0 &&
        own.length === inside.length &&
        claimedBy(entry.name, ['product', 'exe', 'vendor']).length === 0;
      for (const child of own) {
        const childMatch = child.shortcut ? 'product' : (matchIdentity(child.name, identity) as IdentityMatch);
        propose(child, root.class, childMatch, vendorOnlyHere ? entry.path : undefined);
      }
    }
  }

  const collapsed = collapseNested(candidates);
  collapsed.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates: collapsed, skipped };
}
