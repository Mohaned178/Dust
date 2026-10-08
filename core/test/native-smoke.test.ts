import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readNativeRegistrySnapshot } from '../src/startup/registry';
import { STARTUP_SOURCES, RUN_SOURCES } from '../src/startup/types';
import { readFileCompanyName, readFileCompanyNames } from '../src/system/file-version';
import { INSTALLED_APPS_QUERY_SCRIPT, parseInstalledApps, readInstalledAppsNative } from '../src/system/installed-apps';
import { listRegistrySubkeys, readRegistryValues } from '../src/system/win-registry';

const onWindows = process.platform === 'win32';
const CURRENT_VERSION = 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n${script}`,
      ],
      { encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

describe('native registry reader (Windows)', () => {
  it.runIf(onWindows)('reads the values of a key', { timeout: 30_000 }, () => {
    const values = readRegistryValues('HKLM', CURRENT_VERSION);

    expect(values).not.toBeNull();
    const build = values!.get('CurrentBuild');
    expect(build?.type).toBe('string');
    expect(build?.value).toMatch(/^\d+$/);
    const revision = values!.get('UBR');
    expect(revision?.type).toBe('dword');
    expect(typeof revision?.value).toBe('number');
  });

  it.runIf(onWindows)('returns null for a missing key', { timeout: 30_000 }, () => {
    expect(readRegistryValues('HKLM', 'SOFTWARE\\Dust\\NoSuchKey-5f1d0c')).toBeNull();
    expect(readRegistryValues('HKCU', 'Software\\Dust\\NoSuchKey-5f1d0c')).toBeNull();
    expect(listRegistrySubkeys('HKLM', 'SOFTWARE\\Dust\\NoSuchKey-5f1d0c')).toBeNull();
  });

  it.runIf(onWindows)('lists the subkeys of a known key', { timeout: 30_000 }, () => {
    const subkeys = listRegistrySubkeys('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion');

    expect(subkeys).not.toBeNull();
    expect(subkeys!.length).toBeGreaterThan(0);
    expect(subkeys).toContain('Uninstall');
  });

  it.runIf(onWindows)('expands environment variables in expand-string values', { timeout: 30_000 }, () => {
    const values = readRegistryValues('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');
    const path = values?.get('Path');
    if (path?.type !== 'expand-string') return;

    if (path.raw === undefined || !path.raw.includes('%SystemRoot%')) return;
    expect(String(path.value)).not.toContain('%SystemRoot%');
  });
});

describe('native file version reader (Windows)', () => {
  it.runIf(onWindows)('reads the company of a system file', { timeout: 30_000 }, () => {
    expect(readFileCompanyName('C:\\Windows\\System32\\kernel32.dll')).toBe('Microsoft Corporation');
  });

  it.runIf(onWindows)('returns null for a missing file', { timeout: 30_000 }, () => {
    expect(readFileCompanyName('C:\\Windows\\System32\\no-such-file-5f1d0c.dll')).toBeNull();
  });

  it.runIf(onWindows)('maps several paths and leaves out the unreadable ones', { timeout: 30_000 }, () => {
    const kernel = 'C:\\Windows\\System32\\kernel32.dll';
    const missing = 'C:\\Windows\\System32\\no-such-file-5f1d0c.dll';

    const names = readFileCompanyNames([kernel, missing]);

    expect(names).not.toBeNull();
    expect([...names!.entries()]).toEqual([[kernel, 'Microsoft Corporation']]);
  });
});

describe('native startup snapshot (Windows)', () => {
  it.runIf(onWindows)('has the shape of a registry snapshot', { timeout: 30_000 }, () => {
    const snapshot = readNativeRegistrySnapshot();

    for (const source of RUN_SOURCES) {
      expect(Array.isArray(snapshot.run[source])).toBe(true);
      for (const value of snapshot.run[source]) {
        expect(typeof value.name).toBe('string');
        expect(typeof value.command).toBe('string');
      }
    }
    for (const backup of snapshot.backups) {
      expect(RUN_SOURCES).toContain(backup.source);
      expect(typeof backup.raw).toBe('string');
    }
    for (const source of STARTUP_SOURCES) {
      expect(Array.isArray(snapshot.windowsDisabled[source])).toBe(true);
      for (const name of snapshot.windowsDisabled[source]) expect(typeof name).toBe('string');
    }
  });
});

describe('native installed apps (Windows)', () => {
  // Spawns PowerShell, so it runs only with the same opt-in as the other smoke tests.
  it.runIf(onWindows && process.env.DUST_SYSTEM_INFO_SMOKE === '1')(
    'match the PowerShell query they replace',
    { timeout: 120_000 },
    async () => {
      const native = readInstalledAppsNative();
      const reference = parseInstalledApps(await runPowerShell(INSTALLED_APPS_QUERY_SCRIPT));

      expect(reference).not.toBeNull();
      expect(native.length).toBeGreaterThan(0);
      const byId = (apps: typeof native) => [...apps].sort((a, b) => a.id.localeCompare(b.id));
      expect(byId(native)).toEqual(byId(reference!));
    },
  );
});
