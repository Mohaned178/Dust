import { join, normalize, parse, sep } from 'node:path';

export interface GuardEnvironment {
  systemRoot?: string;
  programFiles?: string[];
  programData?: string;
  userProfile?: string;
  userFolders?: string[];
  dustInstallPath?: string;
}

export interface GuardOptions extends GuardEnvironment {
  extraProtected?: string[];
}

export type GuardDenial = 'volume-root' | 'protected-root' | 'protected-ancestor' | 'inside-protected';

export interface GuardResult {
  allowed: boolean;
  reason?: GuardDenial;
}

const DEFAULT_USER_FOLDERS = ['Documents', 'Desktop', 'Downloads', 'Pictures', 'Music', 'Videos', 'OneDrive'];

export function defaultProtectedPaths(env: GuardOptions = {}): string[] {
  const paths: string[] = [];
  const systemRoot = env.systemRoot ?? process.env.SystemRoot;
  if (systemRoot) paths.push(systemRoot);

  const programFiles =
    env.programFiles ??
    ([process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ) as string[]);
  paths.push(...programFiles);

  const programData = env.programData ?? process.env.ProgramData;
  if (programData) paths.push(programData);

  const profile = env.userProfile ?? process.env.USERPROFILE;
  if (profile) {
    paths.push(profile);
    for (const folder of env.userFolders ?? DEFAULT_USER_FOLDERS) {
      paths.push(join(profile, folder));
    }
  }

  if (env.dustInstallPath) paths.push(env.dustInstallPath);
  paths.push(...(env.extraProtected ?? []));

  return paths.map((path) => normalize(path)).filter((path) => path.length > 0);
}

export function canonicalizePath(target: string): string {
  const normalized = normalize(target);
  const root = parse(normalized).root;
  let end = normalized.length;
  while (end > root.length && (normalized[end - 1] === '/' || normalized[end - 1] === '\\')) {
    end -= 1;
  }
  return normalized.slice(0, end);
}

export function checkDeletable(
  target: string,
  options: GuardOptions & { exemptExact?: string[] } = {},
): GuardResult {
  const candidate = canonicalizePath(target);
  const lowerCandidate = candidate.toLowerCase();
  const childSep = sep.toLowerCase();

  if (parse(candidate).root.toLowerCase() === lowerCandidate) {
    return { allowed: false, reason: 'volume-root' };
  }

  const protectedPaths = defaultProtectedPaths(options).map((path) => canonicalizePath(path).toLowerCase());
  if (protectedPaths.includes(lowerCandidate)) {
    return { allowed: false, reason: 'protected-root' };
  }

  const isAncestor = protectedPaths.some((path) => path.startsWith(lowerCandidate + childSep));
  if (isAncestor) {
    return { allowed: false, reason: 'protected-ancestor' };
  }

  const isInside = protectedPaths.some((path) => lowerCandidate.startsWith(path + childSep));
  if (isInside) {
    const exempt = (options.exemptExact ?? []).map((path) => canonicalizePath(path).toLowerCase());
    if (!exempt.includes(lowerCandidate)) {
      return { allowed: false, reason: 'inside-protected' };
    }
  }

  return { allowed: true };
}
