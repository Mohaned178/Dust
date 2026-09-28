import { createHash } from 'node:crypto';
import type { DeleteError } from '../cleaner/executor';
import type { StartupSource } from '../startup/types';

export type UninstallHive = 'hklm' | 'hklm-wow64' | 'hkcu';

export type UninstallKind = 'msi' | 'exe' | 'rundll32' | 'url' | 'unknown';

export type UninstallCommandBlock = 'missing-exe' | 'url-protocol' | 'malformed' | 'not-absolute';

export type LeftoverClass = 'install-dir' | 'app-data' | 'program-data' | 'user-data' | 'temp';

export type UninstallItemKind = 'file' | 'registry' | 'startup';

export type UninstallGrade = 'safe' | 'review';

export type UninstallOutcome = 'complete' | 'partial' | 'failed' | 'reboot-required' | 'not-started';

export type UninstallPhase =
  'prepare' | 'backup' | 'uninstaller' | 'verify' | 'files' | 'registry' | 'startup' | 'finish';

export const UNINSTALL_VERIFY_POLL_MS = 2_000;
export const UNINSTALL_VERIFY_GRACE_MS = 120_000;
export const UNINSTALL_BACKUP_TTL_MS = 30 * 24 * 60 * 60_000;
export const UNINSTALL_PENDING_TTL_MS = 15 * 60_000;
export const UNINSTALL_JOURNAL_VERSION = 1;

export function uninstallItemId(kind: UninstallItemKind, target: string): string {
  const key = target
    .trim()
    .replace(/[\\/]+$/, '')
    .toLowerCase();
  return createHash('sha1').update(`${kind}\u0000${key}`).digest('hex').slice(0, 16);
}

export interface SilentOption {
  args: string[];
  source: 'quiet-string' | 'msi-default';
  wellFormed: boolean;
}

export interface UninstallCommand {
  raw: string;
  kind: UninstallKind;
  executable: string;
  args: string[];
  msiProductCode: string | null;
  exeExists: boolean;
  launchable: boolean;
  blockReason: UninstallCommandBlock | null;
}

export interface UninstallPlannedCommand {
  command: UninstallCommand;
  requiresAdmin: boolean;
  interactiveOnly: boolean;
  silent: SilentOption | null;
}

export interface RemovalApp {
  id: string;
  displayName: string;
  publisher: string;
  version: string;
  hive: UninstallHive;
  installLocation: string;
  estimatedSizeKb: number | null;
}

export interface KeptItem {
  target: string;
  reason: string;
}

export interface LeftoverCandidate {
  id: string;
  path: string;
  bytes: number | null;
  class: LeftoverClass;
  grade: UninstallGrade;
  evidence: string[];
  adminRequired: boolean;
  defaultSelected: boolean;
  syncRoot: boolean;
  link: 'junction' | 'symlink' | null;
  sharedWith: string[];
}

export interface RegistryCandidate {
  id: string;
  hive: UninstallHive;
  path: string;
  scope: 'vendor-root' | 'product' | 'uninstall-key';
  grade: UninstallGrade;
  adminRequired: boolean;
  excludedReason: string | null;
}

export interface StartupCandidate {
  entryId: string;
  name: string;
  source: StartupSource;
  state: 'enabled' | 'disabled';
  disabledKind: 'dust' | 'windows' | null;
  action: 'disable' | 'purge-envelope' | 'none';
  match: 'path' | 'name';
  protected: boolean;
  requiresAdmin: boolean;
}

export interface RemovalTotals {
  bytes: number;
  items: number;
  reviewBytes: number;
  reviewItems: number;
  userDataBytes: number;
  userDataItems: number;
  adminItems: number;
}

export interface RemovalPlan {
  id: string;
  appId: string;
  createdAt: number;
  app: RemovalApp;
  uninstaller: UninstallPlannedCommand | null;
  leftovers: LeftoverCandidate[];
  registry: RegistryCandidate[];
  startup: StartupCandidate[];
  kept: KeptItem[];
  totals: RemovalTotals;
}

export interface UninstallerReport {
  ran: boolean;
  command: string;
  argv: string[];
  exitCode: number | null;
  rebootCode: boolean;
  skippedWaiting: boolean;
  verifiedGone: boolean;
  skippedReason: string | null;
  launchedAt: number | null;
  finishedAt: number | null;
}

export interface FileRemovalReport {
  deletedBytes: number;
  recycledBytes: number;
  deletedItems: number;
  recycledItems: number;
  alreadyGone: number;
  skippedLocked: number;
  errors: DeleteError[];
  kept: KeptItem[];
}

export interface RegistryRemovalReport {
  backupPath: string;
  restoreCommand: string;
  deletedKeys: string[];
  failedKeys: Array<{ path: string; code: string }>;
}

export interface StartupRemovalReport {
  disabled: string[];
  purgedEnvelopes: string[];
  failed: string[];
}

export interface RemovalReport {
  planId: string;
  appId: string;
  appName: string;
  startedAt: number;
  finishedAt: number;
  outcome: UninstallOutcome;
  uninstaller: UninstallerReport;
  files: FileRemovalReport;
  registry: RegistryRemovalReport;
  startup: StartupRemovalReport;
  elevation: 'none' | 'elevated';
  degraded: boolean;
  journalPath: string;
}
