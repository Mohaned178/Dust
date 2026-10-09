import type { DustApi } from '../../../src/shared/ipc';
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
