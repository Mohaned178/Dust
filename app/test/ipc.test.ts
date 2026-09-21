import { SnapshotStore } from '@dust/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngineHost } from '../src/main/host/engine-host';
import { registerIpcHandlers } from '../src/main/ipc';
import type { IpcRegistrar } from '../src/main/ipc';
import { IPC } from '../src/shared/ipc';
import type { DashboardState, ScanEvent, StartAnalyzeResult } from '../src/shared/ipc';
import { FakeSession, emptyScanResult, nextEvent } from './fakes';
import { TempTree } from './fixtures';

class FakeRegistrar implements IpcRegistrar {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler registered for ${channel}`);
    return handler({}, ...args);
  }
}

describe('registerIpcHandlers', () => {
  const trees: TempTree[] = [];

  afterEach(() => {
    for (const tree of trees.splice(0)) tree.cleanup();
  });

  function makeHost(session: FakeSession) {
    const tree = new TempTree();
    trees.push(tree);
    const store = new SnapshotStore({
      snapshotPath: `${tree.root}\\snapshot.json`,
      userPath: `${tree.root}\\user.json`,
    });
    const host = createEngineHost({
      store,
      pool: false,
      listVolumes: () => [{ root: 'T:\\', label: 'Test', driveType: 'fixed' }],
      getVolumeUsage: () => [{ volume: 'T:\\', label: 'Test', totalBytes: 1000, freeBytes: 400 }],
      createRules: () => [],
      createSession: () => session,
    });
    return { host };
  }

  it('routes dashboard, start, cancel and events through the host', async () => {
    const session = new FakeSession({ root: 'T:\\' });
    const { host } = makeHost(session);
    const registrar = new FakeRegistrar();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const unsubscribe = registerIpcHandlers(registrar, host, {
      send: (channel, payload) => sent.push({ channel, payload }),
    });

    const dashboard = (await registrar.invoke(IPC.dashboardGet)) as DashboardState;
    expect(dashboard.volumes.map((volume) => volume.root)).toEqual(['T:\\']);

    const invalid = (await registrar.invoke(IPC.scanStart, 'Z:\\')) as StartAnalyzeResult;
    expect(invalid).toEqual({ ok: false, reason: 'invalid-volume', message: 'unknown volume: Z:\\' });

    const finishedEvent = nextEvent(host, 'finished');
    const started = (await registrar.invoke(IPC.scanStart, 't:\\')) as StartAnalyzeResult;
    expect(started.ok).toBe(true);

    await registrar.invoke(IPC.scanCancel);
    expect(session.cancelled).toBe(true);

    session.finish(emptyScanResult('T:\\', 'cancelled'));
    await finishedEvent;
    await Promise.resolve();

    const forwarded = sent.filter((entry) => entry.channel === IPC.scanEvent).map((entry) => entry.payload as ScanEvent);
    expect(forwarded.some((event) => event.type === 'started')).toBe(true);
    expect(forwarded.some((event) => event.type === 'finished')).toBe(true);

    unsubscribe();
    host.dispose();
  });
});
