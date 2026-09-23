import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../renderer/src/pages/Dashboard';
import type { DustApi, StartAnalyzeResult } from '../../src/shared/ipc';
import { makeApi, makeDashboardState } from './fakes';

function okAnalyze() {
  return vi.fn(async () => ({ ok: true as const, runId: 'run-1' }));
}

function okBrowse() {
  return vi.fn(async () => ({ ok: true as const, runId: 'browse-1' }));
}

function renderDashboard(
  props: {
    api?: DustApi;
    onAnalyze?: (root: string) => Promise<StartAnalyzeResult>;
    onBrowse?: (root: string) => Promise<StartAnalyzeResult>;
    onViewResults?: (root: string) => void;
    onQuickClean?: () => void;
  } = {},
) {
  const onAnalyze = props.onAnalyze ?? okAnalyze();
  const onBrowse = props.onBrowse ?? okBrowse();
  render(
    <Dashboard
      api={props.api ?? makeApi()}
      onAnalyze={onAnalyze}
      onBrowse={onBrowse}
      onViewResults={props.onViewResults ?? vi.fn()}
      onQuickClean={props.onQuickClean ?? vi.fn()}
    />,
  );
  return { onAnalyze, onBrowse };
}

describe('Dashboard', () => {
  it('renders volume cards with usage, external labels and snapshot age', async () => {
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Dust' })).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('E:\\')).toBeInTheDocument();
    expect(screen.getByText('external')).toBeInTheDocument();
    expect(screen.getByText(/Last analyzed .* reclaimable/)).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('starts an analyze run for the system volume', async () => {
    const { onAnalyze } = renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: 'Analyze C:\\' }));
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith('C:\\'));
  });

  it('starts a browse run for a non-system volume', async () => {
    const { onBrowse, onAnalyze } = renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: 'Browse E:\\' }));

    await waitFor(() => expect(onBrowse).toHaveBeenCalledWith('E:\\'));
    expect(onAnalyze).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Analyze E:\\' })).toBeNull();
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
    renderDashboard({ api });

    expect(await screen.findByText(/Snapshot unreadable/)).toBeInTheDocument();
  });

  it('offers cancel-or-wait when another scan holds the lock', async () => {
    const onAnalyze = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'busy', running: 'analyze' })
      .mockResolvedValueOnce({ ok: true, runId: 'run-2' });
    const cancelScan = vi.fn(async () => {});
    renderDashboard({ api: makeApi({ cancelScan }), onAnalyze });

    fireEvent.click(await screen.findByRole('button', { name: 'Analyze C:\\' }));
    expect(await screen.findByRole('dialog', { name: 'Scan already running' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel it' }));
    await waitFor(() => expect(cancelScan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledTimes(2));
  });

  it('shows a banner when the scan cannot start', async () => {
    const onAnalyze = vi.fn(async () => ({ ok: false as const, reason: 'start-failed' as const, message: 'no worker' }));
    renderDashboard({ onAnalyze });

    fireEvent.click(await screen.findByRole('button', { name: 'Analyze C:\\' }));
    expect(await screen.findByText(/Could not start the scan: no worker/)).toBeInTheDocument();
  });

  it('shows a banner when starting the scan rejects', async () => {
    const onAnalyze = vi.fn(async () => {
      throw new Error('boom');
    });
    renderDashboard({ onAnalyze });

    fireEvent.click(await screen.findByRole('button', { name: 'Analyze C:\\' }));
    expect(await screen.findByText(/Could not start the scan: boom/)).toBeInTheDocument();
  });

  it('opens the results view for an analyzed volume', async () => {
    const onViewResults = vi.fn();
    renderDashboard({ onViewResults });

    fireEvent.click(await screen.findByRole('button', { name: 'View results for C:\\' }));
    expect(onViewResults).toHaveBeenCalledWith('C:\\');
    expect(screen.queryByRole('button', { name: 'View results for E:\\' })).toBeNull();
  });

  it('opens quick clean from the dashboard', async () => {
    const onQuickClean = vi.fn();
    renderDashboard({ onQuickClean });

    fireEvent.click(await screen.findByRole('button', { name: 'Quick Clean' }));
    expect(onQuickClean).toHaveBeenCalledTimes(1);
  });

  it('disables quick clean when there is no system volume', async () => {
    const api = makeApi({
      getDashboard: async () =>
        makeDashboardState({
          volumes: [
            {
              root: 'E:\\',
              label: null,
              driveType: 'removable',
              role: 'browse',
              external: true,
              totalBytes: 100,
              freeBytes: 50,
              lastAnalyzedAt: null,
              lastCleanedAt: null,
              reclaimableBytes: null,
            },
          ],
        }),
    });
    renderDashboard({ api });

    const button = await screen.findByRole('button', { name: 'Quick Clean' });
    expect(button).toBeDisabled();
  });
});
