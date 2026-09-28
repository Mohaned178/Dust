import { afterEach, describe, expect, it } from 'vitest';
import { appId, isUninstallableApp, listRemovalApps, toRemovalApp } from '../src/uninstall/apps';
import { resetInstalledAppsCache } from '../src/system/installed-apps';
import { makeInstalledApp } from './installed-app-fixtures';

describe('appId', () => {
  it('is a stable 16-character hex id scoped to hive and key name', () => {
    expect(appId('hklm', '{ABC-123}')).toMatch(/^[a-f0-9]{16}$/);
    expect(appId('hklm', '{ABC-123}')).toBe(appId('hklm', '{ABC-123}'));
    expect(appId('hkcu', '{ABC-123}')).not.toBe(appId('hklm', '{ABC-123}'));
    expect(appId('hklm', '{ABC-123}')).not.toBe(appId('hklm', '{DEF-456}'));
  });

  it('treats key names case-insensitively', () => {
    expect(appId('hklm', '{ABC-123}')).toBe(appId('hklm', '{abc-123}'));
  });
});

describe('isUninstallableApp', () => {
  it('keeps ordinary installed applications', () => {
    expect(
      isUninstallableApp(makeInstalledApp({ displayName: 'Spotify', uninstallString: '"C:\\Spotify\\uninstall.exe"' })),
    ).toBe(true);
    expect(
      isUninstallableApp(
        makeInstalledApp({ displayName: 'Discord', windowsInstaller: true, uninstallString: 'MsiExec.exe /X{GUID}' }),
      ),
    ).toBe(true);
  });

  it('keeps apps without an uninstall string when an install location exists', () => {
    expect(
      isUninstallableApp(
        makeInstalledApp({ displayName: 'NoUninstaller', installLocation: 'C:\\Apps\\NoUninstaller' }),
      ),
    ).toBe(true);
  });

  it('hides system components, non-removable and update entries', () => {
    expect(isUninstallableApp(makeInstalledApp({ displayName: 'Component', systemComponent: true }))).toBe(false);
    expect(isUninstallableApp(makeInstalledApp({ displayName: 'Pinned', noRemove: true }))).toBe(false);
    expect(isUninstallableApp(makeInstalledApp({ displayName: 'Child', parentKeyName: 'Parent' }))).toBe(false);
    expect(isUninstallableApp(makeInstalledApp({ displayName: 'Locked', uninstallable: false }))).toBe(false);
    expect(isUninstallableApp(makeInstalledApp({ displayName: 'Update', releaseType: 'Update' }))).toBe(false);
    expect(isUninstallableApp(makeInstalledApp({ displayName: 'Hotfix', releaseType: 'hotfix' }))).toBe(false);
    expect(isUninstallableApp(makeInstalledApp({ displayName: 'Patch', releaseType: 'Security Update' }))).toBe(false);
    expect(isUninstallableApp(makeInstalledApp({ displayName: 'SP', releaseType: 'Service Pack' }))).toBe(false);
  });

  it('hides entries with no uninstall string and no install location', () => {
    expect(isUninstallableApp(makeInstalledApp({ displayName: 'Ghost' }))).toBe(false);
  });
});

describe('listRemovalApps', () => {
  afterEach(() => {
    resetInstalledAppsCache();
  });

  it('filters hidden and protected apps from the raw registry snapshot', async () => {
    const query = async (): Promise<string> =>
      JSON.stringify([
        {
          hive: 'hklm',
          keyName: '{1}',
          DisplayName: 'Spotify',
          Publisher: 'Spotify AB',
          UninstallString: '"C:\\Spotify\\uninstall.exe"',
        },
        {
          hive: 'hklm',
          keyName: '{2}',
          DisplayName: 'Microsoft Edge',
          Publisher: 'Microsoft Corporation',
          UninstallString: 'setup.exe',
        },
        { hive: 'hkcu', keyName: '{3}', DisplayName: 'Runtime Component', SystemComponent: 1 },
        { hive: 'hkcu', keyName: '{4}', DisplayName: 'Ghost' },
        {
          hive: 'hkcu',
          keyName: '{5}',
          DisplayName: 'NoUninstaller',
          InstallLocation: 'C:\\Apps\\NoUninstaller',
        },
      ]);
    const result = await listRemovalApps({
      query,
      ttlMs: 0,
      dustInstallPath: 'C:\\Dust',
      programFiles: ['C:\\Program Files'],
      systemRoot: 'C:\\Windows',
    });
    expect(result.trusted).toBe(true);
    expect(result.apps.map((app) => app.displayName)).toEqual(['Spotify', 'NoUninstaller']);
  });

  it('hides apps that live in protected locations', async () => {
    const query = async (): Promise<string> =>
      JSON.stringify([
        {
          hive: 'hklm',
          keyName: '{1}',
          DisplayName: 'Driver Companion',
          Publisher: 'Third Party Ltd',
          InstallLocation: 'C:\\Windows\\System32\\DriverStore',
          UninstallString: 'uninst.exe',
        },
      ]);
    const result = await listRemovalApps({
      query,
      ttlMs: 0,
      systemRoot: 'C:\\Windows',
      programFiles: [],
    });
    expect(result.apps).toEqual([]);
  });

  it('degrades to an untrusted empty list when the registry query fails', async () => {
    const result = await listRemovalApps({
      query: async () => {
        throw new Error('blocked');
      },
      ttlMs: 0,
    });
    expect(result).toEqual({ apps: [], trusted: false });
  });
});

describe('toRemovalApp', () => {
  it('projects the removal-relevant fields', () => {
    const app = makeInstalledApp({
      displayName: 'Spotify',
      publisher: 'Spotify AB',
      version: '1.2.3',
      hive: 'hkcu',
      keyName: '{S}',
      installLocation: 'C:\\Users\\x\\AppData\\Roaming\\Spotify',
      estimatedSizeKb: 4096,
    });
    expect(toRemovalApp(app)).toEqual({
      id: app.id,
      displayName: 'Spotify',
      publisher: 'Spotify AB',
      version: '1.2.3',
      hive: 'hkcu',
      installLocation: 'C:\\Users\\x\\AppData\\Roaming\\Spotify',
      estimatedSizeKb: 4096,
    });
  });
});
