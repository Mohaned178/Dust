import type { CategoryId } from '@dust/core';
import { CATEGORY_ORDER } from '../../../src/shared/categories';
import type { CleanItemPreview, CleanItemResult } from '../../../src/shared/ipc';

export function newCleanId(): string {
  return `clean-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Plain-words explanation for a refused preview or clean. */
export function cleanErrorMessage(result: { reason: string; message?: string }): string {
  switch (result.reason) {
    case 'busy':
      return 'A scan is running right now. Wait for it to finish, then try again.';
    case 'empty-selection':
      return result.message ?? 'There is nothing to clean here.';
    case 'invalid-root':
      return result.message ?? 'Dust has no scan of this drive yet. Scan it first.';
    case 'unknown-plan':
      return 'This plan is no longer available. Close this window and review it again.';
    case 'consumed-plan':
      return 'This plan was already used.';
    case 'unacknowledged-review':
      return 'Tick the box to confirm you understand before deleting.';
    case 'rule-not-in-plan':
      return 'Dust’s cleanup rules changed since this plan was made. Review it again.';
    default:
      return result.message ?? 'The cleanup could not be completed.';
  }
}

/**
 * The acknowledgement gate. Every irreversible item in the rule set is graded `review` (Recycle Bin, node_modules
 * with no manifest), so review-grade items and Recycle Bin emptying are what "cannot be recovered" means. Safe `junk`
 * items (temp files, shader caches) are rebuilt by the apps that own them and need no prompt.
 */
export function needsAcknowledgement(items: ReadonlyArray<CleanItemPreview>): boolean {
  return items.some((item) => item.grade === 'review' || item.action === 'empty-recycle-bin');
}

/** The paths the backend wants acknowledged: every review-grade item in the plan. */
export function acknowledgementPaths(items: ReadonlyArray<CleanItemPreview>): string[] {
  return items.filter((item) => item.grade === 'review').map((item) => item.path);
}

export function refusedReasonText(reason: string): string {
  switch (reason) {
    case 'duplicate':
      return 'Already covered by another item.';
    case 'nested':
      return 'Inside another item that is being cleaned.';
    case 'invalid-recovery':
      return 'Dust could not tell how to bring it back.';
    case 'volume-root':
      return 'Whole drives are never cleaned.';
    case 'protected-root':
    case 'protected-ancestor':
    case 'inside-protected':
      return 'In a protected location.';
    default:
      return 'Left alone.';
  }
}

/** What happens to a category's files after they are deleted. */
export function recoveryNote(category: CategoryId, items: ReadonlyArray<CleanItemPreview>): string {
  if (category === 'recycle-bin') return 'Cannot be recovered';
  const kinds = new Set(items.map((item) => item.recovery.kind));
  if (kinds.has('junk') && kinds.has('regenerate')) return 'Some items cannot be recovered';
  if (kinds.has('junk')) return 'Recreated by the apps that use them';
  if (kinds.has('regenerate')) return 'Downloaded again when needed';
  return '';
}

function groupByCategory<T extends { category: CategoryId }>(items: ReadonlyArray<T>): Array<[CategoryId, T[]]> {
  return CATEGORY_ORDER.map((category): [CategoryId, T[]] => [
    category,
    items.filter((item) => item.category === category),
  ]).filter(([, entries]) => entries.length > 0);
}

export function groupPreviewByCategory(items: ReadonlyArray<CleanItemPreview>) {
  return groupByCategory(items);
}

export function groupResultsByCategory(items: ReadonlyArray<CleanItemResult>) {
  return groupByCategory(items);
}

export function resultStatusText(item: CleanItemResult): string {
  if (item.status === 'partial') {
    return item.skippedLocked === 1
      ? 'Partly cleaned. 1 file was in use, so it was left.'
      : `Partly cleaned. ${item.skippedLocked} files were in use, so they were left.`;
  }
  if (item.status === 'already-gone') return 'Already gone.';
  if (item.status === 'failed') return 'Could not be cleaned. It may be in use or need administrator rights.';
  return 'Cleaned.';
}
