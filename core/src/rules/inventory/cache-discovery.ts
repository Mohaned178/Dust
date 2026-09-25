import { basename, join } from 'node:path';
import type { Rule, RuleContext, RuleMatch } from '../types';
import type { RuleEnv } from '../paths';
import type { CacheFinding } from '../findings';
import { matchInstalledApp } from '../../system/installed-apps';
import type { InstalledAppMatch } from '../../system/installed-apps';
import { CURATED_CACHE_SPECS } from './cache-registry';

export const DISCOVERY_RULE_ID = 'cache-discovery';
export const DISCOVERY_MAX_DEPTH = 5;

const GPU_CACHE_NAMES = new Set([
  'dxcache',
  'glcache',
  'nv_cache',
  'shadercache',
  'vulkancache',
  'vkcache',
  'd3dscache',
  'dawncache',
  'grshadercache',
  'gpu_cache',
]);

const STRONG_CACHE_NAMES = new Set([
  'cache',
  'cache_data',
  'code cache',
  'gpucache',
  'cachestorage',
  '.cache',
]);

const WEAK_CACHE_NAMES = new Set(['storage', 'cacheddata']);

export interface CacheDiscoveryOptions {
  maxDepth?: number;
}

export interface CacheDiscoveryResult {
  matches: RuleMatch[];
  findings: CacheFinding[];
}

export function discoveryRoots(env: RuleEnv): string[] {
  const raw = [
    env.localAppData,
    env.appData,
    env.userProfile ? join(env.userProfile, 'AppData', 'LocalLow') : '',
    env.programData,
    env.temp,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const normalized = entry.replace(/[\\/]+$/, '');
    if (normalized.length === 0) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function curatedRoots(env: RuleEnv): string[] {
  const out: string[] = [];
  for (const spec of CURATED_CACHE_SPECS) {
    for (const root of spec.roots(env)) {
      if (root.length > 0) out.push(root.replace(/[\\/]+$/, ''));
    }
  }
  return out;
}

function isSameOrUnder(candidate: string, root: string): boolean {
  const key = candidate.replace(/[\\/]+$/, '').toLowerCase();
  const base = root.replace(/[\\/]+$/, '').toLowerCase();
  if (key === base) return true;
  return key.startsWith(`${base}\\`) || key.startsWith(`${base}/`);
}

function isUnderAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => isSameOrUnder(path, root));
}

function relativeSegments(root: string, path: string): string[] | null {
  const trimmedRoot = root.replace(/[\\/]+$/, '');
  const trimmedPath = path.replace(/[\\/]+$/, '');
  if (trimmedPath.length < trimmedRoot.length) return null;
  if (trimmedPath.slice(0, trimmedRoot.length).toLowerCase() !== trimmedRoot.toLowerCase()) return null;
  const rest = trimmedPath.slice(trimmedRoot.length).replace(/^[\\/]+/, '');
  if (rest.length === 0) return [];
  return rest.split(/[\\/]+/);
}

interface Candidate {
  path: string;
  name: string;
  bytes: number;
  segments: string[];
}

function collectCandidates(ctx: RuleContext, root: string, maxDepth: number): Candidate[] {
  const start = ctx.tree.get(root) ?? ctx.tree.get(root.replace(/[\\/]+$/, ''));
  if (start === undefined) return [];
  const out: Candidate[] = [];
  const stack: Array<{ path: string; depth: number }> = [{ path: start.path, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > 0) {
      const segments = relativeSegments(root, current.path);
      if (segments !== null) {
        out.push({
          path: current.path,
          name: basename(current.path),
          bytes: ctx.tree.get(current.path)?.bytes ?? 0,
          segments,
        });
      }
    }
    if (current.depth >= maxDepth) continue;
    for (const child of ctx.tree.children(current.path)) {
      stack.push({ path: child.path, depth: current.depth + 1 });
    }
  }
  return out;
}

interface Discovered {
  path: string;
  bytes: number;
  rank: number;
  match: RuleMatch | null;
  finding: CacheFinding | null;
}

function place(
  out: Map<string, Discovered>,
  entry: Discovered,
  rank: number,
  key: string,
): void {
  const existing = out.get(key);
  if (existing !== undefined && existing.rank >= rank) return;
  out.set(key, entry);
}

function classify(
  candidate: Candidate,
  apps: readonly import('../../system/installed-apps').InstalledApp[],
  trusted: boolean,
  curated: readonly string[],
  out: Map<string, Discovered>,
): void {
  if (isUnderAny(candidate.path, curated)) return;
  const name = candidate.name.trim().toLowerCase();
  const gpu = GPU_CACHE_NAMES.has(name);
  const strong = STRONG_CACHE_NAMES.has(name);
  const weak = WEAK_CACHE_NAMES.has(name);
  if (!gpu && !strong && !weak) return;
  if (!gpu && !trusted && weak) return;

  const vendor = candidate.segments[0] ?? '';
  const key = candidate.path.replace(/[\\/]+$/, '').toLowerCase();

  if (gpu) {
    place(
      out,
      {
        path: candidate.path,
        bytes: candidate.bytes,
        rank: 5,
        match: {
          path: candidate.path,
          bytes: candidate.bytes,
          grade: 'safe',
          recovery: { kind: 'junk', reason: 'GPU shader cache — regenerated by the driver on demand' },
          evidence:
            vendor.length > 0
              ? `Detected GPU shader cache (${vendor}) — regenerated by the driver`
              : 'Detected GPU shader cache — regenerated by the driver',
          origin: 'detected',
        },
        finding: null,
      },
      5,
      key,
    );
    return;
  }

  const owner: InstalledAppMatch | null =
    trusted && vendor.length > 0 ? matchInstalledApp(vendor, apps) : null;
  if (owner !== null) {
    const label = owner.strength === 'product' ? owner.app.displayName : vendor;
    const reason =
      owner.strength === 'product'
        ? `Detected cache for ${owner.app.displayName} — re-downloaded on demand`
        : `Detected cache from ${vendor} (installed app) — re-downloaded on demand`;
    place(
      out,
      {
        path: candidate.path,
        bytes: candidate.bytes,
        rank: 3,
        match: null,
        finding: {
          path: candidate.path,
          bytes: candidate.bytes,
          kind: 'app-matched',
          grade: 'safe',
          label,
          reason,
        },
      },
      3,
      key,
    );
    return;
  }

  if (trusted && vendor.length > 0) {
    place(
      out,
      {
        path: candidate.path,
        bytes: candidate.bytes,
        rank: 2,
        match: null,
        finding: {
          path: candidate.path,
          bytes: candidate.bytes,
          kind: 'app-leftover',
          grade: 'review',
          label: vendor,
          reason: `Leftover cache from ${vendor} (not installed) — review before deleting`,
        },
      },
      2,
      key,
    );
    return;
  }

  place(
    out,
    {
      path: candidate.path,
      bytes: candidate.bytes,
      rank: 1,
      match: null,
      finding: {
        path: candidate.path,
        bytes: candidate.bytes,
        kind: 'unrecognized',
        grade: 'review',
        label: vendor.length > 0 ? vendor : candidate.name,
        reason: 'Unrecognized cache — review before deleting',
      },
    },
    1,
    key,
  );
}

export function discoverCaches(
  ctx: RuleContext,
  env: RuleEnv,
  options: CacheDiscoveryOptions = {},
): CacheDiscoveryResult {
  const maxDepth = options.maxDepth ?? DISCOVERY_MAX_DEPTH;
  const curated = curatedRoots(env);
  const trusted = ctx.installs !== undefined && ctx.installs.trusted;
  const apps = trusted ? ctx.installs!.apps : [];

  const discovered = new Map<string, Discovered>();
  for (const root of discoveryRoots(env)) {
    for (const candidate of collectCandidates(ctx, root, maxDepth)) {
      classify(candidate, apps, trusted, curated, discovered);
    }
  }

  const entries = [...discovered.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    matches: entries.flatMap((entry) => (entry.match === null ? [] : [entry.match])),
    findings: entries.flatMap((entry) => (entry.finding === null ? [] : [entry.finding])),
  };
}

export function cacheDiscoveryRule(env: RuleEnv, options: CacheDiscoveryOptions = {}): Rule {
  return {
    id: DISCOVERY_RULE_ID,
    category: 'app-caches',
    title: 'Detected caches',
    action: { kind: 'delete-path' },
    match(ctx): RuleMatch[] {
      return discoverCaches(ctx, env, options).matches;
    },
  };
}
