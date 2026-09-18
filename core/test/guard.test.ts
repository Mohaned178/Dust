import { describe, expect, it } from 'vitest';
import { checkDeletable, defaultProtectedPaths } from '../src/cleaner/guard';

const env = {
  systemRoot: 'C:\\Windows',
  programFiles: ['C:\\Program Files', 'C:\\Program Files (x86)'],
  programData: 'C:\\ProgramData',
  userProfile: 'C:\\Users\\x',
  userFolders: ['Documents', 'Desktop', 'Downloads'],
  dustInstallPath: 'C:\\Apps\\Dust',
};

describe('checkDeletable', () => {
  it('refuses volume roots', () => {
    expect(checkDeletable('C:\\', env)).toMatchObject({ allowed: false, reason: 'volume-root' });
    expect(checkDeletable('D:\\', env)).toMatchObject({ allowed: false, reason: 'volume-root' });
  });

  it('refuses protected roots and their ancestors', () => {
    expect(checkDeletable('C:\\Windows', env)).toMatchObject({ allowed: false, reason: 'protected-root' });
    expect(checkDeletable('C:\\Program Files', env)).toMatchObject({ allowed: false, reason: 'protected-root' });
    expect(checkDeletable('C:\\Users\\x', env)).toMatchObject({ allowed: false, reason: 'protected-root' });
    expect(checkDeletable('C:\\Users\\x\\Documents', env)).toMatchObject({
      allowed: false,
      reason: 'protected-root',
    });
    expect(checkDeletable('C:\\Users', env)).toMatchObject({ allowed: false, reason: 'protected-ancestor' });
  });

  it('refuses paths inside a protected root unless exempted exactly', () => {
    expect(checkDeletable('C:\\Windows\\Temp', env)).toMatchObject({
      allowed: false,
      reason: 'inside-protected',
    });
    expect(checkDeletable('C:\\Windows\\Temp', { ...env, exemptExact: ['C:\\Windows\\Temp'] })).toEqual({
      allowed: true,
    });
  });

  it('never allows an equal-to-protected path even with an exemption', () => {
    expect(checkDeletable('C:\\Windows', { ...env, exemptExact: ['C:\\Windows'] })).toMatchObject({
      allowed: false,
      reason: 'protected-root',
    });
    expect(checkDeletable('C:\\', { ...env, exemptExact: ['C:\\'] })).toMatchObject({
      allowed: false,
      reason: 'volume-root',
    });
  });

  it('allows ordinary paths outside protected areas, with or without exemption', () => {
    expect(checkDeletable('F:\\Tools\\junk', env)).toEqual({ allowed: true });
    expect(checkDeletable('F:\\Tools\\junk', { ...env, exemptExact: ['F:\\Tools\\junk'] })).toEqual({
      allowed: true,
    });
  });

  it('allows exempted paths inside the user profile (the temp/cache case)', () => {
    const temp = 'C:\\Users\\x\\AppData\\Local\\Temp';
    expect(checkDeletable(temp, env)).toMatchObject({ allowed: false, reason: 'inside-protected' });
    expect(checkDeletable(temp, { ...env, exemptExact: [temp] })).toEqual({ allowed: true });
  });

  it('is case-insensitive', () => {
    expect(checkDeletable('c:\\WINDOWS\\TEMP', { ...env, exemptExact: ['C:\\windows\\temp'] })).toEqual({
      allowed: true,
    });
    expect(checkDeletable('C:\\WINDOWS', env)).toMatchObject({ allowed: false, reason: 'protected-root' });
  });

  it('honors extraProtected and dustInstallPath', () => {
    expect(checkDeletable('F:\\Vault', { ...env, extraProtected: ['F:\\Vault'] })).toMatchObject({
      allowed: false,
      reason: 'protected-root',
    });
    expect(checkDeletable('C:\\Apps\\Dust', env)).toMatchObject({ allowed: false, reason: 'protected-root' });
  });
});

describe('defaultProtectedPaths', () => {
  it('lists the configured environment paths', () => {
    const paths = defaultProtectedPaths(env);
    expect(paths).toContain('C:\\Windows');
    expect(paths).toContain('C:\\Users\\x');
    expect(paths).toContain('C:\\Users\\x\\Documents');
    expect(paths).toContain('C:\\Apps\\Dust');
  });
});
