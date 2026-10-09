import type { DustApi } from '../../../../src/shared/ipc';
import { useDashboardStore } from '../../stores/dashboard';
import { useResultsStore } from '../../stores/results';

/**
 * Reads everything a clean or a scan changes again: the drive figures, this page's list and Home's totals.
 * The stores are stale-while-revalidate, so without this a screen would keep showing the old numbers.
 */
export async function refreshAfterClean(api: DustApi, root: string): Promise<void> {
  const results = useResultsStore.getState();
  await Promise.all([
    useDashboardStore.getState().load(api, true),
    results.load(api, root, true),
    results.loadCategories(api, root, true),
  ]);
}
