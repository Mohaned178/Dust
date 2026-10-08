import { appDisplayTokens, appPublisherTokens, listInstalledApps, vendorKey } from '../system/installed-apps';
import type { InstalledApp, InstalledAppsOptions, InstalledAppsSnapshot } from '../system/installed-apps';
import { isProtectedApp } from './protected';
import type { RemovalApp } from './types';

export { appId } from '../system/installed-apps';

export type AppNameMatchStrength = 'product' | 'publisher' | 'partial';

function wordTokens(value: string, minimumLength: number): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= minimumLength);
}

function baseName(value: string): string {
  const parts = value.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

export function matchAppName(name: string, app: InstalledApp): AppNameMatchStrength | null {
  const key = vendorKey(name);
  if (key.length < 3) return null;

  const compactProduct = vendorKey(app.displayName);
  if (compactProduct.length >= 3 && key === compactProduct) return 'product';

  const installLeaf = app.installLocation.length > 0 ? vendorKey(baseName(app.installLocation)) : '';
  if (installLeaf.length >= 3 && key === installLeaf) return 'product';

  if (appDisplayTokens(app).includes(key)) return 'partial';
  if (appPublisherTokens(app).includes(key)) return 'publisher';

  const compactPublisher = vendorKey(app.publisher);
  if (compactPublisher.length >= 3 && key === compactPublisher) return 'publisher';

  const displayWords = new Set(wordTokens(app.displayName, 3));
  if (wordTokens(name, 3).some((word) => displayWords.has(word))) return 'partial';

  return null;
}

export interface RemovalAppsOptions extends InstalledAppsOptions {
  systemRoot?: string;
  programFiles?: string[];
  dustInstallPath?: string;
}

const HIDDEN_RELEASE_TYPES = new Set(['update', 'hotfix', 'security update', 'service pack']);

export function isHiddenReleaseType(value: string): boolean {
  return HIDDEN_RELEASE_TYPES.has(value.trim().toLowerCase());
}

export function isUninstallableApp(app: InstalledApp): boolean {
  if (app.displayName.length === 0) return false;
  if (app.systemComponent || app.noRemove || !app.uninstallable) return false;
  if (app.parentKeyName.length > 0) return false;
  if (isHiddenReleaseType(app.releaseType)) return false;
  return app.uninstallString.length > 0 || app.installLocation.length > 0;
}

// The same product is often registered twice (per-machine and WOW64, or an
// MSI plus its bootstrapper). Keep one entry per name and version, preferring
// the one that can actually be uninstalled and located.
export function dedupeApps(apps: readonly InstalledApp[]): InstalledApp[] {
  const score = (app: InstalledApp): number =>
    (app.uninstallString.length > 0 ? 4 : 0) +
    (app.installLocation.length > 0 ? 2 : 0) +
    (app.estimatedSizeKb !== null ? 1 : 0);
  const best = new Map<string, InstalledApp>();
  for (const app of apps) {
    const key = `${vendorKey(app.displayName)}|${app.version.trim().toLowerCase()}`;
    const current = best.get(key);
    if (current === undefined || score(app) > score(current)) best.set(key, app);
  }
  const kept = new Set(best.values());
  return apps.filter((app) => kept.has(app));
}

export async function listRemovalApps(options: RemovalAppsOptions = {}): Promise<InstalledAppsSnapshot> {
  const snapshot = await listInstalledApps(options);
  const apps = dedupeApps(snapshot.apps.filter(isUninstallableApp)).filter(
    (app) =>
      !isProtectedApp(app, {
        systemRoot: options.systemRoot,
        programFiles: options.programFiles,
        dustInstallPath: options.dustInstallPath,
      }),
  );
  return { apps, trusted: snapshot.trusted };
}

export function toRemovalApp(app: InstalledApp): RemovalApp {
  return {
    id: app.id,
    displayName: app.displayName,
    publisher: app.publisher,
    version: app.version,
    hive: app.hive,
    installLocation: app.installLocation,
    estimatedSizeKb: app.estimatedSizeKb,
  };
}
