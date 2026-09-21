import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyDisplayGrade, createDisplayGrader } from '../src/display/display-grade';

const env = {
  systemRoot: 'C:\\Windows',
  programFiles: ['C:\\Program Files'],
  programData: 'C:\\ProgramData',
  userProfile: 'C:\\Users\\x',
  userFolders: ['Documents', 'Desktop'],
};

describe('classifyDisplayGrade', () => {
  it('grades known-safe path patterns as safe with pattern reasons', () => {
    expect(classifyDisplayGrade('C:\\Users\\x\\AppData\\Local\\Temp\\file.tmp', { env })).toMatchObject({
      grade: 'safe',
    });
    expect(classifyDisplayGrade('C:\\Users\\x\\AppData\\Local\\SomeApp\\Cache\\data', { env })).toMatchObject({
      grade: 'safe',
    });
    expect(classifyDisplayGrade('F:\\projects\\app\\node_modules\\pkg\\index.js', { env })).toMatchObject({
      grade: 'safe',
    });
    expect(classifyDisplayGrade('C:\\$Recycle.Bin\\S-1-5-21\\file', { env })).toMatchObject({ grade: 'safe' });
  });

  it('grades system-critical paths as danger with the read-only reason', () => {
    expect(classifyDisplayGrade('C:\\Windows\\System32', { env })).toMatchObject({
      grade: 'danger',
      reason: 'System-critical — read-only',
    });
    expect(classifyDisplayGrade('C:\\Program Files\\App', { env })).toMatchObject({ grade: 'danger' });
    expect(classifyDisplayGrade('C:\\Users\\x', { env })).toMatchObject({
      grade: 'danger',
      reason: 'System-critical — read-only',
    });
    expect(classifyDisplayGrade('C:\\Users\\x\\Documents\\report.docx', { env })).toMatchObject({ grade: 'danger' });
    expect(classifyDisplayGrade('D:\\', { env })).toMatchObject({ grade: 'danger' });
  });

  it('defaults unknown folders to review', () => {
    expect(classifyDisplayGrade('C:\\Users\\x\\RandomFolder', { env })).toMatchObject({
      grade: 'review',
      reason: 'Unrecognized folder — review before deleting',
    });
    expect(classifyDisplayGrade('F:\\Vault', { env })).toMatchObject({ grade: 'review' });
  });

  it('prefers safety: a temp-named folder inside Windows is still danger', () => {
    expect(classifyDisplayGrade('C:\\Windows\\Cache', { env })).toMatchObject({ grade: 'danger' });
  });

  it('createDisplayGrader returns a reusable grader identical to classifyDisplayGrade', () => {
    const grader = createDisplayGrader({ env });
    const paths = [
      'C:\\Windows\\System32',
      'C:\\Users\\x\\Documents\\report.docx',
      'C:\\Users\\x\\AppData\\Local\\Temp\\file.tmp',
      'C:\\Users\\x\\RandomFolder',
      'D:\\',
      'F:\\projects\\app\\node_modules\\pkg\\index.js',
    ];
    for (const path of paths) {
      expect(grader(path)).toEqual(classifyDisplayGrade(path, { env }));
    }
    expect(grader('C:\\Windows\\Cache').grade).toBe('danger');
  });

  it('cannot leak into the cleaner (informational only)', () => {
    const cleanerDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'cleaner');
    for (const file of readdirSync(cleanerDir)) {
      const content = readFileSync(resolve(cleanerDir, file), 'utf8');
      expect(content).not.toContain('display/');
    }
  });
});
