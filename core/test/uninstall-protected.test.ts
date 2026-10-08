import { describe, expect, it } from 'vitest';
import { appCaution, isProtectedApp, protectedAppReason } from '../src/uninstall/protected';
import { makeInstalledApp } from './installed-app-fixtures';

const ENV = {
  systemRoot: 'C:\\Windows',
  programFiles: ['C:\\Program Files', 'C:\\Program Files (x86)'],
  dustInstallPath: 'C:\\Users\\Ahmed\\AppData\\Local\\Programs\\Dust',
};

function reason(overrides: Parameters<typeof makeInstalledApp>[0]): string | null {
  return protectedAppReason(makeInstalledApp(overrides), ENV);
}

describe('protectedAppReason', () => {
  it('protects Dust itself by install location', () => {
    expect(
      reason({
        displayName: 'Dust',
        installLocation: 'C:\\Users\\Ahmed\\AppData\\Local\\Programs\\Dust',
      }),
    ).toBe('dust-app');
  });

  it('protects anything installed under the Windows directory', () => {
    expect(reason({ displayName: 'Platform Helper', installLocation: 'C:\\Windows\\System32\\DriverStore' })).toBe(
      'system-location',
    );
  });

  it('protects apps under system-managed program files locations', () => {
    expect(
      reason({
        displayName: 'Store App',
        installLocation: 'C:\\Program Files\\WindowsApps\\Contoso.App_1.0',
      }),
    ).toBe('protected-location');
    expect(
      reason({
        displayName: 'Defender Platform',
        installLocation: 'C:\\Program Files\\Windows Defender',
      }),
    ).toBe('protected-location');
  });

  it('does not treat a prefix-sharing sibling as inside the Windows directory', () => {
    expect(
      reason({ displayName: 'Third Party', publisher: 'Third Party Ltd', installLocation: 'C:\\WindowsApps\\Third' }),
    ).toBeNull();
  });

  it('lists software from system vendors instead of hiding it', () => {
    expect(reason({ displayName: 'Microsoft Visual Studio Code', publisher: 'Microsoft Corporation' })).toBeNull();
    expect(reason({ displayName: 'NVIDIA App', publisher: 'NVIDIA Corporation' })).toBeNull();
    expect(reason({ displayName: 'Bitdefender Antivirus Free', publisher: 'Bitdefender' })).toBeNull();
    expect(
      reason({
        displayName: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)',
        publisher: 'Microsoft Corporation',
      }),
    ).toBeNull();
  });

  it('hides Windows itself and Windows updates', () => {
    expect(reason({ displayName: 'Windows Defender', publisher: 'Microsoft Corporation' })).toBe('protected-product');
    expect(
      reason({ displayName: 'Update for Windows 10 for x64-based Systems (KB5001716)', publisher: 'Microsoft' }),
    ).toBe('windows-update');
    expect(reason({ displayName: 'Security Update for Windows (KB4023057)', publisher: 'Microsoft' })).toBe(
      'windows-update',
    );
  });

  it('leaves ordinary applications alone', () => {
    expect(reason({ displayName: 'Spotify', publisher: 'Spotify AB' })).toBeNull();
    expect(reason({ displayName: 'Discord', publisher: 'Discord Inc.' })).toBeNull();
    expect(reason({ displayName: 'Google Chrome', publisher: 'Google LLC' })).toBeNull();
    expect(reason({ displayName: 'Steam', publisher: 'Valve Corporation' })).toBeNull();
    expect(reason({ displayName: 'OBS Studio', publisher: 'OBS Project' })).toBeNull();
    expect(reason({ displayName: 'Git', publisher: 'The Git Development Community' })).toBeNull();
    expect(reason({ displayName: '7-Zip', publisher: 'Igor Pavlov' })).toBeNull();
    expect(reason({ displayName: 'Slack', publisher: 'Slack Technologies, LLC' })).toBeNull();
  });

  it('does not over-match publisher substrings', () => {
    expect(reason({ displayName: 'Notepad++', publisher: 'Intelligent Systems GmbH' })).toBeNull();
    expect(reason({ displayName: 'Amdek Viewer', publisher: 'Amdek Systems' })).toBeNull();
  });
});

describe('isProtectedApp', () => {
  it('is the boolean wrapper', () => {
    expect(isProtectedApp(makeInstalledApp({ displayName: 'Spotify', publisher: 'Spotify AB' }), ENV)).toBe(false);
    expect(isProtectedApp(makeInstalledApp({ displayName: 'Dust', installLocation: ENV.dustInstallPath }), ENV)).toBe(
      true,
    );
  });
});

describe('appCaution', () => {
  const caution = (overrides: Parameters<typeof makeInstalledApp>[0]) => appCaution(makeInstalledApp(overrides));

  it('flags software whose removal can affect hardware, security, or other apps', () => {
    expect(caution({ displayName: 'PowerShell 7', publisher: 'Microsoft Corporation' })).toBeNull();
    expect(
      caution({ displayName: 'Microsoft ODBC Driver 18 for SQL Server', publisher: 'Microsoft Corporation' }),
    ).toBeNull();
    expect(caution({ displayName: 'NVIDIA App', publisher: 'NVIDIA Corporation' })).toBe('hardware');
    expect(caution({ displayName: 'AMD Chipset Software', publisher: 'Advanced Micro Devices, Inc.' })).toBe(
      'hardware',
    );
    expect(caution({ displayName: 'Contoso Ethernet Driver', publisher: 'Contoso' })).toBe('hardware');
    expect(caution({ displayName: 'Endpoint Agent', publisher: 'CrowdStrike, Inc.' })).toBe('security');
    expect(
      caution({ displayName: 'Microsoft Visual C++ 2013 Redistributable (x64)', publisher: 'Microsoft Corporation' }),
    ).toBe('runtime');
    expect(caution({ displayName: 'Microsoft Windows Desktop Runtime - 9.0.20', publisher: 'Microsoft' })).toBe(
      'runtime',
    );
  });

  it('leaves ordinary applications alone', () => {
    expect(caution({ displayName: 'Discord', publisher: 'Discord Inc.' })).toBeNull();
    expect(caution({ displayName: 'Notepad++', publisher: 'Intelligent Systems GmbH' })).toBeNull();
    expect(caution({ displayName: 'VLC media player', publisher: 'VideoLAN' })).toBeNull();
  });
});
