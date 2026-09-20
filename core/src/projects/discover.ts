import { basename, dirname, join, sep } from 'node:path';
import { canonicalizePath } from '../cleaner/guard';
import type { AggregateTree } from '../model/tree';
import type { Marker } from '../model/types';
import type { FsProbe } from '../rules/types';
import type { NodeModulesLocation } from './types';
import { detectLockfiles, hasPnp, hasWorkspaceSignals, readManifest } from './manifest';
import type { LockfileName, ManifestInfo } from './manifest';

export interface DiscoveredUnit {
  root: string;
  name: string;
  manifest: ManifestInfo;
  monorepo: boolean;
  workspaceCount: number;
  nodeModules: NodeModulesLocation[];
  lockfiles: LockfileName[];
  pnp: boolean;
  patches: boolean;
}

export interface DiscoveredOrphan {
  path: string;
  bytes: number;
}

export interface DiscoverInput {
  tree: AggregateTree;
  markers: Marker[];
  probe: FsProbe;
}

export function discoverProjects(input: DiscoverInput): { units: DiscoveredUnit[]; orphans: DiscoveredOrphan[] } {
  const manifestMarkers = input.markers
    .filter((marker) => marker.kind === 'package-json')
    .sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  const nodeModulesMarkers = input.markers.filter((marker) => marker.kind === 'node-modules');

  const units: DiscoveredUnit[] = [];
  for (const marker of manifestMarkers) {
    const dir = dirname(marker.path);
    const parent = units.find((unit) => unit.monorepo && isUnder(dir, unit.root));
    if (parent) {
      parent.workspaceCount += 1;
      continue;
    }
    const manifest = readManifest(dir, input.probe) ?? {
      name: null,
      workspaces: false,
      packageManagerField: null,
      valid: false,
    };
    units.push({
      root: dir,
      name: manifest.name ?? basename(dir),
      manifest,
      monorepo: hasWorkspaceSignals(dir, input.probe, manifest),
      workspaceCount: 0,
      nodeModules: [],
      lockfiles: detectLockfiles(dir, input.probe),
      pnp: hasPnp(dir, input.probe),
      patches: input.probe.exists(join(dir, 'patches')),
    });
  }

  const orphans: DiscoveredOrphan[] = [];
  for (const marker of nodeModulesMarkers) {
    const owner = nearestUnit(units, dirname(marker.path));
    const bytes = input.tree.get(marker.path)?.bytes ?? 0;
    if (owner) {
      owner.nodeModules.push({ path: marker.path, bytes });
    } else {
      orphans.push({ path: marker.path, bytes });
    }
  }

  return { units, orphans };
}

function nearestUnit(units: DiscoveredUnit[], targetDir: string): DiscoveredUnit | null {
  let best: DiscoveredUnit | null = null;
  for (const unit of units) {
    if (!isUnder(targetDir, unit.root) && canonicalizePath(targetDir) !== canonicalizePath(unit.root)) continue;
    if (!best || unit.root.length > best.root.length) best = unit;
  }
  return best;
}

function isUnder(candidate: string, parent: string): boolean {
  const child = canonicalizePath(candidate).toLowerCase();
  const root = canonicalizePath(parent).toLowerCase();
  return child.startsWith(root + sep.toLowerCase());
}
