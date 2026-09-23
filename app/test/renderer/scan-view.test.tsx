import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScanView } from '../../renderer/src/pages/ScanView';
import type { ScanEvent } from '../../src/shared/ipc';
import { makeApi } from './fakes';

describe('ScanView', () => {
  it('renders live progress and cancels the scan', () => {
    const cancelScan = vi.fn(async () => {});
    const event: ScanEvent = {
      type: 'progress',
      runId: 'run-1',
      progress: {
        filesScanned: 1234,
        bytesSeen: 2048,
        currentPath: 'C:\\Windows\\Temp',
        dirsCompleted: 3,
        errors: 1,
        elapsedMs: 5000,
      },
    };
    render(<ScanView api={makeApi({ cancelScan })} root="C:\\" runId="run-1" event={event} onBack={vi.fn()} />);

    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
    expect(screen.getByText('C:\\Windows\\Temp')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(cancelScan).toHaveBeenCalledTimes(1);
  });

  it('keeps the last progress payload when non-progress events arrive', () => {
    const progress: ScanEvent = {
      type: 'progress',
      runId: 'run-1',
      progress: {
        filesScanned: 1234,
        bytesSeen: 2048,
        currentPath: 'C:\\Windows\\Temp',
        dirsCompleted: 3,
        errors: 1,
        elapsedMs: 5000,
      },
    };
    const { rerender } = render(
      <ScanView api={makeApi()} root="C:\\" runId="run-1" event={progress} onBack={vi.fn()} />,
    );

    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
    expect(screen.getByText('C:\\Windows\\Temp')).toBeInTheDocument();

    const folders: ScanEvent = { type: 'folders', runId: 'run-1', folders: [] };
    rerender(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={folders} onBack={vi.fn()} />);

    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
    expect(screen.getByText('C:\\Windows\\Temp')).toBeInTheDocument();
  });

  it('shows a message when cancelling the scan rejects', async () => {
    const cancelScan = vi.fn(async () => {
      throw new Error('nope');
    });
    const event: ScanEvent = {
      type: 'progress',
      runId: 'run-1',
      progress: {
        filesScanned: 1,
        bytesSeen: 2,
        currentPath: 'C:\\Windows\\Temp',
        dirsCompleted: 1,
        errors: 0,
        elapsedMs: 100,
      },
    };
    render(<ScanView api={makeApi({ cancelScan })} root="C:\\" runId="run-1" event={event} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(await screen.findByText(/Cancel failed: nope/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel scan' })).toBeInTheDocument();
  });

  it('ignores events from other runs', () => {
    const other: ScanEvent = {
      type: 'finished',
      runId: 'other',
      status: 'complete',
      startedAt: 0,
      finishedAt: 1,
      filesScanned: 0,
      bytesSeen: 0,
      errors: 0,
      projects: 0,
      reclaimableBytes: 0,
      saved: true,
    };
    render(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={other} onBack={vi.fn()} />);
    expect(screen.getByText('Scanning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel scan' })).toBeInTheDocument();
  });

  it('shows the summary after completion', () => {
    const finished: ScanEvent = {
      type: 'finished',
      runId: 'run-1',
      status: 'complete',
      startedAt: 0,
      finishedAt: 65_000,
      filesScanned: 100,
      bytesSeen: 1024,
      errors: 0,
      projects: 2,
      reclaimableBytes: 512 * 1024 * 1024,
      saved: true,
    };
    const onBack = vi.fn();
    render(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={finished} onBack={onBack} />);

    expect(screen.getByText('Scan complete')).toBeInTheDocument();
    expect(screen.getByText(/512 MB reclaimable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel scan' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders browse mode without reclaimable framing', () => {
    const finished: ScanEvent = {
      type: 'browse-finished',
      runId: 'b1',
      status: 'complete',
      startedAt: 0,
      finishedAt: 65_000,
      filesScanned: 100,
      bytesSeen: 2048,
      errors: 0,
    };
    render(
      <ScanView api={makeApi()} mode="browse" root="E:\\" runId="b1" event={finished} onBack={vi.fn()} />,
    );

    expect(screen.getByText('Browse complete')).toBeInTheDocument();
    expect(screen.queryByText('Projects')).toBeNull();
    expect(screen.queryByText(/reclaimable/)).toBeNull();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('shows the browsing title while a browse run is active', () => {
    const event: ScanEvent = {
      type: 'progress',
      runId: 'b1',
      progress: {
        filesScanned: 5,
        bytesSeen: 1024,
        currentPath: 'E:\\Games',
        dirsCompleted: 1,
        errors: 0,
        elapsedMs: 1000,
      },
    };
    render(<ScanView api={makeApi()} mode="browse" root="E:\\" runId="b1" event={event} onBack={vi.fn()} />);

    expect(screen.getByText('Browsing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel scan' })).toBeInTheDocument();
  });

  it('streams folder rows into the live results table', async () => {
    const handlers: Array<(event: ScanEvent) => void> = [];
    const api = makeApi({
      onScanEvent: (handler) => {
        handlers.push(handler);
        return () => {};
      },
    });
    render(<ScanView api={api} root="C:\\" runId="run-1" event={null} onBack={vi.fn()} />);

    act(() => {
      handlers[0]?.({
        type: 'folders',
        runId: 'run-1',
        folders: [
          {
            path: 'C:\\Temp',
            name: 'Temp',
            parent: 'C:\\',
            bytes: 512,
            allocatedBytes: 4096,
            fileCount: 2,
            folderCount: 0,
            linkCount: 0,
            newestMtimeMs: 0,
            errorCount: 0,
            partial: false,
            complete: true,
            childCount: 0,
            grade: 'safe',
            gradeReason: 'Temporary files — apps recreate them as needed',
            action: null,
          },
        ],
      });
    });

    expect((await screen.findAllByText('Temp')).length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: 'Folder tree' })).toBeInTheDocument();
  });

  it('shows the finalize step while results are built', () => {
    const event: ScanEvent = { type: 'finalize-progress', runId: 'run-1', step: 'rows' };
    render(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={event} onBack={vi.fn()} />);
    expect(screen.getByText('Analyzing results… (rows)')).toBeInTheDocument();
  });
});
