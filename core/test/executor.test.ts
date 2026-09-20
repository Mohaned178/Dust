import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deletePathTree, executeItem } from '../src/cleaner/executor';
import type { PlanItem } from '../src/cleaner/plan';
import { Fixture } from './fixtures';

describe('deletePathTree', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('deletes a directory tree and reports the freed bytes', () => {
    fixture.file('junk/a.txt', 'aaaaa');
    fixture.file('junk/sub/b.txt', 'bbbbbbb');
    const outcome = deletePathTree(join(fixture.root, 'junk'));

    expect(outcome).toMatchObject({ status: 'done', deletedBytes: 12, skippedLocked: 0, errors: [] });
    expect(existsSync(join(fixture.root, 'junk'))).toBe(false);
  });

  it('deletes a single file', () => {
    const file = fixture.file('single.bin', '123456');
    const outcome = deletePathTree(file);
    expect(outcome).toMatchObject({ status: 'done', deletedBytes: 6 });
    expect(existsSync(file)).toBe(false);
  });

  it('skips locked files, deletes the rest, and reports partial', async () => {
    // NOTE: deviation from the plan's draft test (openSync 'r' handle).
    // Verified empirically on this platform: Node/libuv opens files with
    // full share modes, so an open 'r' handle does NOT block unlinkSync —
    // the draft assertion (skippedLocked 1) fails with status 'done'.
    // A genuinely undeletable file is a running executable image: Windows
    // denies unlink with EPERM (in the executor's FILE_LOCKED_CODES set).
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
      const outcome = deletePathTree(join(fixture.root, 'junk'));
      expect(outcome.status).toBe('partial');
      expect(outcome.skippedLocked).toBe(1);
      expect(outcome.deletedBytes).toBe(4);
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

  it('never follows links and reports them as errors', (ctx) => {
    fixture.file('real/data.bin', '1234567890');
    fixture.file('junk/keep.txt', 'xx');
    try {
      fixture.link('junk/alias', join(fixture.root, 'real'));
    } catch {
      ctx.skip();
      return;
    }

    const outcome = deletePathTree(join(fixture.root, 'junk'));
    expect(outcome.errors.some((error) => error.code === 'ELINK')).toBe(true);
    expect(existsSync(join(fixture.root, 'real', 'data.bin'))).toBe(true);
    expect(existsSync(join(fixture.root, 'junk', 'keep.txt'))).toBe(false);
    expect(outcome.status).not.toBe('done');
  });

  it('refuses a root-level link target without touching the target', (ctx) => {
    const real = fixture.file('real/data.bin', '1234567890');
    let alias: string;
    try {
      alias = fixture.link('alias', join(fixture.root, 'real'));
    } catch {
      ctx.skip();
      return;
    }

    const outcome = deletePathTree(alias);
    expect(outcome.status).toBe('failed');
    expect(outcome.errors.some((error) => error.code === 'ELINK')).toBe(true);
    expect(existsSync(real)).toBe(true);
    expect(existsSync(join(fixture.root, 'real', 'data.bin'))).toBe(true);
  });

  it('reports already-gone for missing paths', () => {
    expect(deletePathTree(join(fixture.root, 'missing'))).toMatchObject({
      status: 'already-gone',
      deletedBytes: 0,
    });
  });

  it('refuses relative paths', () => {
    expect(isAbsolute('junk')).toBe(false);
    const outcome = deletePathTree('junk');
    expect(outcome.status).toBe('failed');
    expect(outcome.errors[0]?.code).toBe('RELATIVE-PATH');
  });
});

describe('executeItem', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function item(path: string, overrides: Partial<PlanItem> = {}): PlanItem {
    return {
      ruleId: 'fixture',
      category: 'temp',
      path,
      bytes: 0,
      grade: 'safe',
      recovery: { kind: 'junk', reason: 'fixture' },
      evidence: 'fixture',
      action: { kind: 'delete-path' },
      ...overrides,
    };
  }

  it('executes a delete-path item', () => {
    const dir = fixture.dir('junk');
    fixture.file('junk/a.txt', 'aaa');
    const result = executeItem(item(dir));
    expect(result).toMatchObject({ status: 'done', deletedBytes: 3, action: 'delete-path' });
    expect(existsSync(dir)).toBe(false);
  });

  it('refuses a protected path at execute time even when exempted', () => {
    const result = executeItem(item('C:\\Windows'), {
      guard: { systemRoot: 'C:\\Windows', userProfile: 'C:\\Users\\x', userFolders: [] },
    });
    expect(result.status).toBe('failed');
    expect(result.errors[0]?.code).toBe('GUARD-PROTECTED-ROOT');
  });
});
