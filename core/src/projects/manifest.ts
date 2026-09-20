import { join } from 'node:path';
import type { FsProbe } from '../rules/types';

export interface ManifestInfo {
  name: string | null;
  workspaces: boolean;
  packageManagerField: string | null;
  valid: boolean;
}

export const LOCKFILE_NAMES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'] as const;
export type LockfileName = (typeof LOCKFILE_NAMES)[number];

export const PUBLIC_REGISTRY_HOSTS: ReadonlySet<string> = new Set([
  'registry.npmjs.org',
  'registry.yarnpkg.com',
]);

export function readManifest(dir: string, probe: FsProbe): ManifestInfo | null {
  const raw = probe.readFile(join(dir, 'package.json'));
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { name: null, workspaces: false, packageManagerField: null, valid: false };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { name: null, workspaces: false, packageManagerField: null, valid: false };
  }

  const object = parsed as Record<string, unknown>;
  const name = typeof object.name === 'string' && object.name.trim() !== '' ? object.name : null;
  const packageManagerField = typeof object.packageManager === 'string' && object.packageManager.trim() !== ''
    ? object.packageManager
    : null;

  return { name, workspaces: detectWorkspaces(object), packageManagerField, valid: true };
}

export function hasWorkspaceSignals(dir: string, probe: FsProbe, manifest: ManifestInfo): boolean {
  if (manifest.workspaces) return true;
  return ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'nx.json'].some((signal) =>
    probe.exists(join(dir, signal)),
  );
}

export function detectLockfiles(dir: string, probe: FsProbe): LockfileName[] {
  return LOCKFILE_NAMES.filter((name) => probe.exists(join(dir, name)));
}

export function hasPnp(dir: string, probe: FsProbe): boolean {
  return probe.exists(join(dir, '.pnp.cjs')) || probe.exists(join(dir, '.pnp.js'));
}

export function parsePackageManager(field: string): { name: string; major: number | null } | null {
  if (field.trim() === '') return null;
  const at = field.lastIndexOf('@');
  const name = at > 0 ? field.slice(0, at) : field;
  const version = at > 0 ? field.slice(at + 1) : '';
  if (name.trim() === '') return null;
  const majorMatch = /^(\d+)/.exec(version);
  return { name, major: majorMatch ? Number(majorMatch[1]) : null };
}

export function sampleRegistryHosts(content: string): string[] {
  const sample = content.slice(0, 64 * 1024);
  const hosts = new Set<string>();
  const pattern = /"?resolved"?\s*:?\s*"https?:\/\/([^/"\\]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sample)) !== null) {
    hosts.add(match[1]!);
  }
  return [...hosts];
}

function detectWorkspaces(object: Record<string, unknown>): boolean {
  const workspaces = object.workspaces;
  if (Array.isArray(workspaces)) return workspaces.length > 0;
  if (typeof workspaces === 'object' && workspaces !== null) {
    const packages = (workspaces as { packages?: unknown }).packages;
    return Array.isArray(packages) && packages.length > 0;
  }
  return false;
}
