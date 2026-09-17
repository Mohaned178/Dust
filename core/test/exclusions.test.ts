import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createExclusionPredicate } from '../src/scanner/exclusions';

describe('createExclusionPredicate', () => {
  const base = join('C:', 'scan');

  it('excludes default hard-exclusion names case-insensitively', () => {
    const isExcluded = createExclusionPredicate();
    expect(isExcluded(join(base, '$Recycle.Bin'))).toBe(true);
    expect(isExcluded(join(base, '$RECYCLE.BIN'))).toBe(true);
    expect(isExcluded(join(base, 'PAGEFILE.SYS'))).toBe(true);
    expect(isExcluded(join(base, 'hiberfil.sys'))).toBe(true);
    expect(isExcluded(join(base, 'swapfile.sys'))).toBe(true);
    expect(isExcluded(join(base, 'System Volume Information'))).toBe(true);
  });

  it('does not exclude ordinary files', () => {
    const isExcluded = createExclusionPredicate();
    expect(isExcluded(join(base, 'pagefile.sys.bak'))).toBe(false);
    expect(isExcluded(join(base, 'notes.txt'))).toBe(false);
  });

  it('excludes configured absolute paths and their descendants', () => {
    const own = join(base, 'DustInstall');
    const isExcluded = createExclusionPredicate({ paths: [own] });
    expect(isExcluded(own)).toBe(true);
    expect(isExcluded(join(own, 'app', 'index.js'))).toBe(true);
    expect(isExcluded(join(base, 'DustInstall2'))).toBe(false);
  });

  it('matches configured names case-insensitively', () => {
    const isExcluded = createExclusionPredicate({ names: ['MyJunk'] });
    expect(isExcluded(join(base, 'MYJUNK'))).toBe(true);
    expect(isExcluded(join(base, 'myjunk2'))).toBe(false);
  });
});
