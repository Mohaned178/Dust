import { encodeBackupEnvelope, parseBackupEnvelope } from './envelope';
import type { StartupBackupEnvelope } from './envelope';
import type { FolderStore } from './folders';
import { isProtectedStartupEntry } from './protected';
import type { RegistryStore } from './registry';
import { entryId, FOLDER_SOURCES, isFolderSource, isRunSource, requiresAdministrator, RUN_SOURCES } from './types';
import type { FolderSource, StartupEntryRecord, StartupToggleResult } from './types';

export interface StartupStore {
  registry: RegistryStore;
  folders: FolderStore;
  now?: () => number;
  windowsDir?: string | undefined;
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function makeRecord(input: {
  id: string;
  name: string;
  command: string;
  source: StartupEntryRecord['source'];
  state: StartupEntryRecord['state'];
  disabledKind: StartupEntryRecord['disabledKind'];
  disabledAt: number | null;
  fileName: string | null;
  windowsDisabledName: string | null;
  windowsDir?: string | undefined;
}): StartupEntryRecord {
  return {
    id: input.id,
    name: input.name,
    command: input.command,
    source: input.source,
    state: input.state,
    disabledKind: input.disabledKind,
    protected: isProtectedStartupEntry({
      name: input.name,
      command: input.command,
      windowsDir: input.windowsDir,
    }),
    requiresAdmin: requiresAdministrator(input.source),
    disabledAt: input.disabledAt,
    fileName: input.fileName,
    windowsDisabledName: input.windowsDisabledName,
  };
}

export async function listStartupEntries(store: StartupStore): Promise<StartupEntryRecord[]> {
  const [registrySnapshot, folderSnapshot] = await Promise.all([
    store.registry.readSnapshot(),
    store.folders.readSnapshot(),
  ]);
  const entries: StartupEntryRecord[] = [];
  const seen = new Set<string>();
  const windowsDir = store.windowsDir;

  for (const source of RUN_SOURCES) {
    const disabledNames = new Set(registrySnapshot.windowsDisabled[source].map(normalized));
    for (const value of registrySnapshot.run[source]) {
      const id = entryId(source, value.name);
      if (seen.has(id)) continue;
      seen.add(id);
      const disabled = disabledNames.has(normalized(value.name));
      entries.push(
        makeRecord({
          id,
          name: value.name,
          command: value.command,
          source,
          state: disabled ? 'disabled' : 'enabled',
          disabledKind: disabled ? 'windows' : null,
          disabledAt: null,
          fileName: null,
          windowsDisabledName: disabled ? value.name : null,
          windowsDir,
        }),
      );
    }
  }

  for (const source of FOLDER_SOURCES) {
    const disabledNames = new Set(registrySnapshot.windowsDisabled[source].map(normalized));
    for (const shortcut of folderSnapshot.shortcuts[source]) {
      const id = entryId(source, shortcut.name);
      if (seen.has(id)) continue;
      seen.add(id);
      const fileNameDisabled = disabledNames.has(normalized(shortcut.fileName));
      const disabled = fileNameDisabled || disabledNames.has(normalized(shortcut.name));
      entries.push(
        makeRecord({
          id,
          name: shortcut.name,
          command: shortcut.command,
          source,
          state: disabled ? 'disabled' : 'enabled',
          disabledKind: disabled ? 'windows' : null,
          disabledAt: null,
          fileName: shortcut.fileName,
          windowsDisabledName: disabled ? (fileNameDisabled ? shortcut.fileName : shortcut.name) : null,
          windowsDir,
        }),
      );
    }
  }

  for (const backup of registrySnapshot.backups) {
    const envelope = parseBackupEnvelope(backup.raw);
    if (envelope === null || !isRunSource(envelope.source)) continue;
    if (seen.has(envelope.id)) continue;
    seen.add(envelope.id);
    entries.push(
      makeRecord({
        id: envelope.id,
        name: envelope.name,
        command: envelope.command,
        source: envelope.source,
        state: 'disabled',
        disabledKind: 'dust',
        disabledAt: envelope.disabledAt,
        fileName: null,
        windowsDisabledName: null,
        windowsDir,
      }),
    );
  }

  for (const raw of folderSnapshot.backups) {
    const envelope = parseBackupEnvelope(raw);
    if (envelope === null || !isFolderSource(envelope.source)) continue;
    if (seen.has(envelope.id)) continue;
    seen.add(envelope.id);
    entries.push(
      makeRecord({
        id: envelope.id,
        name: envelope.name,
        command: envelope.command,
        source: envelope.source,
        state: 'disabled',
        disabledKind: 'dust',
        disabledAt: envelope.disabledAt,
        fileName: envelope.fileName ?? null,
        windowsDisabledName: null,
        windowsDir,
      }),
    );
  }

  return entries.sort(
    (a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id),
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAccessDenied(error: unknown): boolean {
  return /access is denied|unauthorized|requested registry access is not allowed|EPERM|EACCES/i.test(messageOf(error));
}

function failure(entry: StartupEntryRecord, error: unknown): StartupToggleResult {
  if (entry.requiresAdmin && isAccessDenied(error)) {
    return { ok: false, reason: 'needs-admin', message: 'Dust needs administrator rights to change this entry.' };
  }
  return { ok: false, reason: 'failed', message: "Couldn't change this startup entry." };
}

function envelopeFor(entry: StartupEntryRecord, disabledAt: number): StartupBackupEnvelope {
  const envelope: StartupBackupEnvelope = {
    v: 1,
    id: entry.id,
    name: entry.name,
    command: entry.command,
    source: entry.source,
    disabledAt,
  };
  if (entry.fileName !== null) envelope.fileName = entry.fileName;
  return envelope;
}

export async function disableStartupEntry(id: string, store: StartupStore): Promise<StartupToggleResult> {
  const entries = await listStartupEntries(store);
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    return { ok: false, reason: 'not-found', message: 'This startup entry no longer exists.' };
  }
  if (entry.protected) {
    return { ok: false, reason: 'protected', message: 'Protected by Dust. This entry cannot be disabled.' };
  }
  if (entry.disabledKind === 'windows') {
    return {
      ok: false,
      reason: 'windows-disabled',
      message: 'This entry is disabled in Windows. Change it from Task Manager or Windows Settings.',
    };
  }
  if (entry.state === 'disabled') {
    return { ok: false, reason: 'conflict', message: 'This entry is already disabled.' };
  }

  const now = store.now?.() ?? Date.now();
  const envelope = envelopeFor(entry, now);

  try {
    if (isRunSource(entry.source)) {
      const raw = encodeBackupEnvelope(envelope);
      await store.registry.writeBackupValue(entry.source, entry.id, raw);
      const verified = await store.registry.readBackupValue(entry.source, entry.id);
      if (verified !== raw) throw new Error('Backup verification failed');
      await store.registry.deleteRunValue(entry.source, entry.name);
    } else {
      await store.folders.moveToBackup(
        entry.source,
        { fileName: entry.fileName ?? `${entry.name}.lnk`, name: entry.name, command: entry.command },
        envelope,
      );
      const remaining = await store.folders.readShortcut(entry.source, entry.fileName ?? `${entry.name}.lnk`);
      if (remaining !== null) throw new Error('Backup verification failed');
    }
  } catch (error) {
    return failure(entry, error);
  }

  return { ok: true, entries: await listStartupEntries(store) };
}

export async function removeStartupBackup(id: string, store: StartupStore): Promise<StartupToggleResult> {
  const entries = await listStartupEntries(store);
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    return { ok: false, reason: 'not-found', message: 'This startup entry no longer exists.' };
  }
  if (entry.protected) {
    return { ok: false, reason: 'protected', message: 'Protected by Dust. This entry cannot be changed.' };
  }
  if (entry.disabledKind !== 'dust') {
    return { ok: false, reason: 'conflict', message: 'This entry is not managed by Dust.' };
  }
  try {
    if (isRunSource(entry.source)) {
      await store.registry.deleteBackupValue(entry.source, entry.id);
    } else {
      await store.folders.deleteBackup(entry.id);
    }
  } catch (error) {
    return failure(entry, error);
  }
  return { ok: true, entries: await listStartupEntries(store) };
}

export async function enableStartupEntry(id: string, store: StartupStore): Promise<StartupToggleResult> {
  const entries = await listStartupEntries(store);
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    return { ok: false, reason: 'not-found', message: 'This startup entry no longer exists.' };
  }
  if (entry.protected) {
    return { ok: false, reason: 'protected', message: 'Protected by Dust. This entry cannot be changed.' };
  }
  if (entry.disabledKind === 'windows') {
    const approvedName = entry.windowsDisabledName ?? entry.fileName ?? entry.name;
    try {
      await store.registry.writeApprovedEnabled(entry.source, approvedName);
    } catch (error) {
      return failure(entry, error);
    }
    const entries = await listStartupEntries(store);
    const updated = entries.find((candidate) => candidate.id === id);
    if (updated === undefined || updated.disabledKind === 'windows') {
      return { ok: false, reason: 'failed', message: "Windows didn't allow this change." };
    }
    return { ok: true, entries };
  }
  if (entry.state === 'enabled') {
    return { ok: false, reason: 'conflict', message: 'This entry is already enabled.' };
  }
  if (entry.disabledKind !== 'dust') {
    return { ok: false, reason: 'conflict', message: 'This entry is not managed by Dust.' };
  }

  const envelope = envelopeFor(entry, entry.disabledAt ?? store.now?.() ?? Date.now());

  try {
    if (isRunSource(entry.source)) {
      const current = await store.registry.readRunValue(entry.source, entry.name);
      if (current !== null && current !== entry.command) {
        return {
          ok: false,
          reason: 'conflict',
          message: 'This entry was re-added by another app. Turn off the new entry first.',
        };
      }
      if (current === null) {
        await store.registry.writeRunValue(entry.source, entry.name, entry.command);
        const verified = await store.registry.readRunValue(entry.source, entry.name);
        if (verified !== entry.command) throw new Error('Restore verification failed');
      }
      await store.registry.deleteBackupValue(entry.source, entry.id);
    } else {
      const fileName = entry.fileName ?? `${entry.name}.lnk`;
      const existing = await store.folders.readShortcut(entry.source as FolderSource, fileName);
      if (existing !== null) {
        return {
          ok: false,
          reason: 'conflict',
          message: 'This entry was re-added by another app. Turn off the new entry first.',
        };
      }
      await store.folders.restoreFromBackup({ ...envelope, fileName });
      const restored = await store.folders.readShortcut(entry.source as FolderSource, fileName);
      if (restored === null) throw new Error('Restore verification failed');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'A startup entry with this name already exists') {
      return {
        ok: false,
        reason: 'conflict',
        message: 'This entry was re-added by another app. Turn off the new entry first.',
      };
    }
    return failure(entry, error);
  }

  return { ok: true, entries: await listStartupEntries(store) };
}
