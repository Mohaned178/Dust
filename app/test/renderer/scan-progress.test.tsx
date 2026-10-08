import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyScanEvent, emptyScanRun, ScanProgress } from '../../renderer/src/pages/ScanProgress';
import type { ScanRunRecord } from '../../renderer/src/pages/ScanProgress';
import { finishedEvent, makeApi, makeCategories, makeScanBus } from './fakes';

const progressEvent = {
  type: 'progress' as const,
  runId: 'run-1',
  progress: { filesScanned: 42, bytesSeen: 512, currentPath: 'C:\\Users', dirsCompleted: 2, errors: 0, elapsedMs: 10 },
};

describe('applyScanEvent', () => {
  it('folds progress, categories, finalizing and the outcome into a record', () => {
    const record = emptyScanRun();
    applyScanEvent(record, progressEvent);
    applyScanEvent(record, { type: 'categories', runId: 'run-1', categories: makeCategories() });
    applyScanEvent(record, { type: 'finalizing', runId: 'run-1' });
    applyScanEvent(record, finishedEvent('run-1', 'cancelled'));

    expect(record.progress?.filesScanned).toBe(42);
    expect(record.categories).toHaveLength(makeCategories().length);
    expect(record.finalizing).toBe(true);
    expect(record.outcome).toEqual({ type: 'finished', status: 'cancelled' });

    applyScanEvent(record, { type: 'failed', runId: 'run-1', message: 'later failure' });
    expect(record.outcome).toEqual({ type: 'failed', message: 'later failure' });
  });

  it('ignores events that do not describe a run', () => {
    const record = emptyScanRun();
    applyScanEvent(record, { type: 'cleaned', cleanId: 'c', root: 'C:\\' });
    applyScanEvent(record, { type: 'started', runId: 'run-1', root: 'C:\\', startedAt: 0 });
    expect(record).toEqual(emptyScanRun());
  });
});

describe('ScanProgress', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(options: { run?: ScanRunRecord; usedBytes?: number | null } = {}) {
    const bus = makeScanBus();
    const cancelScan = vi.fn(async () => {});
    const onFinished = vi.fn();
    const onFailed = vi.fn();
    const api = makeApi({ onScanEvent: bus.onScanEvent, cancelScan });
    const getRun = options.run ? () => options.run : undefined;
    render(
      <ScanProgress
        api={api}
        root={'C:\\'}
        runId="run-1"
        usedBytes={options.usedBytes ?? null}
        getRun={getRun}
        onFinished={onFinished}
        onFailed={onFailed}
      />,
    );
    return { bus, cancelScan, onFinished, onFailed };
  }

  it('ticks the elapsed clock and stops it once the scan finishes', () => {
    vi.useFakeTimers();
    const { bus, onFinished } = setup();

    expect(screen.getByText('00:00')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('00:05')).toBeInTheDocument();

    act(() => bus.emit(finishedEvent('run-1')));
    expect(onFinished).toHaveBeenCalledWith('C:\\', 'complete');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('00:05')).toBeInTheDocument();
  });

  it('turns Cancel into a disabled Finishing… once finalizing starts', () => {
    const { bus, cancelScan } = setup();

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    act(() => bus.emit({ type: 'finalizing', runId: 'run-1' }));

    const button = screen.getByRole('button', { name: 'Finishing…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(cancelScan).not.toHaveBeenCalled();
    expect(screen.getByText('Checking what is safe to clean')).toBeInTheDocument();
  });

  it('shows Stopping… after Cancel and recovers if stopping fails', async () => {
    const bus = makeScanBus();
    const cancelScan = vi.fn(async () => {
      throw new Error('nope');
    });
    render(
      <ScanProgress
        api={makeApi({ onScanEvent: bus.onScanEvent, cancelScan })}
        root={'C:\\'}
        runId="run-1"
        usedBytes={null}
        onFinished={vi.fn()}
        onFailed={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Could not stop the scan. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('replays a run that finished before it subscribed', () => {
    const run = emptyScanRun();
    applyScanEvent(run, progressEvent);
    applyScanEvent(run, finishedEvent('run-1'));
    const { onFinished, onFailed } = setup({ run });

    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith('C:\\', 'complete');
    expect(onFailed).not.toHaveBeenCalled();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('replays a run that failed before it subscribed, once', () => {
    const run = emptyScanRun();
    applyScanEvent(run, { type: 'failed', runId: 'run-1', message: 'disk went away' });
    const { bus, onFinished, onFailed } = setup({ run });

    expect(onFailed).toHaveBeenCalledWith('disk went away');
    act(() => bus.emit(finishedEvent('run-1')));
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('ignores events from other runs and shows a percentage against used space', () => {
    const { bus, onFinished } = setup({ usedBytes: 1024 });

    act(() => bus.emit(progressEvent));
    expect(screen.getByText('50%')).toBeInTheDocument();

    act(() => bus.emit(finishedEvent('other-run')));
    expect(onFinished).not.toHaveBeenCalled();
  });
});
