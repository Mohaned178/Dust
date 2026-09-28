import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  buildRemovalPlan,
  defaultSelection,
  missingAcknowledgements,
  planRequiresAdmin,
} from '../src/uninstall/plan';
import type { RemovalPlanEnv } from '../src/uninstall/plan';
import type { StartupEntryRecord } from '../src/startup/types';
import { Fixture } from './fixtures';
import { makeInstalledApp } from './installed-app-fixtures';

const fixtures: Fixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

interface Setup {
  fixture: Fixture;
  env: RemovalPlanEnv;
}

function setup(overrides: Partial<RemovalPlanEnv> = {}): Setup {
  const fixture = new Fixture();
  fixtures.push(fixture);
  const env: RemovalPlanEnv = {
    roots: {
      localAppData: fixture.dir('local'),
      appData: fixture.dir('roaming'),
      localLow: fixture.dir('locallow'),
      programData: fixture.dir('program-data'),
      temp: fixture.dir('temp'),
    },
    home: fixture.dir('profile'),
    programFiles: [],
    systemRoot: 'C:\\Windows',
    oneDrive: [],
    ...overrides,
  };
  return { fixture, env };
}

function registryQuery(
  vendors: Array<{ name: string; children?: string[] }>,
  hive: 'hklm' | 'hkcu' = 'hklm',
): () => Promise<string> {
  return async () =>
    JSON.stringify([
      { hive, vendors: vendors.map((vendor) => ({ name: vendor.name, children: vendor.children ?? [] })) },
    ]);
}

function startupEntry(
  overrides: Partial<StartupEntryRecord> & { name: string; command: string },
): StartupEntryRecord {
  return {
    id: 'entry-id',
    source: 'hkcu-run',
    state: 'enabled',
    disabledKind: null,
    protected: false,
    requiresAdmin: false,
    disabledAt: null,
    fileName: null,
    windowsDisabledName: null,
    ...overrides,
  };
}

describe('buildRemovalPlan', () => {
  it('composes the uninstaller, leftovers, registry and startup candidates with totals', async () => {
    const { fixture, env } = setup();
    fixture.file('local/FooApp/data.bin', '0123456789');
    const app = makeInstalledApp({
      displayName: 'FooApp',
      publisher: 'Foo Corp',
      hive: 'hkcu',
      keyName: '{FOO}',
      uninstallString: 'uninstall.exe /S',
    });
    const startup = startupEntry({ name: 'FooApp Updater', command: 'C:\\Apps\\FooApp\\FooApp.exe' });

    const plan = await buildRemovalPlan({
      app,
      env,
      startup: [startup],
      registryRead: registryQuery([{ name: 'FooApp', children: ['FooApp'] }], 'hkcu'),
      makeId: () => 'plan-1',
      now: () => 1000,
    });

    expect(plan.id).toBe('plan-1');
    expect(plan.createdAt).toBe(1000);
    expect(plan.app.displayName).toBe('FooApp');
    expect(plan.uninstaller).toMatchObject({
      interactiveOnly: true,
      requiresAdmin: false,
      silent: null,
      command: { kind: 'exe', launchable: false, blockReason: 'not-absolute' },
    });
    expect(plan.leftovers).toHaveLength(1);
    expect(plan.registry.map((candidate) => candidate.scope)).toEqual([
      'vendor-root',
      'product',
      'uninstall-key',
    ]);
    expect(plan.startup).toHaveLength(1);
    expect(plan.startup[0]).toMatchObject({ action: 'disable', protected: false });
    expect(plan.totals).toEqual({
      bytes: 10,
      items: 5,
      reviewBytes: 0,
      reviewItems: 0,
      userDataBytes: 0,
      userDataItems: 0,
      adminItems: 0,
    });
    expect(planRequiresAdmin(plan)).toBe(false);
  });

  it('respects quiet MSI uninstallers and unknown uninstallers', async () => {
    const { env } = setup();
    const msi = makeInstalledApp({
      displayName: 'FooApp',
      publisher: 'Foo Corp',
      hive: 'hklm',
      keyName: '{MSI}',
      windowsInstaller: true,
      uninstallString: 'MsiExec.exe /X{11111111-2222-3333-4444-555555555555}',
      quietUninstallString: 'MsiExec.exe /X{11111111-2222-3333-4444-555555555555} /qn',
    });
    const msiPlan = await buildRemovalPlan({
      app: msi,
      env,
      registryRead: registryQuery([]),
    });
    expect(msiPlan.uninstaller).toMatchObject({
      interactiveOnly: false,
      requiresAdmin: true,
      silent: { args: ['/x', '{11111111-2222-3333-4444-555555555555}', '/qn', '/norestart'] },
    });

    const silent = makeInstalledApp({
      displayName: 'FooApp',
      publisher: 'Foo Corp',
      keyName: '{NO-UNINSTALLER}',
    });
    const silentPlan = await buildRemovalPlan({ app: silent, env, registryRead: registryQuery([]) });
    expect(silentPlan.uninstaller).toBeNull();
    expect(silentPlan.kept).toContainEqual({ target: 'FooApp', reason: 'no-uninstaller' });
  });

  it('keeps excluded registry candidates and preserves the uninstall key when the scan is untrusted', async () => {
    const { env } = setup();
    const app = makeInstalledApp({ displayName: 'Acme', publisher: 'Acme Software', keyName: '{A}' });
    const sibling = makeInstalledApp({
      displayName: 'Acme Video',
      publisher: 'Acme Software',
      keyName: '{B}',
    });
    const shared = await buildRemovalPlan({
      app,
      apps: [app, sibling],
      env,
      registryRead: registryQuery([{ name: 'Acme', children: [] }]),
    });
    const excluded = shared.registry.find((candidate) => candidate.scope === 'vendor-root');
    expect(excluded).toBeUndefined();
    expect(shared.registry.map((candidate) => candidate.scope)).toEqual(['uninstall-key']);
    expect(shared.kept).toContainEqual({
      target: 'Software\\Acme',
      reason: 'shared-vendor-root',
    });

    const untrusted = await buildRemovalPlan({
      app,
      env,
      registryRead: async () => {
        throw new Error('blocked');
      },
    });
    expect(untrusted.registry.map((candidate) => candidate.scope)).toEqual(['uninstall-key']);
    expect(untrusted.kept.some((entry) => entry.reason === 'registry-untrusted')).toBe(true);
  });

  it('maps startup entries to reversible actions and keeps protected entries untouched', async () => {
    const { env } = setup();
    const app = makeInstalledApp({ displayName: 'FooApp', publisher: 'Foo Corp', keyName: '{F}' });
    const command = 'C:\\Apps\\FooApp\\FooApp.exe';
    const plan = await buildRemovalPlan({
      app,
      env,
      registryRead: registryQuery([]),
      startup: [
        startupEntry({ id: 'enabled', name: 'FooApp', command }),
        startupEntry({ id: 'dust', name: 'FooApp Updater', command, state: 'disabled', disabledKind: 'dust' }),
        startupEntry({ id: 'windows', name: 'FooApp Helper', command, state: 'disabled', disabledKind: 'windows' }),
        startupEntry({ id: 'protected', name: 'FooApp Security', command, protected: true }),
      ],
    });

    expect(plan.startup.map((candidate) => [candidate.entryId, candidate.action])).toEqual([
      ['enabled', 'disable'],
      ['dust', 'purge-envelope'],
      ['windows', 'none'],
    ]);
    expect(plan.kept).toContainEqual({ target: 'FooApp Security', reason: 'protected-startup-entry' });
  });

  it('matches startup entries by executable footprint, not substring', async () => {
    const { fixture, env } = setup();
    env.installLocation = fixture.dir('apps/FooApp');
    const app = makeInstalledApp({
      displayName: 'FooApp',
      publisher: 'Foo Corp',
      keyName: '{F}',
      installLocation: env.installLocation,
    });
    const plan = await buildRemovalPlan({
      app,
      env,
      registryRead: registryQuery([]),
      startup: [
        startupEntry({ id: 'inside', name: 'FooApp', command: join(env.installLocation, 'FooApp.exe') }),
        startupEntry({ id: 'outside', name: 'FooApp', command: 'C:\\Program Files\\Other\\thing.exe' }),
      ],
    });
    expect(plan.startup.map((candidate) => [candidate.entryId, candidate.match])).toEqual([
      ['inside', 'path'],
      ['outside', 'name'],
    ]);
    const selection = defaultSelection(plan);
    expect(selection).toContain('inside');
    expect(selection).not.toContain('outside');
  });

  it('does not path-match startup entries from a too-broad install location', async () => {
    const { env } = setup();
    const app = makeInstalledApp({
      displayName: 'FooApp',
      publisher: 'Foo Corp',
      keyName: '{F}',
      installLocation: 'C:\\Program Files',
    });
    const plan = await buildRemovalPlan({
      app,
      env,
      registryRead: registryQuery([]),
      startup: [
        startupEntry({ id: 'other', name: 'Unrelated', command: 'C:\\Program Files\\Other\\thing.exe' }),
      ],
    });
    expect(plan.startup).toEqual([]);
  });

  it('resolves a bare uninstaller name against the install location', async () => {
    const { fixture, env } = setup();
    env.installLocation = fixture.dir('apps/FooApp');
    fixture.file('apps/FooApp/uninstall.exe', 'MZ');
    const app = makeInstalledApp({
      displayName: 'FooApp',
      publisher: 'Foo Corp',
      keyName: '{F}',
      installLocation: env.installLocation,
      uninstallString: 'uninstall.exe /S',
    });
    const plan = await buildRemovalPlan({ app, env, registryRead: registryQuery([]) });
    expect(plan.uninstaller?.command).toMatchObject({
      executable: join(env.installLocation, 'uninstall.exe'),
      launchable: true,
      blockReason: null,
    });
  });

  it('computes admin requirements for machine-wide apps and install folders', async () => {
    const { fixture, env } = setup();
    const programFiles = fixture.dir('program-files');
    env.programFiles = [programFiles];
    const app = makeInstalledApp({
      displayName: 'FooApp',
      publisher: 'Foo Corp',
      hive: 'hklm',
      keyName: '{F}',
      installLocation: fixture.dir('program-files/FooApp'),
      uninstallString: 'uninstall.exe',
    });

    const plan = await buildRemovalPlan({ app, env, registryRead: registryQuery([]) });
    expect(plan.uninstaller?.requiresAdmin).toBe(true);
    expect(plan.totals.adminItems).toBe(2);
    expect(planRequiresAdmin(plan)).toBe(true);
  });

  it('treats URL uninstallers as present but not runnable', async () => {
    const { env } = setup();
    const app = makeInstalledApp({
      displayName: 'Store App',
      publisher: 'Store Corp',
      keyName: '{S}',
      uninstallString: 'steam://uninstall/570',
    });
    const plan = await buildRemovalPlan({ app, env, registryRead: registryQuery([]) });
    expect(plan.uninstaller).toMatchObject({
      command: { kind: 'url', launchable: false, blockReason: 'url-protocol' },
    });
  });
});

describe('selection helpers', () => {
  it('defaults to safe and review candidates that are selected by the discovery, excluding user data', async () => {
    const { fixture, env } = setup();
    fixture.dir('local/FooApp');
    fixture.dir('roaming/FooApp');
    const app = makeInstalledApp({ displayName: 'FooApp', publisher: 'Foo Corp', keyName: '{F}' });
    const plan = await buildRemovalPlan({
      app,
      env,
      registryRead: registryQuery([{ name: 'FooApp', children: [] }]),
      startup: [startupEntry({ name: 'FooApp', command: 'C:\\FooApp\\FooApp.exe' })],
    });

    const selection = defaultSelection(plan);
    const userData = plan.leftovers.find((candidate) => candidate.class === 'user-data');
    expect(userData).toBeDefined();
    expect(selection).not.toContain(userData!.id);
    expect(selection).toContain(plan.leftovers.find((candidate) => candidate.class === 'app-data')!.id);
    expect(selection).toHaveLength(3);
  });

  it('never defaults to review-grade registry keys', async () => {
    const { env } = setup();
    const app = makeInstalledApp({ displayName: 'Music Player', publisher: 'Acme Software', keyName: '{M}' });
    const plan = await buildRemovalPlan({
      app,
      env,
      registryRead: registryQuery([{ name: 'Acme', children: ['Player'] }]),
    });

    const vendorRoot = plan.registry.find((candidate) => candidate.scope === 'vendor-root');
    expect(vendorRoot).toMatchObject({ grade: 'review' });
    const uninstallKey = plan.registry.find((candidate) => candidate.scope === 'uninstall-key');
    expect(uninstallKey).toBeDefined();
    expect(defaultSelection(plan)).toEqual([uninstallKey!.id]);
  });

  it('requires acknowledgement only for selected review items', async () => {
    const { fixture, env } = setup();
    fixture.dir('local/Acme');
    const app = makeInstalledApp({ displayName: 'Music Player', publisher: 'Acme Software', keyName: '{M}' });
    const plan = await buildRemovalPlan({ app, env, registryRead: registryQuery([]) });
    const review = plan.leftovers.find((candidate) => candidate.grade === 'review')!;

    expect(missingAcknowledgements(plan, [review.id], [])).toEqual([review.id]);
    expect(missingAcknowledgements(plan, [review.id], [review.id])).toEqual([]);
    expect(missingAcknowledgements(plan, [], [])).toEqual([]);
  });
});
