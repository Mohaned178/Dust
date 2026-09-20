import { basename, dirname, join } from 'node:path';
import { canonicalizePath } from '../cleaner/guard';
import type { AggregateTree } from '../model/tree';
import type { FsProbe } from '../rules/types';
import { discoverProjects } from './discover';
import type { DiscoveredOrphan, DiscoveredUnit } from './discover';
import { PUBLIC_REGISTRY_HOSTS, parsePackageManager, sampleRegistryHosts } from './manifest';
import type { LockfileName } from './manifest';
import type {
  ActivitySource,
  ClassifyInput,
  PackageManager,
  ProjectActivity,
  ProjectAnalysis,
  ProjectRecord,
  RecencyGroup,
  RecencyThresholds,
  Restorability,
} from './types';

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_RECENCY_THRESHOLDS: RecencyThresholds = { activeDays: 30, occasionalDays: 180 };

export function classifyProjects(input: ClassifyInput): ProjectAnalysis {
  const { units, orphans } = discoverProjects({ tree: input.tree, markers: input.markers, probe: input.probe });
  const now = (input.now ?? Date.now)();
  const thresholds: RecencyThresholds = { ...DEFAULT_RECENCY_THRESHOLDS, ...(input.thresholds ?? {}) };
  const pins = new Set((input.pins ?? []).map((pin) => canonicalizePath(pin).toLowerCase()));

  const projects = [
    ...units.map((unit) => classifyUnit(unit, input, now, thresholds, pins)),
    ...orphans.map((orphan) => classifyOrphan(orphan, input, pins)),
  ];
  projects.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { projects };
}

function classifyUnit(
  unit: DiscoveredUnit,
  input: ClassifyInput,
  now: number,
  thresholds: RecencyThresholds,
  pins: Set<string>,
): ProjectRecord {
  const manager = resolveManager(unit);
  const restorability = resolveRestorability(unit, input.probe, manager);
  const activity = computeActivity(unit, input.tree, input.probe);
  const recency = recencyOf(activity, now, thresholds);
  const pinned = pins.has(canonicalizePath(unit.root).toLowerCase());
  const external = input.isExternal?.(unit.root) ?? false;
  const bytes = unit.nodeModules.reduce((sum, entry) => sum + entry.bytes, 0);

  const evidence: string[] = [
    manager.label,
    unit.monorepo ? `Monorepo · ${unit.workspaceCount} packages` : 'Project',
    describeActivity(activity, now),
    ...restorability.reasons,
  ];
  if (unit.pnp) evidence.push('Yarn Plug\u2019n\u2019Play detected');
  if (pinned) evidence.push('pinned by user — never suggested');
  if (external) evidence.push('external drive — not offered in MVP');
  if (unit.nodeModules.length === 0) evidence.push('node_modules not present');

  return {
    path: unit.root,
    name: unit.name,
    kind: unit.monorepo ? 'monorepo' : 'project',
    packageManager: manager.manager,
    pinned,
    workspaceCount: unit.workspaceCount,
    nodeModules: { paths: unit.nodeModules, bytes },
    activity,
    recency,
    restorability,
    offered: !pinned && !external && restorability.grade !== 'not-offered' && unit.nodeModules.length > 0,
    evidence,
  };
}

function classifyOrphan(orphan: DiscoveredOrphan, input: ClassifyInput, pins: Set<string>): ProjectRecord {
  const parentDir = dirname(orphan.path);
  const pinned = pins.has(canonicalizePath(orphan.path).toLowerCase());
  const external = input.isExternal?.(parentDir) ?? false;
  return {
    path: orphan.path,
    name: basename(parentDir),
    kind: 'orphaned-node-modules',
    packageManager: 'unknown',
    pinned,
    workspaceCount: 0,
    nodeModules: { paths: [{ path: orphan.path, bytes: orphan.bytes }], bytes: orphan.bytes },
    activity: { ms: null, source: 'unknown' },
    recency: 'unknown',
    restorability: {
      grade: 'yellow',
      reasons: ['no manifest or lockfile found — node_modules cannot be recreated'],
      restoreCommand: null,
    },
    offered: !pinned && !external,
    evidence: ['Orphaned node_modules — no package.json above', 'cannot be recreated'],
  };
}

interface ManagerResolution {
  manager: PackageManager;
  label: string;
  unsupportedReason: string | null;
}

function resolveManager(unit: DiscoveredUnit): ManagerResolution {
  const field = unit.manifest.packageManagerField;
  if (field) {
    const parsed = parsePackageManager(field);
    if (parsed && ['npm', 'yarn', 'pnpm', 'bun'].includes(parsed.name)) {
      const manager = parsed.name as PackageManager;
      if (manager === 'yarn' && parsed.major !== null && parsed.major >= 2) {
        return { manager, label: `yarn ${parsed.major} (Berry)`, unsupportedReason: `yarn ${parsed.major} (Berry) is not supported — Phase 2` };
      }
      if (manager === 'pnpm') {
        return { manager, label: 'pnpm', unsupportedReason: 'pnpm is not supported — Phase 2' };
      }
      if (manager === 'bun') {
        return { manager, label: 'bun', unsupportedReason: 'bun is not supported — Phase 2' };
      }
      return { manager, label: manager, unsupportedReason: null };
    }
  }

  if (unit.lockfiles.includes('pnpm-lock.yaml')) {
    return { manager: 'pnpm', label: 'pnpm', unsupportedReason: 'pnpm is not supported — Phase 2' };
  }
  if (unit.lockfiles.includes('bun.lockb')) {
    return { manager: 'bun', label: 'bun', unsupportedReason: 'bun is not supported — Phase 2' };
  }
  if (unit.lockfiles.includes('yarn.lock')) {
    return { manager: 'yarn', label: 'yarn (classic)', unsupportedReason: null };
  }
  if (unit.lockfiles.includes('package-lock.json')) {
    return { manager: 'npm', label: 'npm', unsupportedReason: null };
  }
  return { manager: 'unknown', label: 'unknown package manager', unsupportedReason: null };
}

function resolveRestorability(unit: DiscoveredUnit, probe: FsProbe, manager: ManagerResolution): Restorability {
  const notOfferedReasons: string[] = [];
  if (manager.unsupportedReason) notOfferedReasons.push(manager.unsupportedReason);
  if (unit.pnp) notOfferedReasons.push("Yarn Plug'n'Play project — no node_modules to clean");
  if (notOfferedReasons.length > 0) {
    return { grade: 'not-offered', reasons: notOfferedReasons, restoreCommand: null };
  }

  const hasLockfile = unit.lockfiles.includes('package-lock.json') || unit.lockfiles.includes('yarn.lock');
  const reasons: string[] = [];
  if (!hasLockfile) {
    reasons.push('no lockfile — dependency versions may drift on reinstall');
  }
  if (unit.patches) {
    reasons.push('patches/ directory present — verify patch-package runs after install');
  }

  const privateHosts = detectPrivateRegistryHosts(unit, probe);
  if (privateHosts.length > 0) {
    reasons.push(`lockfile references a private registry (${privateHosts[0]}) — ensure access before removing`);
  }

  const grade = reasons.length === 0 ? 'green' : 'yellow';
  const restoreCommand =
    grade === 'green'
      ? manager.manager === 'yarn'
        ? 'yarn install --frozen-lockfile'
        : 'npm ci'
      : manager.manager === 'yarn'
        ? 'yarn install'
        : 'npm install';

  return { grade, reasons, restoreCommand };
}

function detectPrivateRegistryHosts(unit: DiscoveredUnit, probe: FsProbe): string[] {
  const lockfile: LockfileName | undefined = unit.lockfiles.find(
    (name) => name === 'package-lock.json' || name === 'yarn.lock',
  );
  if (!lockfile) return [];
  const content = probe.readFile(join(unit.root, lockfile));
  if (content === null) return [];
  return sampleRegistryHosts(content).filter((host) => !PUBLIC_REGISTRY_HOSTS.has(host));
}

function computeActivity(unit: DiscoveredUnit, tree: AggregateTree, probe: FsProbe): ProjectActivity {
  const files = tree.get(unit.root)?.newestMtimeMs ?? 0;
  const reflog = probe.stat(join(unit.root, '.git', 'logs', 'HEAD'))?.mtimeMs ?? 0;
  const manifest = probe.stat(join(unit.root, 'package.json'))?.mtimeMs ?? 0;

  let ms = 0;
  let source: ActivitySource = 'unknown';
  if (files > 0) {
    ms = files;
    source = 'files';
  }
  if (reflog > ms) {
    ms = reflog;
    source = 'git-reflog';
  }
  if (manifest > ms) {
    ms = manifest;
    source = 'manifest';
  }
  return ms > 0 ? { ms, source } : { ms: null, source: 'unknown' };
}

function recencyOf(activity: ProjectActivity, now: number, thresholds: RecencyThresholds): RecencyGroup {
  if (activity.ms === null) return 'unknown';
  const age = now - activity.ms;
  if (age <= thresholds.activeDays * DAY) return 'active';
  if (age <= thresholds.occasionalDays * DAY) return 'occasional';
  return 'dead';
}

function describeActivity(activity: ProjectActivity, now: number): string {
  if (activity.ms === null) return 'Last activity: unknown';
  const days = Math.floor((now - activity.ms) / DAY);
  return `Last activity: ${days}d ago (${activity.source})`;
}
