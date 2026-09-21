import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultsView } from '../../renderer/src/pages/ResultsView';
import type { CleanExecuteRequest, ResultsState, ScanEvent } from '../../src/shared/ipc';
import { makeApi, makeCategories, makeResultsState } from './fakes';

describe('ResultsView', () => {
  it('shows a loading state while getResults is pending', async () => {
    let resolveResults: (state: ResultsState) => void = () => {};
    const api = makeApi({
      getResults: () =>
        new Promise<ResultsState>((resolve) => {
          resolveResults = resolve;
        }),
    });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    expect(screen.getByText('Loading results…')).toBeInTheDocument();
    expect(screen.queryByText(/No results yet/)).toBeNull();

    await act(async () => {
      resolveResults(makeResultsState());
    });
    expect(await screen.findByText('Users')).toBeInTheDocument();
  });

  it('renders the strip, the tree and the snapshot banner from getResults', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    expect(await screen.findByText('Users')).toBeInTheDocument();
    expect(screen.getAllByText('Temp').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Reclaimable by category' })).toBeInTheDocument();
    expect(screen.getByText(/tree is limited to depth 4 plus top contributors/)).toBeInTheDocument();
  });

  it('filters the tree when a category is selected', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    expect(await screen.findByText('Users')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Temp/ }));

    await waitFor(() => expect(screen.queryByText('Users')).toBeNull());
    expect(screen.getAllByText('Temp').length).toBeGreaterThan(0);
  });

  it('shows the why-this-grade details for a selected row', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Why Temp is graded safe' }));

    expect(screen.getByText('Why this grade')).toBeInTheDocument();
    expect(screen.getAllByText('User TEMP directory - junk by definition').length).toBeGreaterThan(0);
    expect(screen.getByText('Rule: system-temp')).toBeInTheDocument();
  });

  it('reveals a path through the api', async () => {
    const revealPath = vi.fn(async () => {});
    const api = makeApi({ getResults: async () => makeResultsState(), revealPath });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Explore' }))[0]!);
    await waitFor(() => expect(revealPath).toHaveBeenCalledTimes(1));
  });

  it('shows an empty state when there are no results', async () => {
    const api = makeApi({ getResults: async () => makeResultsState({ source: 'empty', rows: [], categories: [] }) });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    expect(await screen.findByText(/No results yet/)).toBeInTheDocument();
  });

  it('hides danger rows behind the Show danger toggle', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    expect(await screen.findByText('Users')).toBeInTheDocument();
    expect(screen.queryByText('Windows')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Show danger/ }));
    expect(await screen.findByText('Windows')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Hide danger/ }));
    expect(screen.queryByText('Windows')).toBeNull();
  });

  it('merges live folder and match events during a scan', async () => {
    const getResults = vi.fn(async () => makeResultsState());
    const handlers: Array<(event: ScanEvent) => void> = [];
    const api = makeApi({
      getResults,
      onScanEvent: (handler) => {
        handlers.push(handler);
        return () => {};
      },
    });
    render(<ResultsView api={api} root="C:\\" runId="run-1" />);

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
    expect(screen.getByText('512 B')).toBeInTheDocument();

    act(() => {
      handlers[0]?.({
        type: 'matches',
        runId: 'run-1',
        matches: [
          {
            path: 'C:\\Temp',
            bytes: 512,
            ruleId: 'system-temp',
            category: 'temp',
            grade: 'safe',
            evidence: 'live evidence',
          },
        ],
      });
    });
    expect(await screen.findByText('live evidence')).toBeInTheDocument();
    expect(getResults).not.toHaveBeenCalled();
  });

  it('opens a row cleanup dialog and executes the host plan', async () => {
    const executeClean = vi.fn(async (_request: CleanExecuteRequest) => ({
      ok: true as const,
      report: {
        planId: 'plan-1',
        scope: 'row' as const,
        root: 'C:\\',
        startedAt: 1,
        finishedAt: 2,
        items: [],
        deletedBytes: 1024,
        skippedLocked: 0,
        itemErrors: 0,
        remainingReclaimableBytes: 0,
        cleanedAt: 2,
      },
    }));
    const api = makeApi({ getResults: async () => makeResultsState(), executeClean });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Clean Temp' }));

    const dialog = await screen.findByRole('dialog', { name: 'Clean C:\\Temp' });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(executeClean).toHaveBeenCalledTimes(1));
    expect(executeClean.mock.calls[0]?.[0]).toMatchObject({ planId: 'plan-1' });
    expect(await screen.findByText('Cleanup complete')).toBeInTheDocument();
  });

  it('refetches results after a cleaned event', async () => {
    const getResults = vi.fn(async () => makeResultsState());
    const handlers: Array<(event: ScanEvent) => void> = [];
    const api = makeApi({
      getResults,
      onScanEvent: (handler) => {
        handlers.push(handler);
        return () => {};
      },
    });
    render(<ResultsView api={api} root="C:\\" runId={null} />);
    await screen.findByText('Users');
    expect(getResults).toHaveBeenCalledTimes(1);

    await act(async () => {
      handlers[0]?.({ type: 'cleaned', cleanId: 'clean-1', root: 'C:\\' });
    });
    await waitFor(() => expect(getResults).toHaveBeenCalledTimes(2));
  });

  it('opens Dev Cleanup from the npm projects category', async () => {
    const onOpenDevCleanup = vi.fn();
    const categories = makeCategories().map((row) =>
      row.category === 'npm-projects' ? { ...row, bytes: 4096, items: 1, ruleIds: ['npm-project-modules'] } : row,
    );
    const api = makeApi({ getResults: async () => makeResultsState({ categories }) });
    render(<ResultsView api={api} root="C:\\" runId={null} onOpenDevCleanup={onOpenDevCleanup} />);

    fireEvent.click(await screen.findByRole('button', { name: /npm projects/ }));
    expect(onOpenDevCleanup).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Users')).not.toBeNull();
  });
});
