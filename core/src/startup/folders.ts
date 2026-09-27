import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { StartupBackupEnvelope } from './envelope';
import type { FolderSource, StartupShortcut } from './types';

export interface ShortcutDetails {
  target: string;
  args: string;
}

export type ShortcutResolver = (shortcutPath: string) => Promise<ShortcutDetails | null>;

export interface StartupFolderPaths {
  user: string;
  common: string;
  backup: string;
}

export function resolveStartupFolderPaths(env: NodeJS.ProcessEnv = process.env): StartupFolderPaths {
  const appData = (env.APPDATA ?? '').trim();
  const programData = (env.PROGRAMDATA ?? '').trim();
  const startupRelative = join('Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  return {
    user: appData === '' ? '' : join(appData, startupRelative),
    common: programData === '' ? '' : join(programData, startupRelative),
    backup: appData === '' ? '' : join(appData, 'Dust', 'startup-disabled'),
  };
}

export interface FolderSnapshot {
  shortcuts: Record<FolderSource, StartupShortcut[]>;
  backups: string[];
}

export interface FolderStore {
  readSnapshot(): Promise<FolderSnapshot>;
  readShortcut(source: FolderSource, fileName: string): Promise<StartupShortcut | null>;
  moveToBackup(source: FolderSource, shortcut: StartupShortcut, envelope: StartupBackupEnvelope): Promise<void>;
  restoreFromBackup(envelope: StartupBackupEnvelope): Promise<void>;
  deleteBackup(id: string): Promise<void>;
}

export interface FsFolderStoreOptions {
  env?: NodeJS.ProcessEnv;
  resolveShortcut?: ShortcutResolver;
  paths?: StartupFolderPaths;
}

function formatCommand(details: ShortcutDetails): string {
  const args = details.args.trim();
  return args.length === 0 ? details.target : `${details.target} ${args}`;
}

function isShortcut(fileName: string): boolean {
  return extname(fileName).toLowerCase() === '.lnk';
}

function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

export function createFsFolderStore(options: FsFolderStoreOptions = {}): FolderStore {
  const paths = options.paths ?? resolveStartupFolderPaths(options.env ?? process.env);
  const resolve = options.resolveShortcut ?? (async () => null);

  function rootFor(source: FolderSource): string {
    return source === 'startup-folder-user' ? paths.user : paths.common;
  }

  function backupFilePath(id: string): string {
    return join(paths.backup, `${id}.lnk`);
  }

  function backupMetaPath(id: string): string {
    return join(paths.backup, `${id}.json`);
  }

  async function toShortcut(root: string, fileName: string): Promise<StartupShortcut> {
    let details: ShortcutDetails | null = null;
    try {
      details = await resolve(join(root, fileName));
    } catch {
      details = null;
    }
    return {
      fileName,
      name: basename(fileName, extname(fileName)),
      command: details === null ? '' : formatCommand(details),
    };
  }

  async function listFolder(source: FolderSource): Promise<StartupShortcut[]> {
    const root = rootFor(source);
    if (root === '' || !existsSync(root)) return [];
    let names: string[];
    try {
      names = readdirSync(root).filter(isShortcut);
    } catch {
      return [];
    }
    return Promise.all(names.map((fileName) => toShortcut(root, fileName)));
  }

  return {
    async readSnapshot() {
      const [user, common] = await Promise.all([
        listFolder('startup-folder-user'),
        listFolder('startup-folder-common'),
      ]);
      const backups: string[] = [];
      if (paths.backup !== '' && existsSync(paths.backup)) {
        let names: string[] = [];
        try {
          names = readdirSync(paths.backup).filter((fileName) => extname(fileName).toLowerCase() === '.json');
        } catch {
          names = [];
        }
        for (const fileName of names) {
          const id = basename(fileName, extname(fileName));
          if (id.length === 0 || !existsSync(backupFilePath(id))) continue;
          try {
            backups.push(readFileSync(join(paths.backup, fileName), 'utf8'));
          } catch {
            /* an unreadable backup is skipped, never treated as active */
          }
        }
      }
      return {
        shortcuts: { 'startup-folder-user': user, 'startup-folder-common': common },
        backups,
      };
    },

    async readShortcut(source, fileName) {
      const root = rootFor(source);
      if (root === '' || fileName.length === 0 || !existsSync(join(root, fileName))) return null;
      return toShortcut(root, fileName);
    },

    async moveToBackup(source, shortcut, envelope) {
      const root = rootFor(source);
      if (root === '') throw new Error('Startup folder is not available');
      if (paths.backup === '') throw new Error('Backup folder is not available');
      const from = join(root, shortcut.fileName);
      if (!existsSync(from)) throw new Error('Startup shortcut no longer exists');
      mkdirSync(paths.backup, { recursive: true });
      const target = backupFilePath(envelope.id);
      moveFile(from, target);
      try {
        writeFileSync(backupMetaPath(envelope.id), JSON.stringify(envelope), 'utf8');
      } catch (error) {
        try {
          moveFile(target, from);
        } catch {
          /* the shortcut stays in the backup folder and remains recoverable */
        }
        throw error;
      }
    },

    async restoreFromBackup(envelope) {
      const fileName = envelope.fileName ?? '';
      const root = rootFor(envelope.source as FolderSource);
      if (root === '' || fileName.length === 0) throw new Error('Startup shortcut is not available');
      const source = backupFilePath(envelope.id);
      const target = join(root, fileName);
      if (!existsSync(source)) throw new Error('Backup shortcut is missing');
      if (existsSync(target)) throw new Error('A startup entry with this name already exists');
      moveFile(source, target);
      try {
        rmSync(backupMetaPath(envelope.id), { force: true });
      } catch {
        /* the restored shortcut is what matters; a stale sidecar is ignored */
      }
    },

    async deleteBackup(id) {
      if (paths.backup === '') return;
      try {
        rmSync(backupMetaPath(id), { force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
