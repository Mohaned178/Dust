import { SnapshotStore } from '@dust/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngineHost } from '../src/main/host/engine-host';
import { registerIpcHandlers, parseCleanPreviewRequest } from '../src/main/ipc';
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
      systemRoot: 'T:\\',
      listVolumes: () => [{ root: 'T:\\', label: 'Test', driveType: 'fixed', mediaType: 'unknown' }],
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
    const revealed: string[] = [];
    const relaunched: number[] = [];
    const unsubscribe = registerIpcHandlers(
      registrar,
      host,
      {
        send: (channel, payload) => sent.push({ channel, payload }),
      },
      {
        revealPath: async (path) => {
          revealed.push(path);
        },
        relaunchElevated: async () => {
          relaunched.push(1);
        },
      },
    );

    const dashboard = (await registrar.invoke(IPC.dashboardGet)) as DashboardState;
    expect(dashboard.volumes.map((volume) => volume.root)).toEqual(['T:\\']);

    const invalid = (await registrar.invoke(IPC.scanStart, 'Z:\\')) as StartAnalyzeResult;
    expect(invalid).toEqual({ ok: false, reason: 'invalid-volume', message: 'unknown volume: Z:\\' });

    const finishedEvent = nextEvent(host, 'finished');
    const started = (await registrar.invoke(IPC.scanStart, 't:\\')) as StartAnalyzeResult;
    expect(started.ok).toBe(true);

    const cancelled = registrar.invoke(IPC.scanCancel);
    expect(session.cancelled).toBe(true);

    session.finish(emptyScanResult('T:\\', 'cancelled'));
    await finishedEvent;
    expect(await cancelled).toBe(true);
    await Promise.resolve();

    const forwarded = sent.filter((entry) => entry.channel === IPC.scanEvent).map((entry) => entry.payload as ScanEvent);
    expect(forwarded.some((event) => event.type === 'started')).toBe(true);
    expect(forwarded.some((event) => event.type === 'finished')).toBe(true);

    const results = (await registrar.invoke(IPC.resultsGet, 'Z:\\')) as { source: string };
    expect(results.source).toBe('empty');

    await registrar.invoke(IPC.revealPath, 'T:\\Temp');
    expect(revealed).toEqual(['T:\\Temp']);

    await registrar.invoke(IPC.relaunchElevated);
    expect(relaunched).toEqual([1]);

    unsubscribe();
    host.dispose();
  });

  it('routes preview, execute, dev cleanup and pins through the host', async () => {
    const { host } = makeHost(new FakeSession({ root: 'T:\\' }));
    const registrar = new FakeRegistrar();
    const unsubscribe = registerIpcHandlers(
      registrar,
      host,
      {
        send: () => {},
      },
      {
        revealPath: async () => {},
        relaunchElevated: async () => {},
      },
    );

    expect(await registrar.invoke(IPC.cleanPreview, { scope: 'quick' })).toEqual({
      ok: false,
      reason: 'empty-selection',
      message: 'Nothing to clean here',
    });
    expect(await registrar.invoke(IPC.cleanPreview, { scope: 'row', root: 'T:\\', paths: ['T:\\Temp'] })).toEqual({
      ok: false,
      reason: 'invalid-root',
      message: 'No scan data for T:\\ - run an Analyze first',
    });
    expect(await registrar.invoke(IPC.cleanPreview, 'not-a-request')).toEqual({
      ok: false,
      reason: 'failed',
      message: 'Invalid cleanup request',
    });
    expect(await registrar.invoke(IPC.cleanExecute, { cleanId: 'c1', planId: 'nope' })).toEqual({
      ok: false,
      reason: 'unknown-plan',
    });
    expect((await registrar.invoke(IPC.devCleanupGet, 'T:\\')) as { source: string }).toMatchObject({
      source: 'empty',
    });
    expect(await registrar.invoke(IPC.pinsSet, 'T:\\dev\\app', true)).toEqual({
      ok: true,
      pins: ['T:\\dev\\app'],
    });

    unsubscribe();
    host.dispose();
  });
});

describe('parseCleanPreviewRequest', () => {
  it('returns null for malformed payloads', () => {
    expect(parseCleanPreviewRequest(null)).toBeNull();
    expect(parseCleanPreviewRequest('x')).toBeNull();
    expect(parseCleanPreviewRequest([])).toBeNull();
    expect(parseCleanPreviewRequest({ scope: 'nope' })).toBeNull();
    expect(parseCleanPreviewRequest({ scope: 'row' })).toBeNull();
    expect(parseCleanPreviewRequest({ scope: 'row', root: '' })).toBeNull();
  });

  it('parses valid requests and filters paths to strings', () => {
    expect(parseCleanPreviewRequest({ scope: 'quick' })).toEqual({ scope: 'quick' });
    expect(parseCleanPreviewRequest({ scope: 'row', root: 'T:\\' })).toEqual({
      scope: 'row',
      root: 'T:\\',
      paths: [],
    });
    expect(parseCleanPreviewRequest({ scope: 'dev', root: 'T:\\', paths: ['T:\\a', 5] })).toEqual({
      scope: 'dev',
      root: 'T:\\',
      paths: ['T:\\a'],
    });
  });
});
