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
} from '../src/index';
import { encodeBackupEnvelope, parseBackupEnvelope } from '../src/index';

export function emptyRun(): Record<RunSource, RunValue[]> {
  return { 'hkcu-run': [], 'hklm-run': [], 'hklm-run-wow64': [] };
}

export function emptyWindowsDisabled(): Record<StartupSource, string[]> {
  return {
    'hkcu-run': [],
    'hklm-run': [],
    'hklm-run-wow64': [],
    'startup-folder-user': [],
    'startup-folder-common': [],
  };
}

export interface FakeRegistryOptions {
  run?: Partial<Record<RunSource, RunValue[]>>;
  backups?: Array<{ source: RunSource; envelope: StartupBackupEnvelope }>;
  windowsDisabled?: Partial<Record<StartupSource, string[]>>;
}

export class FakeRegistryStore implements RegistryStore {
  readonly calls: string[] = [];
  readonly run: Record<RunSource, RunValue[]>;
  readonly backups: Array<{ source: RunSource; raw: string }>;
  readonly windowsDisabled: Record<StartupSource, string[]>;
  failNextWrite = false;

  constructor(options: FakeRegistryOptions = {}) {
    this.run = { ...emptyRun(), ...options.run };
    this.backups = (options.backups ?? []).map((entry) => ({
      source: entry.source,
      raw: encodeBackupEnvelope(entry.envelope),
    }));
    this.windowsDisabled = { ...emptyWindowsDisabled(), ...options.windowsDisabled };
  }

  async readSnapshot(): Promise<RegistrySnapshot> {
    this.calls.push('readSnapshot');
    return {
      run: JSON.parse(JSON.stringify(this.run)) as Record<RunSource, RunValue[]>,
      backups: this.backups.map((entry) => ({ ...entry })),
      windowsDisabled: JSON.parse(JSON.stringify(this.windowsDisabled)) as Record<StartupSource, string[]>,
    };
  }

  async readRunValue(source: RunSource, name: string): Promise<string | null> {
    this.calls.push(`readRun:${source}:${name}`);
    return this.run[source].find((value) => value.name === name)?.command ?? null;
  }

  async writeRunValue(source: RunSource, name: string, command: string): Promise<void> {
    this.calls.push(`writeRun:${source}:${name}`);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('Access is denied');
    }
    const existing = this.run[source].find((value) => value.name === name);
    if (existing) existing.command = command;
    else this.run[source].push({ name, command });
  }

  async deleteRunValue(source: RunSource, name: string): Promise<void> {
    this.calls.push(`deleteRun:${source}:${name}`);
    this.run[source] = this.run[source].filter((value) => value.name !== name);
  }

  async readBackupValue(source: RunSource, id: string): Promise<string | null> {
    this.calls.push(`readBackup:${source}:${id}`);
    return this.backups.find((entry) => entry.source === source && backupId(entry.raw) === id)?.raw ?? null;
  }

  async writeBackupValue(source: RunSource, id: string, raw: string): Promise<void> {
    this.calls.push(`writeBackup:${source}:${id}`);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('Access is denied');
    }
    this.backups.push({ source, raw });
  }

  async deleteBackupValue(source: RunSource, id: string): Promise<void> {
    this.calls.push(`deleteBackup:${source}:${id}`);
    const index = this.backups.findIndex((entry) => entry.source === source && backupId(entry.raw) === id);
    if (index >= 0) this.backups.splice(index, 1);
  }

  async writeApprovedEnabled(source: StartupSource, name: string): Promise<void> {
    this.calls.push(`writeApprovedEnabled:${source}:${name}`);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('Access is denied');
    }
    this.windowsDisabled[source] = this.windowsDisabled[source].filter(
      (entry) => entry.toLowerCase() !== name.toLowerCase(),
    );
  }
}

function backupId(raw: string): string | null {
  return parseBackupEnvelope(raw)?.id ?? null;
}

export interface FakeFolderOptions {
  shortcuts?: Partial<Record<FolderSource, StartupShortcut[]>>;
  backups?: StartupBackupEnvelope[];
}

export class FakeFolderStore implements FolderStore {
  readonly calls: string[] = [];
  readonly shortcuts: Record<FolderSource, StartupShortcut[]>;
  readonly backups: StartupBackupEnvelope[];

  constructor(options: FakeFolderOptions = {}) {
    this.shortcuts = {
      'startup-folder-user': [...(options.shortcuts?.['startup-folder-user'] ?? [])],
      'startup-folder-common': [...(options.shortcuts?.['startup-folder-common'] ?? [])],
    };
    this.backups = [...(options.backups ?? [])];
  }

  async readSnapshot(): Promise<FolderSnapshot> {
    this.calls.push('readSnapshot');
    return {
      shortcuts: JSON.parse(JSON.stringify(this.shortcuts)) as Record<FolderSource, StartupShortcut[]>,
      backups: this.backups.map((envelope) => encodeBackupEnvelope(envelope)),
    };
  }

  async readShortcut(source: FolderSource, fileName: string): Promise<StartupShortcut | null> {
    this.calls.push(`readShortcut:${source}:${fileName}`);
    return this.shortcuts[source].find((shortcut) => shortcut.fileName === fileName) ?? null;
  }

  async moveToBackup(source: FolderSource, shortcut: StartupShortcut, envelope: StartupBackupEnvelope): Promise<void> {
    this.calls.push(`moveToBackup:${source}:${shortcut.fileName}`);
    const index = this.shortcuts[source].findIndex((entry) => entry.fileName === shortcut.fileName);
    if (index < 0) throw new Error('Startup shortcut no longer exists');
    this.shortcuts[source].splice(index, 1);
    this.backups.push(envelope);
  }

  async restoreFromBackup(envelope: StartupBackupEnvelope): Promise<void> {
    this.calls.push(`restore:${envelope.id}`);
    const index = this.backups.findIndex((entry) => entry.id === envelope.id);
    if (index < 0) throw new Error('Backup shortcut is missing');
    const source = envelope.source as FolderSource;
    const fileName = envelope.fileName ?? `${envelope.name}.lnk`;
    if (this.shortcuts[source].some((entry) => entry.fileName === fileName)) {
      throw new Error('A startup entry with this name already exists');
    }
    this.backups.splice(index, 1);
    this.shortcuts[source].push({ fileName, name: envelope.name, command: envelope.command });
  }

  async deleteBackup(id: string): Promise<void> {
    this.calls.push(`deleteBackup:${id}`);
    const index = this.backups.findIndex((entry) => entry.id === id);
    if (index >= 0) this.backups.splice(index, 1);
  }
}

export function makeStore(options: {
  registry?: FakeRegistryStore;
  folders?: FakeFolderStore;
  now?: () => number;
  windowsDir?: string;
}): StartupStore {
  return {
    registry: options.registry ?? new FakeRegistryStore(),
    folders: options.folders ?? new FakeFolderStore(),
    now: options.now ?? (() => Date.UTC(2026, 0, 5)),
    windowsDir: options.windowsDir,
  };
}
