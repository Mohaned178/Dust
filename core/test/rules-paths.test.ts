import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultRuleEnv, expandProfileWildcard } from '../src/rules/paths';
import { createNodeFsProbe } from '../src/rules/probe';
import { Fixture } from './fixtures';

describe('defaultRuleEnv', () => {
  it('reads Windows environment variables with sensible fallbacks', () => {
    const env = defaultRuleEnv();
    expect(env.temp).toBe(process.env.TEMP ?? process.env.TMP ?? '');
    expect(typeof env.localAppData).toBe('string');
    expect(typeof env.appData).toBe('string');
    expect(typeof env.userProfile).toBe('string');
    expect(typeof env.windowsDir).toBe('string');
    expect(typeof env.programData).toBe('string');
  });
});

describe('expandProfileWildcard', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('returns existing wildcard matches sorted, ignoring missing ones', () => {
    fixture.dir('User Data/Default/Cache');
    fixture.dir('User Data/Profile 1/Cache');
    const probe = createNodeFsProbe();

    const matches = expandProfileWildcard(fixture.root, 'User Data/*/Cache', probe);
    expect(matches).toEqual([
      join(fixture.root, 'User Data', 'Default', 'Cache'),
      join(fixture.root, 'User Data', 'Profile 1', 'Cache'),
    ]);
  });

  it('returns an empty array when the wildcard parent does not exist', () => {
    const probe = createNodeFsProbe();
    expect(expandProfileWildcard(fixture.root, 'Missing/*/Cache', probe)).toEqual([]);
  });
});
