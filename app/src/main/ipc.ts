import { appendFileSync } from 'node:fs';
import { IPC } from '../shared/ipc';
import type {
  CleanExecuteRequest,
  CleanPreviewRequest,
  ScanEvent,
  StartupLaunchHint,
  StartupRelaunchAction,
  UninstallExecuteRequest,
  UninstallLaunchHint,
  UninstallRunRequest,
  UpdateStatus,
} from '../shared/ipc';
import type { EngineHost } from './host/engine-host';
import { instrument } from './host/instrument';

export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface EventSender {
  send(channel: string, payload: unknown): void;
}

export interface ShellActions {
  revealPath(path: string): Promise<void>;
  relaunchElevated(startupToggleId?: string, action?: StartupRelaunchAction): Promise<void>;
  relaunchElevatedUninstall?(jobId: string): Promise<void>;
}

export interface UpdateActions {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  install(): void;
}

const IDLE_UPDATE_STATUS: UpdateStatus = { phase: 'idle', version: null, percent: null, message: null };

const timingEnabled = process.env.DUST_TIMING === '1';
let timingLogPath: string | null = null;

export function setTimingLogPath(path: string): void {
  timingLogPath = path;
}

function logTiming(name: string, startedAt: number): void {
  const line = `[dust:timing] ${name} ${(performance.now() - startedAt).toFixed(1)}ms\n`;
  try {
    if (timingLogPath !== null) appendFileSync(timingLogPath, line);
    else console.log(line.trimEnd());
  } catch {
    /* timing must never break the app */
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function timed<T>(name: string, fn: () => T): T {
  if (!timingEnabled) return fn();
  const startedAt = performance.now();
  let result: T;
  try {
    result = fn();
  } catch (error) {
    logTiming(name, startedAt);
    throw error;
  }
  if (isThenable(result)) {
    // Log once it settles; the caller still gets the original promise.
    try {
      const log = (): void => logTiming(name, startedAt);
      result.then(log, log);
    } catch {
      /* timing must never break the app */
    }
  } else {
    logTiming(name, startedAt);
  }
  return result;
}

export function registerIpcHandlers(
  registrar: IpcRegistrar,
  host: EngineHost,
  sender: EventSender,
  shell: ShellActions,
  getStartupLaunchHint: () => StartupLaunchHint | null = () => null,
  getUninstallLaunchHint: () => UninstallLaunchHint | null = () => null,
  updates: UpdateActions | null = null,
): () => void {
  registrar.handle(IPC.dashboardGet, () => timed('dashboardGet', () => host.getDashboard()));
  registrar.handle(IPC.scanStart, (_event, volume) => host.startAnalyze(typeof volume === 'string' ? volume : ''));
  registrar.handle(IPC.scanCancel, () => host.cancelScan());
  registrar.handle(IPC.resultsGet, (_event, root) =>
    timed('resultsGet', () => host.getResults(typeof root === 'string' ? root : '')),
  );
  registrar.handle(IPC.resultsCategoriesGet, (_event, root) =>
    timed('resultsCategoriesGet', () => host.getResultCategories(typeof root === 'string' ? root : '')),
  );
  registrar.handle(IPC.browseStart, (_event, volume) => host.startBrowse(typeof volume === 'string' ? volume : ''));
  registrar.handle(IPC.browseResultsGet, (_event, root) =>
    timed('browseResultsGet', () => host.getBrowseResults(typeof root === 'string' ? root : '')),
  );
  registrar.handle(IPC.browseDelete, (_event, path) => host.deleteBrowsePath(typeof path === 'string' ? path : ''));
  registrar.handle(IPC.revealPath, (_event, path) => shell.revealPath(typeof path === 'string' ? path : ''));
  registrar.handle(IPC.cleanPreview, (_event, request) => {
    const parsed = parseCleanPreviewRequest(request);
    return parsed === null
      ? { ok: false, reason: 'failed', message: 'Invalid cleanup request' }
      : host.previewClean(parsed);
  });
  registrar.handle(IPC.cleanExecute, (_event, request) => host.executeClean(parseCleanExecuteRequest(request)));
  registrar.handle(IPC.devCleanupGet, (_event, root) =>
    timed('devCleanupGet', () => host.getDevCleanup(typeof root === 'string' ? root : '')),
  );
  registrar.handle(IPC.pinsSet, (_event, path, pinned) =>
    host.setPin(typeof path === 'string' ? path : '', pinned === true),
  );
  registrar.handle(IPC.startupList, () => timed('startupList', () => host.getStartup()));
  registrar.handle(IPC.startupDisable, (_event, id) => host.disableStartup(typeof id === 'string' ? id : ''));
  registrar.handle(IPC.startupEnable, (_event, id) => host.enableStartup(typeof id === 'string' ? id : ''));
  registrar.handle(IPC.startupHint, () => getStartupLaunchHint());
  registrar.handle(IPC.systemInfoGet, (_event, force) =>
    timed('systemInfoGet', () => host.getSystemInfo(force === true)),
  );
  registrar.handle(IPC.systemInfoLive, () => host.getSystemInfoLive());
  registrar.handle(IPC.relaunchElevated, (_event, id, action) =>
    shell.relaunchElevated(typeof id === 'string' ? id : undefined, action === 'enable' ? 'enable' : 'disable'),
  );
  registrar.handle(IPC.uninstallList, (_event, force) =>
    timed('uninstallList', () => host.listUninstall(force === true)),
  );
  registrar.handle(IPC.uninstallPreview, (_event, appId, options) =>
    timed('uninstallPreview', () =>
      host.previewUninstall(typeof appId === 'string' ? appId : '', {
        leftoversOnly:
          typeof options === 'object' &&
          options !== null &&
          (options as Record<string, unknown>).leftoversOnly === true,
      }),
    ),
  );
  registrar.handle(IPC.uninstallRun, (_event, request) => host.runUninstaller(parseUninstallRunRequest(request)));
  registrar.handle(IPC.uninstallExecute, (_event, request) =>
    host.executeUninstall(parseUninstallExecuteRequest(request)),
  );
  registrar.handle(IPC.uninstallSkipWaiting, () => host.skipUninstallWaiting());
  registrar.handle(IPC.uninstallHint, () => getUninstallLaunchHint());
  registrar.handle(
    IPC.relaunchElevatedUninstall,
    (_event, jobId) => shell.relaunchElevatedUninstall?.(typeof jobId === 'string' ? jobId : '') ?? Promise.resolve(),
  );
  registrar.handle(IPC.updatesGet, () => updates?.status() ?? IDLE_UPDATE_STATUS);
  registrar.handle(IPC.updatesCheck, () => updates?.check() ?? IDLE_UPDATE_STATUS);
  registrar.handle(IPC.updatesInstall, () => {
    updates?.install();
  });
  const offScan = host.onEvent((event: ScanEvent) => {
    instrument('ipc.send', () => sender.send(IPC.scanEvent, event));
  });
  const offUninstall = host.onUninstallEvent((event) => {
    instrument('ipc.send', () => sender.send(IPC.uninstallEvent, event));
  });
  const offStartup = host.onStartupEvent((event) => {
    instrument('ipc.send', () => sender.send(IPC.startupEvent, event));
  });
  return () => {
    offScan();
    offUninstall();
    offStartup();
  };
}

export function parseCleanPreviewRequest(value: unknown): CleanPreviewRequest | null {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.scope === 'quick') return { scope: 'quick' };
    if (
      (record.scope === 'dev' || record.scope === 'row') &&
      typeof record.root === 'string' &&
      record.root.length > 0
    ) {
      const paths = Array.isArray(record.paths)
        ? record.paths.filter((entry): entry is string => typeof entry === 'string')
        : [];
      return { scope: record.scope, root: record.root, paths };
    }
  }
  return null;
}

export function parseCleanExecuteRequest(value: unknown): CleanExecuteRequest {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const acknowledge = Array.isArray(record.acknowledge)
    ? record.acknowledge.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    cleanId: typeof record.cleanId === 'string' ? record.cleanId : '',
    planId: typeof record.planId === 'string' ? record.planId : '',
    acknowledge,
  };
}

export function parseUninstallRunRequest(value: unknown): UninstallRunRequest {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    jobId: typeof record.jobId === 'string' ? record.jobId : '',
    appId: typeof record.appId === 'string' ? record.appId : '',
    quiet: record.quiet === true,
  };
}

export function parseUninstallExecuteRequest(value: unknown): UninstallExecuteRequest {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const strings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === 'string') : [];
  return {
    jobId: typeof record.jobId === 'string' ? record.jobId : '',
    planId: typeof record.planId === 'string' ? record.planId : '',
    selection: strings(record.selection),
    includeUserData: record.includeUserData === true,
    runUninstaller: record.runUninstaller !== false,
    quiet: record.quiet === true,
    acknowledge: strings(record.acknowledge),
  };
}
