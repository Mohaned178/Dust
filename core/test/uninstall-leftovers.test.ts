import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  defaultDirectorySize,
  defaultDirectorySizeAsync,
  discoverLeftovers,
  measureLeftoverCandidates,
} from '../src/uninstall/leftovers';
import type { LeftoverDiscoveryOptions, LeftoverRoots } from '../src/uninstall/leftovers';
import type { LeftoverCandidate } from '../src/uninstall/types';
import { Fixture } from './fixtures';
import { makeInstalledApp } from './installed-app-fixtures';

const fixtures: Fixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

interface Setup {
  fixture: Fixture;
  roots: LeftoverRoots;
  options: LeftoverDiscoveryOptions;
}

function setup(overrides: Partial<LeftoverDiscoveryOptions> = {}): Setup {
  const fixture = new Fixture();
  fixtures.push(fixture);
  const roots: LeftoverRoots = {
    localAppData: fixture.dir('local'),
    appData: fixture.dir('roaming'),
    localLow: fixture.dir('locallow'),
    programData: fixture.dir('program-data'),
    temp: fixture.dir('temp'),
  };
  return {
    fixture,
    roots,
    options: {
      roots,
      installLocation: fixture.dir('apps/FooApp'),
      installParents: [fixture.root],
      home: fixture.dir('profile'),
      programFiles: [],
      startMenu: [],
      systemRoot: 'C:\\Windows',
      oneDrive: [],
      ...overrides,
    },
  };
}

function fooApp(overrides: Parameters<typeof makeInstalledApp>[0] = { displayName: 'FooApp' }) {
  return makeInstalledApp(overrides);
}

describe('discoverLeftovers', () => {
  it('marks a product-name match in AppData\\Local as a safe, selected app-data leftover', () => {
    const { fixture, options } = setup();
    fixture.file('local/FooApp/data.bin', 'hello');
    fixture.dir('local/FooApp/Cache');

    const result = discoverLeftovers(fooApp(), [], options);
    const candidate = result.candidates.find((entry) => entry.path.includes('local'));
    expect(candidate).toMatchObject({
      path: join(fixture.root, 'local', 'FooApp'),
      class: 'app-data',
      grade: 'safe',
      defaultSelected: true,
      adminRequired: false,
      syncRoot: false,
      link: null,
      sharedWith: [],
    });
    expect(candidate!.bytes).toBe(5);
    expect(candidate!.evidence.some((line) => line.includes('matches'))).toBe(true);
  });

  it('proposes the registered install location as an install-dir candidate', () => {
    const { options } = setup();
    const result = discoverLeftovers(fooApp(), [], options);
    const install = result.candidates.find((candidate) => candidate.class === 'install-dir');
    expect(install).toMatchObject({
      path: options.installLocation,
      grade: 'safe',
      defaultSelected: true,
    });
    expect(install?.evidence.some((line) => line.includes('install location'))).toBe(true);
  });

  it('looks inside a vendor folder for the product folder, never proposing the vendor folder itself', () => {
    const { fixture, options } = setup();
    fixture.dir('local/Acme/Music Player');
    fixture.dir('local/Acme/Other Tool');
    const app = fooApp({ displayName: 'Music Player', publisher: 'Acme Software' });

    const result = discoverLeftovers(app, [], options);
    const paths = result.candidates.map((entry) => entry.path);
    expect(paths).toContain(join(fixture.root, 'local', 'Acme', 'Music Player'));
    expect(paths).not.toContain(join(fixture.root, 'local', 'Acme'));
    expect(paths.some((path) => path.endsWith('Other Tool'))).toBe(false);
    // Another folder lives in the vendor folder, so it must stay.
    expect(result.candidates.find((entry) => entry.path.endsWith('Music Player'))?.emptyParent).toBeUndefined();
  });

  it('marks a vendor folder for removal once empty when it only holds this app', () => {
    const { fixture, options } = setup();
    fixture.dir('program-data/Acme/Music Player');
    const app = fooApp({ displayName: 'Music Player', publisher: 'Acme Software' });

    const result = discoverLeftovers(app, [], options);
    const candidate = result.candidates.find((entry) => entry.path.endsWith('Music Player'));
    expect(candidate?.emptyParent).toBe(join(fixture.root, 'program-data', 'Acme'));
  });

  it('never matches on a shared word: partial overlaps and vendor-wide folders are ignored', () => {
    const { fixture, options } = setup();
    fixture.dir('local/Acme Stuff');
    fixture.dir('local/Microsoft');
    fixture.dir('local/Server Tools');
    const app = fooApp({ displayName: 'Microsoft ODBC Driver 17 for SQL Server', publisher: 'Microsoft Corporation' });

    const result = discoverLeftovers(app, [], { ...options, installLocation: '' });
    expect(result.candidates).toEqual([]);
  });

  it('finds per-user installs under LocalAppData\\Programs', () => {
    const { fixture, options } = setup();
    fixture.dir('local/Programs/Python/Python314');
    const app = fooApp({ displayName: 'Python 3.14.3 (64-bit)', publisher: 'Python Software Foundation' });

    const result = discoverLeftovers(app, [], { ...options, installLocation: '' });
    expect(result.candidates.map((entry) => entry.path)).toContain(join(fixture.root, 'local', 'Programs', 'Python'));
  });

  it('finds an unregistered install folder under Program Files', () => {
    const { fixture, options } = setup();
    const programFiles = fixture.dir('pf');
    fixture.file('pf/nodejs/node.exe', 'x');
    fixture.dir('pf/VideoLAN/VLC');
    const node = fooApp({ displayName: 'Node.js', publisher: 'Node.js Foundation', keyName: '{node}' });

    const result = discoverLeftovers(node, [], { ...options, installLocation: '', programFiles: [programFiles] });
    expect(result.candidates.find((entry) => entry.path === join(programFiles, 'nodejs'))).toMatchObject({
      class: 'install-dir',
      adminRequired: true,
    });
    expect(result.candidates.some((entry) => entry.path.includes('VideoLAN'))).toBe(false);
  });

  it('finds the Start menu folder and shortcuts', () => {
    const { fixture, options } = setup();
    const startMenu = fixture.dir('start');
    fixture.file('start/FooApp/FooApp.lnk', 'x');
    fixture.file('start/FooApp.lnk', 'x');
    fixture.file('start/Unrelated.lnk', 'x');

    const result = discoverLeftovers(fooApp(), [], { ...options, startMenu: [startMenu] });
    const paths = result.candidates.map((entry) => entry.path);
    expect(paths).toContain(join(startMenu, 'FooApp'));
    expect(paths).toContain(join(startMenu, 'FooApp.lnk'));
    expect(paths.some((path) => path.endsWith('Unrelated.lnk'))).toBe(false);
  });

  it('only proposes review leftovers for caution apps', () => {
    const { fixture, options } = setup();
    fixture.dir('local/FooApp');

    const result = discoverLeftovers(fooApp(), [], { ...options, caution: true });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((entry) => entry.grade === 'review' && !entry.defaultSelected)).toBe(true);
  });

  it('ignores unrelated folders and nested paths outside vendor folders', () => {
    const { fixture, options } = setup();
    fixture.dir('local/Unrelated');
    fixture.dir('local/Container/FooApp');

    const result = discoverLeftovers(fooApp(), [], options);
    expect(result.candidates.map((candidate) => candidate.path)).toContain(options.installLocation);
    expect(result.candidates.some((candidate) => candidate.path.endsWith('Unrelated'))).toBe(false);
    expect(result.candidates.some((candidate) => candidate.path.includes('Container'))).toBe(false);
  });

  it('flags leftovers shared with another installed app and never auto-selects them', () => {
    const { fixture, options } = setup();
    fixture.dir('local/Acme');
    const target = fooApp({ displayName: 'Acme', publisher: 'Acme Software' });
    const sibling = makeInstalledApp({
      displayName: 'Acme Video',
      publisher: 'Acme Software',
      keyName: '{sibling}',
    });

    const result = discoverLeftovers(target, [target, sibling], options);
    const candidate = result.candidates.find((entry) => entry.path.endsWith('Acme'));
    expect(candidate).toMatchObject({ grade: 'review', defaultSelected: false });
    expect(candidate?.sharedWith).toEqual(['Acme Video']);
    expect(candidate?.evidence.some((line) => line.includes('Shared with'))).toBe(true);
  });

  it('classifies Roaming leftovers as review-grade user data that stays unselected', () => {
    const { fixture, options } = setup();
    fixture.dir('roaming/FooApp');

    const result = discoverLeftovers(fooApp(), [], options);
    const candidate = result.candidates.find((entry) => entry.path.includes('roaming'));
    expect(candidate).toMatchObject({ class: 'user-data', grade: 'review', defaultSelected: false });
  });

  it('grades ProgramData vendor folders as review, never safe', () => {
    const { fixture, options } = setup();
    fixture.dir('program-data/FooApp');

    const result = discoverLeftovers(fooApp(), [], options);
    const candidate = result.candidates.find((entry) => entry.path.includes('program-data'));
    expect(candidate).toMatchObject({ class: 'program-data', grade: 'review', defaultSelected: false });
    expect(candidate?.evidence.some((line) => line.toLowerCase().includes('shared'))).toBe(true);
  });

  it('classifies save/profile folders as user data even under AppData\\Local', () => {
    const { fixture, options } = setup();
    fixture.dir('local/SaveGames Manager');
    const app = fooApp({ displayName: 'SaveGames Manager' });

    const result = discoverLeftovers(app, [], { ...options, installLocation: '' });
    const candidate = result.candidates.find((entry) => entry.path.includes('SaveGames Manager'));
    expect(candidate).toMatchObject({ class: 'user-data', defaultSelected: false });
  });

  it('marks OneDrive-synced folders as review and unselected', () => {
    const { fixture, options } = setup();
    fixture.dir('local/FooApp');

    const result = discoverLeftovers(fooApp(), [], {
      ...options,
      oneDrive: [fixture.root],
    });
    const candidate = result.candidates.find((entry) => entry.path.includes('local'));
    expect(candidate).toMatchObject({ syncRoot: true, grade: 'review', defaultSelected: false });
    expect(candidate?.evidence.some((line) => line.includes('OneDrive'))).toBe(true);
  });

  it('never follows reparse points and refuses them by default', () => {
    const { fixture, options } = setup();
    fixture.dir('elsewhere/FooApp');
    fixture.link('local/FooApp', join(fixture.root, 'elsewhere', 'FooApp'));

    const result = discoverLeftovers(fooApp(), [], options);
    const candidate = result.candidates.find((entry) => entry.path.includes('local'));
    expect(candidate?.link).not.toBeNull();
    expect(candidate).toMatchObject({ grade: 'review', defaultSelected: false, bytes: null });
  });

  it('skips an install location that is missing or protected', () => {
    const { fixture, options } = setup();
    options.installLocation = join(fixture.root, 'ghost');
    const missing = discoverLeftovers(fooApp(), [], options);
    expect(missing.candidates.some((candidate) => candidate.class === 'install-dir')).toBe(false);
    expect(missing.skipped.map((entry) => entry.reason)).toContain('missing-location');

    options.installLocation = options.roots.programData;
    const protectedResult = discoverLeftovers(fooApp(), [], options);
    expect(protectedResult.skipped.map((entry) => entry.reason)).toContain('protected-location');
  });

  it('refuses install locations with traversal and normalizes accepted ones', () => {
    const { fixture, options } = setup();
    options.installLocation = `${fixture.dir('apps/FooApp')}\\..\\..`;
    const traversal = discoverLeftovers(fooApp(), [], options);
    expect(traversal.skipped.map((entry) => entry.reason)).toContain('invalid-location');
    expect(traversal.candidates.some((candidate) => candidate.class === 'install-dir')).toBe(false);

    options.installLocation = fixture.dir('apps/FooApp').replace(/\\/g, '/');
    const forwardSlashes = discoverLeftovers(fooApp(), [], options);
    const install = forwardSlashes.candidates.find((candidate) => candidate.class === 'install-dir');
    expect(install?.path).toBe(fixture.dir('apps/FooApp'));
  });

  it('refuses install locations outside the allowed parents', () => {
    const { fixture, options } = setup();
    options.installParents = [fixture.dir('allowed')];
    options.installLocation = fixture.dir('apps/FooApp');

    const result = discoverLeftovers(fooApp(), [], options);
    expect(result.skipped.map((entry) => entry.reason)).toContain('untrusted-location');
    expect(result.candidates.some((candidate) => candidate.class === 'install-dir')).toBe(false);
  });

  it('skips an install location that is too broad or shared with another app', () => {
    const { fixture, options } = setup();
    options.installLocation = fixture.root;
    const broad = discoverLeftovers(fooApp(), [], options);
    expect(broad.skipped.map((entry) => entry.reason)).toContain('location-too-broad');

    options.installLocation = options.roots.localAppData;
    const rootItself = discoverLeftovers(fooApp(), [], options);
    expect(rootItself.skipped.map((entry) => entry.reason)).toContain('location-too-broad');

    fixture.dir('pack/Other');
    options.installLocation = fixture.dir('pack');
    const other = makeInstalledApp({
      displayName: 'Other',
      installLocation: join(fixture.root, 'pack', 'Other'),
      keyName: '{other}',
    });
    const shared = discoverLeftovers(fooApp(), [other], options);
    expect(shared.skipped.map((entry) => entry.reason)).toContain('shared-install-location');
    expect(shared.candidates.some((candidate) => candidate.class === 'install-dir')).toBe(false);
  });

  it('marks install locations under Program Files as admin-required', () => {
    const { fixture, options } = setup();
    const programFiles = fixture.dir('program-files');
    options.programFiles = [programFiles];
    options.installLocation = fixture.dir('program-files/FooApp');

    const result = discoverLeftovers(fooApp(), [], options);
    const install = result.candidates.find((candidate) => candidate.class === 'install-dir');
    expect(install).toMatchObject({ adminRequired: true });
  });

  it('never proposes anything inside the Dust install path', () => {
    const { fixture } = setup();
    const dust = fixture.dir('dust');
    fixture.dir('dust/FooApp');
    const result = discoverLeftovers(fooApp(), [], {
      roots: {
        localAppData: dust,
        appData: fixture.dir('roaming'),
        localLow: fixture.dir('locallow'),
        programData: fixture.dir('program-data'),
        temp: fixture.dir('temp'),
      },
      home: fixture.dir('profile'),
      dustInstallPath: dust,
      programFiles: [],
      oneDrive: [],
    });
    expect(result.candidates).toEqual([]);
    expect(result.skipped.map((entry) => entry.reason)).toContain('dust-location');
  });

  it('keeps bytes null when measuring fails', () => {
    const { fixture, options } = setup();
    fixture.dir('local/FooApp');
    const result = discoverLeftovers(fooApp(), [], { ...options, measure: () => null });
    const candidate = result.candidates.find((entry) => entry.path.includes('local'));
    expect(candidate?.bytes).toBeNull();
  });
});

describe('defaultDirectorySize', () => {
  it('sums file sizes without following links and reports null when unreadable', () => {
    const fixture = new Fixture();
    fixtures.push(fixture);
    fixture.file('tree/a.txt', '1234');
    fixture.file('tree/sub/b.txt', '12');
    fixture.dir('outside');
    fixture.link('tree/link', join(fixture.root, 'outside'));

    expect(defaultDirectorySize(join(fixture.root, 'tree'))).toBe(6);
    expect(defaultDirectorySize(join(fixture.root, 'ghost'))).toBeNull();
  });
});

describe('defaultDirectorySizeAsync', () => {
  it('matches the synchronous walker for trees, links, and missing paths', async () => {
    const fixture = new Fixture();
    fixtures.push(fixture);
    fixture.file('tree/a.txt', '1234');
    fixture.file('tree/sub/b.txt', '12');
    fixture.file('tree/sub/deep/c.txt', '123');
    fixture.dir('outside');
    fixture.link('tree/link', join(fixture.root, 'outside'));

    const sync = defaultDirectorySize(join(fixture.root, 'tree'));
    await expect(defaultDirectorySizeAsync(join(fixture.root, 'tree'))).resolves.toBe(sync);
    await expect(defaultDirectorySizeAsync(join(fixture.root, 'ghost'))).resolves.toBeNull();
  });
});

describe('measureLeftoverCandidates', () => {
  it('fills bytes for non-link candidates in place and skips links', async () => {
    const candidates = [
      { id: 'a', path: 'first', bytes: null, link: null },
      { id: 'b', path: 'second', bytes: null, link: 'junction' },
      { id: 'c', path: 'third', bytes: null, link: null },
    ] as unknown as LeftoverCandidate[];

    await measureLeftoverCandidates(candidates, async (path) => (path === 'first' ? 42 : 7));

    expect(candidates[0]?.bytes).toBe(42);
    expect(candidates[1]?.bytes).toBeNull();
    expect(candidates[2]?.bytes).toBe(7);
  });
});
