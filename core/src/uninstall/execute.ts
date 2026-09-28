import { execFile, spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { deletePathTree } from '../cleaner/executor';
import { stageToRecycleBin } from '../cleaner/recycle';
import { createRegistryBackup, fullRegistryPath } from './backup';
import type { BackupResult } from './backup';
import type { Journal } from './journal';
import { missingAcknowledgements } from './plan';
import type { VerifyResult } from './verify';
import { waitForRemoval } from './verify';
import type {
  FileRemovalReport,
  KeptItem,
  RegistryCandidate,
  RemovalPlan,
  RemovalReport,
  UninstallCommand,
  UninstallPhase,
  UninstallerReport,
  StartupRemovalReport,
} from './types';

export interface UninstallerRunInput {
  command: UninstallCommand;
  argv: string[];
  cwd?: string;
  quiet: boolean;
  shouldStopWaiting: () => boolean;
  onSpawned: (pid: number | null) => void;
}

export interface UninstallerRunOutcome {
  exitCode: number | null;
  skippedWaiting: boolean;
}

export type UninstallerRunner = (input: UninstallerRunInput) => Promise<UninstallerRunOutcome>;

export type FileRemoveMode = 'delete' | 'recycle';

export interface FileRemoveOutcome {
  status: 'deleted' | 'recycled' | 'already-gone' | 'partial' | 'failed' | 'kept' | 'skipped-locked';
  bytes: number;
  skippedLocked: number;
  code?: string;
}

export type FileRemover = (path: string, mode: FileRemoveMode) => Promise<FileRemoveOutcome>;

export interface StartupActions {
  disable(entryId: string): Promise<boolean>;
  purgeEnvelope(entryId: string): Promise<boolean>;
}

export interface RemovalExecutionRequest {
  plan: RemovalPlan;
  selection: readonly string[];
  acknowledge?: readonly string[];
  includeUserData: boolean;
  runUninstaller: boolean;
  quiet: boolean;
  degraded: boolean;
  elevated: boolean;
}

export interface RemovalExecutionDeps {
  backupDir: string;
  journalPath: string;
  journal: Pick<Journal, 'append'>;
  now?: () => number;
  createBackup?: (candidates: readonly RegistryCandidate[], appId: string) => Promise<BackupResult>;
  runUninstaller?: UninstallerRunner;
  checkAppKeyPresent?: () => Promise<boolean>;
  waitForRemoval?: (options: {
    check: () => Promise<boolean>;
    shouldStop: () => boolean;
  }) => Promise<VerifyResult>;
  removeFile?: FileRemover;
  deleteRegistryKey?: (fullKeyPath: string) => Promise<boolean>;
  startup?: StartupActions;
  shouldStopWaiting?: () => boolean;
  onEvent?: (event: RemovalEvent) => void;
}

export type RemovalEvent =
  | { type: 'phase'; phase: UninstallPhase; status: 'started' | 'done' | 'failed' | 'skipped'; note?: string }
  | { type: 'uninstaller-started'; pid: number | null; argv: string[] }
  | { type: 'uninstaller-exited'; exitCode: number | null }
  | { type: 'reboot-required' }
  | { type: 'verify'; gone: boolean; attempt: number }
  | { type: 'item'; itemId: string; status: FileRemoveOutcome['status']; bytes: number };

export type RemovalExecutionResult =
  | { ok: true; report: RemovalReport }
  | { ok: false; reason: 'unacknowledged-review'; items: string[] }
  | { ok: false; reason: 'no-selection' };

const REBOOT_EXIT_CODES = new Set([3010, 1641]);

const SCOPE_ORDER: Record<RegistryCandidate['scope'], number> = {
  'vendor-root': 0,
  product: 1,
  'uninstall-key': 2,
};

function execFileAsync(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { encoding: 'utf8', timeout: 60_000, windowsHide: true }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function defaultPresenceCheck(plan: RemovalPlan): () => Promise<boolean> {
  const candidate = plan.registry.find((entry) => entry.scope === 'uninstall-key');
  if (candidate === undefined) return async () => false;
  const key = fullRegistryPath(candidate.hive, candidate.path);
  return async () => {
    try {
      await execFileAsync('reg.exe', ['query', key]);
      return true;
    } catch {
      return false;
    }
  };
}

function defaultDeleteRegistryKey(fullKeyPath: string): Promise<boolean> {
  return execFileAsync('reg.exe', ['delete', fullKeyPath, '/f']).then(
    () => true,
    () => false,
  );
}

function defaultFileRemover(): FileRemover {
  return async (path, mode) => {
    if (mode === 'recycle') {
      const staged = await stageToRecycleBin(path);
      return staged.ok
        ? { status: 'recycled', bytes: 0, skippedLocked: 0 }
        : { status: 'kept', bytes: 0, skippedLocked: 0, code: staged.code ?? 'RECYCLE-ERROR' };
    }
    const outcome = deletePathTree(path);
    switch (outcome.status) {
      case 'done':
        return { status: 'deleted', bytes: outcome.deletedBytes, skippedLocked: 0 };
      case 'already-gone':
        return { status: 'already-gone', bytes: 0, skippedLocked: 0 };
      case 'partial':
        return {
          status: 'partial',
          bytes: outcome.deletedBytes,
          skippedLocked: outcome.skippedLocked,
          code: outcome.errors[0]?.code,
        };
      default:
        return {
          status: 'failed',
          bytes: outcome.deletedBytes,
          skippedLocked: outcome.skippedLocked,
          code: outcome.errors[0]?.code ?? 'DELETE-FAILED',
        };
    }
  };
}

function cwdFor(executable: string): string | undefined {
  if (!/[\\/]/.test(executable)) return undefined;
  return dirname(executable);
}

function defaultUninstallerRunner(input: UninstallerRunInput): Promise<UninstallerRunOutcome> {
  const child = spawn(input.command.executable, input.argv, {
    cwd: input.cwd,
    windowsHide: input.quiet,
    stdio: 'ignore',
  });
  input.onSpawned(child.pid ?? null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: UninstallerRunOutcome): void => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(outcome);
    };
    const timer = setInterval(() => {
      if (!input.shouldStopWaiting()) return;
      try {
        child.unref();
      } catch {
        /* the child may already be gone */
      }
      finish({ exitCode: null, skippedWaiting: true });
    }, 500);
    child.once('error', () => finish({ exitCode: null, skippedWaiting: false }));
    child.once('exit', (code) => finish({ exitCode: code, skippedWaiting: false }));
  });
}

export async function executeRemoval(
  request: RemovalExecutionRequest,
  deps: RemovalExecutionDeps,
): Promise<RemovalExecutionResult> {
  const { plan } = request;
  const now = deps.now ?? Date.now;
  const emit = (event: RemovalEvent): void => {
    try {
      deps.onEvent?.(event);
    } catch {
      /* observers must never break a removal run */
    }
  };
  const phase = (
    name: UninstallPhase,
    status: 'started' | 'done' | 'failed' | 'skipped',
    note?: string,
  ): void => {
    emit(note === undefined ? { type: 'phase', phase: name, status } : { type: 'phase', phase: name, status, note });
    deps.journal.append('phase', note === undefined ? { phase: name, status } : { phase: name, status, note });
  };

  const missing = missingAcknowledgements(plan, request.selection, request.acknowledge ?? []);
  if (missing.length > 0) return { ok: false, reason: 'unacknowledged-review', items: missing };

  const degraded = request.degraded && !request.elevated;
  const selection = new Set(request.selection);
  const selectionKept: KeptItem[] = [];
  const degradedRegistry: Array<{ path: string; code: string }> = [];

  const selectedLeftovers = plan.leftovers.filter((item) => {
    if (!selection.has(item.id)) return false;
    if (item.class === 'user-data' && !request.includeUserData) {
      selectionKept.push({ target: item.path, reason: 'user-data-not-included' });
      return false;
    }
    if (degraded && item.adminRequired) {
      selectionKept.push({ target: item.path, reason: 'needs-admin' });
      return false;
    }
    return true;
  });
  const selectedRegistry = plan.registry.filter((item) => {
    if (!selection.has(item.id)) return false;
    if (degraded && item.adminRequired) {
      degradedRegistry.push({ path: fullRegistryPath(item.hive, item.path), code: 'NEEDS-ADMIN' });
      return false;
    }
    return true;
  });
  const selectedStartup = plan.startup.filter(
    (item) => selection.has(item.entryId) && item.action !== 'none',
  );

  const uninstaller = plan.uninstaller;
  const uninstallerSelected = request.runUninstaller && uninstaller !== null;

  if (
    selectedLeftovers.length === 0 &&
    selectedRegistry.length === 0 &&
    selectedStartup.length === 0 &&
    !uninstallerSelected
  ) {
    return { ok: false, reason: 'no-selection' };
  }

  const startedAt = now();
  const uninstallerReport: UninstallerReport = {
    ran: false,
    command: uninstaller?.command.raw ?? '',
    argv: [],
    exitCode: null,
    rebootCode: false,
    skippedWaiting: false,
    verifiedGone: false,
    skippedReason: null,
    launchedAt: null,
    finishedAt: null,
  };
  const fileKept: KeptItem[] = [...selectionKept];
  const filesReport: FileRemovalReport = {
    deletedBytes: 0,
    recycledBytes: 0,
    deletedItems: 0,
    recycledItems: 0,
    skippedLocked: 0,
    errors: [],
    kept: fileKept,
  };
  const registryDeleted: string[] = [];
  const registryFailures: Array<{ path: string; code: string }> = [];
  const startupReport: StartupRemovalReport = { disabled: [], purgedEnvelopes: [], failed: [] };
  let backup: BackupResult | null = null;

  phase('prepare', 'started');
  deps.journal.append('started', { appName: plan.app.displayName });
  phase('prepare', 'done');

  if (selectedRegistry.length > 0) {
    phase('backup', 'started');
    const createBackup =
      deps.createBackup ??
      ((candidates: readonly RegistryCandidate[], appId: string) =>
        createRegistryBackup(candidates, appId, { backupDir: deps.backupDir, now }));
    try {
      backup = await createBackup(selectedRegistry, plan.appId);
    } catch (error) {
      backup = {
        ok: false,
        reason: 'export-failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (backup.ok) {
      deps.journal.append('backup', { path: backup.path, keys: backup.exportedKeys.length });
      phase('backup', 'done');
    } else {
      deps.journal.append('error', { phase: 'backup', reason: backup.reason, detail: backup.detail ?? null });
      phase('backup', 'failed', backup.reason);
    }
  } else {
    phase('backup', 'skipped');
  }

  if (uninstallerSelected && uninstaller !== null) {
    if (!uninstaller.command.launchable) {
      uninstallerReport.skippedReason = uninstaller.command.blockReason ?? 'not-launchable';
      phase('uninstaller', 'skipped', uninstallerReport.skippedReason);
    } else {
      phase('uninstaller', 'started');
      const useSilent = request.quiet && uninstaller.silent !== null;
      const argv = useSilent ? uninstaller.silent!.args : uninstaller.command.args;
      uninstallerReport.ran = true;
      uninstallerReport.argv = argv;
      uninstallerReport.launchedAt = now();
      deps.journal.append('uninstaller-spawned', { argv, quiet: useSilent });
      const run = deps.runUninstaller ?? defaultUninstallerRunner;
      const outcome = await run({
        command: uninstaller.command,
        argv,
        cwd: cwdFor(uninstaller.command.executable),
        quiet: useSilent,
        shouldStopWaiting: () => deps.shouldStopWaiting?.() === true,
        onSpawned: (pid) => emit({ type: 'uninstaller-started', pid, argv }),
      });
      uninstallerReport.exitCode = outcome.exitCode;
      uninstallerReport.skippedWaiting = outcome.skippedWaiting;
      uninstallerReport.finishedAt = now();
      uninstallerReport.rebootCode = outcome.exitCode !== null && REBOOT_EXIT_CODES.has(outcome.exitCode);
      deps.journal.append('uninstaller-exited', {
        exitCode: outcome.exitCode,
        skippedWaiting: outcome.skippedWaiting,
      });
      emit({ type: 'uninstaller-exited', exitCode: outcome.exitCode });
      if (uninstallerReport.rebootCode) {
        emit({ type: 'reboot-required' });
        phase('uninstaller', 'done', 'reboot-required');
      } else {
        phase('uninstaller', 'done');
      }
    }
  } else {
    phase('uninstaller', 'skipped');
  }

  if (uninstallerReport.rebootCode) {
    for (const name of ['verify', 'files', 'registry', 'startup'] as const) {
      phase(name, 'skipped', 'reboot-required');
    }
    phase('finish', 'started');
    deps.journal.append('finished', { outcome: 'reboot-required' });
    phase('finish', 'done');
    return {
      ok: true,
      report: buildReport('reboot-required'),
    };
  }

  if (uninstallerReport.ran) {
    phase('verify', 'started');
    const check = deps.checkAppKeyPresent ?? defaultPresenceCheck(plan);
    let verify: VerifyResult;
    if (uninstallerReport.skippedWaiting) {
      const present = await check();
      verify = { gone: !present, attempts: 1, skipped: true, elapsedMs: 0 };
    } else {
      const wait =
        deps.waitForRemoval ??
        ((options: { check: () => Promise<boolean>; shouldStop: () => boolean }) => waitForRemoval(options));
      verify = await wait({
        check,
        shouldStop: () => deps.shouldStopWaiting?.() === true,
      });
    }
    uninstallerReport.verifiedGone = verify.gone;
    deps.journal.append('verify', { gone: verify.gone, attempts: verify.attempts, skipped: verify.skipped });
    emit({ type: 'verify', gone: verify.gone, attempt: verify.attempts });
    phase('verify', 'done');
  } else {
    phase('verify', 'skipped');
  }

  if (selectedLeftovers.length > 0) {
    phase('files', 'started');
    const remove = deps.removeFile ?? defaultFileRemover();
    for (const item of selectedLeftovers) {
      if (item.link !== null) {
        fileKept.push({ target: item.path, reason: 'reparse-point' });
        emit({ type: 'item', itemId: item.id, status: 'kept', bytes: 0 });
        continue;
      }
      if (item.syncRoot) {
        fileKept.push({ target: item.path, reason: 'synced-folder' });
        emit({ type: 'item', itemId: item.id, status: 'kept', bytes: 0 });
        continue;
      }
      const mode: FileRemoveMode = item.grade === 'review' ? 'recycle' : 'delete';
      let outcome: FileRemoveOutcome;
      try {
        outcome = await remove(item.path, mode);
      } catch {
        outcome = { status: 'failed', bytes: 0, skippedLocked: 0, code: 'UNKNOWN' };
      }
      switch (outcome.status) {
        case 'deleted':
          filesReport.deletedItems += 1;
          filesReport.deletedBytes += outcome.bytes;
          break;
        case 'recycled':
          filesReport.recycledItems += 1;
          filesReport.recycledBytes += outcome.bytes;
          break;
        case 'already-gone':
          filesReport.deletedItems += 1;
          break;
        case 'partial':
          filesReport.deletedBytes += outcome.bytes;
          filesReport.skippedLocked += outcome.skippedLocked;
          if (outcome.code !== undefined) filesReport.errors.push({ path: item.path, code: outcome.code });
          break;
        case 'skipped-locked':
          filesReport.skippedLocked += Math.max(outcome.skippedLocked, 1);
          break;
        case 'kept':
          fileKept.push({ target: item.path, reason: outcome.code ?? 'kept' });
          break;
        case 'failed':
          filesReport.errors.push({ path: item.path, code: outcome.code ?? 'UNKNOWN' });
          break;
      }
      emit({ type: 'item', itemId: item.id, status: outcome.status, bytes: outcome.bytes });
    }
    deps.journal.append('files', {
      deleted: filesReport.deletedItems,
      recycled: filesReport.recycledItems,
      locked: filesReport.skippedLocked,
      errors: filesReport.errors.length,
    });
    phase('files', 'done');
  } else {
    phase('files', 'skipped');
  }

  if (selectedRegistry.length > 0) {
    if (backup === null || !backup.ok) {
      phase('registry', 'skipped', 'no-backup');
    } else {
      phase('registry', 'started');
      const allowed = new Set(backup.exportedKeys);
      const ordered = [...selectedRegistry].sort(
        (a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope],
      );
      const removeKey = deps.deleteRegistryKey ?? defaultDeleteRegistryKey;
      for (const item of ordered) {
        const full = fullRegistryPath(item.hive, item.path);
        if (!allowed.has(full)) {
          registryFailures.push({ path: full, code: 'NOT-BACKED-UP' });
          emit({ type: 'item', itemId: item.id, status: 'failed', bytes: 0 });
          continue;
        }
        const deleted = await removeKey(full);
        if (deleted) {
          registryDeleted.push(full);
          emit({ type: 'item', itemId: item.id, status: 'deleted', bytes: 0 });
        } else {
          registryFailures.push({ path: full, code: 'DELETE-FAILED' });
          emit({ type: 'item', itemId: item.id, status: 'failed', bytes: 0 });
        }
      }
      deps.journal.append('registry', {
        deleted: registryDeleted.length,
        failed: registryFailures.length,
      });
      phase('registry', 'done');
    }
  } else {
    phase('registry', 'skipped');
  }

  if (selectedStartup.length > 0) {
    if (deps.startup === undefined) {
      startupReport.failed.push(...selectedStartup.map((item) => item.name));
      phase('startup', 'failed', 'unavailable');
    } else {
      phase('startup', 'started');
      for (const item of selectedStartup) {
        const ok =
          item.action === 'disable'
            ? await deps.startup.disable(item.entryId)
            : await deps.startup.purgeEnvelope(item.entryId);
        if (!ok) {
          startupReport.failed.push(item.name);
          continue;
        }
        if (item.action === 'disable') startupReport.disabled.push(item.name);
        else startupReport.purgedEnvelopes.push(item.name);
      }
      deps.journal.append('startup', {
        disabled: startupReport.disabled.length,
        purged: startupReport.purgedEnvelopes.length,
        failed: startupReport.failed.length,
      });
      phase('startup', 'done');
    }
  } else {
    phase('startup', 'skipped');
  }

  const allRegistryFailures = [...registryFailures, ...degradedRegistry];
  const hasFailures =
    filesReport.errors.length > 0 ||
    filesReport.skippedLocked > 0 ||
    allRegistryFailures.length > 0 ||
    startupReport.failed.length > 0 ||
    (backup !== null && !backup.ok) ||
    uninstallerReport.skippedReason !== null ||
    (uninstallerReport.ran && !uninstallerReport.verifiedGone);
  const removedSomething =
    filesReport.deletedItems + filesReport.recycledItems > 0 ||
    registryDeleted.length > 0 ||
    startupReport.disabled.length + startupReport.purgedEnvelopes.length > 0 ||
    uninstallerReport.verifiedGone;

  phase('finish', 'started');
  const outcome = !hasFailures ? 'complete' : removedSomething ? 'partial' : 'failed';
  deps.journal.append('finished', { outcome });
  phase('finish', 'done');

  function buildReport(finalOutcome: RemovalReport['outcome']): RemovalReport {
    return {
      planId: plan.id,
      appId: plan.appId,
      appName: plan.app.displayName,
      startedAt,
      finishedAt: now(),
      outcome: finalOutcome,
      uninstaller: uninstallerReport,
      files: filesReport,
      registry: {
        backupPath: backup !== null && backup.ok ? backup.path : '',
        restoreCommand: backup !== null && backup.ok ? backup.restoreCommand : '',
        deletedKeys: registryDeleted,
        failedKeys: [...registryFailures, ...degradedRegistry],
      },
      startup: startupReport,
      elevation: request.elevated ? 'elevated' : 'none',
      degraded,
      journalPath: deps.journalPath,
    };
  }

  return { ok: true, report: buildReport(outcome) };
}
