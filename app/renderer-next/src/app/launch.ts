import type { DustApi } from '../../../src/shared/ipc';
import { useDashboardStore } from '../stores/dashboard';
import { useResultsStore } from '../stores/results';
import { useNavStore } from './nav';

/**
 * Dust relaunches itself elevated to finish a startup toggle or an uninstall. The backend leaves a hint behind;
 * this opens the matching page once and parks the hint in its navigation parameters for that page to use.
 * Call it once at startup.
 */
export async function applyLaunchHints(api: DustApi): Promise<void> {
  const [startup, uninstall] = await Promise.all([
    api.getStartupLaunchHint().catch(() => null),
    api.getUninstallLaunchHint().catch(() => null),
  ]);
  const { navigate } = useNavStore.getState();
  if (startup !== null && startup.open) navigate('startup', { notice: startup.notice });
  // Resuming an uninstall wins when both are set: it is the one that was interrupted mid-way.
  if (uninstall !== null && uninstall.open) navigate('apps', { hint: uninstall });
}

/**
 * Asks for what Home shows before Home has loaded, so the requests overlap with loading the page. The scan totals
 * are the slow one on a cold start, and asking first puts them ahead of the tiles' requests in the backend's queue.
 */
export async function prefetchHome(api: DustApi): Promise<void> {
  await useDashboardStore.getState().load(api);
  const system = useDashboardStore.getState().dashboard.data?.volumes.find((volume) => volume.role === 'system');
  if (system !== undefined && system.lastAnalyzedAt !== null) {
    await useResultsStore.getState().loadCategories(api, system.root);
  }
}
