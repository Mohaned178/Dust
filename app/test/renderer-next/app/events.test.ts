import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLUSH_INTERVAL_MS, startEvents } from '../../../renderer-next/src/app/events';
import type { Scheduler } from '../../../renderer-next/src/app/events';
import { useAppsStore } from '../../../renderer-next/src/stores/apps';
import { useCleanStore } from '../../../renderer-next/src/stores/clean';
import { useScanStore } from '../../../renderer-next/src/stores/scan';
import { useStartupStore } from '../../../renderer-next/src/stores/startup';
import { useUpdatesStore } from '../../../renderer-next/src/stores/updates';
import type { ScanEvent, StartupDetailsEvent, UninstallEvent, UpdateStatus } from '../../../src/shared/ipc';
import { finishedEvent, makeApi, makeScanBus } from '../../renderer/fakes';

/** A clock and a frame loop that only move when the test says so. */
function manualScheduler() {
  let time = 0;
  let tasks: Array<{ at: number; run: () => void }> = [];
  const scheduler: Scheduler = {
    now: () => time,
    schedule: (run, delayMs) => {
      const task = { at: time + delayMs, run };
      tasks.push(task);
      return () => {
        tasks = tasks.filter((candidate) => candidate !== task);
      };
    },
  };
  return {
    scheduler,
    pending: () => tasks.length,
    advance(ms: number) {
      time += ms;
      for (const task of tasks.filter((candidate) => candidate.at <= time)) {
        tasks = tasks.filter((candidate) => candidate !== task);
        task.run();
      }
    },
  };
}

function bus<T>() {
  const handlers = new Set<(event: T) => void>();
  return {
    on: (handler: (event: T) => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    emit: (event: T) => {
      for (const handler of [...handlers]) handler(event);
    },
  };
}

function progress(filesScanned: number): ScanEvent {
  return {
    type: 'progress',
    runId: 'run-1',
    progress: {
      filesScanned,
      bytesSeen: filesScanned * 10,
      currentPath: 'C:\\somewhere',
      dirsCompleted: 0,
      errors: 0,
      elapsedMs: 1,
    },
  };
}

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function setup() {
  const scan = makeScanBus();
  const uninstall = bus<UninstallEvent>();
  const startup = bus<StartupDetailsEvent>();
  const updates = bus<UpdateStatus>();
  const api = makeApi({
    onScanEvent: scan.onScanEvent,
    onUninstallEvent: uninstall.on,
    onStartupEvent: startup.on,
    onUpdateEvent: updates.on,
  });
  const clock = manualScheduler();
  const stop = startEvents(api, clock.scheduler);
  stops.push(stop);
  return { scan, uninstall, startup, updates, clock, stop };
}

describe('event bridge', () => {
  it('turns 1,000 progress events in one frame into one store update', () => {
    const rig = setup();
    rig.scan.emit({ type: 'started', runId: 'run-1', root: 'C:\\', startedAt: 1 });
    const updates = vi.fn();
    const unsubscribe = useScanStore.subscribe(updates);

    for (let index = 1; index <= 1000; index += 1) rig.scan.emit(progress(index));
    expect(updates).not.toHaveBeenCalled();

    rig.clock.advance(16);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(useScanStore.getState().runs['run-1']?.progress?.filesScanned).toBe(1000);
    unsubscribe();
  });

  it('writes buffered events at most ten times a second', () => {
    const rig = setup();
    const updates = vi.fn();
    const unsubscribe = useScanStore.subscribe(updates);

    rig.scan.emit(progress(1));
    rig.clock.advance(16);
    expect(updates).toHaveBeenCalledTimes(1);

    rig.scan.emit(progress(2));
    rig.clock.advance(16);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(useScanStore.getState().runs['run-1']?.progress?.filesScanned).toBe(1);

    rig.clock.advance(FLUSH_INTERVAL_MS);
    expect(updates).toHaveBeenCalledTimes(2);
    expect(useScanStore.getState().runs['run-1']?.progress?.filesScanned).toBe(2);
    unsubscribe();
  });

  it('keeps a finished event that arrives before anything is listening', () => {
    const rig = setup();
    rig.scan.emit({ type: 'started', runId: 'run-1', root: 'C:\\', startedAt: 1 });
    rig.scan.emit(progress(40));
    rig.scan.emit({ type: 'finalizing', runId: 'run-1' });
    rig.scan.emit(finishedEvent('run-1'));

    // A screen mounts only now, as it does after a fast scan.
    const { result } = renderHook(() => useScanStore((state) => state.runs['run-1']));
    expect(result.current?.outcome).toEqual({ type: 'finished', status: 'complete' });
    expect(result.current?.finalizing).toBe(true);
    expect(result.current?.root).toBe('C:\\');
    // Progress that was still waiting for its frame is written before the outcome, not lost.
    expect(result.current?.progress?.filesScanned).toBe(40);
  });

  it('applies a failure at once, without waiting for a frame', () => {
    const rig = setup();
    rig.scan.emit({ type: 'failed', runId: 'run-2', message: 'Disk unavailable' });
    expect(useScanStore.getState().runs['run-2']?.outcome).toEqual({ type: 'failed', message: 'Disk unavailable' });
    expect(rig.clock.pending()).toBe(0);
  });

  it('keeps only the last three runs', () => {
    const rig = setup();
    for (const runId of ['a', 'b', 'c', 'd']) rig.scan.emit({ type: 'started', runId, root: 'C:\\', startedAt: 1 });
    expect(Object.keys(useScanStore.getState().runs)).toEqual(['b', 'c', 'd']);
    expect(useScanStore.getState().latestRunId).toBe('d');
  });

  it('tracks quick clean progress, which has no run id', () => {
    const rig = setup();
    rig.scan.emit({
      type: 'quick-clean-progress',
      progress: { filesScanned: 5, bytesSeen: 50, currentPath: 'C:\\t', dirsCompleted: 0, errors: 0, elapsedMs: 1 },
    });
    rig.clock.advance(16);
    expect(useScanStore.getState().quickProgress?.filesScanned).toBe(5);
  });

  it('collects clean items per clean and marks it done on cleaned', () => {
    const rig = setup();
    const item = (path: string) => ({
      ruleId: 'r',
      path,
      category: 'temp' as const,
      action: 'delete-path' as const,
      status: 'done' as const,
      plannedBytes: 10,
      deletedBytes: 10,
      skippedLocked: 0,
      errorCount: 0,
      restoreCommand: null,
    });
    rig.scan.emit({ type: 'clean-item', cleanId: 'c1', item: item('C:\\a') });
    rig.scan.emit({ type: 'clean-item', cleanId: 'c1', item: item('C:\\b') });
    rig.scan.emit({ type: 'cleaned', cleanId: 'c1', root: 'C:\\' });
    const run = useCleanStore.getState().runs.c1;
    expect(run?.items.map((entry) => entry.path)).toEqual(['C:\\a', 'C:\\b']);
    expect(run?.done).toBe(true);
    expect(run?.root).toBe('C:\\');
  });

  it('writes streamed app sizes and icons with one update, in either event form', () => {
    const rig = setup();
    const updates = vi.fn();
    const unsubscribe = useAppsStore.subscribe(updates);

    for (let index = 0; index < 300; index += 1) {
      rig.uninstall.emit({ type: 'app-size', appId: `app-${index}`, bytes: index });
      rig.uninstall.emit({ type: 'app-icon', appId: `app-${index}`, iconDataUrl: `data:${index}` });
    }
    rig.uninstall.emit({ type: 'app-sizes', sizes: [{ appId: 'batched', bytes: 7 }] });
    rig.uninstall.emit({ type: 'app-icons', icons: [{ appId: 'batched', iconDataUrl: 'data:batched' }] });
    expect(updates).not.toHaveBeenCalled();

    rig.clock.advance(16);
    expect(updates).toHaveBeenCalledTimes(1);
    const state = useAppsStore.getState();
    expect(state.sizes.size).toBe(301);
    expect(state.sizes.get('app-299')).toBe(299);
    expect(state.sizes.get('batched')).toBe(7);
    expect(state.icons.get('batched')).toBe('data:batched');
    unsubscribe();
  });

  it('folds an uninstall job so a late screen can catch up', () => {
    const rig = setup();
    rig.uninstall.emit({ type: 'phase', jobId: 'j1', phase: 'uninstaller', status: 'started' });
    rig.uninstall.emit({ type: 'item', jobId: 'j1', itemId: 'a', status: 'done', bytes: 100 });
    rig.uninstall.emit({ type: 'item', jobId: 'j1', itemId: 'b', status: 'done', bytes: 50 });
    rig.uninstall.emit({ type: 'failed', jobId: 'j1', message: 'Stopped' });
    const job = useAppsStore.getState().jobs.j1;
    expect(job?.phases.uninstaller).toEqual({ status: 'started' });
    expect(job?.itemsDone).toBe(2);
    expect(job?.bytesRemoved).toBe(150);
    expect(job?.outcome).toEqual({ type: 'failed', message: 'Stopped' });
  });

  it('merges startup details and applies update events', () => {
    const rig = setup();
    rig.startup.emit({ details: [{ id: 's1', publisher: 'Acme', iconDataUrl: null }] });
    rig.clock.advance(16);
    expect(useStartupStore.getState().details.get('s1')).toEqual({ publisher: 'Acme', iconDataUrl: null });

    rig.updates.emit({ phase: 'downloaded', version: '1.3.0', percent: 100, message: null });
    expect(useUpdatesStore.getState().status.phase).toBe('downloaded');
  });

  it('stops listening and drops buffered events when stopped', () => {
    const rig = setup();
    rig.scan.emit(progress(1));
    rig.stop();
    rig.scan.emit(progress(2));
    rig.clock.advance(1000);
    expect(useScanStore.getState().runs['run-1']).toBeUndefined();
    expect(rig.clock.pending()).toBe(0);
  });
});

describe('browser scheduler', () => {
  function realClockSetup() {
    const scan = makeScanBus();
    const stop = startEvents(makeApi({ onScanEvent: scan.onScanEvent }));
    stops.push(stop);
    return scan;
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('flushes on the next animation frame', () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    });
    const scan = realClockSetup();
    const updates = vi.fn();
    const unsubscribe = useScanStore.subscribe(updates);

    for (let index = 1; index <= 1000; index += 1) scan.emit(progress(index));
    expect(updates).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20));
    expect(updates).toHaveBeenCalledTimes(1);
    expect(useScanStore.getState().runs['run-1']?.progress?.filesScanned).toBe(1000);

    // A second burst right away waits out the 100 ms interval.
    scan.emit(progress(1001));
    act(() => vi.advanceTimersByTime(20));
    expect(updates).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(100));
    expect(updates).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('still flushes when no animation frame ever comes, as in a hidden window', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const scan = realClockSetup();

    scan.emit(progress(7));
    act(() => vi.advanceTimersByTime(240));
    expect(useScanStore.getState().runs['run-1']).toBeUndefined();
    act(() => vi.advanceTimersByTime(20));
    expect(useScanStore.getState().runs['run-1']?.progress?.filesScanned).toBe(7);
  });
});
