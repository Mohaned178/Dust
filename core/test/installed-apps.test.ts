import { afterEach, describe, expect, it } from 'vitest';
import {
  appMatchesTokens,
  appId,
  listInstalledApps,
  matchInstalledApp,
  parseInstalledApps,
  resetInstalledAppsCache,
  vendorKey,
} from '../src/system/installed-apps';
import { makeInstalledApp } from './installed-app-fixtures';

const SPOTIFY = makeInstalledApp({
  displayName: 'Spotify',
  publisher: 'Spotify AB',
  installLocation: 'C:\\Users\\x\\AppData\\Roaming\\Spotify',
});

const MICROSOFT_EDGE = makeInstalledApp({
  displayName: 'Microsoft Edge',
  publisher: 'Microsoft Corporation',
});

describe('parseInstalledApps', () => {
  it('parses an array of registry entries and trims fields', () => {
    const apps = parseInstalledApps(
      JSON.stringify([
        { DisplayName: ' Spotify ', Publisher: ' Spotify AB ', InstallLocation: ' C:\\Spotify ' },
        { DisplayName: 'NoPublisher' },
      ]),
    );
    expect(apps).toEqual([
      makeInstalledApp({
        displayName: 'Spotify',
        publisher: 'Spotify AB',
        installLocation: 'C:\\Spotify',
        keyName: 'spotify',
      }),
      makeInstalledApp({ displayName: 'NoPublisher', keyName: 'nopublisher' }),
    ]);
  });

  it('accepts a single object, empty output and null', () => {
    expect(parseInstalledApps(JSON.stringify({ DisplayName: 'Discord' }))).toEqual([
      makeInstalledApp({ displayName: 'Discord', keyName: 'discord' }),
    ]);
    expect(parseInstalledApps('')).toEqual([]);
    expect(parseInstalledApps('null')).toEqual([]);
  });

  it('returns null for malformed json and skips entries without a name', () => {
    expect(parseInstalledApps('not json')).toBeNull();
    expect(parseInstalledApps(JSON.stringify([{ Publisher: 'x' }, { DisplayName: '  ' }]))).toEqual([]);
  });

  it('parses the enriched registry fields', () => {
    const apps = parseInstalledApps(
      JSON.stringify([
        {
          hive: 'hkcu',
          keyName: '{GUID}',
          DisplayName: 'Spotify',
          Publisher: 'Spotify AB',
          DisplayVersion: '1.2.3',
          InstallDate: '20240102',
          EstimatedSize: 2048,
          UninstallString: '"C:\\Spotify\\uninstall.exe" /S',
          QuietUninstallString: '"C:\\Spotify\\uninstall.exe" /S',
          DisplayIcon: 'C:\\Spotify\\spotify.exe',
          WindowsInstaller: 0,
          SystemComponent: 0,
          NoRemove: 0,
          Uninstallable: 1,
          ParentKeyName: '',
          ReleaseType: '',
        },
      ]),
    );
    expect(apps).toEqual([
      makeInstalledApp({
        displayName: 'Spotify',
        publisher: 'Spotify AB',
        hive: 'hkcu',
        keyName: '{GUID}',
        version: '1.2.3',
        installDate: '20240102',
        estimatedSizeKb: 2048,
        uninstallString: '"C:\\Spotify\\uninstall.exe" /S',
        quietUninstallString: '"C:\\Spotify\\uninstall.exe" /S',
        displayIcon: 'C:\\Spotify\\spotify.exe',
        windowsInstaller: false,
        systemComponent: false,
        noRemove: false,
        uninstallable: true,
        parentKeyName: '',
        releaseType: '',
      }),
    ]);
  });

  it('treats a missing Uninstallable flag as removable and reads numeric booleans', () => {
    const apps = parseInstalledApps(
      JSON.stringify([
        { hive: 'hklm', keyName: '{A}', DisplayName: 'Legacy' },
        { hive: 'hklm', keyName: '{B}', DisplayName: 'Locked', Uninstallable: 0 },
        { hive: 'hklm-wow64', keyName: '{C}', DisplayName: 'Wow', NoRemove: 1 },
      ]),
    );
    expect(apps?.map((app) => [app.displayName, app.uninstallable, app.noRemove])).toEqual([
      ['Legacy', true, false],
      ['Locked', false, false],
      ['Wow', true, true],
    ]);
  });

  it('deduplicates by hive and key name, keeping same-named apps in different keys', () => {
    const apps = parseInstalledApps(
      JSON.stringify([
        { hive: 'hklm', keyName: '{1}', DisplayName: 'Contoso App' },
        { hive: 'hklm', keyName: '{2}', DisplayName: 'Contoso App' },
        { hive: 'hkcu', keyName: '{1}', DisplayName: 'Contoso App' },
        { hive: 'hklm', keyName: '{1}', DisplayName: 'Contoso App (duplicate row)' },
      ]),
    );
    expect(apps).toHaveLength(3);
  });

  it('deduplicates entries with the same compact name when no key identity is present', () => {
    const apps = parseInstalledApps(
      JSON.stringify([{ DisplayName: 'Google Chrome' }, { DisplayName: 'google chrome' }, { DisplayName: 'Chrome' }]),
    );
    expect(apps?.map((app) => app.displayName)).toEqual(['Google Chrome', 'Chrome']);
  });
});

describe('appId', () => {
  it('is derived from hive and key name', () => {
    expect(SPOTIFY.id).toBe(appId('hklm', 'spotify'));
    expect(appId('hklm', 'spotify')).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('app matching', () => {
  it('normalizes vendor keys', () => {
    expect(vendorKey('NVIDIA Corporation')).toBe('nvidiacorporation');
    expect(vendorKey('Spotify AB')).toBe('spotifyab');
  });

  it('matches display name words and the compact name', () => {
    expect(appMatchesTokens(MICROSOFT_EDGE, ['edge'])).toBe(true);
    expect(appMatchesTokens(MICROSOFT_EDGE, ['microsoftedge'])).toBe(true);
    expect(appMatchesTokens(MICROSOFT_EDGE, ['chrome'])).toBe(false);
  });

  it('prefers a product match and falls back to a publisher match', () => {
    const product = matchInstalledApp('Spotify', [SPOTIFY]);
    expect(product).toMatchObject({ strength: 'product' });

    const acme = makeInstalledApp({ displayName: 'Music Player', publisher: 'Acme Corporation' });
    const publisher = matchInstalledApp('Acme', [acme]);
    expect(publisher).toMatchObject({ strength: 'publisher', app: { displayName: 'Music Player' } });

    expect(matchInstalledApp('Unknown Vendor', [SPOTIFY])).toBeNull();
    expect(matchInstalledApp('', [SPOTIFY])).toBeNull();
  });

  it('ignores generic publisher words', () => {
    expect(matchInstalledApp('Corporation', [MICROSOFT_EDGE])).toBeNull();
    expect(matchInstalledApp('Technologies', [SPOTIFY])).toBeNull();
  });
});

describe('listInstalledApps', () => {
  afterEach(() => {
    resetInstalledAppsCache();
  });

  it('returns a trusted snapshot when the query succeeds', async () => {
    const snapshot = await listInstalledApps({
      query: async () => JSON.stringify([{ DisplayName: 'Spotify', Publisher: 'Spotify AB' }]),
    });
    expect(snapshot.trusted).toBe(true);
    expect(snapshot.apps).toHaveLength(1);
    expect(snapshot.apps[0]).toMatchObject({ displayName: 'Spotify', publisher: 'Spotify AB' });
  });

  it('degrades to an untrusted empty snapshot when the query fails or is malformed', async () => {
    const failed = await listInstalledApps({
      query: async () => {
        throw new Error('registry blocked');
      },
    });
    expect(failed).toEqual({ apps: [], trusted: false });
    resetInstalledAppsCache();

    const malformed = await listInstalledApps({ query: async () => 'not json' });
    expect(malformed).toEqual({ apps: [], trusted: false });
  });

  it('caches within the ttl and refreshes after it expires', async () => {
    let calls = 0;
    let clock = 1000;
    const query = async (): Promise<string> => {
      calls += 1;
      return JSON.stringify([{ DisplayName: 'Spotify' }]);
    };

    await listInstalledApps({ query, ttlMs: 500, now: () => clock });
    clock += 100;
    await listInstalledApps({ query, ttlMs: 500, now: () => clock });
    expect(calls).toBe(1);

    clock += 1000;
    await listInstalledApps({ query, ttlMs: 500, now: () => clock });
    expect(calls).toBe(2);
  });
});
