import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScanEvent } from '../../src/shared/ipc';
import { QuickCleanView } from '../../renderer/src/pages/QuickCleanView';
import { makeApi, makeCleanReport } from './fakes';

describe('QuickCleanView', () => {
  it('previews, confirms and shows the summary', async () => {
    const executeClean = vi.fn(async () => ({
      ok: true as const,
      report: makeCleanReport({ deletedBytes: 2048, remainingReclaimableBytes: 1024 }),
    }));
    const api = makeApi({ executeClean });
    const onDone = vi.fn();
    const onViewResults = vi.fn();
    render(<QuickCleanView api={api} onDone={onDone} onViewResults={onViewResults} />);

    expect(await screen.findByRole('dialog', { name: 'Quick Clean' })).toBeInTheDocument();
    expect(
      screen.getByText('Quick Clean covers Temp, Recycle Bin, npm cache, and App caches — it never includes npm projects.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Temp, 9.8 KB, Junk by default' }));
    expect(screen.getByText('C:\\Users\\x\\AppData\\Local\\Temp')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand some items cannot be recovered' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Clean' }));
    await waitFor(() => expect(executeClean).toHaveBeenCalledTimes(1));

    expect(await screen.findByRole('button', { name: 'View Updated Disk' })).toBeInTheDocument();
    expect(screen.getAllByText('2.0 KB').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'View Updated Disk' }));
    expect(onViewResults).toHaveBeenCalledWith('C:\\');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('surfaces when a scan holds the lock', async () => {
    const api = makeApi({ previewClean: async () => ({ ok: false, reason: 'busy', running: 'analyze' }) });
    render(<QuickCleanView api={api} onDone={vi.fn()} onViewResults={vi.fn()} />);

    expect(await screen.findByText('A scan is already running. Cancel it first.')).toBeInTheDocument();
  });

  it('shows targeted scan progress and cancels', async () => {
    const handlers: Array<(event: ScanEvent) => void> = [];
    const cancelScan = vi.fn(async () => {});
    const api = makeApi({
      cancelScan,
      previewClean: () => new Promise(() => {}),
      onScanEvent: (handler) => {
        handlers.push(handler);
        return () => {};
      },
    });
    render(<QuickCleanView api={api} onDone={vi.fn()} onViewResults={vi.fn()} />);

    act(() => {
      handlers[0]?.({
        type: 'quick-clean-progress',
        progress: {
          filesScanned: 1234,
          bytesSeen: 2048,
          currentPath: 'C:\\Temp',
          dirsCompleted: 3,
          errors: 0,
          elapsedMs: 1000,
        },
      });
    });

    expect(await screen.findByText(/1,234 files scanned/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelScan).toHaveBeenCalledTimes(1);
  });
});
