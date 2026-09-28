import { createHash } from 'node:crypto';

export type RunSource = 'hkcu-run' | 'hklm-run' | 'hklm-run-wow64';

export type FolderSource = 'startup-folder-user' | 'startup-folder-common';

export type StartupSource = RunSource | FolderSource;

export type StartupEntryState = 'enabled' | 'disabled';

export type StartupDisabledKind = 'dust' | 'windows';

export interface StartupEntryRecord {
  id: string;
  name: string;
  command: string;
  source: StartupSource;
  state: StartupEntryState;
  disabledKind: StartupDisabledKind | null;
  protected: boolean;
  requiresAdmin: boolean;
  disabledAt: number | null;
  fileName: string | null;
  windowsDisabledName: string | null;
}

export type StartupToggleRefusal =
  'not-found' | 'protected' | 'needs-admin' | 'conflict' | 'windows-disabled' | 'failed';

export type StartupToggleResult =
  { ok: true; entries: StartupEntryRecord[] } | { ok: false; reason: StartupToggleRefusal; message: string };

export interface RunValue {
  name: string;
  command: string;
}

export interface StartupShortcut {
  fileName: string;
  name: string;
  command: string;
}

export const RUN_SOURCES: readonly RunSource[] = ['hkcu-run', 'hklm-run', 'hklm-run-wow64'];

export const FOLDER_SOURCES: readonly FolderSource[] = ['startup-folder-user', 'startup-folder-common'];

export const STARTUP_SOURCES: readonly StartupSource[] = [...RUN_SOURCES, ...FOLDER_SOURCES];

export function isRunSource(source: StartupSource): source is RunSource {
  return source === 'hkcu-run' || source === 'hklm-run' || source === 'hklm-run-wow64';
}

export function isFolderSource(source: StartupSource): source is FolderSource {
  return source === 'startup-folder-user' || source === 'startup-folder-common';
}

export function requiresAdministrator(source: StartupSource): boolean {
  return source === 'hklm-run' || source === 'hklm-run-wow64' || source === 'startup-folder-common';
}

export function entryId(source: StartupSource, name: string): string {
  return createHash('sha1').update(`${source}\u0000${name}`).digest('hex').slice(0, 16);
}
