import type { DevCleanupState, DevGroup, DevProject } from '../../../src/shared/ipc';

export type BandId = DevGroup['id'];

/** The order the groups are shown in, safest first. */
export const BAND_ORDER: readonly BandId[] = ['dead', 'occasional', 'active', 'orphaned', 'pinned'];

/** Plain names for the groups. How long ago is shown as words, never as a score. */
export const BANDS: Record<BandId, { title: string; detail: string; blurb: string }> = {
  dead: {
    title: 'Not used for 6+ months',
    detail: '180 days or more',
    blurb: 'The safest place to start.',
  },
  occasional: {
    title: 'Used now and then',
    detail: '31 to 180 days',
    blurb: 'Rebuilding costs one install when you come back.',
  },
  active: {
    title: 'Used recently',
    detail: '30 days or less',
    blurb: 'You will probably need these again soon.',
  },
  orphaned: {
    title: 'Loose node_modules',
    detail: 'No project beside them',
    blurb: 'Nothing here to rebuild them from.',
  },
  pinned: {
    title: 'Kept',
    detail: 'Left out of cleanup',
    blurb: 'Projects you chose to keep. Dust never offers these.',
  },
};

/** Projects that can be ticked: offered by the rules and not kept. */
export function isSelectable(project: DevProject): boolean {
  return project.offered && !project.pinned;
}

/** Groups in display order. */
export function orderedGroups(state: DevCleanupState): DevGroup[] {
  return [...state.groups].sort((a, b) => BAND_ORDER.indexOf(a.id) - BAND_ORDER.indexOf(b.id));
}

export function bytesOf(projects: ReadonlyArray<DevProject>): number {
  return projects.reduce((sum, project) => sum + project.nodeModulesBytes, 0);
}

/** "Select all safe and unused": unused for 6+ months, offered, not kept, and each rebuilds from its lockfile. */
export function recommendedProjects(groups: ReadonlyArray<DevGroup>): DevProject[] {
  return (groups.find((group) => group.id === 'dead')?.projects ?? []).filter(
    (project) => isSelectable(project) && project.grade === 'green',
  );
}

const DAY_MS = 86_400_000;

/** "Not touched for 7 months", or "Used today". Unknown activity says so. */
export function quietFor(activityMs: number | null, now = Date.now()): string {
  if (activityMs === null) return 'Last use unknown';
  const days = Math.max(Math.floor((now - activityMs) / DAY_MS), 0);
  if (days < 1) return 'Used today';
  if (days < 31) return days === 1 ? 'Used yesterday' : `Used ${days} days ago`;
  if (days < 365) {
    const months = Math.max(Math.round(days / 30), 1);
    return `Not touched for ${months} ${months === 1 ? 'month' : 'months'}`;
  }
  const years = Math.floor(days / 365);
  return `Not touched for ${years} ${years === 1 ? 'year' : 'years'}`;
}

/** Where the "last used" date came from, for the tooltip. */
export function activitySourceText(project: DevProject): string {
  switch (project.activitySource) {
    case 'git-reflog':
      return 'From the project’s Git history.';
    case 'files':
      return 'From when its files last changed.';
    case 'manifest':
      return 'From its package.json.';
    default:
      return 'Dust could not tell when it was last used.';
  }
}

/** The line under a project's name: how to bring it back, or why it is not offered. */
export function projectSubline(project: DevProject): string {
  if (project.pinned) return 'You chose to keep this project.';
  if (project.offered) return project.restoreCommand !== null ? `Rebuild with ${project.restoreCommand}` : project.path;
  return project.reasons.length > 0 ? project.reasons.join(' · ') : 'Dust does not offer this one.';
}

/** The disclosure row for each recently cleaned project: nothing is lost, here is how to bring it back. */
export function totalFreed(entries: DevCleanupState['recentlyCleaned']): number {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}

/** One row of the project list: a group heading, one of its projects, or a note that it is empty. */
export type ListItem =
  | { kind: 'group'; key: string; group: DevGroup; expanded: boolean }
  | { kind: 'project'; key: string; project: DevProject; maxBytes: number }
  | { kind: 'empty'; key: string };
