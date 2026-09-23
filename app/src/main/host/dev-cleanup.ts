import { basename, dirname } from 'node:path';
import type { ProjectRecord } from '@dust/core';
import { canonicalKey } from './cleanup';
import type { DevGroup, DevProject } from '../../shared/ipc';

export function projectNameOf(path: string): string {
  return basename(path).toLowerCase() === 'node_modules' ? basename(dirname(path)) : basename(path);
}

export function toDevProjects(projects: ProjectRecord[], pins: readonly string[]): DevProject[] {
  const pinned = new Set(pins.map(canonicalKey));
  return projects.map((entry) => {
    const isPinned = entry.pinned || pinned.has(canonicalKey(entry.path));
    return {
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      packageManager: entry.packageManager,
      recency: entry.recency,
      pinned: isPinned,
      offered: entry.offered && !isPinned,
      nodeModulesBytes: entry.nodeModules.bytes,
      nodeModulesPaths: entry.nodeModules.paths.map((location) => location.path),
      activityMs: entry.activity.ms,
      activitySource: entry.activity.source,
      grade: entry.restorability.grade,
      reasons: entry.restorability.reasons,
      restoreCommand: entry.restorability.restoreCommand,
      workspaceCount: entry.workspaceCount,
    };
  });
}

const GROUP_ORDER: Array<{ id: DevGroup['id']; label: string }> = [
  { id: 'dead', label: 'Dead (more than 180 days)' },
  { id: 'occasional', label: 'Occasional (31-180 days)' },
  { id: 'active', label: 'Active (30 days or less)' },
  { id: 'orphaned', label: 'Orphaned node_modules' },
  { id: 'pinned', label: 'Pinned' },
];

export function groupDevProjects(projects: DevProject[]): DevGroup[] {
  const groups: DevGroup[] = GROUP_ORDER.map((entry) => ({ ...entry, projects: [] }));
  const byId = new Map(groups.map((group) => [group.id, group]));

  for (const project of projects) {
    const id: DevGroup['id'] = project.pinned
      ? 'pinned'
      : project.kind === 'orphaned-node-modules'
        ? 'orphaned'
        : project.recency === 'dead'
          ? 'dead'
          : project.recency === 'active'
            ? 'active'
            : 'occasional';
    byId.get(id)!.projects.push(project);
  }

  for (const group of groups) {
    group.projects.sort(
      (a, b) => b.nodeModulesBytes - a.nodeModulesBytes || a.path.localeCompare(b.path),
    );
  }
  return groups;
}
