import type { UpdateStatus } from '../shared/ipc';

export interface UpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateServiceDeps {
  updater: UpdaterAdapter;
  isPackaged: boolean;
  onStatus: (status: UpdateStatus) => void;
  checkDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface UpdateService {
  start(): void;
  check(): Promise<UpdateStatus>;
  install(): void;
  status(): UpdateStatus;
  dispose(): void;
}

export const UPDATE_CHECK_DELAY_MS = 10_000;

const IDLE_STATUS: UpdateStatus = { phase: 'idle', version: null, percent: null, message: null };

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  let current: UpdateStatus = { ...IDLE_STATUS };
  let timer: unknown = null;
  let wired = false;

  function publish(next: UpdateStatus): void {
    current = next;
    deps.onStatus(next);
  }

  function wire(): void {
    if (wired) return;
    wired = true;
    const updater = deps.updater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => {
      publish({ phase: 'checking', version: null, percent: null, message: null });
    });
    updater.on('update-available', (info) => {
      publish({ phase: 'available', version: versionOf(info), percent: null, message: null });
    });
    updater.on('update-not-available', () => {
      publish({ phase: 'up-to-date', version: null, percent: null, message: null });
    });
    updater.on('download-progress', (progress) => {
      publish({ phase: 'downloading', version: current.version, percent: percentOf(progress), message: null });
    });
    updater.on('update-downloaded', (info) => {
      publish({ phase: 'downloaded', version: versionOf(info), percent: 100, message: null });
    });
    updater.on('error', (error) => {
      publish({ phase: 'error', version: current.version, percent: null, message: messageOf(error) });
    });
  }

  async function check(): Promise<UpdateStatus> {
    if (!deps.isPackaged) {
      publish({
        phase: 'idle',
        version: null,
        percent: null,
        message: 'Updates are available in packaged builds only.',
      });
      return current;
    }
    wire();
    try {
      await deps.updater.checkForUpdates();
    } catch (error) {
      publish({ phase: 'error', version: current.version, percent: null, message: messageOf(error) });
    }
    return current;
  }

  function install(): void {
    if (current.phase !== 'downloaded') return;
    deps.updater.quitAndInstall();
  }

  function start(): void {
    if (!deps.isPackaged || timer !== null) return;
    wire();
    const schedule = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    timer = schedule(() => {
      void check();
    }, deps.checkDelayMs ?? UPDATE_CHECK_DELAY_MS);
  }

  function dispose(): void {
    if (timer === null) return;
    const cancel = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
    cancel(timer);
    timer = null;
  }

  if (deps.isPackaged) wire();

  return { start, check, install, status: () => current, dispose };
}

function versionOf(info: unknown): string | null {
  if (typeof info === 'object' && info !== null && 'version' in info) {
    const version = (info as { version?: unknown }).version;
    if (typeof version === 'string' && version.length > 0) return version;
  }
  return null;
}

function percentOf(progress: unknown): number | null {
  if (typeof progress === 'object' && progress !== null && 'percent' in progress) {
    const percent = (progress as { percent?: unknown }).percent;
    if (typeof percent === 'number' && Number.isFinite(percent)) return Math.round(percent);
  }
  return null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
