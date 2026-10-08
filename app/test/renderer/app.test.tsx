import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../renderer/src/App';
import { finishedEvent, makeApi, makeCategories, makeResultsState, makeScanBus } from './fakes';

describe('App', () => {
  it('moves from Home through a scan, cancels, and lands on the results', async () => {
    const bus = makeScanBus();
    const cancelScan = vi.fn(async () => {});
    const api = makeApi({ cancelScan, onScanEvent: bus.onScanEvent });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scan C:\\' }));
    expect(await screen.findByRole('heading', { name: 'C:\\' })).toBeInTheDocument();
    expect(screen.getByText('Scanning')).toBeInTheDocument();

    act(() => {
      bus.emit({
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

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelScan).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();

    act(() => bus.emit(finishedEvent('run-1', 'cancelled')));
    expect(await screen.findByRole('heading', { name: /Results for C:/ })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '← Home' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('still reaches the results when finished is emitted before startAnalyze resolves', async () => {
    const bus = makeScanBus();
    const getResults = vi.fn(async (root: string) => makeResultsState({ root }));
    const api = makeApi({
      getResults,
      onScanEvent: bus.onScanEvent,
      startAnalyze: async () => {
        bus.emit({ type: 'started', runId: 'run-fast', root: 'C:\\', startedAt: 0 });
        bus.emit(finishedEvent('run-fast'));
        return { ok: true, runId: 'run-fast' };
      },
    });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scan C:\\' }));
    expect(await screen.findByRole('heading', { name: /Results for C:/ })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
    expect(getResults).toHaveBeenCalledWith('C:\\');
  });

  it('returns Home with the failure when failed is emitted before startAnalyze resolves', async () => {
    const bus = makeScanBus();
    const api = makeApi({
      onScanEvent: bus.onScanEvent,
      startAnalyze: async () => {
        bus.emit({ type: 'failed', runId: 'run-bad', message: 'disk went away' });
        return { ok: true, runId: 'run-bad' };
      },
    });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scan C:\\' }));
    expect(await screen.findByText(/The scan stopped: disk went away/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('shows Finishing… instead of Cancel once the scan is finalizing', async () => {
    const bus = makeScanBus();
    const api = makeApi({ onScanEvent: bus.onScanEvent });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scan C:\\' }));
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeEnabled();

    act(() => bus.emit({ type: 'finalizing', runId: 'run-1' }));
    expect(screen.getByRole('button', { name: 'Finishing…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('replays finalizing seen before the scan screen mounted', async () => {
    const bus = makeScanBus();
    const api = makeApi({
      onScanEvent: bus.onScanEvent,
      startAnalyze: async () => {
        bus.emit({ type: 'finalizing', runId: 'run-late' });
        return { ok: true, runId: 'run-late' };
      },
    });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scan C:\\' }));
    expect(await screen.findByRole('button', { name: 'Finishing…' })).toBeDisabled();
  });

  it('keeps Home and offers to wait or cancel when a scan is already running', async () => {
    const api = makeApi({ startAnalyze: async () => ({ ok: false, reason: 'busy', running: 'analyze' }) });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scan C:\\' }));
    expect(await screen.findByText('A scan is already running.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('opens the results view from the drive card', async () => {
    const getResults = vi.fn(async (root: string) => makeResultsState({ root }));
    const api = makeApi({ getResults });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Results' }));
    expect(await screen.findByRole('heading', { name: /Results for C:/ })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'Select Temp' })).toBeInTheDocument();
    expect(getResults).toHaveBeenCalledWith('C:\\');

    fireEvent.click(screen.getByRole('button', { name: '← Home' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('rescans from the results page', async () => {
    const startAnalyze = vi.fn(async () => ({ ok: true as const, runId: 'run-2' }));
    const api = makeApi({ startAnalyze });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Results' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    await waitFor(() => expect(startAnalyze).toHaveBeenCalledWith('C:\\'));
    expect(await screen.findByText('Scanning')).toBeInTheDocument();
  });

  it('opens the results view filtered to a ready-to-clean category', async () => {
    const api = makeApi();
    render(<App api={api} />);

    const ready = await screen.findByRole('region', { name: 'Ready to clean' });
    expect(ready).toHaveTextContent('Ready to clean on C:\\');
    fireEvent.click(await screen.findByRole('button', { name: /^Temp/ }));
    expect(await screen.findByRole('heading', { name: /Results for C:/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Temp/, pressed: true })).toBeInTheDocument();
  });

  it('opens Quick Clean from Ready to clean', async () => {
    const api = makeApi();
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Review and clean' }));
    expect(await screen.findByRole('dialog', { name: 'Quick Clean' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quick Clean' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('opens settings from the sidebar', async () => {
    const api = makeApi();
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });

  it('opens Dev Cleanup from the results category strip', async () => {
    const categories = makeCategories().map((row) =>
      row.category === 'npm-projects' ? { ...row, bytes: 4096, items: 1, ruleIds: ['npm-project-modules'] } : row,
    );
    const api = makeApi({ getResults: async (root) => makeResultsState({ root, categories }) });
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Results' }));
    fireEvent.click(await screen.findByRole('button', { name: /npm projects/ }));

    expect(await screen.findByRole('heading', { name: 'Dev Cleanup' })).toBeInTheDocument();
    expect(await screen.findByText('dead-app')).toBeInTheDocument();
  });

  it('opens Developer cleanup from the sidebar once the system drive is known', async () => {
    const api = makeApi();
    render(<App api={api} />);

    const item = screen.getByRole('button', { name: 'Developer cleanup' });
    await waitFor(() => expect(item).toBeEnabled());
    fireEvent.click(item);
    expect(await screen.findByRole('heading', { name: 'Dev Cleanup' })).toBeInTheDocument();
  });

  it('opens System Info from the sidebar', async () => {
    const api = makeApi();
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'System info' }));
    expect(await screen.findByRole('heading', { name: 'System Info' })).toBeInTheDocument();
    expect(await screen.findByText('Windows 11 Pro 25H2')).toBeInTheDocument();
  });
});
