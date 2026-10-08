import { describe, expect, it } from 'vitest';
import { dedupeApps } from '../src/uninstall/apps';
import { appIdentity, cleanDisplayName, matchIdentity } from '../src/uninstall/identity';
import { resolveUninstallerCommand } from '../src/uninstall/plan';
import { ProcessTreeTracker } from '../src/uninstall/process-tree';
import { makeInstalledApp } from './installed-app-fixtures';

describe('cleanDisplayName', () => {
  it('drops architecture, version, and locale decorations', () => {
    expect(cleanDisplayName('Python 3.14.3 (64-bit)')).toBe('Python 3.14.3');
    expect(cleanDisplayName('Microsoft Visual C++ 2013 Redistributable (x86) - 12.0.40664')).toBe(
      'Microsoft Visual C++ 2013 Redistributable',
    );
    expect(cleanDisplayName('Microsoft Office LTSC Professional Plus 2024 - en-us')).toBe(
      'Microsoft Office LTSC Professional Plus 2024',
    );
    expect(cleanDisplayName('The Last of Us - Part II')).toBe('The Last of Us - Part II');
  });
});

describe('appIdentity', () => {
  it('derives product, program-file, and vendor keys', () => {
    const identity = appIdentity(
      makeInstalledApp({
        displayName: 'Microsoft Visual Studio Code (User)',
        publisher: 'Microsoft Corporation',
        installLocation: 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code',
        displayIcon: 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      }),
    );
    expect(identity.product).toEqual(
      expect.arrayContaining(['microsoftvisualstudiocode', 'visualstudiocode', 'microsoftvscode']),
    );
    expect(identity.exe).toEqual(['code']);
    expect(identity.vendor).toContain('microsoft');
  });

  it('uses the parent of a generic install leaf and the vendor folder above it', () => {
    const identity = appIdentity(
      makeInstalledApp({
        displayName: 'Google Chrome',
        publisher: 'Google LLC',
        installLocation: 'C:\\Program Files\\Google\\Chrome\\Application',
      }),
    );
    expect(identity.product).toEqual(expect.arrayContaining(['googlechrome', 'chrome']));
    expect(identity.vendor).toContain('google');
  });

  it('never yields generic keys', () => {
    const identity = appIdentity(makeInstalledApp({ displayName: 'Update Service', publisher: 'Windows' }));
    expect(identity.product).not.toContain('update');
    expect(identity.product).not.toContain('service');
  });
});

describe('matchIdentity', () => {
  const python = appIdentity(makeInstalledApp({ displayName: 'Python 3.14.3 (64-bit)', publisher: 'PSF' }));

  it('matches exact names and trailing versions only', () => {
    expect(matchIdentity('Python', python)).toBe('product');
    expect(matchIdentity('Python314', python)).toBe('product');
    expect(matchIdentity('Python Tools', python)).toBeNull();
    expect(matchIdentity('MyPython', python)).toBeNull();
  });

  it('separates vendor matches from product matches', () => {
    const riot = appIdentity(makeInstalledApp({ displayName: 'Riot Client', publisher: 'Riot Games, Inc' }));
    expect(matchIdentity('Riot Client', riot)).toBe('product');
    expect(matchIdentity('Riot Games', riot)).toBe('vendor');
    expect(matchIdentity('League of Legends', riot)).toBeNull();
  });
});

describe('dedupeApps', () => {
  it('keeps one entry per name and version, preferring an uninstallable one', () => {
    const bare = makeInstalledApp({ displayName: 'Tool', version: '1.0', keyName: '{a}', uninstallString: '' });
    const full = makeInstalledApp({
      displayName: 'Tool',
      version: '1.0',
      keyName: '{b}',
      uninstallString: 'C:\\Tool\\uninst.exe',
    });
    const other = makeInstalledApp({ displayName: 'Tool', version: '2.0', keyName: '{c}' });
    expect(dedupeApps([bare, full, other]).map((app) => app.keyName)).toEqual(['{b}', '{c}']);
  });
});

describe('resolveUninstallerCommand', () => {
  it('turns an MSI install/repair command into an uninstall', () => {
    const app = makeInstalledApp({
      displayName: 'Node.js',
      uninstallString: 'MsiExec.exe /I{11111111-2222-3333-4444-555555555555}',
    });
    const command = resolveUninstallerCommand(app, {
      roots: { localAppData: '', appData: '', localLow: '', programData: '', temp: '' },
    });
    expect(command.args).toEqual(['/x', '{11111111-2222-3333-4444-555555555555}']);
  });
});

describe('ProcessTreeTracker', () => {
  it('follows a relaunch hand-off after the original process exits', () => {
    const tracker = new ProcessTreeTracker(100);
    expect(tracker.update([{ pid: 100, ppid: 1, name: 'uninst.exe' }])).toBe(true);
    // The uninstaller started its temp copy and exited.
    expect(tracker.update([{ pid: 200, ppid: 100, name: 'Au_.exe' }])).toBe(true);
    expect(tracker.update([{ pid: 300, ppid: 1, name: 'other.exe' }])).toBe(false);
  });

  it('ignores a browser opened at the end and reused process ids', () => {
    const tracker = new ProcessTreeTracker(100);
    tracker.update([{ pid: 100, ppid: 1, name: 'uninst.exe' }]);
    expect(tracker.update([{ pid: 150, ppid: 100, name: 'chrome.exe' }])).toBe(false);
    // PID 100 reappears as an unrelated process after the uninstaller exited.
    expect(tracker.update([{ pid: 100, ppid: 4, name: 'svchost.exe' }])).toBe(false);
  });
});
