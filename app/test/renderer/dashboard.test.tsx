import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../renderer/src/pages/Dashboard';
import { makeApi, makeDashboardState } from './fakes';

function okAnalyze() {
  return vi.fn(async () => ({ ok: true as const, runId: 'run-1' }));
}

describe('Dashboard', () => {
  it('renders volume cards with usage, external labels and snapshot age', async () => {
    render(<Dashboard api={makeApi()} onAnalyze={okAnalyze()} onViewResults={vi.fn()} onQuickClean={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Dust' })).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('E:\\')).toBeInTheDocument();
    expect(screen.getByText('external')).toBeInTheDocument();
    expect(screen.getByText(/Last analyzed .* reclaimable/)).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('starts an analyze run for the clicked volume', async () => {
    const onAnalyze = okAnalyze();
    render(<Dashboard api={makeApi()} onAnalyze={onAnalyze} onViewResults={vi.fn()} onQuickClean={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Analyze C:\\' }));
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith('C:\\'));
  });

  it('surfaces snapshot corruption', async () => {
    const api = makeApi({
      getDashboard: async () =>
        makeDashboardState({
          snapshot: {
            status: 'corrupt',
            reason: 'invalid-json',
            root: null,
            finishedAt: null,
            scanStatus: null,
            reclaimableBytes: null,
            cleanedAt: null,
            rulesStale: false,
          },
        }),
    });
    render(<Dashboard api={api} onAnalyze={okAnalyze()} onViewResults={vi.fn()} onQuickClean={vi.fn()} />);

    expect(await screen.findByText(/Snapshot unreadable/)).toBeInTheDocument();
  });

  it('offers cancel-or-wait when another scan holds the lock', async () => {
    const onAnalyze = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'busy', running: 'analyze' })
      .mockResolvedValueOnce({ ok: true, runId: 'run-2' });
    const cancelScan = vi.fn(async () => {});
    render(<Dashboard api={makeApi({ cancelScan })} onAnalyze={onAnalyze} onViewResults={vi.fn()} onQuickClean={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Analyze C:\\' }));
    expect(await screen.findByRole('dialog', { name: 'Scan already running' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel it' }));
    await waitFor(() => expect(cancelScan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledTimes(2));
  });

  it('shows a banner when the scan cannot start', async () => {
    const onAnalyze = vi.fn(async () => ({ ok: false as const, reason: 'start-failed' as const, message: 'no worker' }));
    render(<Dashboard api={makeApi()} onAnalyze={onAnalyze} onViewResults={vi.fn()} onQuickClean={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Analyze C:\\' }));
    expect(await screen.findByText(/Could not start the scan: no worker/)).toBeInTheDocument();
  });

  it('shows a banner when starting the scan rejects', async () => {
    const onAnalyze = vi.fn(async () => {
      throw new Error('boom');
    });
    render(<Dashboard api={makeApi()} onAnalyze={onAnalyze} onViewResults={vi.fn()} onQuickClean={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Analyze C:\\' }));
    expect(await screen.findByText(/Could not start the scan: boom/)).toBeInTheDocument();
  });

  it('opens the results view for an analyzed volume', async () => {
    const onViewResults = vi.fn();
    render(<Dashboard api={makeApi()} onAnalyze={okAnalyze()} onViewResults={onViewResults} onQuickClean={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View results for C:\\' }));
    expect(onViewResults).toHaveBeenCalledWith('C:\\');
    expect(screen.queryByRole('button', { name: 'View results for E:\\' })).toBeNull();
  });

  it('opens quick clean from the dashboard', async () => {
    const onQuickClean = vi.fn();
    render(
      <Dashboard api={makeApi()} onAnalyze={okAnalyze()} onViewResults={vi.fn()} onQuickClean={onQuickClean} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Quick Clean' }));
    expect(onQuickClean).toHaveBeenCalledTimes(1);
  });
});
