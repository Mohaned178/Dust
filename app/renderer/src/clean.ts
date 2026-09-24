import type { CategoryId } from '@dust/core';
import { CATEGORY_ORDER } from '../../src/shared/categories';
import type { CleanItemPreview, CleanItemResult } from '../../src/shared/ipc';

export function newCleanId(): string {
  return `clean-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cleanErrorMessage(result: { reason: string; message?: string }): string {
  switch (result.reason) {
    case 'busy':
      return 'A scan is already running. Cancel it first.';
    case 'empty-selection':
      return result.message ?? 'Nothing to clean here.';
    case 'invalid-root':
      return result.message ?? 'No scan data for this volume - run an Analyze first.';
    case 'unknown-plan':
      return 'This plan expired - close and try again.';
    case 'consumed-plan':
      return 'This plan was already executed.';
    case 'unacknowledged-review':
      return 'Acknowledge the irreversible items before deleting.';
    case 'rule-not-in-plan':
      return 'The plan no longer matches the rule set.';
    default:
      return result.message ?? 'Cleanup failed.';
  }
}

export function browseRefusalMessage(refusal: string | undefined): string {
  switch (refusal) {
    case 'busy':
      return 'A scan is already running. Wait for it to finish, then try again.';
    case 'not-browsed':
      return 'This folder is no longer in the browse list. Rescan the drive and try again.';
    case 'volume-root':
      return "This is a drive root — Dust won't delete a whole drive.";
    case 'protected-root':
    case 'protected-ancestor':
    case 'inside-protected':
      return "This item is inside a protected location, such as Windows, Program Files, or your user profile. Dust won't delete it.";
    default:
      return "Dust couldn't delete this item. It may be protected or in use.";
  }
}

export function recoveryText(item: CleanItemPreview): string {
  return item.recovery.kind === 'regenerate' ? `Rebuild with: ${item.recovery.text}` : item.recovery.text;
}

export function recoveryLabel(item: CleanItemPreview): string {
  return item.recovery.kind === 'regenerate' ? 'Rebuild with' : item.recovery.text;
}

export function refusedReasonText(reason: string): string {
  switch (reason) {
    case 'duplicate':
      return 'Already covered by another item';
    case 'nested':
      return 'Inside another item being cleaned';
    case 'invalid-recovery':
      return 'No recovery method was available';
    case 'volume-root':
      return 'Drive roots are never cleaned';
    case 'protected-root':
    case 'protected-ancestor':
    case 'inside-protected':
      return 'In a protected location';
    default:
      return 'Left untouched';
  }
}

export function groupItemsByCategory(items: CleanItemPreview[]): Array<[CategoryId, CleanItemPreview[]]> {
  return CATEGORY_ORDER.map((category): [CategoryId, CleanItemPreview[]] => [
    category,
    items.filter((item) => item.category === category),
  ]).filter(([, entries]) => entries.length > 0);
}

export function groupResultsByCategory(items: CleanItemResult[]): Array<[CategoryId, CleanItemResult[]]> {
  return CATEGORY_ORDER.map((category): [CategoryId, CleanItemResult[]] => [
    category,
    items.filter((item) => item.category === category),
  ]).filter(([, entries]) => entries.length > 0);
}

export function categoryRecoveryNote(category: CategoryId, items: CleanItemPreview[]): string {
  if (category === 'recycle-bin') return 'Irreversible';
  const kinds = new Set(items.map((item) => item.recovery.kind));
  if (kinds.has('junk') && kinds.has('regenerate')) return 'Some items cannot be restored';
  if (kinds.has('junk')) return 'Junk by default';
  if (kinds.has('regenerate')) return 'Re-downloaded on next use';
  return '';
}
