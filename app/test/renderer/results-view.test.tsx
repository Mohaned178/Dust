import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultsView } from '../../renderer/src/pages/ResultsView';
import { flushLiveScan, ingestScanEvent } from '../../renderer/src/live-scan';
import type { CategorySummaryRow, CleanExecuteRequest, ResultRow, ResultsState, ScanEvent } from '../../src/shared/ipc';
import { makeApi, makeCategories, makeCleanPreview, makeResultsRows, makeResultsState } from './fakes';

const npmCacheRow: ResultRow = {
  path: 'C:\\npm-cache',
  name: 'npm-cache',
  parent: 'C:\\',
  bytes: 1024,
  allocatedBytes: 1024,
  fileCount: 8,
  folderCount: 2,
  linkCount: 0,
  newestMtimeMs: 0,
  errorCount: 0,
  partial: false,
  complete: true,
  childCount: 0,
  grade: 'safe',
  gradeReason: 'Download cache',
  action: { ruleId: 'npm-cache', category: 'npm-cache', grade: 'safe', evidence: 'Download cache - re-downloaded on next install' },
};

function withNpmCache(bytes = 1024): CategorySummaryRow[] {
  return makeCategories().map((row) =>
    row.category === 'npm-cache' ? { ...row, bytes, items: 1, ruleIds: ['npm-cache'] } : row,
  );
}

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
    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
  });

  it('renders the summary, the filter chips and the snapshot banner', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Filter by category' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Reclaimable summary' })).toBeInTheDocument();
    expect(screen.getByText(/reclaimable across 1 item/)).toBeInTheDocument();
    expect(screen.getByText('Safe items by default; npm projects are included.')).toBeInTheDocument();
    expect(screen.getAllByText('Safe').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Review').length).toBeGreaterThan(0);
    expect(screen.getByText(/tree is limited to depth 4 plus top contributors/)).toBeInTheDocument();
  });

  it('narrows the contributor list to a category and clears it with All', async () => {
    const api = makeApi({
      getResults: async () =>
        makeResultsState({ categories: withNpmCache(), rows: [...makeResultsRows(), npmCacheRow] }),
    });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select npm-cache' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /npm cache/ }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Select Temp' })).toBeNull());
    expect(screen.getByRole('checkbox', { name: 'Select npm-cache' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
  });

  it('labels search with paths and names, reports the match count, and clears in-field', async () => {
    const api = makeApi({
      getResults: async () =>
        makeResultsState({ categories: withNpmCache(), rows: [...makeResultsRows(), npmCacheRow] }),
    });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    const input = await screen.findByPlaceholderText('Search paths and names');
    expect(input).toHaveAccessibleName('Search paths and names');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

    fireEvent.change(input, { target: { value: 'temp' } });
    await waitFor(() =>
      expect(screen.getAllByRole('status').some((node) => node.textContent === '1 match')).toBe(true),
    );

    fireEvent.change(input, { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByText(/No contributors match/)).toBeInTheDocument());
    expect(screen.getAllByRole('status').some((node) => node.textContent === '0 matches')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    await waitFor(() => expect(screen.queryByText(/No contributors match/)).toBeNull());
    expect(screen.getByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
  });

  it('unfolds a contributor to show why, the rule, recovery, and Keep', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Why Temp is graded Safe' }));

    expect(screen.getByText('Why this grade')).toBeInTheDocument();
    expect(screen.getByText('User TEMP directory - junk by definition')).toBeInTheDocument();
    expect(screen.getByText('Rule: system-temp')).toBeInTheDocument();
    expect(await screen.findByText('Temporary files are recreated by the apps that need them')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Select Temp' })).toBeNull());
    expect(screen.getByText('1 item kept')).toBeInTheDocument();
  });

  it('announces the async recovery load in the polite region', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Why Temp is graded Safe' }));

    expect(await screen.findByText('Recovery details ready for C:\\Temp.')).toBeInTheDocument();
  });

  it('reveals a path through the relocated tree', async () => {
    const revealPath = vi.fn(async () => {});
    const api = makeApi({ getResults: async () => makeResultsState(), revealPath });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click(await screen.findByRole('button', { name: /Browse everything/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: /^Explore/ }))[0]!);
    await waitFor(() => expect(revealPath).toHaveBeenCalledTimes(1));
  });

  it('shows an empty state when there are no results', async () => {
    const api = makeApi({ getResults: async () => makeResultsState({ source: 'empty', rows: [], categories: [] }) });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    expect(await screen.findByText(/No results yet/)).toBeInTheDocument();
  });

  it('hides danger rows behind the Show danger toggle inside the tree', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    await screen.findByRole('checkbox', { name: 'Select Temp' });
    fireEvent.click(screen.getByRole('button', { name: /Browse everything/ }));
    expect(screen.queryByText('Windows')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Show danger/ }));
    expect(await screen.findByText('Windows')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Hide danger/ }));
    expect(screen.queryByText('Windows')).toBeNull();
  });

  it('merges live folder and match events into the contributor list during a scan', async () => {
    const getResults = vi.fn(async () => makeResultsState());
    const api = makeApi({ getResults });
    render(<ResultsView api={api} root="C:\\" runId="run-1" />);

    act(() => {
      ingestScanEvent({
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
      flushLiveScan();
    });
    expect(screen.queryByRole('checkbox', { name: 'Select Temp' })).toBeNull();

    act(() => {
      ingestScanEvent({
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
      flushLiveScan();
    });
    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
    expect(screen.getAllByText('512 B').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Why Temp is graded Safe' }));
    expect(await screen.findByText('live evidence')).toBeInTheDocument();
    expect(getResults).not.toHaveBeenCalled();
  });

  it('selects contributors and cleans them through the preview dialog', async () => {
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

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Temp' }));
    expect(screen.getByRole('status', { name: 'Selection' })).toHaveTextContent('Clean 1 selected');

    fireEvent.click(screen.getByRole('button', { name: 'Preview & clean' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clean 1 selected' });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand some items cannot be recovered' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Clean' }));

    await waitFor(() => expect(executeClean).toHaveBeenCalledTimes(1));
    expect(executeClean.mock.calls[0]?.[0]).toMatchObject({ planId: 'plan-1' });
    expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('refetches results after a cleaned event and clears the selection', async () => {
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
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Temp' }));
    expect(getResults).toHaveBeenCalledTimes(1);

    await act(async () => {
      handlers[0]?.({ type: 'cleaned', cleanId: 'clean-1', root: 'C:\\' });
    });
    await waitFor(() => expect(getResults).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Preview & clean' })).toBeNull());
  });

  it('opens Dev Cleanup from the npm projects chip', async () => {
    const onOpenDevCleanup = vi.fn();
    const categories = makeCategories().map((row) =>
      row.category === 'npm-projects' ? { ...row, bytes: 4096, items: 1, ruleIds: ['npm-project-modules'] } : row,
    );
    const api = makeApi({ getResults: async () => makeResultsState({ categories }) });
    render(<ResultsView api={api} root="C:\\" runId={null} onOpenDevCleanup={onOpenDevCleanup} />);

    fireEvent.click(await screen.findByRole('button', { name: /npm projects/ }));
    expect(onOpenDevCleanup).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
  });

  it('hides the npm projects chip when the Dev Cleanup handoff is unavailable', async () => {
    const categories = makeCategories().map((row) =>
      row.category === 'npm-projects' ? { ...row, bytes: 4096, items: 1, ruleIds: ['npm-project-modules'] } : row,
    );
    const api = makeApi({ getResults: async () => makeResultsState({ categories }) });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    await screen.findByRole('checkbox', { name: 'Select Temp' });
    expect(screen.queryByRole('button', { name: /npm projects/ })).toBeNull();
    expect(screen.getByRole('button', { name: /npm cache/ })).toBeInTheDocument();
  });

  it('selects all visible safe contributors and clears them again', async () => {
    const api = makeApi({
      getResults: async () => makeResultsState({ rows: [...makeResultsRows(), npmCacheRow] }),
    });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    await screen.findByRole('checkbox', { name: 'Select Temp' });
    fireEvent.click(screen.getByRole('checkbox', { name: /Select all safe/ }));

    expect(screen.getByRole('status', { name: 'Selection' })).toHaveTextContent('Clean 2 selected');

    fireEvent.click(screen.getByRole('checkbox', { name: /Deselect all/ }));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Selection' })).toBeNull());
  });

  it('select-all respects kept and filtered rows', async () => {
    const api = makeApi({
      getResults: async () => makeResultsState({ rows: [...makeResultsRows(), npmCacheRow] }),
    });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Why Temp is graded Safe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.getByText('1 item kept')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /Select all safe/ }));
    const selection = screen.getByRole('status', { name: 'Selection' });
    expect(selection).toHaveTextContent('Clean 1 selected');
    expect(selection).toHaveTextContent('1.0 KB');
  });

  it('distinguishes a failed recovery load and retries it', async () => {
    let calls = 0;
    const previewClean = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? { ok: false as const, reason: 'busy' as const, running: 'analyze' as const }
        : { ok: true as const, preview: makeCleanPreview() };
    });
    const api = makeApi({ getResults: async () => makeResultsState(), previewClean });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Why Temp is graded Safe' }));
    expect(await screen.findByText('Couldn’t load recovery details.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('Temporary files are recreated by the apps that need them'),
    ).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('ignores a stale getResults response that resolves after a newer one', async () => {
    const pending: Array<(state: ResultsState) => void> = [];
    const getResults = vi.fn(
      () =>
        new Promise<ResultsState>((resolve) => {
          pending.push(resolve);
        }),
    );
    const handlers: Array<(event: ScanEvent) => void> = [];
    const api = makeApi({
      getResults,
      onScanEvent: (handler) => {
        handlers.push(handler);
        return () => {};
      },
    });
    const rowsWithTempName = (name: string) =>
      makeResultsRows().map((row) => (row.path === 'C:\\Temp' ? { ...row, name } : row));
    render(<ResultsView api={api} root="C:\\" runId={null} />);
    await waitFor(() => expect(getResults).toHaveBeenCalledTimes(1));

    await act(async () => {
      handlers[0]?.({ type: 'cleaned', cleanId: 'clean-1', root: 'C:\\' });
    });
    expect(getResults).toHaveBeenCalledTimes(2);

    const newer = pending[1];
    const older = pending[0];
    await act(async () => {
      newer?.(makeResultsState({ rows: rowsWithTempName('Newer') }));
    });
    await act(async () => {
      older?.(makeResultsState({ rows: rowsWithTempName('Older') }));
    });

    expect(await screen.findByText('Newer')).toBeInTheDocument();
    expect(screen.queryByText('Older')).toBeNull();
  });

  it('shows a closeable error when the bulk plan cannot be built', async () => {
    const api = makeApi({
      getResults: async () => makeResultsState(),
      previewClean: async () => ({ ok: false as const, reason: 'busy' as const, running: 'analyze' as const }),
    });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Temp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview & clean' }));
    expect(await screen.findByText('A scan is already running. Cancel it first.')).toBeInTheDocument();
    expect(screen.queryByText('Building the cleanup plan.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows an empty contributor state for a category with no loaded rows', async () => {
    const api = makeApi({ getResults: async () => makeResultsState({ categories: withNpmCache(4096) }) });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    await screen.findByRole('checkbox', { name: 'Select Temp' });
    fireEvent.click(screen.getByRole('button', { name: /npm cache/ }));

    expect(await screen.findByText('Nothing safe to clean here')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Select Temp' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
  });

  it('shows a recoverable error without the raw failure and retries the load', async () => {
    const getResults = vi.fn(async () => makeResultsState());
    getResults.mockRejectedValueOnce(new Error('EPERM: operation not permitted'));
    const api = makeApi({ getResults });
    render(<ResultsView api={api} root="C:\\" runId={null} />);

    expect(await screen.findByText('Couldn\u2019t load results. Reload to try again.')).toBeInTheDocument();
    expect(screen.queryByText(/EPERM/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
    expect(getResults).toHaveBeenCalledTimes(2);
  });

  it('announces streamed scan updates in a polite live region', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    render(<ResultsView api={api} root="C:\\" runId="run-1" />);

    act(() => {
      ingestScanEvent({ type: 'categories', runId: 'run-1', categories: makeCategories() });
    });

    const status = screen.getByText('Scanning — 256 KB reclaimable so far.');
    expect(status).toBeInTheDocument();
  });

  it('closes the bulk dialog when the root changes', async () => {
    const api = makeApi({ getResults: async () => makeResultsState() });
    const { rerender } = render(<ResultsView api={api} root="C:\\" runId={null} />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Temp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview & clean' }));
    expect(await screen.findByRole('dialog', { name: 'Clean 1 selected' })).toBeInTheDocument();

    rerender(<ResultsView api={api} root="D:\\" runId={null} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
