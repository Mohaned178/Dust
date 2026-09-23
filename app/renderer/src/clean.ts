import type { CategoryId } from '@dust/core';
import { CATEGORY_ORDER } from '../../src/shared/categories';
import type { CleanItemPreview } from '../../src/shared/ipc';

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

export function recoveryText(item: CleanItemPreview): string {
  return item.recovery.kind === 'regenerate' ? `Rebuild with: ${item.recovery.text}` : item.recovery.text;
}

export function groupItemsByCategory(items: CleanItemPreview[]): Array<[CategoryId, CleanItemPreview[]]> {
  return CATEGORY_ORDER.map((category): [CategoryId, CleanItemPreview[]] => [
    category,
    items.filter((item) => item.category === category),
  ]).filter(([, entries]) => entries.length > 0);
}
