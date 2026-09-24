import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScanView } from '../../renderer/src/pages/ScanView';
import { flushLiveScan, ingestScanEvent } from '../../renderer/src/live-scan';
import type {
  BrowseRow,
  CategorySummaryRow,
  ResultMatch,
  ResultRow,
  ResultsState,
  ScanEvent,
  ScanProgressPayload,
} from '../../src/shared/ipc';
import { makeApi } from './fakes';

function progressEvent(path: string, overrides: Partial<ScanProgressPayload> = {}, runId = 'run-1'): ScanEvent {
  return {
    type: 'progress',
    runId,
    progress: {
      filesScanned: 1234,
      bytesSeen: 2048,
      currentPath: path,
      dirsCompleted: 3,
      errors: 1,
      elapsedMs: 5000,
      ...overrides,
    },
  };
}

type CategoryId = CategorySummaryRow['category'];

function resultRow(path: string, name: string, bytes: number, parent: string): ResultRow {
  return {
    path,
    name,
    parent,
    bytes,
    allocatedBytes: bytes,
    fileCount: 1,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    complete: true,
    childCount: 0,
    grade: 'safe',
    gradeReason: 'Temporary files',
    action: null,
  };
}

function match(path: string, bytes: number, category: CategoryId, grade: ResultMatch['grade'] = 'safe'): ResultMatch {
  return { path, bytes, ruleId: `${category}-rule`, category, grade, evidence: 'evidence' };
}

function browseRow(path: string, name: string, bytes: number, parent: string): BrowseRow {
  return {
    path,
    name,
    parent,
    bytes,
    allocatedBytes: bytes,
    fileCount: 1,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    complete: true,
    childCount: 0,
  };
}

function categoryRows(entries: Array<[CategoryId, number]>): CategorySummaryRow[] {
  const labels: Record<CategoryId, string> = {
    temp: 'Temp',
    'recycle-bin': 'Recycle Bin',
    'npm-cache': 'npm cache',
    'app-caches': 'App caches',
    'npm-projects': 'npm projects',
  };
  const order: CategoryId[] = ['temp', 'recycle-bin', 'npm-cache', 'app-caches', 'npm-projects'];
  return order.map((category) => {
    const found = entries.find(([id]) => id === category);
    return { category, label: labels[category], bytes: found?.[1] ?? 0, items: found ? 1 : 0, ruleIds: [] };
  });
}

describe('ScanView', () => {
  it('renders the live path log and stats, and cancels the scan', () => {
    const cancelScan = vi.fn(async () => {});
    render(
      <ScanView
        api={makeApi({ cancelScan })}
        root="C:\\"
        runId="run-1"
        event={progressEvent('C:\\Windows\\Temp')}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(/Analyzing/)).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('00:05')).toBeInTheDocument();
    expect(screen.getByText('Windows\\Temp')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(cancelScan).toHaveBeenCalledTimes(1);
  });

  it('announces scan stats on a slower cadence than the visual tick', () => {
    vi.useFakeTimers();
    try {
      render(
        <ScanView
          api={makeApi()}
          root="C:\\"
          runId="run-1"
          event={progressEvent('C:\\Windows\\Temp')}
          onBack={vi.fn()}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByText(/Scanned 1,234 files/)).toBeNull();

      act(() => {
        vi.advanceTimersByTime(3500);
      });
      expect(screen.getByText(/Scanned 1,234 files/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the last progress payload when non-progress events arrive', () => {
    const { rerender } = render(
      <ScanView api={makeApi()} root="C:\\" runId="run-1" event={progressEvent('C:\\Windows\\Temp')} onBack={vi.fn()} />,
    );

    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('00:05')).toBeInTheDocument();
    expect(screen.getByText('Windows\\Temp')).toBeInTheDocument();

    const folders: ScanEvent = { type: 'folders', runId: 'run-1', folders: [] };
    rerender(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={folders} onBack={vi.fn()} />);

    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('00:05')).toBeInTheDocument();
    expect(screen.getByText('Windows\\Temp')).toBeInTheDocument();
  });

  it('keeps the last three paths, newest first', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <ScanView api={makeApi()} root="C:\\" runId="run-1" event={progressEvent('C:\\one')} onBack={vi.fn()} />,
      );
      const advance = (path: string) => {
        rerender(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={progressEvent(path)} onBack={vi.fn()} />);
        act(() => {
          vi.advanceTimersByTime(200);
        });
      };
      advance('C:\\two');
      advance('C:\\three');
      advance('C:\\four');

      expect(screen.getByText('C:\\four')).toBeInTheDocument();
      expect(screen.getByText('C:\\three')).toBeInTheDocument();
      expect(screen.getByText('C:\\two')).toBeInTheDocument();
      expect(screen.queryByText('C:\\one')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a message when cancelling the scan rejects', async () => {
    const cancelScan = vi.fn(async () => {
      throw new Error('nope');
    });
    render(
      <ScanView
        api={makeApi({ cancelScan })}
        root="C:\\"
        runId="run-1"
        event={progressEvent('C:\\Windows\\Temp')}
        onBack={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel scan' }));
    expect(await screen.findByText('Couldn’t cancel the scan. It may still be running.')).toBeInTheDocument();
    expect(screen.queryByText(/nope/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel scan' })).toBeInTheDocument();
  });

  it('shows a plain message when the scan fails, without the raw error', () => {
    const failed: ScanEvent = {
      type: 'failed',
      runId: 'run-1',
      message: 'EPERM: operation not permitted, scandir C:\\System Volume Information',
    };
    render(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={failed} onBack={vi.fn()} />);

    expect(screen.getByText('Scan failed')).toBeInTheDocument();
    expect(screen.getByText('The scan stopped before it finished.')).toBeInTheDocument();
    expect(screen.queryByText(/EPERM/)).toBeNull();
    expect(screen.queryByText(/System Volume Information/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeInTheDocument();
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
    expect(screen.getByText(/Analyzing/)).toBeInTheDocument();
    expect(screen.getByText('Preparing…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel scan' })).toBeInTheDocument();
  });

  it('shows the placeholders and empty tree while the scan runs', () => {
    render(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={null} onBack={vi.fn()} />);

    expect(screen.getByText('Preparing…')).toBeInTheDocument();
    expect(screen.getByText('Waiting for first results…')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Live results' })).toBeInTheDocument();
    const categories = screen.getByRole('region', { name: 'Reclaimable by category' });
    expect(categories).toBeInTheDocument();
    expect(screen.getByText('Recycle Bin')).toBeInTheDocument();
    expect(screen.getByText('npm cache')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the summary and results after completion', () => {
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
    expect(screen.getAllByText(/reclaimable/).length).toBeGreaterThan(0);
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
    render(<ScanView api={makeApi()} mode="browse" root="E:\\" runId="b1" event={finished} onBack={vi.fn()} />);

    expect(screen.getByText('Browse complete')).toBeInTheDocument();
    expect(screen.queryByText('Projects')).toBeNull();
    expect(screen.queryByText(/reclaimable/)).toBeNull();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Reclaimable by category' })).toBeNull();
  });

  it('shows the browsing title and hides categories while a browse run is active', () => {
    render(
      <ScanView
        api={makeApi()}
        mode="browse"
        root="E:\\"
        runId="b1"
        event={progressEvent('E:\\Games', {}, 'b1')}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(/Browsing/)).toBeInTheDocument();
    expect(screen.getByText('E:\\Games')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Reclaimable by category' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel scan' })).toBeInTheDocument();
  });

  it('fills the category chips and the live results tray as events arrive', () => {
    render(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={null} onBack={vi.fn()} />);
    const tray = () => screen.getByRole('region', { name: 'Live results' });

    expect(screen.getByRole('button', { name: /Temp/ })).toBeDisabled();

    act(() => {
      ingestScanEvent({ type: 'categories', runId: 'run-1', categories: categoryRows([['temp', 512]]) });
    });
    expect(screen.getByRole('button', { name: /Temp/ })).toBeEnabled();

    act(() => {
      ingestScanEvent({ type: 'folders', runId: 'run-1', folders: [resultRow('C:\\Temp', 'Temp', 512, 'C:\\')] });
      ingestScanEvent({ type: 'matches', runId: 'run-1', matches: [match('C:\\Temp', 512, 'temp')] });
    });
    expect(within(tray()).queryByText('Temp')).toBeNull();

    act(() => flushLiveScan());
    expect(within(tray()).getByText('Temp')).toBeInTheDocument();
    expect(within(tray()).getByText('Safe')).toBeInTheDocument();
    expect(within(tray()).getAllByText(/so far/).length).toBeGreaterThan(0);
    expect(within(tray()).getAllByText(/1 safe/).length).toBeGreaterThan(0);
  });

  it('caps the live tray by bytes and counts the remainder', () => {
    render(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={null} onBack={vi.fn()} />);
    const folders = Array.from({ length: 10 }, (_, index) =>
      resultRow(`C:\\Folder${index}`, `Folder${index}`, (10 - index) * 1024, 'C:\\'),
    );

    act(() => {
      ingestScanEvent({ type: 'folders', runId: 'run-1', folders });
      ingestScanEvent({
        type: 'matches',
        runId: 'run-1',
        matches: folders.map((row) => match(row.path, row.bytes, 'temp')),
      });
      flushLiveScan();
    });

    const tray = screen.getByRole('region', { name: 'Live results' });
    expect(within(tray).getAllByRole('listitem')).toHaveLength(8);
    expect(within(tray).getByText('+2 more')).toBeInTheDocument();
  });

  it('filters the live tray with the category chips', () => {
    render(<ScanView api={makeApi()} root="C:\\" runId="run-1" event={null} onBack={vi.fn()} />);

    act(() => {
      ingestScanEvent({
        type: 'categories',
        runId: 'run-1',
        categories: categoryRows([['temp', 512], ['npm-cache', 4096]]),
      });
      ingestScanEvent({
        type: 'folders',
        runId: 'run-1',
        folders: [
          resultRow('C:\\Temp', 'Temp', 512, 'C:\\'),
          resultRow('C:\\npm-cache', 'npm-cache', 4096, 'C:\\'),
        ],
      });
      ingestScanEvent({
        type: 'matches',
        runId: 'run-1',
        matches: [match('C:\\Temp', 512, 'temp'), match('C:\\npm-cache', 4096, 'npm-cache')],
      });
      flushLiveScan();
    });

    const tray = screen.getByRole('region', { name: 'Live results' });
    expect(within(tray).getByText('Temp')).toBeInTheDocument();
    expect(within(tray).getByText('npm-cache')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /npm cache/ }));
    expect(within(tray).queryByText('Temp')).toBeNull();
    expect(within(tray).getByText('npm-cache')).toBeInTheDocument();
  });

  it('fills the browse tray from the live folder stream', () => {
    render(<ScanView api={makeApi()} mode="browse" root="E:\\" runId="b1" event={null} onBack={vi.fn()} />);

    act(() => {
      ingestScanEvent({
        type: 'browse-folders',
        runId: 'b1',
        folders: [browseRow('E:\\Games', 'Games', 4096, 'E:\\')],
      });
      flushLiveScan();
    });

    const tray = screen.getByRole('region', { name: 'Live results' });
    expect(within(tray).getByText('Games')).toBeInTheDocument();
    expect(within(tray).getByText(/1 folder/)).toBeInTheDocument();
    expect(within(tray).queryByText('Safe')).toBeNull();
  });

  it('continues into Results from the live store without a loading flash', async () => {
    const getResults = vi.fn(() => new Promise<ResultsState>(() => {}));
    const api = makeApi({ getResults });
    const finished: ScanEvent = {
      type: 'finished',
      runId: 'run-1',
      status: 'complete',
      startedAt: 0,
      finishedAt: 65_000,
      filesScanned: 100,
      bytesSeen: 1024,
      errors: 0,
      projects: 1,
      reclaimableBytes: 512,
      saved: true,
    };
    const { rerender } = render(
      <ScanView api={api} root="C:\\" runId="run-1" event={null} onBack={vi.fn()} />,
    );

    act(() => {
      ingestScanEvent({ type: 'folders', runId: 'run-1', folders: [resultRow('C:\\Temp', 'Temp', 512, 'C:\\')] });
      ingestScanEvent({ type: 'matches', runId: 'run-1', matches: [match('C:\\Temp', 512, 'temp')] });
      flushLiveScan();
      ingestScanEvent(finished);
    });
    rerender(<ScanView api={api} root="C:\\" runId="run-1" event={finished} onBack={vi.fn()} />);

    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
    expect(screen.queryByText('Loading results…')).toBeNull();
  });

  it('hands off session-only results from the live store when the snapshot could not be saved', async () => {
    const getResults = vi.fn(() => new Promise<ResultsState>(() => {}));
    const api = makeApi({ getResults });
    const finished: ScanEvent = {
      type: 'finished',
      runId: 'run-1',
      status: 'complete',
      startedAt: 0,
      finishedAt: 65_000,
      filesScanned: 100,
      bytesSeen: 1024,
      errors: 0,
      projects: 1,
      reclaimableBytes: 512,
      saved: false,
    };
    const { rerender } = render(
      <ScanView api={api} root="C:\\" runId="run-1" event={null} onBack={vi.fn()} />,
    );

    act(() => {
      ingestScanEvent({ type: 'folders', runId: 'run-1', folders: [resultRow('C:\\Temp', 'Temp', 512, 'C:\\')] });
      ingestScanEvent({ type: 'matches', runId: 'run-1', matches: [match('C:\\Temp', 512, 'temp')] });
      flushLiveScan();
      ingestScanEvent(finished);
    });
    rerender(<ScanView api={api} root="C:\\" runId="run-1" event={finished} onBack={vi.fn()} />);

    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
    expect(screen.getByText(/these results are for this session only/)).toBeInTheDocument();
    expect(screen.queryByText('Loading results…')).toBeNull();
    expect(getResults).not.toHaveBeenCalled();
  });
});
