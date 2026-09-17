import { join } from 'node:path';
import type { Entry, Marker } from '../model/types';
import type { Enumerator } from './enumerator';

export interface DirScanContext {
  enumerator: Enumerator;
  isExcluded: (absPath: string) => boolean;
  shouldAbort?: () => boolean;
  onEntry?: (contribution: { entries: 1; files: 0 | 1; bytes: number; path: string }) => void;
}

export interface DirScanResult {
  path: string;
  directBytes: number;
  directFileCount: number;
  linkCount: number;
  linkPaths: string[];
  errorCount: number;
  newestMtimeMs: number;
  partial: boolean;
  aborted: boolean;
  entryCount: number;
  childDirs: string[];
  markers: Marker[];
}

export function scanDirectory(dir: string, trackMtime: boolean, ctx: DirScanContext): DirScanResult {
  const result: DirScanResult = {
    path: dir,
    directBytes: 0,
    directFileCount: 0,
    linkCount: 0,
    linkPaths: [],
    errorCount: 0,
    newestMtimeMs: 0,
    partial: false,
    aborted: false,
    entryCount: 0,
    childDirs: [],
    markers: [],
  };

  let entries: Entry[];
  try {
    const listing = ctx.enumerator.list(dir);
    entries = listing.entries;
    result.errorCount = listing.entryErrors;
  } catch {
    result.errorCount = 1;
    result.partial = true;
    return result;
  }

  for (const entry of entries) {
    if (ctx.shouldAbort?.()) {
      result.aborted = true;
      result.partial = true;
      break;
    }
    result.entryCount += 1;
    const abs = join(dir, entry.name);

    if (ctx.isExcluded(abs)) {
      ctx.onEntry?.({ entries: 1, files: 0, bytes: 0, path: dir });
      continue;
    }

    if (entry.kind === 'link') {
      result.linkCount += 1;
      result.linkPaths.push(abs);
      ctx.onEntry?.({ entries: 1, files: 0, bytes: 0, path: dir });
      continue;
    }

    if (entry.kind === 'file') {
      result.directBytes += entry.size;
      result.directFileCount += 1;
      if (trackMtime && entry.mtimeMs > result.newestMtimeMs) result.newestMtimeMs = entry.mtimeMs;
      if (isPackageJsonMarker(dir, entry.name)) {
        result.markers.push({ kind: 'package-json', path: abs });
      }
      ctx.onEntry?.({ entries: 1, files: 1, bytes: entry.size, path: dir });
      continue;
    }

    if (isNodeModulesRootMarker(dir, entry.name)) {
      result.markers.push({ kind: 'node-modules', path: abs });
    }
    if (entry.name.toLowerCase() === '.git') {
      result.markers.push({ kind: 'git-dir', path: abs });
    }
    result.childDirs.push(abs);
    ctx.onEntry?.({ entries: 1, files: 0, bytes: 0, path: dir });
  }

  return result;
}

export function isPackageJsonMarker(dir: string, name: string): boolean {
  return name.toLowerCase() === 'package.json' && !pathHasNodeModules(dir);
}

export function isNodeModulesRootMarker(dir: string, name: string): boolean {
  return name.toLowerCase() === 'node_modules' && !pathHasNodeModules(dir);
}

export function pathHasNodeModules(dir: string): boolean {
  return dir.toLowerCase().split(/[\\/]/).includes('node_modules');
}

export function isMtimeTrackedChild(name: string): boolean {
  const lower = name.toLowerCase();
  return lower !== 'node_modules' && lower !== '.git';
}
