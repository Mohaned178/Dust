import { describe, expect, it } from 'vitest';
import {
  disableStartupEntry,
  enableStartupEntry,
  entryId,
  listStartupEntries,
  parseBackupEnvelope,
  removeStartupBackup,
} from '../src/index';
import type { StartupBackupEnvelope } from '../src/index';
import { FakeFolderStore, FakeRegistryStore, makeStore } from './startup-fakes';

const command = '"C:\\Apps\\Discord\\Update.exe" --processStart Discord.exe';

describe('disableStartupEntry', () => {
  it('writes the backup before removing the Run value', async () => {
    const id = entryId('hkcu-run', 'Discord');
    const registry = new FakeRegistryStore({ run: { 'hkcu-run': [{ name: 'Discord', command }] } });

    const result = await disableStartupEntry(id, makeStore({ registry }));

    expect(result.ok).toBe(true);
    expect(registry.run['hkcu-run']).toEqual([]);
    expect(registry.backups).toHaveLength(1);
    const envelope = parseBackupEnvelope(registry.backups[0].raw);
    expect(envelope).toMatchObject({
      v: 1,
      id,
      name: 'Discord',
      command,
      source: 'hkcu-run',
      disabledAt: Date.UTC(2026, 0, 5),
    });
    const writeAt = registry.calls.indexOf(`writeBackup:hkcu-run:${id}`);
    const deleteAt = registry.calls.indexOf('deleteRun:hkcu-run:Discord');
    expect(writeAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(writeAt);
    if (result.ok) {
      expect(result.entries.find((entry) => entry.id === id)).toMatchObject({
        state: 'disabled',
        disabledKind: 'dust',
      });
    }
  });

  it('moves a startup-folder shortcut into the backup folder', async () => {
    const id = entryId('startup-folder-user', 'Slack');
    const folders = new FakeFolderStore({
      shortcuts: { 'startup-folder-user': [{ fileName: 'Slack.lnk', name: 'Slack', command: 'slack.exe' }] },
    });

    const result = await disableStartupEntry(id, makeStore({ folders }));

    expect(result.ok).toBe(true);
    expect(folders.shortcuts['startup-folder-user']).toEqual([]);
    expect(folders.backups).toHaveLength(1);
    expect(folders.backups[0]).toMatchObject({ id, name: 'Slack', fileName: 'Slack.lnk' });
    expect(folders.calls).toContain(`moveToBackup:startup-folder-user:Slack.lnk`);
  });

  it('leaves the entry untouched when the backup write fails', async () => {
    const id = entryId('hkcu-run', 'Discord');
    const registry = new FakeRegistryStore({ run: { 'hkcu-run': [{ name: 'Discord', command }] } });
    registry.failNextWrite = true;

    const result = await disableStartupEntry(id, makeStore({ registry }));

    expect(result).toEqual({ ok: false, reason: 'failed', message: "Couldn't change this startup entry." });
    expect(registry.run['hkcu-run']).toHaveLength(1);
    expect(registry.backups).toHaveLength(0);
  });

  it('reports needs-admin when a machine-wide write is denied', async () => {
    const id = entryId('hklm-run', 'Steam');
    const registry = new FakeRegistryStore({ run: { 'hklm-run': [{ name: 'Steam', command: 'steam.exe' }] } });
    registry.failNextWrite = true;

    const result = await disableStartupEntry(id, makeStore({ registry }));

    expect(result).toEqual({
      ok: false,
      reason: 'needs-admin',
      message: 'Dust needs administrator rights to change this entry.',
    });
  });

  it('refuses protected and Windows-disabled entries without writing', async () => {
    const protectedId = entryId('hkcu-run', 'SecurityHealth');
    const protectedRegistry = new FakeRegistryStore({
      run: { 'hkcu-run': [{ name: 'SecurityHealth', command: '"C:\\Windows\\System32\\SecurityHealthSystray.exe"' }] },
    });
    const protectedResult = await disableStartupEntry(
      protectedId,
      makeStore({ registry: protectedRegistry, windowsDir: 'C:\\Windows' }),
    );
    expect(protectedResult.ok).toBe(false);
    if (!protectedResult.ok) expect(protectedResult.reason).toBe('protected');
    expect(protectedRegistry.calls.some((call) => call.startsWith('write'))).toBe(false);

    const windowsId = entryId('hkcu-run', 'OneDrive');
    const windowsRegistry = new FakeRegistryStore({
      run: { 'hkcu-run': [{ name: 'OneDrive', command: 'onedrive.exe' }] },
      windowsDisabled: { 'hkcu-run': ['OneDrive'] },
    });
    const windowsResult = await disableStartupEntry(windowsId, makeStore({ registry: windowsRegistry }));
    expect(windowsResult.ok).toBe(false);
    if (!windowsResult.ok) expect(windowsResult.reason).toBe('windows-disabled');
    expect(windowsRegistry.run['hkcu-run']).toHaveLength(1);
    expect(windowsRegistry.backups).toHaveLength(0);
  });

  it('returns not-found for an unknown id', async () => {
    const result = await disableStartupEntry('deadbeefdeadbeef', makeStore({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

describe('enableStartupEntry', () => {
  const envelope: StartupBackupEnvelope = {
    v: 1,
    id: entryId('hkcu-run', 'Discord'),
    name: 'Discord',
    command,
    source: 'hkcu-run',
    disabledAt: Date.UTC(2026, 0, 4),
  };

  it('restores the Run value and clears the backup', async () => {
    const registry = new FakeRegistryStore({ backups: [{ source: 'hkcu-run', envelope }] });

    const result = await enableStartupEntry(envelope.id, makeStore({ registry }));

    expect(result.ok).toBe(true);
    expect(registry.run['hkcu-run']).toEqual([{ name: 'Discord', command }]);
    expect(registry.backups).toHaveLength(0);
    const writeAt = registry.calls.indexOf('writeRun:hkcu-run:Discord');
    const deleteAt = registry.calls.indexOf(`deleteBackup:hkcu-run:${envelope.id}`);
    expect(writeAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(writeAt);
    if (result.ok) {
      expect(result.entries.find((entry) => entry.id === envelope.id)).toMatchObject({
        state: 'enabled',
        disabledKind: null,
      });
    }
  });

  it('restores a startup-folder shortcut from the backup folder', async () => {
    const folderEnvelope: StartupBackupEnvelope = {
      v: 1,
      id: entryId('startup-folder-user', 'Slack'),
      name: 'Slack',
      command: 'slack.exe',
      source: 'startup-folder-user',
      disabledAt: Date.UTC(2026, 0, 4),
      fileName: 'Slack.lnk',
    };
    const folders = new FakeFolderStore({ backups: [folderEnvelope] });

    const result = await enableStartupEntry(folderEnvelope.id, makeStore({ folders }));

    expect(result.ok).toBe(true);
    expect(folders.shortcuts['startup-folder-user']).toEqual([
      { fileName: 'Slack.lnk', name: 'Slack', command: 'slack.exe' },
    ]);
    expect(folders.backups).toHaveLength(0);
  });

  it('refuses to overwrite an entry re-added by another app', async () => {
    const registry = new FakeRegistryStore({
      run: { 'hkcu-run': [{ name: 'Discord', command: 'C:\\New\\discord.exe' }] },
      backups: [{ source: 'hkcu-run', envelope }],
    });

    const result = await enableStartupEntry(envelope.id, makeStore({ registry }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('conflict');
    expect(registry.run['hkcu-run'][0]?.command).toBe('C:\\New\\discord.exe');
  });

  it('enables a Windows-disabled entry by writing the approval value', async () => {
    const windowsId = entryId('hkcu-run', 'OneDrive');
    const registry = new FakeRegistryStore({
      run: { 'hkcu-run': [{ name: 'OneDrive', command: 'onedrive.exe' }] },
      windowsDisabled: { 'hkcu-run': ['OneDrive'] },
    });

    const result = await enableStartupEntry(windowsId, makeStore({ registry }));

    expect(result.ok).toBe(true);
    expect(registry.calls).toContain('writeApprovedEnabled:hkcu-run:OneDrive');
    expect(registry.run['hkcu-run']).toEqual([{ name: 'OneDrive', command: 'onedrive.exe' }]);
    expect(registry.backups).toHaveLength(0);
    expect(registry.windowsDisabled['hkcu-run']).toEqual([]);
    if (result.ok) {
      expect(result.entries.find((entry) => entry.id === windowsId)).toMatchObject({
        state: 'enabled',
        disabledKind: null,
        windowsDisabledName: null,
      });
    }
  });

  it('enables a Windows-disabled shortcut by its approval value name', async () => {
    const id = entryId('startup-folder-user', 'Slack');
    const registry = new FakeRegistryStore({
      windowsDisabled: { 'startup-folder-user': ['Slack.lnk'] },
    });
    const folders = new FakeFolderStore({
      shortcuts: { 'startup-folder-user': [{ fileName: 'Slack.lnk', name: 'Slack', command: 'slack.exe' }] },
    });

    const result = await enableStartupEntry(id, makeStore({ registry, folders }));

    expect(result.ok).toBe(true);
    expect(registry.calls).toContain('writeApprovedEnabled:startup-folder-user:Slack.lnk');
    expect(registry.backups).toHaveLength(0);
    expect(folders.calls.some((call) => call.startsWith('moveToBackup'))).toBe(false);
    expect(folders.calls.some((call) => call.startsWith('restore'))).toBe(false);
  });

  it('reports failure when the approval write is denied and leaves the entry disabled', async () => {
    const windowsId = entryId('hkcu-run', 'OneDrive');
    const registry = new FakeRegistryStore({
      run: { 'hkcu-run': [{ name: 'OneDrive', command: 'onedrive.exe' }] },
      windowsDisabled: { 'hkcu-run': ['OneDrive'] },
    });
    registry.failNextWrite = true;

    const result = await enableStartupEntry(windowsId, makeStore({ registry }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');
    expect(registry.windowsDisabled['hkcu-run']).toEqual(['OneDrive']);
  });
});

describe('list after toggles', () => {
  it('reports the toggle through a fresh list', async () => {
    const registry = new FakeRegistryStore({ run: { 'hkcu-run': [{ name: 'Discord', command }] } });
    const store = makeStore({ registry });
    const id = entryId('hkcu-run', 'Discord');

    await disableStartupEntry(id, store);
    expect((await listStartupEntries(store))[0]?.state).toBe('disabled');

    await enableStartupEntry(id, store);
    expect((await listStartupEntries(store))[0]?.state).toBe('enabled');
  });
});

describe('removeStartupBackup', () => {
  it('purges a Dust backup for a disabled Run entry', async () => {
    const id = entryId('hkcu-run', 'Discord');
    const registry = new FakeRegistryStore({
      run: {},
      backups: [
        { source: 'hkcu-run', envelope: { v: 1, id, name: 'Discord', command, source: 'hkcu-run', disabledAt: 5 } },
      ],
    });

    const result = await removeStartupBackup(id, makeStore({ registry }));

    expect(result.ok).toBe(true);
    expect(registry.backups).toHaveLength(0);
    expect(registry.calls).toContain(`deleteBackup:hkcu-run:${id}`);
  });

  it('purges folder envelopes', async () => {
    const id = entryId('startup-folder-user', 'Slack');
    const folders = new FakeFolderStore({
      backups: [
        {
          v: 1,
          id,
          name: 'Slack',
          command: 'slack.exe',
          source: 'startup-folder-user',
          disabledAt: 5,
          fileName: 'Slack.lnk',
        },
      ],
    });

    const result = await removeStartupBackup(id, makeStore({ folders }));

    expect(result.ok).toBe(true);
    expect(folders.backups).toHaveLength(0);
    expect(folders.calls).toContain(`deleteBackup:${id}`);
  });

  it('refuses entries that are not managed by Dust', async () => {
    const id = entryId('hkcu-run', 'Discord');
    const registry = new FakeRegistryStore({ run: { 'hkcu-run': [{ name: 'Discord', command }] } });

    const result = await removeStartupBackup(id, makeStore({ registry }));

    expect(result).toEqual({
      ok: false,
      reason: 'conflict',
      message: 'This entry is not managed by Dust.',
    });
  });

  it('reports not-found for unknown ids', async () => {
    const result = await removeStartupBackup(entryId('hkcu-run', 'Ghost'), makeStore({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});
