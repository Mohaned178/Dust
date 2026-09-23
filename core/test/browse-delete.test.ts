import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteUnprotectedPath } from '../src/cleaner/browse-delete';
import { Fixture } from './fixtures';

describe('deleteUnprotectedPath', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function guard() {
    return {
      systemRoot: join(fixture.root, 'Windows'),
      programData: join(fixture.root, 'ProgramData'),
      userProfile: join(fixture.root, 'Users', 'x'),
      userFolders: [],
    };
  }

  it('refuses a volume root', () => {
    expect(deleteUnprotectedPath('T:\\', { guard: guard() })).toMatchObject({
      status: 'refused',
      refusal: 'volume-root',
      deletedBytes: 0,
    });
  });

  it('refuses protected paths and their ancestors', () => {
    expect(deleteUnprotectedPath(join(fixture.root, 'Windows', 'System32', 'x'), { guard: guard() })).toMatchObject({
      status: 'refused',
      refusal: 'inside-protected',
    });
    expect(deleteUnprotectedPath(join(fixture.root, 'ProgramData'), { guard: guard() })).toMatchObject({
      status: 'refused',
      refusal: 'protected-root',
    });
    expect(deleteUnprotectedPath(join(fixture.root, 'Users'), { guard: guard() })).toMatchObject({
      status: 'refused',
      refusal: 'protected-ancestor',
    });
  });

  it('refuses protected paths case-insensitively', () => {
    expect(deleteUnprotectedPath(join(fixture.root, 'WINDOWS', 'system32'), { guard: guard() })).toMatchObject({
      status: 'refused',
    });
  });

  it('never exempts a rule-known path inside a protected root', () => {
    expect(deleteUnprotectedPath(join(fixture.root, 'Windows', 'Temp'), { guard: guard() })).toMatchObject({
      status: 'refused',
      refusal: 'inside-protected',
    });
  });

  it('deletes an unprotected directory tree and reports freed bytes', () => {
    fixture.file('junk/a.txt', 'aaaaa');
    fixture.file('junk/sub/b.txt', 'bbbbbbb');

    const result = deleteUnprotectedPath(join(fixture.root, 'junk'), { guard: guard() });

    expect(result).toMatchObject({ status: 'done', deletedBytes: 12, skippedLocked: 0, errors: [] });
    expect(existsSync(join(fixture.root, 'junk'))).toBe(false);
  });

  it('deletes a single file', () => {
    const file = fixture.file('single.bin', '123456');

    const result = deleteUnprotectedPath(file, { guard: guard() });

    expect(result).toMatchObject({ status: 'done', deletedBytes: 6 });
    expect(existsSync(file)).toBe(false);
  });

  it('reports already-gone for missing paths', () => {
    expect(deleteUnprotectedPath(join(fixture.root, 'missing'), { guard: guard() })).toMatchObject({
      status: 'already-gone',
      deletedBytes: 0,
    });
  });

  it('skips locked files, deletes the rest, and reports partial', async () => {
    fixture.dir('junk');
    const locked = join(fixture.root, 'junk', 'sleeper.exe');
    copyFileSync(process.execPath, locked);
    fixture.file('junk/free.txt', 'defg');
    const child = spawn(locked, ['-e', "console.log('ready'); setInterval(() => {}, 1000);"], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('sleeper never became ready')), 15000);
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.stdout?.on('data', (chunk) => {
          if (String(chunk).includes('ready')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      const result = deleteUnprotectedPath(join(fixture.root, 'junk'), { guard: guard() });

      expect(result.status).toBe('partial');
      expect(result.skippedLocked).toBe(1);
      expect(result.deletedBytes).toBe(4);
      expect(existsSync(locked)).toBe(true);
      expect(existsSync(join(fixture.root, 'junk', 'free.txt'))).toBe(false);
    } finally {
      child.kill();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve();
        else {
          child.on('exit', () => resolve());
          setTimeout(resolve, 5000);
        }
      });
    }
  });
});
