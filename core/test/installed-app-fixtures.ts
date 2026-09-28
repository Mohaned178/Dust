import { appId, vendorKey } from '../src/system/installed-apps';
import type { InstalledApp } from '../src/system/installed-apps';

export function makeInstalledApp(
  overrides: Partial<InstalledApp> & { displayName: string },
): InstalledApp {
  const keyName = overrides.keyName ?? vendorKey(overrides.displayName);
  const hive = overrides.hive ?? 'hklm';
  const base: InstalledApp = {
    id: '',
    hive,
    keyName,
    displayName: overrides.displayName,
    publisher: '',
    installLocation: '',
    version: '',
    installDate: '',
    estimatedSizeKb: null,
    uninstallString: '',
    quietUninstallString: '',
    displayIcon: '',
    windowsInstaller: false,
    systemComponent: false,
    noRemove: false,
    uninstallable: true,
    parentKeyName: '',
    releaseType: '',
  };
  const merged = { ...base, ...overrides, keyName, hive };
  return { ...merged, id: overrides.id ?? appId(merged.hive, merged.keyName) };
}
