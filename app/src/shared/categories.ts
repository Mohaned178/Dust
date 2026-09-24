import type { CategoryId } from '@dust/core';

export const CATEGORY_ORDER: CategoryId[] = ['temp', 'recycle-bin', 'npm-cache', 'app-caches', 'npm-projects'];

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  temp: 'Temp',
  'recycle-bin': 'Recycle Bin',
  'npm-cache': 'npm cache',
  'app-caches': 'App caches',
  'npm-projects': 'npm projects',
};

/** One-line plain-language explanation shown when a category card is engaged. */
export const CATEGORY_DESCRIPTIONS: Record<CategoryId, string> = {
  temp: 'User and system temporary files',
  'recycle-bin': 'Deleted files still taking up space',
  'npm-cache': 'Downloaded packages npm can fetch again',
  'app-caches': 'Caches apps rebuild on their next launch',
  'npm-projects': 'node_modules in projects you no longer use',
};

/**
 * Canonical scope of the Dashboard "Reclaimable" figure: every byte Dust's rules
 * matched across all cleanup categories, including npm projects. The Results and
 * Quick Clean figures are subsets of this total and label themselves as such.
 */
export const RECLAIMABLE_SCOPE_NOTE = 'All cleanup categories, including npm projects.';

/** Results shows the safe contributor subset of the canonical total. */
export const RESULTS_SCOPE_NOTE = 'Safe items by default; npm projects are included.';

/** The categories Quick Clean covers — a subset that never includes npm projects. */
export const QUICK_CLEAN_CATEGORY_IDS: CategoryId[] = ['temp', 'recycle-bin', 'npm-cache', 'app-caches'];

function labelList(ids: CategoryId[]): string {
  const labels = ids.map((id) => CATEGORY_LABELS[id]);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/** Quick Clean's reconciliation line for its plan figure. */
export const QUICK_CLEAN_SCOPE_NOTE = `Quick Clean covers ${labelList(QUICK_CLEAN_CATEGORY_IDS)} — it never includes npm projects.`;

export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_ORDER as string[]).includes(value);
}
