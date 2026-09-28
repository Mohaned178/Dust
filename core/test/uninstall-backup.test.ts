import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  backupDirFor,
  backupFileName,
  createRegistryBackup,
  decodeRegistryText,
  encodeRegistryText,
  fullRegistryPath,
  mergeRegistryExports,
  pruneRegistryBackups,
  restoreCommandFor,
} from '../src/uninstall/backup';
import type { RegistryCandidate } from '../src/uninstall/types';
import { Fixture } from './fixtures';

const fixtures: Fixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

function registryCandidate(
  hive: RegistryCandidate['hive'],
  path: string,
  overrides: Partial<RegistryCandidate> = {},
): RegistryCandidate {
  return {
    id: 'candidate-id',
    hive,
    path,
    scope: 'product',
    grade: 'safe',
    adminRequired: hive !== 'hkcu',
    excludedReason: null,
    ...overrides,
  };
}

const EXPORT_TEMPLATE = (key: string): string =>
  `Windows Registry Editor Version 5.00\r\n\r\n[${key}]\r\n"value"="1"\r\n`;

function fakeReg(files: Record<string, string>): (args: string[]) => Promise<string> {
  return async (args) => {
    const [command, key, file] = args;
    if (command !== 'export' || key === undefined || file === undefined) {
      throw new Error(`unexpected command: ${args.join(' ')}`);
    }
    const content = files[key];
    if (content === undefined) {
      throw new Error('ERROR: The system was unable to find the specified registry key or value.');
    }
    writeFileSync(file, content);
    return '';
  };
}

describe('backupFileName', () => {
  it('stamps the app id in UTC', () => {
    expect(backupFileName('abc123', new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe(
      'abc123-20260102-030405.reg',
    );
  });
});

describe('fullRegistryPath', () => {
  it('maps hives to reg.exe roots', () => {
    expect(fullRegistryPath('hklm', 'Software\\Vendor')).toBe('HKLM\\Software\\Vendor');
    expect(fullRegistryPath('hkcu', 'Software\\Vendor')).toBe('HKCU\\Software\\Vendor');
    expect(fullRegistryPath('hklm-wow64', 'Software\\Vendor')).toBe(
      'HKLM\\Software\\WOW6432Node\\Vendor',
    );
    expect(
      fullRegistryPath('hklm-wow64', 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{X}'),
    ).toBe('HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{X}');
  });
});

describe('mergeRegistryExports', () => {
  it('writes one header and keeps every key block', () => {
    const merged = mergeRegistryExports([
      'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\A]\n"a"="1"\n',
      'Windows Registry Editor Version 5.00\n\n[HKEY_CURRENT_USER\\Software\\B]\n"b"="2"\n',
    ]);
    const headerCount = merged.split('Windows Registry Editor Version 5.00').length - 1;
    expect(headerCount).toBe(1);
    expect(merged).toContain('[HKEY_LOCAL_MACHINE\\Software\\A]');
    expect(merged).toContain('[HKEY_CURRENT_USER\\Software\\B]');
    expect(merged.startsWith('Windows Registry Editor Version 5.00\r\n')).toBe(true);
    expect(merged.endsWith('\r\n')).toBe(true);
    expect(merged.includes('\n\n\n')).toBe(false);
  });
});

describe('restoreCommandFor', () => {
  it('produces a quotable reg import command', () => {
    expect(restoreCommandFor('C:\\Backups\\app-1.reg')).toBe('reg import "C:\\Backups\\app-1.reg"');
  });
});

describe('backupDirFor', () => {
  it('places backups under the user data directory', () => {
    expect(backupDirFor('C:\\Users\\x\\AppData\\Roaming\\Dust')).toBe(
      join('C:\\Users\\x\\AppData\\Roaming\\Dust', 'uninstall-backups'),
    );
  });
});

describe('registry export encoding', () => {
  it('decodes UTF-16LE exports with a BOM and plain UTF-8 text', () => {
    const content =
      'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Foo]\r\n"a"="1"\r\n';
    expect(decodeRegistryText(encodeRegistryText(content))).toBe(content);
    expect(decodeRegistryText(Buffer.from(content, 'utf8'))).toBe(content);
    expect(decodeRegistryText(content)).toBe(content);
  });

  it('writes merged archives as UTF-16LE with a BOM so reg import can read them', async () => {
    const fixture = new Fixture();
    fixtures.push(fixture);
    const backupDir = fixture.dir('backups');
    const exported =
      'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Bar]\r\n"b"="2"\r\n';
    const result = await createRegistryBackup(
      [registryCandidate('hkcu', 'Software\\Bar')],
      'abc123',
      {
        backupDir,
        runReg: async (args) => {
          const file = args[2]!;
          writeFileSync(file, encodeRegistryText(exported));
          return '';
        },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const raw = readFileSync(result.path);
    expect(raw[0]).toBe(0xff);
    expect(raw[1]).toBe(0xfe);
    const text = decodeRegistryText(raw);
    expect(text.split('Windows Registry Editor Version 5.00').length - 1).toBe(1);
    expect(text).toContain('[HKEY_CURRENT_USER\\Software\\Bar]');
    expect(text).toContain('"b"="2"');
  });
});

describe('createRegistryBackup', () => {
  it('exports every key into a single merged archive', async () => {
    const fixture = new Fixture();
    fixtures.push(fixture);
    const backupDir = fixture.dir('backups');
    const candidates = [
      registryCandidate('hklm', 'Software\\Foo'),
      registryCandidate('hkcu', 'Software\\Bar', { id: 'other' }),
    ];
    const result = await createRegistryBackup(candidates, 'abc123', {
      backupDir,
      now: () => Date.UTC(2026, 0, 2, 3, 4, 5),
      runReg: fakeReg({
        'HKLM\\Software\\Foo': EXPORT_TEMPLATE('HKEY_LOCAL_MACHINE\\Software\\Foo'),
        'HKCU\\Software\\Bar': EXPORT_TEMPLATE('HKEY_CURRENT_USER\\Software\\Bar'),
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(join(backupDir, 'abc123-20260102-030405.reg'));
    expect(result.exportedKeys).toEqual(['HKLM\\Software\\Foo', 'HKCU\\Software\\Bar']);
    expect(result.restoreCommand).toBe(`reg import "${result.path}"`);
    const merged = decodeRegistryText(readFileSync(result.path));
    expect(merged).toContain('[HKEY_LOCAL_MACHINE\\Software\\Foo]');
    expect(merged).toContain('[HKEY_CURRENT_USER\\Software\\Bar]');
  });

  it('skips keys that no longer exist and fails on other export errors', async () => {
    const fixture = new Fixture();
    fixtures.push(fixture);
    const backupDir = fixture.dir('backups');
    const skipped = await createRegistryBackup(
      [registryCandidate('hklm', 'Software\\Gone')],
      'abc123',
      { backupDir, runReg: fakeReg({}) },
    );
    expect(skipped).toMatchObject({ ok: true, exportedKeys: [] });

    const failed = await createRegistryBackup(
      [registryCandidate('hklm', 'Software\\Foo')],
      'abc123',
      {
        backupDir,
        runReg: async () => {
          throw new Error('reg.exe exploded');
        },
      },
    );
    expect(failed).toMatchObject({ ok: false, reason: 'export-failed' });
  });

  it('returns no-keys when there is nothing to export', async () => {
    const fixture = new Fixture();
    fixtures.push(fixture);
    const result = await createRegistryBackup([], 'abc123', {
      backupDir: fixture.dir('backups'),
      runReg: fakeReg({}),
    });
    expect(result).toEqual({ ok: false, reason: 'no-keys' });
  });
});

describe('pruneRegistryBackups', () => {
  it('removes archives older than the ttl and keeps everything else', () => {
    const fixture = new Fixture();
    fixtures.push(fixture);
    const dir = fixture.dir('backups');
    const now = Date.UTC(2026, 0, 31);
    fixture.file('backups/old.reg', 'old', now - 40 * 24 * 60 * 60_000);
    fixture.file('backups/new.reg', 'new', now - 24 * 60 * 60_000);
    fixture.file('backups/notes.txt', 'keep', now - 60 * 24 * 60 * 60_000);

    const removed = pruneRegistryBackups(dir, { now: () => now });
    expect(removed).toEqual(['old.reg']);
    expect(readFileSync(join(dir, 'new.reg'), 'utf8')).toBe('new');
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('keep');
  });

  it('returns an empty list for a missing directory', () => {
    expect(pruneRegistryBackups('C:\\does\\not\\exist', {})).toEqual([]);
  });
});
