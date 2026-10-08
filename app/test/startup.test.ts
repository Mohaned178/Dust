import { describe, expect, it, vi } from 'vitest';
import type {
  FolderSnapshot,
  FolderSource,
  FolderStore,
  RegistrySnapshot,
  RegistryStore,
  RunSource,
  RunValue,
  StartupBackupEnvelope,
  StartupShortcut,
  StartupSource,
  StartupStore,
} from '@dust/core';
import { encodeBackupEnvelope, entryId, parseBackupEnvelope } from '@dust/core';
import type { EngineHost } from '../src/main/host/engine-host';
import { createStartupService, executableFromCommand } from '../src/main/host/startup';
import { applyPendingStartupToggle, parsePendingStartupToggle } from '../src/main/startup-launch';
import type { StartupDetailsEvent, StartupEntry } from '../src/shared/ipc';

function emptyRun(): Record<RunSource, RunValue[]> {
  return { 'hkcu-run': [], 'hklm-run': [], 'hklm-run-wow64': [] };
}

function emptyWindowsDisabled(): Record<StartupSource, string[]> {
  return {
    'hkcu-run': [],
    'hklm-run': [],
    'hklm-run-wow64': [],
    'startup-folder-user': [],
    'startup-folder-common': [],
  };
}

class MemoryRegistry implements RegistryStore {
  run: Record<RunSource, RunValue[]> = emptyRun();
  backups: Array<{ source: RunSource; raw: string }> = [];
  windowsDisabled: Record<StartupSource, string[]> = emptyWindowsDisabled();

  async readSnapshot(): Promise<RegistrySnapshot> {
    return {
      run: JSON.parse(JSON.stringify(this.run)) as Record<RunSource, RunValue[]>,
      backups: [...this.backups],
      windowsDisabled: JSON.parse(JSON.stringify(this.windowsDisabled)) as Record<StartupSource, string[]>,
    };
  }

  async readRunValue(source: RunSource, name: string): Promise<string | null> {
    return this.run[source].find((value) => value.name === name)?.command ?? null;
  }

  async writeRunValue(source: RunSource, name: string, command: string): Promise<void> {
    const existing = this.run[source].find((value) => value.name === name);
    if (existing) existing.command = command;
    else this.run[source].push({ name, command });
  }

  async deleteRunValue(source: RunSource, name: string): Promise<void> {
    this.run[source] = this.run[source].filter((value) => value.name !== name);
  }

  async readBackupValue(source: RunSource, id: string): Promise<string | null> {
    return (
      this.backups.find((entry) => entry.source === source && parseBackupEnvelope(entry.raw)?.id === id)?.raw ?? null
    );
  }

  async writeBackupValue(source: RunSource, id: string, raw: string): Promise<void> {
    this.backups.push({ source, raw });
  }

  async deleteBackupValue(source: RunSource, id: string): Promise<void> {
    this.backups = this.backups.filter(
      (entry) => !(entry.source === source && parseBackupEnvelope(entry.raw)?.id === id),
    );
  }

  async writeApprovedEnabled(source: StartupSource, name: string): Promise<void> {
    this.windowsDisabled[source] = this.windowsDisabled[source].filter(
      (entry) => entry.toLowerCase() !== name.toLowerCase(),
    );
  }
}

class MemoryFolders implements FolderStore {
  shortcuts: Record<FolderSource, StartupShortcut[]> = {
    'startup-folder-user': [],
    'startup-folder-common': [],
  };
  backups: StartupBackupEnvelope[] = [];

  async readSnapshot(): Promise<FolderSnapshot> {
    return {
      shortcuts: JSON.parse(JSON.stringify(this.shortcuts)) as Record<FolderSource, StartupShortcut[]>,
      backups: this.backups.map((envelope) => encodeBackupEnvelope(envelope)),
    };
  }

  async readShortcut(source: FolderSource, fileName: string): Promise<StartupShortcut | null> {
    return this.shortcuts[source].find((shortcut) => shortcut.fileName === fileName) ?? null;
  }

  async moveToBackup(source: FolderSource, shortcut: StartupShortcut, envelope: StartupBackupEnvelope): Promise<void> {
    this.shortcuts[source] = this.shortcuts[source].filter((entry) => entry.fileName !== shortcut.fileName);
    this.backups.push(envelope);
  }

  async restoreFromBackup(envelope: StartupBackupEnvelope): Promise<void> {
    this.backups = this.backups.filter((entry) => entry.id !== envelope.id);
    const source = envelope.source as FolderSource;
    this.shortcuts[source].push({
      fileName: envelope.fileName ?? `${envelope.name}.lnk`,
      name: envelope.name,
      command: envelope.command,
    });
  }

  async deleteBackup(id: string): Promise<void> {
    this.backups = this.backups.filter((entry) => entry.id !== id);
  }
}

const discordCommand = '"C:\\Apps\\Discord\\Update.exe" --processStart Discord.exe';

function memoryStore(): { store: StartupStore; registry: MemoryRegistry; folders: MemoryFolders } {
  const registry = new MemoryRegistry();
  const folders = new MemoryFolders();
  return {
    store: { registry, folders, now: () => Date.UTC(2026, 0, 5), windowsDir: 'C:\\Windows' },
    registry,
    folders,
  };
}

describe('executableFromCommand', () => {
  it('reads quoted paths, bare paths with arguments, and environment variables', () => {
    expect(executableFromCommand(discordCommand)).toBe('C:\\Apps\\Discord\\Update.exe');
    expect(executableFromCommand('C:\\Program Files\\App\\app.exe --minimized')).toBe(
      'C:\\Program Files\\App\\app.exe',
    );
    expect(
      executableFromCommand('"%LOCALAPPDATA%\\Discord\\Update.exe" --processStart Discord.exe', {
        LOCALAPPDATA: 'D:\\Users\\alice\\AppData\\Local',
      }),
    ).toBe('D:\\Users\\alice\\AppData\\Local\\Discord\\Update.exe');
    expect(executableFromCommand('')).toBeNull();
  });
});

describe('createStartupService', () => {
  it('decorates entries with publisher and icon data by event and keeps live counts', async () => {
    const { store, registry } = memoryStore();
    registry.run['hkcu-run'] = [{ name: 'Discord', command: discordCommand }];
    const loadPublisher = vi.fn(async () => new Map([['C:\\Apps\\Discord\\Update.exe', 'Discord Inc.']]));
    const loadIcon = vi.fn(async () => 'data:image/png;base64,icon');
    const service = createStartupService({ store, loadPublisher, loadIcon });
    const events: StartupDetailsEvent[] = [];
    const arrived = new Promise<void>((resolve) => {
      service.onDetails((event) => {
        events.push(event);
        if (events.some((entry) => entry.details.some((d) => d.publisher !== null && d.iconDataUrl !== null))) {
          resolve();
        }
      });
    });

    const result = await service.list();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.counts).toEqual({ total: 1, enabled: 1, disabled: 0 });
    expect(result.state.entries[0]).toMatchObject({ name: 'Discord', requiresAdmin: false });
    await arrived;
    const id = result.state.entries[0]!.id;
    const merged = events.flatMap((event) => event.details).filter((detail) => detail.id === id);
    expect(merged.at(-1)).toEqual({ id, publisher: 'Discord Inc.', iconDataUrl: 'data:image/png;base64,icon' });

    const again = await service.list();
    expect(again.ok && again.state.entries[0]).toMatchObject({
      publisher: 'Discord Inc.',
      iconDataUrl: 'data:image/png;base64,icon',
    });
    expect(loadPublisher).toHaveBeenCalledTimes(1);
    expect(loadIcon).toHaveBeenCalledTimes(1);
  });

  describe('details after the list', () => {
    const exe = 'C:\\Apps\\Discord\\Update.exe';

    function pending<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    function setup() {
      const { store, registry } = memoryStore();
      registry.run['hkcu-run'] = [{ name: 'Discord', command: discordCommand }];
      const publisher = pending<Map<string, string>>();
      const icon = pending<string | null>();
      const loadPublisher = vi.fn(() => publisher.promise);
      const loadIcon = vi.fn(() => icon.promise);
      const service = createStartupService({ store, loadPublisher, loadIcon });
      return { service, publisher, icon, loadPublisher, loadIcon };
    }

    it('returns rows before publishers and icons load, then delivers them by id', async () => {
      const { service, publisher, icon, loadPublisher, loadIcon } = setup();
      const events: StartupDetailsEvent[] = [];
      service.onDetails((event) => events.push(event));

      const result = await service.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const id = result.state.entries[0]!.id;
      expect(result.state.entries[0]).toMatchObject({ publisher: null, iconDataUrl: null });
      expect(loadPublisher).toHaveBeenCalledTimes(1);
      expect(loadIcon).toHaveBeenCalledWith(exe);
      expect(events).toEqual([]);

      publisher.resolve(new Map([[exe, 'Discord Inc.']]));
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toEqual({ details: [{ id, publisher: 'Discord Inc.', iconDataUrl: null }] });

      icon.resolve('data:image/png;base64,icon');
      await vi.waitFor(() => expect(events).toHaveLength(2));
      expect(events[1]).toEqual({
        details: [{ id, publisher: 'Discord Inc.', iconDataUrl: 'data:image/png;base64,icon' }],
      });
    });

    it('serves cached values on the next list without starting new loads', async () => {
      const { service, publisher, icon, loadPublisher, loadIcon } = setup();
      const events: StartupDetailsEvent[] = [];
      service.onDetails((event) => events.push(event));
      await service.list();
      publisher.resolve(new Map([[exe, 'Discord Inc.']]));
      icon.resolve('data:image/png;base64,icon');
      await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(2));

      const second = await service.list();

      expect(second.ok && second.state.entries[0]).toMatchObject({
        publisher: 'Discord Inc.',
        iconDataUrl: 'data:image/png;base64,icon',
      });
      expect(loadPublisher).toHaveBeenCalledTimes(1);
      expect(loadIcon).toHaveBeenCalledTimes(1);
    });

    it('does not start a second load for a path whose load is still running', async () => {
      const { service, loadPublisher, loadIcon } = setup();

      await service.list();
      await service.list();

      expect(loadPublisher).toHaveBeenCalledTimes(1);
      expect(loadIcon).toHaveBeenCalledTimes(1);
    });

    it('keeps working when a listener throws', async () => {
      const { service, publisher, icon } = setup();
      const seen: StartupDetailsEvent[] = [];
      service.onDetails(() => {
        throw new Error('broken listener');
      });
      service.onDetails((event) => seen.push(event));
      await service.list();

      publisher.resolve(new Map([[exe, 'Discord Inc.']]));
      icon.resolve(null);

      await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(1));
      const again = await service.list();
      expect(again.ok && again.state.entries[0]).toMatchObject({ publisher: 'Discord Inc.' });
    });

    it('stops delivering events after unsubscribing', async () => {
      const { service, publisher, icon } = setup();
      const kept: StartupDetailsEvent[] = [];
      const dropped: StartupDetailsEvent[] = [];
      const off = service.onDetails((event) => dropped.push(event));
      service.onDetails((event) => kept.push(event));
      await service.list();
      off();

      publisher.resolve(new Map([[exe, 'Discord Inc.']]));
      icon.resolve('data:image/png;base64,icon');

      await vi.waitFor(() => expect(kept.length).toBeGreaterThanOrEqual(1));
      expect(dropped).toEqual([]);
    });
  });

  it('falls back to null publisher and icon when decoration fails', async () => {
    const { store, registry } = memoryStore();
    registry.run['hklm-run'] = [{ name: 'Mystery', command: 'C:\\Tools\\mystery.exe' }];
    const service = createStartupService({
      store,
      loadPublisher: async () => {
        throw new Error('powershell unavailable');
      },
      loadIcon: async () => null,
    });

    const result = await service.list();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.entries[0]).toMatchObject({
      publisher: null,
      iconDataUrl: null,
      requiresAdmin: true,
    });
  });

  it('maps a refused toggle without touching the list', async () => {
    const { store, registry } = memoryStore();
    const protectedId = entryId('hkcu-run', 'SecurityHealth');
    registry.run['hkcu-run'] = [
      { name: 'SecurityHealth', command: '"C:\\Windows\\System32\\SecurityHealthSystray.exe"' },
    ];
    const service = createStartupService({ store });

    const result = await service.disable(protectedId);

    expect(result).toEqual({
      ok: false,
      reason: 'protected',
      message: 'Protected by Dust. This entry cannot be disabled.',
    });
  });

  it('disables and re-enables an entry through the store', async () => {
    const { store, registry } = memoryStore();
    const id = entryId('hkcu-run', 'Discord');
    registry.run['hkcu-run'] = [{ name: 'Discord', command: discordCommand }];
    const service = createStartupService({ store });

    const disabled = await service.disable(id);
    expect(disabled.ok).toBe(true);
    if (disabled.ok) expect(disabled.state.counts).toMatchObject({ enabled: 0, disabled: 1 });

    const enabled = await service.enable(id);
    expect(enabled.ok).toBe(true);
    if (enabled.ok) expect(enabled.state.counts).toMatchObject({ enabled: 1, disabled: 0 });
    expect(registry.run['hkcu-run']).toHaveLength(1);
  });
});

describe('pending elevated toggle', () => {
  function hostWith(entries: StartupEntry[]): {
    host: EngineHost;
    disable: ReturnType<typeof vi.fn>;
    enable: ReturnType<typeof vi.fn>;
  } {
    const counts = {
      total: entries.length,
      enabled: entries.filter((entry) => entry.state === 'enabled').length,
      disabled: entries.filter((entry) => entry.state === 'disabled').length,
    };
    const disable = vi.fn(async () => ({ ok: true as const, state: { entries, counts, loadedAt: 1 } }));
    const enable = vi.fn(async () => ({ ok: true as const, state: { entries, counts, loadedAt: 1 } }));
    const host = {
      getStartup: async () => ({ ok: true as const, state: { entries, counts, loadedAt: 1 } }),
      disableStartup: disable,
      enableStartup: enable,
    } as unknown as EngineHost;
    return { host, disable, enable };
  }

  const enabledEntry: StartupEntry = {
    id: 'a1b2c3d4e5f60718',
    name: 'Discord',
    publisher: null,
    command: discordCommand,
    source: 'hkcu-run',
    state: 'enabled',
    disabledKind: null,
    protected: false,
    requiresAdmin: false,
    disabledAt: null,
    iconDataUrl: null,
  };
  const windowsDisabledEntry: StartupEntry = {
    ...enabledEntry,
    id: 'd4e5f607182930a1',
    name: 'OneDrive',
    state: 'disabled',
    disabledKind: 'windows',
  };

  it('parses well-formed toggle and enable arguments', () => {
    expect(parsePendingStartupToggle(['electron', '.'])).toEqual({
      requested: false,
      id: null,
      action: 'disable',
    });
    expect(parsePendingStartupToggle(['electron', '--dust-startup-toggle=not-an-id'])).toEqual({
      requested: true,
      id: null,
      action: 'disable',
    });
    expect(parsePendingStartupToggle(['electron', '--dust-startup-toggle=a1b2c3d4e5f60718'])).toEqual({
      requested: true,
      id: 'a1b2c3d4e5f60718',
      action: 'disable',
    });
    expect(parsePendingStartupToggle(['electron', '--dust-startup-enable=a1b2c3d4e5f60718'])).toEqual({
      requested: true,
      id: 'a1b2c3d4e5f60718',
      action: 'enable',
    });
    expect(parsePendingStartupToggle(['electron', '--dust-startup-enable=not-an-id'])).toEqual({
      requested: true,
      id: null,
      action: 'enable',
    });
  });

  it('performs a known, enabled, unprotected toggle', async () => {
    const { host, disable } = hostWith([enabledEntry]);

    const notice = await applyPendingStartupToggle(host, enabledEntry.id);

    expect(disable).toHaveBeenCalledWith(enabledEntry.id);
    expect(notice).toEqual({ entryId: enabledEntry.id, name: 'Discord', to: 'disabled' });
  });

  it('enables a Windows-disabled entry and keeps the windows kind on the notice', async () => {
    const { host, enable } = hostWith([windowsDisabledEntry]);

    const notice = await applyPendingStartupToggle(host, windowsDisabledEntry.id, 'enable');

    expect(enable).toHaveBeenCalledWith(windowsDisabledEntry.id);
    expect(notice).toEqual({
      entryId: windowsDisabledEntry.id,
      name: 'OneDrive',
      to: 'enabled',
      disabledKind: 'windows',
    });
  });

  it('refuses silently for unknown, protected, windows-disabled, or already-disabled ids', async () => {
    const protectedEntry = { ...enabledEntry, protected: true };
    const windowsEntry = { ...enabledEntry, disabledKind: 'windows' as const };
    const alreadyDisabled = { ...enabledEntry, state: 'disabled' as const };
    const cases: Array<{ entry: StartupEntry; id: string }> = [
      { entry: enabledEntry, id: 'ffffffffffffffff' },
      { entry: protectedEntry, id: protectedEntry.id },
      { entry: windowsEntry, id: windowsEntry.id },
      { entry: alreadyDisabled, id: alreadyDisabled.id },
    ];

    for (const testCase of cases) {
      const { host, disable } = hostWith([testCase.entry]);
      const notice = await applyPendingStartupToggle(host, testCase.id);
      expect(notice).toBeNull();
      expect(disable).not.toHaveBeenCalled();
    }
  });

  it('refuses silently to enable protected, enabled, or unknown ids', async () => {
    const protectedEntry = { ...windowsDisabledEntry, protected: true };
    const cases: Array<{ entry: StartupEntry; id: string }> = [
      { entry: enabledEntry, id: enabledEntry.id },
      { entry: protectedEntry, id: protectedEntry.id },
      { entry: windowsDisabledEntry, id: 'ffffffffffffffff' },
    ];

    for (const testCase of cases) {
      const { host, enable } = hostWith([testCase.entry]);
      const notice = await applyPendingStartupToggle(host, testCase.id, 'enable');
      expect(notice).toBeNull();
      expect(enable).not.toHaveBeenCalled();
    }
  });
});
