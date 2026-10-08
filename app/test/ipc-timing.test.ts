import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcRegistrar } from '../src/main/ipc';
import type { EngineHost } from '../src/main/host/engine-host';
import type { DashboardState } from '../src/shared/ipc';
import { IPC } from '../src/shared/ipc';

class Registrar implements IpcRegistrar {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }
  invoke(channel: string, ...args: unknown[]): unknown {
    return this.handlers.get(channel)!({}, ...args);
  }
}

function fakeHost(getDashboard: () => Promise<DashboardState>): EngineHost {
  const off = () => () => {};
  return {
    getDashboard,
    onEvent: off,
    onUninstallEvent: off,
    onStartupEvent: off,
  } as unknown as EngineHost;
}

async function load(timing: boolean) {
  vi.resetModules();
  if (timing) vi.stubEnv('DUST_TIMING', '1');
  else vi.stubEnv('DUST_TIMING', '');
  return import('../src/main/ipc');
}

describe('timed() for async handlers', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function timingLines(): string[] {
    return log.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .filter((line: string) => line.includes('dust:timing'));
  }

  it('logs after the promise settles and hands back the same promise', async () => {
    const { registerIpcHandlers } = await load(true);
    let release!: (value: DashboardState) => void;
    const pending = new Promise<DashboardState>((resolve) => {
      release = resolve;
    });
    const registrar = new Registrar();
    registerIpcHandlers(
      registrar,
      fakeHost(() => pending),
      { send: () => {} },
      {
        revealPath: async () => {},
        relaunchElevated: async () => {},
      },
    );

    const returned = registrar.invoke(IPC.dashboardGet);
    await Promise.resolve();
    expect(returned).toBe(pending);
    expect(timingLines()).toEqual([]);

    const value = { volumes: [], scan: null, snapshot: null } as unknown as DashboardState;
    release(value);
    await expect(returned).resolves.toBe(value);
    await Promise.resolve();

    expect(timingLines()).toHaveLength(1);
    expect(timingLines()[0]).toMatch(/^\[dust:timing\] dashboardGet \d+\.\dms$/);
  });

  it('logs a rejected promise too and still rejects for the caller', async () => {
    const { registerIpcHandlers } = await load(true);
    const failure = new Error('nope');
    const registrar = new Registrar();
    registerIpcHandlers(
      registrar,
      fakeHost(() => Promise.reject(failure)),
      { send: () => {} },
      {
        revealPath: async () => {},
        relaunchElevated: async () => {},
      },
    );

    await expect(registrar.invoke(IPC.dashboardGet)).rejects.toBe(failure);
    await Promise.resolve();

    expect(timingLines()).toHaveLength(1);
  });

  it('logs nothing when timing is off', async () => {
    const { registerIpcHandlers } = await load(false);
    const registrar = new Registrar();
    registerIpcHandlers(
      registrar,
      fakeHost(async () => ({}) as DashboardState),
      { send: () => {} },
      {
        revealPath: async () => {},
        relaunchElevated: async () => {},
      },
    );

    await registrar.invoke(IPC.dashboardGet);
    await Promise.resolve();

    expect(timingLines()).toEqual([]);
  });
});
