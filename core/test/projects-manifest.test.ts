import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeFsProbe } from '../src/rules/probe';
import {
  PUBLIC_REGISTRY_HOSTS,
  detectLockfiles,
  hasPnp,
  hasWorkspaceSignals,
  parsePackageManager,
  readManifest,
  sampleRegistryHosts,
} from '../src/projects/manifest';
import { Fixture } from './fixtures';

describe('readManifest', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('returns null when package.json is absent', () => {
    const dir = fixture.dir('empty');
    expect(readManifest(dir, createNodeFsProbe())).toBeNull();
  });

  it('parses name, workspaces array and the packageManager field', () => {
    const dir = fixture.dir('app');
    fixture.file('app/package.json', JSON.stringify({ name: 'my-app', workspaces: ['packages/*'], packageManager: 'pnpm@8.6.0' }));
    expect(readManifest(dir, createNodeFsProbe())).toEqual({
      name: 'my-app',
      workspaces: true,
      packageManagerField: 'pnpm@8.6.0',
      valid: true,
    });
  });

  it('accepts the workspaces object form and reports invalid JSON as parsed-but-invalid', () => {
    const dir = fixture.dir('app');
    fixture.file('app/package.json', JSON.stringify({ workspaces: { packages: ['apps/*'] } }));
    expect(readManifest(dir, createNodeFsProbe())).toMatchObject({ workspaces: true, valid: true });

    fixture.file('app/package.json', '{ not json');
    expect(readManifest(dir, createNodeFsProbe())).toMatchObject({ workspaces: false, valid: false, name: null });
  });
});

describe('hasWorkspaceSignals', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('is true for manifest workspaces and for each signal file', () => {
    const dir = fixture.dir('plain');
    fixture.file('plain/package.json', '{}');
    const probe = createNodeFsProbe();
    const plain = readManifest(dir, probe)!;
    expect(hasWorkspaceSignals(dir, probe, plain)).toBe(false);

    for (const signal of ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'nx.json']) {
      const target = fixture.dir(`mono-${signal}`);
      fixture.file(`mono-${signal}/package.json`, '{}');
      fixture.file(`mono-${signal}/${signal}`, '{}');
      const manifest = readManifest(target, probe)!;
      expect(hasWorkspaceSignals(target, probe, manifest)).toBe(true);
    }
  });
});

describe('detectLockfiles and hasPnp', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('lists present lockfiles in stable order', () => {
    const dir = fixture.dir('app');
    fixture.file('app/pnpm-lock.yaml', '');
    fixture.file('app/package-lock.json', '{}');
    expect(detectLockfiles(dir, createNodeFsProbe())).toEqual(['package-lock.json', 'pnpm-lock.yaml']);
    expect(detectLockfiles(fixture.dir('bare'), createNodeFsProbe())).toEqual([]);
  });

  it('detects Plug n Play files', () => {
    const dir = fixture.dir('berry');
    expect(hasPnp(dir, createNodeFsProbe())).toBe(false);
    fixture.file('berry/.pnp.cjs', '');
    expect(hasPnp(dir, createNodeFsProbe())).toBe(true);
  });
});

describe('parsePackageManager', () => {
  it('parses name and major and rejects malformed fields', () => {
    expect(parsePackageManager('yarn@3.2.1')).toEqual({ name: 'yarn', major: 3 });
    expect(parsePackageManager('npm@10.2.0')).toEqual({ name: 'npm', major: 10 });
    expect(parsePackageManager('pnpm')).toEqual({ name: 'pnpm', major: null });
    expect(parsePackageManager('')).toBeNull();
  });
});

describe('sampleRegistryHosts', () => {
  it('extracts resolved hosts and treats npmjs and yarnpkg as public', () => {
    const content = [
      '"resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz"',
      '"resolved": "https://registry.yarnpkg.com/right-pad/-/right-pad-1.0.0.tgz"',
      '"resolved": "https://npm.internal.example/secret/-/secret-2.0.0.tgz"',
      '"resolved": "https://npm.internal.example/other/-/other-1.0.0.tgz"',
    ].join('\n');
    expect(sampleRegistryHosts(content)).toEqual(['registry.npmjs.org', 'registry.yarnpkg.com', 'npm.internal.example']);
    expect(PUBLIC_REGISTRY_HOSTS.has('npm.internal.example')).toBe(false);
    expect(sampleRegistryHosts('')).toEqual([]);
  });
});
