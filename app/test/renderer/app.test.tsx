import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../renderer/src/App';
import type { ScanEvent } from '../../src/shared/ipc';
import { makeApi, makeCategories, makeResultsState } from './fakes';

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

  it('browses a non-system volume and streams rows', async () => {
    const handlers: Array<(event: ScanEvent) => void> = [];
    const startBrowse = vi.fn(async () => ({ ok: true as const, runId: 'browse-1' }));
    const api = makeApi({
      startBrowse,
      onScanEvent: (handler) => {
        handlers.push(handler);
        return () => {};
      },
    });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Browse E:\\' }));
    expect(await screen.findByText('Browsing')).toBeInTheDocument();
    expect(startBrowse).toHaveBeenCalledWith('E:\\');

    await act(async () => {
      const event: ScanEvent = {
        type: 'browse-folders',
        runId: 'browse-1',
        folders: [
          {
            path: 'E:\\Games',
            name: 'Games',
            parent: 'E:\\',
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
          },
        ],
      };
      for (const handler of handlers) handler(event);
    });
    expect(await screen.findByText('Games')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Safety' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dust' })).toBeInTheDocument();
  });

  it('opens the results view from a disk card', async () => {
    const getResults = vi.fn(async (root: string) => makeResultsState({ root }));
    const api = makeApi({ getResults });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View results for C:\\' }));
    expect(await screen.findByRole('heading', { name: 'Results' })).toBeInTheDocument();
    expect(await screen.findByText('Users')).toBeInTheDocument();
    expect(getResults).toHaveBeenCalledWith('C:\\');

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dust' })).toBeInTheDocument();
  });

  it('opens Quick Clean from the dashboard', async () => {
    const api = makeApi();
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Quick Clean' }));
    expect(await screen.findByRole('heading', { name: 'Quick Clean' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dust' })).toBeInTheDocument();
  });

  it('opens Dev Cleanup from the results category strip', async () => {
    const categories = makeCategories().map((row) =>
      row.category === 'npm-projects'
        ? { ...row, bytes: 4096, items: 1, ruleIds: ['npm-project-modules'] }
        : row,
    );
    const api = makeApi({ getResults: async (root) => makeResultsState({ root, categories }) });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View results for C:\\' }));
    fireEvent.click(await screen.findByRole('button', { name: /npm projects/ }));

    expect(await screen.findByRole('heading', { name: 'Dev Cleanup' })).toBeInTheDocument();
    expect(await screen.findByText('dead-app')).toBeInTheDocument();
  });
});
