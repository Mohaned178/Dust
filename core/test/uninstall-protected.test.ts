import { describe, expect, it } from 'vitest';
import { isProtectedApp, protectedAppReason } from '../src/uninstall/protected';
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

  it('protects by publisher signature', () => {
    expect(reason({ displayName: 'Edge', publisher: 'Microsoft Corporation' })).toBe('protected-publisher');
    expect(reason({ displayName: 'GeForce Experience', publisher: 'NVIDIA Corporation' })).toBe('protected-publisher');
    expect(reason({ displayName: 'AMD Software', publisher: 'Advanced Micro Devices, Inc.' })).toBe(
      'protected-publisher',
    );
    expect(reason({ displayName: 'Graphics Command Center', publisher: 'Intel Corporation' })).toBe(
      'protected-publisher',
    );
    expect(reason({ displayName: 'Audio Console', publisher: 'Realtek Semiconductor Corp.' })).toBe(
      'protected-publisher',
    );
    expect(reason({ displayName: 'Endpoint Agent', publisher: 'CrowdStrike, Inc.' })).toBe('protected-publisher');
  });

  it('protects known runtime and security products by name', () => {
    expect(
      reason({
        displayName: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)',
        publisher: 'Microsoft Corporation',
      }),
    ).toBe('protected-publisher');
    expect(reason({ displayName: 'Windows Defender', publisher: 'Microsoft Corporation' })).toBe('protected-publisher');
    expect(reason({ displayName: 'Contoso Redistributable', publisher: 'Contoso Ltd' })).toBe('protected-product');
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
    expect(isProtectedApp(makeInstalledApp({ displayName: 'Edge', publisher: 'Microsoft Corporation' }), ENV)).toBe(
      true,
    );
  });
});
