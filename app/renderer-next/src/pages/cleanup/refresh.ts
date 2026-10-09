import type { DustApi } from '../../../../src/shared/ipc';
import { useDashboardStore } from '../../stores/dashboard';
import { useExploreStore } from '../../stores/explore';
import { useResultsStore } from '../../stores/results';

/**
 * Reads everything a clean or a scan changes again: the drive figures, this page's list and Home's totals.
 * The stores are stale-while-revalidate, so without this a screen would keep showing the old numbers.
 */
export async function refreshAfterClean(api: DustApi, root: string): Promise<void> {
  // Folders cached for the explorer describe the disk as it was.
  useExploreStore.getState().reset();
  const results = useResultsStore.getState();
  await Promise.all([
    useDashboardStore.getState().load(api, true),
    results.load(api, root, true),
    results.loadCategories(api, root, true),
  ]);
}
