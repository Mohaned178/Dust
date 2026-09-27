import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFsFolderStore,
  listStartupEntries,
  resolveStartupFolderPaths,
} from '../src/index';
import type { ShortcutDetails } from '../src/index';
import { FakeRegistryStore } from './startup-fakes';

describe('startup roots across machines', () => {
  it('derives every folder path from the injected environment', () => {
    const alice = {
      APPDATA: 'D:\\Users\\alice\\AppData\\Roaming',
      PROGRAMDATA: 'D:\\ProgramData',
    };

    const paths = resolveStartupFolderPaths(alice);

    expect(paths.user).toBe(
      'D:\\Users\\alice\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup',
    );
    expect(paths.common).toBe('D:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup');
    expect(paths.backup).toBe('D:\\Users\\alice\\AppData\\Roaming\\Dust\\startup-disabled');
    expect(paths.user).not.toContain('pc');
  });

  it('finds a fixture profile for alice without dev-machine literals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dust-startup-'));
    try {
      const env: NodeJS.ProcessEnv = {
        SystemRoot: 'D:\\Windows',
        APPDATA: join(root, 'Users', 'alice', 'AppData', 'Roaming'),
        PROGRAMDATA: join(root, 'ProgramData'),
      };
      const paths = resolveStartupFolderPaths(env);
      mkdirSync(paths.user, { recursive: true });
      mkdirSync(paths.common, { recursive: true });
      const discordPath = join(paths.user, 'Discord.lnk');
      const steamPath = join(paths.user, 'Steam.lnk');
      writeFileSync(discordPath, '');
      writeFileSync(steamPath, '');

      const targets = new Map<string, ShortcutDetails>([
        [discordPath, { target: 'D:\\Apps\\Discord\\Discord.exe', args: '--start' }],
        [steamPath, { target: 'D:\\Games\\Steam\\steam.exe', args: '-silent' }],
      ]);
      const folders = createFsFolderStore({
        env,
        resolveShortcut: async (path) => targets.get(path) ?? null,
      });
      const registry = new FakeRegistryStore({
        run: {
          'hkcu-run': [{ name: 'OneDrive', command: '"D:\\Apps\\OneDrive\\OneDrive.exe" /background' }],
          'hklm-run': [{ name: 'NvBackend', command: '"D:\\Program Files\\NVIDIA\\NvBackend.exe"' }],
        },
      });

      const entries = await listStartupEntries({ registry, folders, windowsDir: env.SystemRoot });

      expect(entries.map((entry) => entry.name).sort()).toEqual(['Discord', 'NvBackend', 'OneDrive', 'Steam']);
      const discord = entries.find((entry) => entry.name === 'Discord');
      expect(discord).toMatchObject({
        source: 'startup-folder-user',
        fileName: 'Discord.lnk',
        command: 'D:\\Apps\\Discord\\Discord.exe --start',
        requiresAdmin: false,
      });
      expect(discord?.command.startsWith(env.APPDATA ?? '')).toBe(false);
      expect(entries.find((entry) => entry.name === 'NvBackend')?.protected).toBe(true);

      const previous = process.env.APPDATA;
      process.env.APPDATA = 'C:\\Definitely\\Wrong';
      try {
        const again = await listStartupEntries({ registry, folders, windowsDir: env.SystemRoot });
        expect(again.map((entry) => entry.name)).toContain('Discord');
      } finally {
        if (previous === undefined) delete process.env.APPDATA;
        else process.env.APPDATA = previous;
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists every entry when a machine has many of them', async () => {
    const run = Array.from({ length: 25 }, (_, index) => ({
      name: `Entry ${index + 1}`,
      command: `D:\\Apps\\app${index}.exe`,
    }));
    const registry = new FakeRegistryStore({ run: { 'hkcu-run': run } });

    const entries = await listStartupEntries({ registry, folders: createFsFolderStore({ env: {} }) });

    expect(entries).toHaveLength(25);
    expect(entries[0]?.name).toBe('Entry 1');
  });
});
