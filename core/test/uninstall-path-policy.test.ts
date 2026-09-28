import { describe, expect, it } from 'vitest';
import {
  assertLeftoverNameComponent,
  assertUninstallTarget,
  defaultUninstallParents,
  normalizePlanPath,
} from '../src/uninstall/path-policy';

const ROOTS = [
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\Users\\bob\\AppData\\Local',
  'C:\\Users\\bob\\AppData\\Roaming',
];

function check(path: string, extraBlocked: string[] = []) {
  return assertUninstallTarget(path, {
    roots: ROOTS,
    systemRoot: 'C:\\Windows',
    userProfile: 'C:\\Users\\bob',
    dustInstallPath: 'C:\\Program Files\\Dust',
    extraBlocked,
  });
}

describe('normalizePlanPath', () => {
  it('normalizes separators and strips trailing slashes', () => {
    expect(normalizePlanPath('C:/Program Files/App/')).toBe('C:\\Program Files\\App');
    expect(normalizePlanPath('C:\\Program Files\\App\\')).toBe('C:\\Program Files\\App');
    expect(normalizePlanPath('  C:\\Program Files\\App  ')).toBe('C:\\Program Files\\App');
  });

  it('rejects paths containing parent traversal', () => {
    expect(normalizePlanPath('C:\\Program Files\\..')).toBeNull();
    expect(normalizePlanPath('C:\\Program Files\\App\\..\\..')).toBeNull();
    expect(normalizePlanPath('C:\\Users\\bob\\..\\..\\Windows')).toBeNull();
  });

  it('rejects volume roots, relative paths, UNC paths, and empty input', () => {
    expect(normalizePlanPath('C:\\')).toBeNull();
    expect(normalizePlanPath('C:')).toBeNull();
    expect(normalizePlanPath('App\\Folder')).toBeNull();
    expect(normalizePlanPath('\\\\server\\share\\App')).toBeNull();
    expect(normalizePlanPath('')).toBeNull();
    expect(normalizePlanPath('   ')).toBeNull();
    expect(normalizePlanPath('C:\\Apps\0Evil')).toBeNull();
  });
});

describe('assertUninstallTarget', () => {
  it('accepts paths strictly inside an allowed parent', () => {
    expect(check('C:\\Program Files\\App')).toEqual({ ok: true, path: 'C:\\Program Files\\App' });
    expect(check('C:\\ProgramData\\Vendor\\App')).toEqual({ ok: true, path: 'C:\\ProgramData\\Vendor\\App' });
    expect(check('C:\\Users\\bob\\AppData\\Roaming\\App')).toEqual({ ok: true, path: 'C:\\Users\\bob\\AppData\\Roaming\\App' });
  });

  it('is case insensitive and accepts forward slashes after normalization', () => {
    expect(check('c:\\program files\\app')).toEqual({ ok: true, path: 'c:\\program files\\app' });
    expect(check('C:/Program Files/App')).toEqual({ ok: true, path: 'C:\\Program Files\\App' });
  });

  it('refuses an allowed parent root itself', () => {
    // Program Files is also an ancestor of the Dust install path, so the guard refuses it first.
    expect(check('C:\\Program Files')).toMatchObject({ ok: false, reason: 'protected' });
    expect(check('C:\\ProgramData')).toMatchObject({ ok: false, reason: 'root-itself' });
    expect(check('C:\\Users\\bob\\AppData\\Local')).toMatchObject({ ok: false, reason: 'root-itself' });
  });

  it('refuses traversal, volume roots, and relative paths as invalid', () => {
    expect(check('C:\\Program Files\\..')).toMatchObject({ ok: false, reason: 'invalid-path' });
    expect(check('C:\\')).toMatchObject({ ok: false, reason: 'invalid-path' });
    expect(check('App')).toMatchObject({ ok: false, reason: 'invalid-path' });
  });

  it('refuses protected system and profile locations', () => {
    expect(check('C:\\Windows\\System32')).toMatchObject({ ok: false, reason: 'protected' });
    expect(check('C:\\Users\\bob')).toMatchObject({ ok: false, reason: 'protected' });
    expect(check('C:\\Users\\bob\\Documents\\App')).toMatchObject({ ok: false, reason: 'protected' });
    expect(check('C:\\Users\\bob\\Desktop\\App')).toMatchObject({ ok: false, reason: 'protected' });
    expect(check('C:\\Program Files\\Dust')).toMatchObject({ ok: false, reason: 'protected' });
  });

  it('refuses paths outside every allowed parent', () => {
    expect(check('D:\\Games\\App')).toMatchObject({ ok: false, reason: 'outside-allowed-roots' });
    expect(check('C:\\Games\\App')).toMatchObject({ ok: false, reason: 'outside-allowed-roots' });
  });

  it('refuses ancestors of the profile and of allowed parents', () => {
    expect(check('C:\\Users')).toMatchObject({ ok: false, reason: 'protected' });
    expect(check('C:\\Users\\bob\\AppData')).toMatchObject({ ok: false, reason: 'too-broad' });
  });

  it('refuses explicitly blocked paths and their children', () => {
    expect(check('C:\\Program Files\\App\\Saves', ['C:\\Program Files\\App\\Saves'])).toMatchObject({
      ok: false,
      reason: 'blocked',
    });
    expect(check('C:\\Program Files\\App\\Saves\\Slot1', ['C:\\Program Files\\App\\Saves'])).toMatchObject({
      ok: false,
      reason: 'blocked',
    });
  });
});

describe('assertLeftoverNameComponent', () => {
  it('accepts ordinary folder names', () => {
    expect(assertLeftoverNameComponent('Mozilla')).toBe(true);
    expect(assertLeftoverNameComponent('Some Vendor 2.0')).toBe(true);
  });

  it('refuses names that could escape a path', () => {
    expect(assertLeftoverNameComponent('')).toBe(false);
    expect(assertLeftoverNameComponent('.')).toBe(false);
    expect(assertLeftoverNameComponent('..')).toBe(false);
    expect(assertLeftoverNameComponent('a\\b')).toBe(false);
    expect(assertLeftoverNameComponent('a/b')).toBe(false);
    expect(assertLeftoverNameComponent('a:b')).toBe(false);
    expect(assertLeftoverNameComponent('a\0b')).toBe(false);
  });
});

describe('defaultUninstallParents', () => {
  it('derives the standard parents from an environment', () => {
    const parents = defaultUninstallParents({
      ProgramFiles: 'D:\\PF',
      'ProgramFiles(x86)': 'D:\\PF86',
      ProgramData: 'D:\\PD',
      LOCALAPPDATA: 'D:\\LAD',
      APPDATA: 'D:\\AD',
    });
    expect(parents).toEqual(['D:\\PF', 'D:\\PF86', 'D:\\PD', 'D:\\LAD', 'D:\\AD']);
  });

  it('drops missing values', () => {
    expect(defaultUninstallParents({ ProgramFiles: 'D:\\PF' })).toEqual(['D:\\PF']);
  });
});