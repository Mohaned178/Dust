import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../renderer/src/App';
import type { ScanEvent } from '../../src/shared/ipc';
import { makeApi } from './fakes';

describe('App', () => {
  it('moves from the dashboard through a scan and back', async () => {
    const handlers: Array<(event: ScanEvent) => void> = [];
    const cancelScan = vi.fn(async () => {});
    const api = makeApi({
      cancelScan,
      onScanEvent: (handler) => {
        handlers.push(handler);
        return () => {};
      },
    });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Analyze C:\\' }));
    expect(await screen.findByText('Scanning')).toBeInTheDocument();

    await act(async () => {
      handlers[0]?.({
        type: 'progress',
        runId: 'run-1',
        progress: {
          filesScanned: 1234,
          bytesSeen: 2048,
          currentPath: 'C:\\Windows',
          dirsCompleted: 3,
          errors: 1,
          elapsedMs: 2000,
        },
      });
    });
    expect(screen.getByText('1,234')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(cancelScan).toHaveBeenCalledTimes(1);

    await act(async () => {
      handlers[0]?.({
        type: 'finished',
        runId: 'run-1',
        status: 'cancelled',
        startedAt: 0,
        finishedAt: 2000,
        filesScanned: 1234,
        bytesSeen: 2048,
        errors: 1,
        projects: 0,
        reclaimableBytes: 0,
        saved: true,
      });
    });
    expect(await screen.findByText('Scan cancelled')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dust' })).toBeInTheDocument();
  });

  it('opens the results view from a disk card', async () => {
    const api = makeApi();
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View results for C:\\' }));
    expect(await screen.findByRole('heading', { name: 'Results' })).toBeInTheDocument();
    expect(await screen.findByText('Users')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dust' })).toBeInTheDocument();
  });
});
