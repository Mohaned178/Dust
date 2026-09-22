import { checkDeletable } from './guard';
import type { GuardOptions } from './guard';
import { deletePathTree } from './executor';
import type { DeleteError } from './executor';

export type BrowseDeleteStatus = 'done' | 'partial' | 'failed' | 'already-gone' | 'refused';

export interface BrowseDeleteResult {
  path: string;
  status: BrowseDeleteStatus;
  deletedBytes: number;
  skippedLocked: number;
  errors: DeleteError[];
  refusal?: string;
}

export function deleteUnprotectedPath(target: string, options: { guard?: GuardOptions } = {}): BrowseDeleteResult {
  const guardResult = checkDeletable(target, options.guard ?? {});
  if (!guardResult.allowed) {
    return {
      path: target,
      status: 'refused',
      deletedBytes: 0,
      skippedLocked: 0,
      errors: [],
      refusal: guardResult.reason ?? 'denied',
    };
  }

  return { path: target, ...deletePathTree(target) };
}
