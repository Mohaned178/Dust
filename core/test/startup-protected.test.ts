import { describe, expect, it } from 'vitest';
import { isProtectedStartupEntry } from '../src/index';

describe('isProtectedStartupEntry', () => {
  it('protects Windows security entries', () => {
    expect(
      isProtectedStartupEntry({
        name: 'SecurityHealth',
        command: '"C:\\Windows\\System32\\SecurityHealthSystray.exe"',
      }),
    ).toBe(true);
    expect(isProtectedStartupEntry({ name: 'Windows Defender', command: 'mpcmdrun.exe' })).toBe(true);
  });

  it('protects GPU and audio driver helpers', () => {
    expect(isProtectedStartupEntry({ name: 'NvBackend', command: '"C:\\Program Files\\NVIDIA\\NvBackend.exe"' })).toBe(
      true,
    );
    expect(isProtectedStartupEntry({ name: 'RTHDVCPL', command: 'RTHDVCPL.exe' })).toBe(true);
    expect(isProtectedStartupEntry({ name: 'igfxTray', command: 'igfxtray.exe' })).toBe(true);
  });

  it('protects commands that resolve under System32', () => {
    expect(
      isProtectedStartupEntry({
        name: 'Some Entry',
        command: '"C:\\Windows\\System32\\custom\\helper.exe" -quiet',
        windowsDir: 'C:\\Windows',
      }),
    ).toBe(true);
    expect(
      isProtectedStartupEntry({
        name: 'Some Entry',
        command: '"C:\\Apps\\custom\\helper.exe"',
        windowsDir: 'C:\\Windows',
      }),
    ).toBe(false);
  });

  it('leaves ordinary apps unprotected', () => {
    expect(
      isProtectedStartupEntry({
        name: 'Discord',
        command: '"C:\\Users\\user\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe',
        windowsDir: 'C:\\Windows',
      }),
    ).toBe(false);
    expect(isProtectedStartupEntry({ name: 'Steam', command: '"C:\\Program Files (x86)\\Steam\\steam.exe"' })).toBe(
      false,
    );
    expect(isProtectedStartupEntry({ name: 'Slack', command: 'slack.exe' })).toBe(false);
  });
});
