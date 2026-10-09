import { resetNavStore } from '../app/nav';
import { resetAppsStore } from './apps';
import { resetCleanStore } from './clean';
import { resetCleanupStore } from './cleanup';
import { resetDashboardStore } from './dashboard';
import { resetDevStore } from './dev';
import { resetHealthStore } from './health';
import { resetResultsStore } from './results';
import { resetScanStore } from './scan';
import { resetStartupStore } from './startup';
import { useToastStore } from '../ui/toast-store';
import { resetUpdatesStore } from './updates';

/** Stores are module singletons; tests call this between cases. */
export function resetAllStores(): void {
  resetAppsStore();
  resetCleanStore();
  resetCleanupStore();
  resetDashboardStore();
  resetDevStore();
  resetHealthStore();
  resetResultsStore();
  resetScanStore();
  resetStartupStore();
  resetUpdatesStore();
  resetNavStore();
  useToastStore.setState({ toasts: [] });
}
