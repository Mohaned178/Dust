import { afterEach, describe, expect, it } from 'vitest';
import {
  appMatchesTokens,
  listInstalledApps,
  matchInstalledApp,
  parseInstalledApps,
  resetInstalledAppsCache,
  vendorKey,
} from '../src/system/installed-apps';
import type { InstalledApp } from '../src/system/installed-apps';

const SPOTIFY: InstalledApp = {
  displayName: 'Spotify',
  publisher: 'Spotify AB',
  installLocation: 'C:\\Users\\x\\AppData\\Roaming\\Spotify',
};

const MICROSOFT_EDGE: InstalledApp = {
  displayName: 'Microsoft Edge',
  publisher: 'Microsoft Corporation',
  installLocation: '',
};

describe('parseInstalledApps', () => {
  it('parses an array of registry entries and trims fields', () => {
    const apps = parseInstalledApps(
      JSON.stringify([
        { DisplayName: ' Spotify ', Publisher: ' Spotify AB ', InstallLocation: ' C:\\Spotify ' },
        { DisplayName: 'NoPublisher' },
      ]),
    );
    expect(apps).toEqual([
      { displayName: 'Spotify', publisher: 'Spotify AB', installLocation: 'C:\\Spotify' },
      { displayName: 'NoPublisher', publisher: '', installLocation: '' },
    ]);
  });

  it('accepts a single object, empty output and null', () => {
    expect(parseInstalledApps(JSON.stringify({ DisplayName: 'Discord' }))).toEqual([
      { displayName: 'Discord', publisher: '', installLocation: '' },
    ]);
    expect(parseInstalledApps('')).toEqual([]);
    expect(parseInstalledApps('null')).toEqual([]);
  });

  it('returns null for malformed json and skips entries without a name', () => {
    expect(parseInstalledApps('not json')).toBeNull();
    expect(parseInstalledApps(JSON.stringify([{ Publisher: 'x' }, { DisplayName: '  ' }]))).toEqual([]);
  });

  it('deduplicates entries with the same compact name', () => {
    const apps = parseInstalledApps(
      JSON.stringify([
        { DisplayName: 'Google Chrome' },
        { DisplayName: 'google chrome' },
        { DisplayName: 'Chrome' },
      ]),
    );
    expect(apps?.map((app) => app.displayName)).toEqual(['Google Chrome', 'Chrome']);
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

    const acme: InstalledApp = {
      displayName: 'Music Player',
      publisher: 'Acme Corporation',
      installLocation: '',
    };
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
