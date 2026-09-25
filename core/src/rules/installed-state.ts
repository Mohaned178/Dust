import { appMatchesTokens } from '../system/installed-apps';
import type { InstalledAppsSnapshot } from '../system/installed-apps';

export function appIsInstalled(
  snapshot: InstalledAppsSnapshot | undefined,
  tokens: readonly string[],
): boolean {
  if (snapshot === undefined || !snapshot.trusted) return true;
  return snapshot.apps.some((app) => appMatchesTokens(app, tokens));
}

export function appIsVerifiedMissing(
  snapshot: InstalledAppsSnapshot | undefined,
  tokens: readonly string[],
): boolean {
  return snapshot !== undefined && snapshot.trusted && !appIsInstalled(snapshot, tokens);
}
