import { join, normalize, parse, sep } from 'node:path';
import { DEFAULT_USER_FOLDERS, canonicalizePath, checkDeletable } from '../cleaner/guard';

export type UninstallTargetDenial =
  'invalid-path' | 'protected' | 'root-itself' | 'too-broad' | 'outside-allowed-roots' | 'blocked';

export type UninstallTargetResult = { ok: true; path: string } | { ok: false; reason: UninstallTargetDenial };

export interface UninstallTargetOptions {
  roots: readonly string[];
  systemRoot?: string;
  userProfile?: string;
  dustInstallPath?: string;
  extraBlocked?: readonly string[];
}

export function defaultUninstallParents(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData, env.LOCALAPPDATA, env.APPDATA].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

export function normalizePlanPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.includes('\0')) return null;
  if (!/^[a-zA-Z]:[\\/]/.test(trimmed)) return null;
  const segments = trimmed.split(/[\\/]+/).slice(1);
  if (segments.some((segment) => segment === '..')) return null;
  const normalized = normalize(trimmed);
  const root = parse(normalized).root;
  const stripped = normalized.length > root.length && normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized;
  if (stripped.length <= root.length) return null;
  return stripped;
}

function pathKey(path: string): string {
  return canonicalizePath(path).toLowerCase();
}

export function isPathInsideOrEqual(parent: string, child: string): boolean {
  const base = pathKey(parent);
  const target = pathKey(child);
  if (base.length === 0 || target.length === 0) return false;
  if (target === base) return true;
  return target.startsWith(base + sep.toLowerCase());
}

function isProfileProtected(path: string, userProfile: string | undefined): boolean {
  if (userProfile === undefined) return false;
  const profile = pathKey(userProfile);
  const target = pathKey(path);
  if (profile.length === 0 || target.length === 0) return false;
  if (target === profile) return true;
  if (profile.startsWith(target + sep.toLowerCase())) return true;
  return DEFAULT_USER_FOLDERS.some((folder) => {
    const personal = pathKey(join(userProfile, folder));
    return target === personal || target.startsWith(personal + sep.toLowerCase());
  });
}

export function assertUninstallTarget(raw: string, options: UninstallTargetOptions): UninstallTargetResult {
  const path = normalizePlanPath(raw);
  if (path === null) return { ok: false, reason: 'invalid-path' };

  const blocked = (options.extraBlocked ?? []).some((entry) => isPathInsideOrEqual(entry, path));
  if (blocked) return { ok: false, reason: 'blocked' };

  const guard = checkDeletable(path, {
    systemRoot: options.systemRoot,
    programFiles: [],
    programData: '',
    userProfile: '',
    dustInstallPath: options.dustInstallPath,
  });
  if (!guard.allowed) return { ok: false, reason: 'protected' };

  const isRootItself = options.roots.some((root) => pathKey(root) === pathKey(path));
  if (isRootItself) return { ok: false, reason: 'root-itself' };

  if (isProfileProtected(path, options.userProfile)) return { ok: false, reason: 'protected' };

  const tooBroad = options.roots.some((root) => isPathInsideOrEqual(path, root) && pathKey(root) !== pathKey(path));
  if (tooBroad) return { ok: false, reason: 'too-broad' };

  const insideAny = options.roots.some((root) => isPathInsideOrEqual(root, path));
  if (!insideAny) return { ok: false, reason: 'outside-allowed-roots' };

  return { ok: true, path };
}

export function assertLeftoverNameComponent(name: string): boolean {
  if (name.length === 0) return false;
  if (name === '.' || name === '..') return false;
  if (/[\\/:]/.test(name)) return false;
  if (name.includes('\0')) return false;
  return true;
}
