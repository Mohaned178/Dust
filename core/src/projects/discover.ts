import { basename, dirname, join } from 'node:path';
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

export interface UnitLookup {
  add(unit: DiscoveredUnit): void;
  nearest(dir: string): DiscoveredUnit | null;
  monorepoParent(dir: string): DiscoveredUnit | null;
}

export function createUnitLookup(): UnitLookup {
  const byRoot = new Map<string, DiscoveredUnit>();
  const find = (dir: string, predicate: (unit: DiscoveredUnit) => boolean): DiscoveredUnit | null => {
    for (const key of ancestorKeys(dir)) {
      const unit = byRoot.get(key);
      if (unit && predicate(unit)) return unit;
    }
    return null;
  };
  return {
    add(unit) {
      byRoot.set(canonicalizePath(unit.root).toLowerCase(), unit);
    },
    nearest(dir) {
      return find(dir, () => true);
    },
    monorepoParent(dir) {
      return find(dir, (unit) => unit.monorepo);
    },
  };
}

export function* ancestorKeys(dir: string): Generator<string> {
  let key = canonicalizePath(dir).toLowerCase();
  for (;;) {
    yield key;
    const parent = dirname(key);
    if (parent === key) return;
    key = parent;
  }
}

export function discoverProjects(input: DiscoverInput): { units: DiscoveredUnit[]; orphans: DiscoveredOrphan[] } {
  const manifestMarkers = input.markers
    .filter((marker) => marker.kind === 'package-json')
    .sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  const nodeModulesMarkers = input.markers.filter((marker) => marker.kind === 'node-modules');

  const units: DiscoveredUnit[] = [];
  const lookup = createUnitLookup();
  for (const marker of manifestMarkers) {
    const dir = dirname(marker.path);
    const parent = lookup.monorepoParent(dir);
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
    const unit = {
      root: dir,
      name: manifest.name ?? basename(dir),
      manifest,
      monorepo: hasWorkspaceSignals(dir, input.probe, manifest),
      workspaceCount: 0,
      nodeModules: [],
      lockfiles: detectLockfiles(dir, input.probe),
      pnp: hasPnp(dir, input.probe),
      patches: input.probe.exists(join(dir, 'patches')),
    };
    units.push(unit);
    lookup.add(unit);
  }

  const orphans: DiscoveredOrphan[] = [];
  for (const marker of nodeModulesMarkers) {
    const owner = lookup.nearest(dirname(marker.path));
    const bytes = input.tree.get(marker.path)?.bytes ?? 0;
    if (owner) {
      owner.nodeModules.push({ path: marker.path, bytes });
    } else {
      orphans.push({ path: marker.path, bytes });
    }
  }

  return { units, orphans };
}
