import { describe, expect, it } from 'vitest';
import {
  parseRegistryKeySnapshot,
  readRegistryKeySnapshotCached,
  resetRegistrySnapshotCache,
  scanRegistry,
} from '../src/uninstall/registry-scan';
import type { RegistryHiveKeys, RegistryVendor } from '../src/uninstall/registry-scan';
import { makeInstalledApp } from './installed-app-fixtures';

function vendor(name: string, children: string[] = []): RegistryVendor {
  return { name, children };
}

function hive(hiveId: RegistryHiveKeys['hive'], vendors: RegistryVendor[]): RegistryHiveKeys {
  return { hive: hiveId, vendors };
}

const UNINSTALL_PREFIX = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

function queryFor(hives: RegistryHiveKeys[]): () => Promise<string> {
  return async () => JSON.stringify(hives);
}

describe('scanRegistry', () => {
  it('finds the product vendor root, its product keys and the uninstall key', async () => {
    const app = makeInstalledApp({
      displayName: 'FooApp',
      publisher: 'Foo Corp',
      hive: 'hklm',
      keyName: '{FOO-GUID}',
    });
    const result = await scanRegistry(app, [], {
      read: queryFor([hive('hklm', [vendor('FooApp', ['FooApp', 'Helper'])])]),
    });

    expect(result.trusted).toBe(true);
    expect(result.candidates.map((candidate) => [candidate.path, candidate.scope, candidate.grade])).toEqual([
      ['Software\\FooApp', 'vendor-root', 'safe'],
      ['Software\\FooApp\\FooApp', 'product', 'safe'],
      [`${UNINSTALL_PREFIX}\\{FOO-GUID}`, 'uninstall-key', 'safe'],
    ]);
    expect(result.candidates.every((candidate) => candidate.excludedReason === null)).toBe(true);
    expect(result.candidates.every((candidate) => candidate.adminRequired)).toBe(true);
    expect(result.candidates[0]!.id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('downgrades publisher-only matches to review', async () => {
    const app = makeInstalledApp({ displayName: 'Music Player', publisher: 'Acme Software' });
    const result = await scanRegistry(app, [], {
      read: queryFor([hive('hklm', [vendor('Acme', ['Player'])])]),
    });
    const root = result.candidates.find((candidate) => candidate.scope === 'vendor-root');
    expect(root).toMatchObject({ path: 'Software\\Acme', grade: 'review' });
    const product = result.candidates.find((candidate) => candidate.scope === 'product');
    expect(product).toMatchObject({ path: 'Software\\Acme\\Player', grade: 'review' });
  });

  it('never enumerates structurally protected scopes', async () => {
    const app = makeInstalledApp({ displayName: 'Microsoft Edge', publisher: 'Microsoft Corporation' });
    const result = await scanRegistry(app, [], {
      read: queryFor([
        hive('hklm', [
          vendor('Microsoft', ['Edge']),
          vendor('Windows', ['Defender']),
          vendor('Classes', ['CLSID']),
          vendor('Policies', ['Edge']),
          vendor('WOW6432Node', ['Edge']),
        ]),
      ]),
    });
    expect(result.candidates.map((candidate) => candidate.scope)).toEqual(['uninstall-key']);
  });

  it('excludes shared vendor roots and shared product keys', async () => {
    const target = makeInstalledApp({ displayName: 'Acme', publisher: 'Acme Software', keyName: '{a}' });
    const sibling = makeInstalledApp({ displayName: 'Acme Video', publisher: 'Acme Software', keyName: '{b}' });
    const result = await scanRegistry(target, [target, sibling], {
      read: queryFor([hive('hklm', [vendor('Acme', ['Shared Tool'])])]),
    });

    const root = result.candidates.find((candidate) => candidate.scope === 'vendor-root');
    expect(root).toMatchObject({ excludedReason: 'shared-vendor-root', grade: 'review' });

    const sharedChild = makeInstalledApp({
      displayName: 'Shared Tool',
      publisher: 'Other Corp',
      keyName: '{c}',
    });
    const toolTarget = makeInstalledApp({
      displayName: 'Shared Tool',
      publisher: 'Acme Software',
      keyName: '{t}',
    });
    const shared = await scanRegistry(toolTarget, [toolTarget, sharedChild], {
      read: queryFor([hive('hklm', [vendor('Acme', ['Shared Tool'])])]),
    });
    const product = shared.candidates.find((candidate) => candidate.scope === 'product');
    expect(product).toMatchObject({ excludedReason: 'shared-product-key', grade: 'review' });
  });

  it('maps hives to admin requirements and reads all three views', async () => {
    const app = makeInstalledApp({ displayName: 'FooApp', publisher: 'Foo Corp', hive: 'hkcu', keyName: '{HKCU}' });
    const result = await scanRegistry(app, [], {
      read: queryFor([hive('hkcu', [vendor('FooApp', [])]), hive('hklm-wow64', [vendor('FooApp', [])])]),
    });
    const user = result.candidates.find((candidate) => candidate.hive === 'hkcu' && candidate.scope === 'vendor-root');
    const wow = result.candidates.find(
      (candidate) => candidate.hive === 'hklm-wow64' && candidate.scope === 'vendor-root',
    );
    const uninstall = result.candidates.find((candidate) => candidate.scope === 'uninstall-key');
    expect(user).toMatchObject({ adminRequired: false });
    expect(wow).toMatchObject({ adminRequired: true });
    expect(uninstall).toMatchObject({ hive: 'hkcu', adminRequired: false });
  });

  it('still offers the uninstall key and reports untrusted when the read fails or is malformed', async () => {
    const app = makeInstalledApp({ displayName: 'FooApp', publisher: 'Foo Corp', keyName: '{X}' });
    const failed = await scanRegistry(app, [], {
      read: async () => {
        throw new Error('registry blocked');
      },
    });
    expect(failed.trusted).toBe(false);
    expect(failed.candidates.map((candidate) => candidate.scope)).toEqual(['uninstall-key']);

    const malformed = await scanRegistry(app, [], { read: async () => 'not json' });
    expect(malformed.trusted).toBe(false);
    expect(malformed.candidates).toHaveLength(1);
  });

  it('returns only the uninstall key when nothing matches', async () => {
    const app = makeInstalledApp({ displayName: 'Spotify', publisher: 'Spotify AB' });
    const result = await scanRegistry(app, [], {
      read: queryFor([hive('hklm', [vendor('Unrelated')])]),
    });
    expect(result.candidates.map((candidate) => candidate.scope)).toEqual(['uninstall-key']);
  });
});

describe('readRegistryKeySnapshotCached', () => {
  it('reuses the first read and shares concurrent calls', async () => {
    resetRegistrySnapshotCache();
    let calls = 0;
    const read = async (): Promise<string> => {
      calls += 1;
      return '[]';
    };

    const [first, second] = await Promise.all([
      readRegistryKeySnapshotCached(read),
      readRegistryKeySnapshotCached(read),
    ]);
    expect(first).toBe('[]');
    expect(second).toBe('[]');
    expect(calls).toBe(1);

    await readRegistryKeySnapshotCached(read);
    expect(calls).toBe(1);
    resetRegistrySnapshotCache();
  });

  it('retries after a failure and drops the cache on reset', async () => {
    resetRegistrySnapshotCache();
    let calls = 0;
    const read = async (): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new Error('registry blocked');
      return '[]';
    };

    await expect(readRegistryKeySnapshotCached(read)).rejects.toThrow('registry blocked');
    await expect(readRegistryKeySnapshotCached(read)).resolves.toBe('[]');
    await readRegistryKeySnapshotCached(read);
    expect(calls).toBe(2);

    resetRegistrySnapshotCache();
    await readRegistryKeySnapshotCached(read);
    expect(calls).toBe(3);
    resetRegistrySnapshotCache();
  });
});

describe('parseRegistryKeySnapshot', () => {
  it('parses hives, vendor names and children', () => {
    const parsed = parseRegistryKeySnapshot(
      JSON.stringify([
        { hive: 'hklm', vendors: [{ name: 'Foo', children: ['One', 'Two'] }] },
        { hive: 'hkcu', vendors: [{ name: ' Bar ', children: 'Only' }] },
      ]),
    );
    expect(parsed).toEqual({
      hives: [
        { hive: 'hklm', vendors: [{ name: 'Foo', children: ['One', 'Two'] }] },
        { hive: 'hkcu', vendors: [{ name: 'Bar', children: ['Only'] }] },
      ],
    });
  });

  it('drops unknown hives, blank names and malformed entries', () => {
    const parsed = parseRegistryKeySnapshot(
      JSON.stringify([
        { hive: 'hkmagic', vendors: [{ name: 'Foo' }] },
        { hive: 'hklm', vendors: [{ name: '  ' }, { name: 'Ok' }, null] },
        null,
      ]),
    );
    expect(parsed).toEqual({ hives: [{ hive: 'hklm', vendors: [{ name: 'Ok', children: [] }] }] });
  });

  it('returns null for invalid json and empty output', () => {
    expect(parseRegistryKeySnapshot('not json')).toBeNull();
    expect(parseRegistryKeySnapshot('   ')).toBeNull();
    expect(parseRegistryKeySnapshot('null')).toEqual({ hives: [] });
  });
});
