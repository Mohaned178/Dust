import type { RemovalReport, UninstallItemPreview } from '../../../src/shared/ipc';

export type UninstallSectionId =
  'install-dir' | 'app-data' | 'program-data' | 'user-data' | 'temp' | 'registry' | 'startup';

export interface UninstallSection {
  id: UninstallSectionId;
  title: string;
  description: string | null;
  items: UninstallItemPreview[];
}

const SECTION_ORDER: readonly UninstallSectionId[] = [
  'install-dir',
  'app-data',
  'program-data',
  'user-data',
  'temp',
  'registry',
  'startup',
];

const SECTION_COPY: Record<UninstallSectionId, { title: string; description: string | null }> = {
  'install-dir': { title: 'Install folder', description: 'The install location registered by the app.' },
  'app-data': { title: 'App data', description: null },
  'program-data': { title: 'Shared app data', description: 'Cleared for every user on this machine.' },
  'user-data': { title: 'User data', description: 'Kept by default. Saved games, profiles, and chat logs.' },
  temp: { title: 'Temporary files', description: null },
  registry: { title: 'Registry keys', description: 'A backup is exported before anything is deleted.' },
  startup: { title: 'Startup entries', description: 'Turned off, not deleted. You can turn them back on.' },
};

export function groupUninstallItems(items: readonly UninstallItemPreview[]): UninstallSection[] {
  const buckets = new Map<UninstallSectionId, UninstallItemPreview[]>();
  for (const item of items) {
    const section =
      item.kind === 'registry' ? 'registry' : item.kind === 'startup' ? 'startup' : (item.dataClass ?? 'app-data');
    const list = buckets.get(section) ?? [];
    list.push(item);
    buckets.set(section, list);
  }
  const out: UninstallSection[] = [];
  for (const id of SECTION_ORDER) {
    const list = buckets.get(id);
    if (list === undefined || list.length === 0) continue;
    out.push({ id, title: SECTION_COPY[id].title, description: SECTION_COPY[id].description, items: list });
  }
  return out;
}

export function defaultUninstallSelection(items: readonly UninstallItemPreview[]): string[] {
  return items.filter((item) => item.defaultSelected).map((item) => item.id);
}

export interface UninstallSelectionTotals {
  items: number;
  bytes: number;
  reviewItems: number;
  adminItems: number;
}

export function uninstallSelectionTotals(
  items: readonly UninstallItemPreview[],
  selection: readonly string[] | ReadonlySet<string>,
): UninstallSelectionTotals {
  const selected = selection instanceof Set ? selection : new Set(selection);
  const totals: UninstallSelectionTotals = { items: 0, bytes: 0, reviewItems: 0, adminItems: 0 };
  for (const item of items) {
    if (!selected.has(item.id)) continue;
    totals.items += 1;
    totals.bytes += item.bytes ?? 0;
    if (item.grade === 'review') totals.reviewItems += 1;
    if (item.adminRequired) totals.adminItems += 1;
  }
  return totals;
}

export function selectedReviewItems(
  items: readonly UninstallItemPreview[],
  selection: readonly string[] | ReadonlySet<string>,
): UninstallItemPreview[] {
  const selected = selection instanceof Set ? selection : new Set(selection);
  return items.filter((item) => selected.has(item.id) && item.grade === 'review');
}

export const UNINSTALL_PHASES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'prepare', label: 'Preparing' },
  { id: 'backup', label: 'Backing up registry keys' },
  { id: 'uninstaller', label: "Running the app's uninstaller" },
  { id: 'verify', label: 'Checking that it is gone' },
  { id: 'files', label: 'Removing leftover files' },
  { id: 'registry', label: 'Removing registry keys' },
  { id: 'startup', label: 'Turning off startup entries' },
  { id: 'finish', label: 'Finishing up' },
];

const PHASE_LABELS = new Map(UNINSTALL_PHASES.map((phase) => [phase.id, phase.label]));

export function phaseLabel(phase: string): string {
  return PHASE_LABELS.get(phase) ?? 'Working';
}

const KEPT_REASONS: Record<string, string> = {
  'needs-admin': 'Needs administrator rights',
  'user-data-not-included': 'User data was kept',
  'synced-folder': 'Inside a syncing folder, so it was not touched',
  'reparse-point': 'A link, so it was not followed',
  'registry-untrusted': "Couldn't read parts of the registry",
  'no-uninstaller': 'No uninstaller is registered for this app',
  'protected-startup-entry': 'A protected startup entry',
  'shared-vendor-root': 'Shared with another installed app',
  'shared-product-key': 'Shared with another installed app',
  'shared-install-location': 'Shared with another installed app',
  'missing-location': 'The install folder is already gone',
  'protected-location': 'In a protected location',
  'location-too-broad': 'Too broad to remove safely',
  'dust-location': "Dust's own files are never touched",
  'not-backed-up': "Couldn't back it up, so it was not deleted",
  'needs-elevation': 'Needs administrator rights',
  'no-backup': "Couldn't back up the registry, so keys were kept",
  'reboot-required': 'A restart is required to finish',
  unavailable: 'Not available right now',
  'NOT-BACKED-UP': "Couldn't back it up, so it was not deleted",
  'DELETE-FAILED': 'Windows would not let Dust delete this key',
  'NEEDS-ADMIN': 'Needs administrator rights',
};

export function keptReasonText(reason: string): string {
  return KEPT_REASONS[reason] ?? reason;
}

const BLOCK_REASONS: Record<string, string> = {
  'missing-exe': 'The uninstaller file is missing. You can still remove the leftovers.',
  'url-protocol': 'This app uninstalls through a website, which Dust cannot wait for.',
  malformed: 'The uninstaller command was not recognized. You can still remove the leftovers.',
};

export function blockReasonText(reason: string | null): string | null {
  if (reason === null) return null;
  return BLOCK_REASONS[reason] ?? 'The uninstaller cannot be run. You can still remove the leftovers.';
}

export function outcomeText(outcome: RemovalReport['outcome']): { title: string; detail: string } {
  switch (outcome) {
    case 'complete':
      return { title: 'Uninstalled', detail: 'The app and its selected leftovers were removed.' };
    case 'partial':
      return {
        title: 'Partly removed',
        detail: 'Some items could not be removed. The report below lists what was kept and why.',
      };
    case 'failed':
      return { title: "Cleanup didn't finish", detail: 'Nothing was removed. The report below explains why.' };
    case 'reboot-required':
      return {
        title: 'A restart is required',
        detail: 'This app finishes uninstalling after a restart. Leftovers were not touched.',
      };
    case 'not-started':
      return { title: 'The uninstall did not start', detail: 'Nothing was changed.' };
  }
}
