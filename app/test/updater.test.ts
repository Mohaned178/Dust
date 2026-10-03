import { describe, expect, it } from 'vitest';
import { createUpdateService } from '../src/main/updater';
import type { UpdaterAdapter } from '../src/main/updater';
import type { UpdateStatus } from '../src/shared/ipc';

interface FakeUpdater extends UpdaterAdapter {
  emit(event: string, ...args: unknown[]): void;
  checks: number;
  installs: number;
}

function makeFakeUpdater(): FakeUpdater {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const updater: FakeUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checks: 0,
    installs: 0,
    on: (event, listener) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return updater;
    },
    checkForUpdates: async () => {
      updater.checks += 1;
    },
    quitAndInstall: () => {
      updater.installs += 1;
    },
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return updater;
}

describe('createUpdateService', () => {
  it('tracks the full download lifecycle and enables auto-download', () => {
    const updater = makeFakeUpdater();
    const statuses: UpdateStatus[] = [];
    const service = createUpdateService({
      updater,
      isPackaged: true,
      onStatus: (status) => statuses.push(status),
    });

    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '1.2.0' });
    updater.emit('download-progress', { percent: 41.6 });
    updater.emit('update-downloaded', { version: '1.2.0' });

    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(statuses).toEqual([
      { phase: 'checking', version: null, percent: null, message: null },
      { phase: 'available', version: '1.2.0', percent: null, message: null },
      { phase: 'downloading', version: '1.2.0', percent: 42, message: null },
      { phase: 'downloaded', version: '1.2.0', percent: 100, message: null },
    ]);
    expect(service.status().phase).toBe('downloaded');
  });

  it('only installs once an update has been downloaded', () => {
    const updater = makeFakeUpdater();
    const service = createUpdateService({ updater, isPackaged: true, onStatus: () => {} });

    service.install();
    expect(updater.installs).toBe(0);

    updater.emit('update-downloaded', { version: '1.2.0' });
    service.install();
    expect(updater.installs).toBe(1);
  });

  it('schedules a background check after the delay in packaged builds', async () => {
    const updater = makeFakeUpdater();
    const scheduled: { fn: (() => void) | null } = { fn: null };
    let scheduledDelay = 0;
    const service = createUpdateService({
      updater,
      isPackaged: true,
      onStatus: () => {},
      checkDelayMs: 1234,
      setTimer: (fn, ms) => {
        scheduled.fn = fn;
        scheduledDelay = ms;
        return 1;
      },
    });

    service.start();
    expect(scheduledDelay).toBe(1234);
    expect(updater.checks).toBe(0);
    scheduled.fn?.();
    await Promise.resolve();
    expect(updater.checks).toBe(1);

    service.start();
    expect(updater.checks).toBe(1);
  });

  it('never checks in development builds', async () => {
    const updater = makeFakeUpdater();
    const statuses: UpdateStatus[] = [];
    const service = createUpdateService({ updater, isPackaged: false, onStatus: (status) => statuses.push(status) });

    service.start();
    await service.check();

    expect(updater.checks).toBe(0);
    expect(statuses).toEqual([
      { phase: 'idle', version: null, percent: null, message: 'Updates are available in packaged builds only.' },
    ]);
  });

  it('surfaces check failures as an error status', async () => {
    const updater = makeFakeUpdater();
    updater.checkForUpdates = async () => {
      throw new Error('network down');
    };
    const statuses: UpdateStatus[] = [];
    const service = createUpdateService({ updater, isPackaged: true, onStatus: (status) => statuses.push(status) });

    await service.check();

    expect(statuses).toContainEqual({ phase: 'error', version: null, percent: null, message: 'network down' });
  });
});
