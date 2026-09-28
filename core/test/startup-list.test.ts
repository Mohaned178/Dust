import { describe, expect, it } from 'vitest';
import { entryId, listStartupEntries } from '../src/index';
import type { StartupBackupEnvelope } from '../src/index';
import { FakeFolderStore, FakeRegistryStore, makeStore } from './startup-fakes';

const discordCommand = '"C:\\Apps\\Discord\\Update.exe" --processStart Discord.exe';
const steamCommand = '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent';

describe('listStartupEntries', () => {
  it('reads Run values from every hive as entries', async () => {
    const registry = new FakeRegistryStore({
      run: {
        'hkcu-run': [{ name: 'Discord', command: discordCommand }],
        'hklm-run': [{ name: 'Steam', command: steamCommand }],
        'hklm-run-wow64': [{ name: 'Legacy', command: 'C:\\Legacy\\app.exe' }],
      },
    });

    const entries = await listStartupEntries(makeStore({ registry }));

    expect(entries.map((entry) => entry.name).sort()).toEqual(['Discord', 'Legacy', 'Steam']);
    const discord = entries.find((entry) => entry.name === 'Discord');
    expect(discord).toMatchObject({
      id: entryId('hkcu-run', 'Discord'),
      command: discordCommand,
      source: 'hkcu-run',
      state: 'enabled',
      disabledKind: null,
      protected: false,
      requiresAdmin: false,
      fileName: null,
    });
    expect(entries.find((entry) => entry.name === 'Steam')?.requiresAdmin).toBe(true);
    expect(entries.find((entry) => entry.name === 'Legacy')?.source).toBe('hklm-run-wow64');
  });

  it('reads .lnk files from both startup folders', async () => {
    const folders = new FakeFolderStore({
      shortcuts: {
        'startup-folder-user': [{ fileName: 'Slack.lnk', name: 'Slack', command: '"C:\\Apps\\Slack\\slack.exe"' }],
        'startup-folder-common': [
          { fileName: 'Teams.lnk', name: 'Teams', command: '"C:\\Program Files\\Teams\\teams.exe"' },
        ],
      },
    });

    const entries = await listStartupEntries(makeStore({ folders }));

    expect(entries.map((entry) => entry.name).sort()).toEqual(['Slack', 'Teams']);
    const slack = entries.find((entry) => entry.name === 'Slack');
    expect(slack).toMatchObject({
      source: 'startup-folder-user',
      fileName: 'Slack.lnk',
      requiresAdmin: false,
    });
    expect(entries.find((entry) => entry.name === 'Teams')?.requiresAdmin).toBe(true);
  });

  it('lists Dust backups as disabled entries', async () => {
    const envelope: StartupBackupEnvelope = {
      v: 1,
      id: entryId('hkcu-run', 'Discord'),
      name: 'Discord',
      command: discordCommand,
      source: 'hkcu-run',
      disabledAt: Date.UTC(2026, 0, 4),
    };
    const registry = new FakeRegistryStore({ backups: [{ source: 'hkcu-run', envelope }] });
    const folderEnvelope: StartupBackupEnvelope = {
      v: 1,
      id: entryId('startup-folder-user', 'Slack'),
      name: 'Slack',
      command: '"C:\\Apps\\Slack\\slack.exe"',
      source: 'startup-folder-user',
      disabledAt: Date.UTC(2026, 0, 4),
      fileName: 'Slack.lnk',
    };
    const folders = new FakeFolderStore({ backups: [folderEnvelope] });

    const entries = await listStartupEntries(makeStore({ registry, folders }));

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.state).toBe('disabled');
      expect(entry.disabledKind).toBe('dust');
      expect(entry.disabledAt).toBe(Date.UTC(2026, 0, 4));
    }
    expect(entries.find((entry) => entry.name === 'Slack')?.fileName).toBe('Slack.lnk');
  });

  it('treats a live entry as enabled and hides its stale backup', async () => {
    const id = entryId('hkcu-run', 'Discord');
    const registry = new FakeRegistryStore({
      run: { 'hkcu-run': [{ name: 'Discord', command: discordCommand }] },
      backups: [
        {
          source: 'hkcu-run',
          envelope: {
            v: 1,
            id,
            name: 'Discord',
            command: 'C:\\Old\\discord.exe',
            source: 'hkcu-run',
            disabledAt: Date.UTC(2026, 0, 1),
          },
        },
      ],
    });

    const entries = await listStartupEntries(makeStore({ registry }));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id, state: 'enabled', disabledKind: null });
  });

  it('reports Windows-disabled entries as disabled windows entries', async () => {
    const registry = new FakeRegistryStore({
      run: {
        'hkcu-run': [{ name: 'OneDrive', command: '"C:\\Apps\\OneDrive.exe" /background' }],
      },
      windowsDisabled: { 'hkcu-run': ['OneDrive'] },
    });

    const entries = await listStartupEntries(makeStore({ registry }));

    expect(entries[0]).toMatchObject({
      name: 'OneDrive',
      state: 'disabled',
      disabledKind: 'windows',
      disabledAt: null,
      windowsDisabledName: 'OneDrive',
    });
  });

  it('tracks the approval value name that matched a startup-folder shortcut', async () => {
    const folders = new FakeFolderStore({
      shortcuts: {
        'startup-folder-user': [{ fileName: 'Slack.lnk', name: 'Slack', command: 'slack.exe' }],
      },
    });
    const registry = new FakeRegistryStore({
      windowsDisabled: { 'startup-folder-user': ['Slack'] },
    });

    const entries = await listStartupEntries(makeStore({ registry, folders }));

    expect(entries[0]).toMatchObject({
      name: 'Slack',
      state: 'disabled',
      disabledKind: 'windows',
      windowsDisabledName: 'Slack',
    });
  });

  it('exposes no impact field on the entry record', async () => {
    const registry = new FakeRegistryStore({
      run: { 'hkcu-run': [{ name: 'Discord', command: discordCommand }] },
    });

    const entries = await listStartupEntries(makeStore({ registry }));

    expect(Object.keys(entries[0]).some((key) => /impact/i.test(key))).toBe(false);
    expect(JSON.stringify(entries)).not.toMatch(/impact/i);
  });
});
