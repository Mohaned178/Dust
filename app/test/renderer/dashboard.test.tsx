import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CategoryId } from '@dust/core';
import { Dashboard } from '../../renderer/src/pages/Dashboard';
import type { DashboardState, DustApi, ResultsState, StartAnalyzeResult } from '../../src/shared/ipc';
import { makeApi, makeDashboardState, makeResultsState } from './fakes';

function okAnalyze() {
  return vi.fn(async () => ({ ok: true as const, runId: 'run-1' }));
}

function renderDashboard(
  props: {
    api?: DustApi;
    onAnalyze?: (root: string) => Promise<StartAnalyzeResult>;
    onViewResults?: (root: string, category?: CategoryId | null) => void;
    onQuickClean?: () => void;
    onOpenDevCleanup?: (root: string) => void;
    onSystemDrive?: (root: string | null) => void;
    shortcutsEnabled?: boolean;
  } = {},
) {
  const onAnalyze = props.onAnalyze ?? okAnalyze();
  render(
    <Dashboard
      api={props.api ?? makeApi()}
      onAnalyze={onAnalyze}
      onViewResults={props.onViewResults ?? vi.fn()}
      onQuickClean={props.onQuickClean ?? vi.fn()}
      onOpenDevCleanup={props.onOpenDevCleanup ?? vi.fn()}
      onSystemDrive={props.onSystemDrive}
      shortcutsEnabled={props.shortcutsEnabled}
    />,
  );
  return { onAnalyze };
}

describe('Dashboard', () => {
  it('leads with the reclaimable figure, category evidence and developer section', async () => {
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'System drive' })).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('C:\\')).toBeInTheDocument();
    expect(screen.getByText('512 MB')).toBeInTheDocument();
    expect(screen.getByText(/Reclaimable · Last analyzed/)).toBeInTheDocument();
    expect(screen.getByText('All cleanup categories, including npm projects.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Temp — 256 KB reclaimable/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /npm projects/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Other Drives' })).toBeNull();
  });

  it('shows a capacity bar in the hero and a share rail on each category card', async () => {
    renderDashboard();

    const capacity = await screen.findByRole('progressbar', { name: 'C:\\ disk usage' });
    expect(capacity).toHaveAttribute('aria-valuetext', '512 MB of 1.0 GB used');

    const temp = await screen.findByRole('button', { name: /Temp —/ });
    expect(temp).toHaveAccessibleName(/User and system temporary files/);
    expect(within(temp).getByText('User and system temporary files')).toBeInTheDocument();
    expect(within(temp).queryByRole('progressbar')).toBeNull();
  });

  it('shows the not-analyzed state and hides the results affordance on first run', async () => {
    const api = makeApi({
      getDashboard: async () => {
        const base = makeDashboardState();
        return {
          ...base,
          volumes: [
            { ...base.volumes[0], lastAnalyzedAt: null, lastCleanedAt: null, reclaimableBytes: null },
            ...base.volumes.slice(1),
          ],
        };
      },
    });
    renderDashboard({ api });

    expect(await screen.findByText('Not analyzed yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View results for C:\\' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Analyze C:\\' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-analyze C:\\' })).toBeNull();

    expect(screen.getByText('Analyze to fill these in.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reclaimable/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Developer cleanup' })).toBeNull();
    expect(screen.queryByText('Analyze to find npm projects')).toBeNull();
  });

  it('labels session-only results and still offers the hand-off when the snapshot could not be saved', async () => {
    const api = makeApi({
      getDashboard: async () => {
        const base = makeDashboardState();
        return {
          ...base,
          volumes: [{ ...base.volumes[0], sessionOnly: true }, ...base.volumes.slice(1)],
          snapshot: { ...base.snapshot, status: 'missing', finishedAt: null, reclaimableBytes: null },
        };
      },
    });
    renderDashboard({ api });

    expect(await screen.findByText(/these results are for this session only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View results for C:\\' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Temp — 256 KB reclaimable/ })).toBeInTheDocument();
  });

  it('surfaces a category load failure with a retry instead of an unanalyzed em-dash state', async () => {
    const getResults = vi
      .fn()
      .mockRejectedValueOnce(new Error('EIO: i/o error'))
      .mockResolvedValueOnce(makeResultsState());
    renderDashboard({ api: makeApi({ getResults }) });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load category details: EIO: i/o error",
    );
    expect(screen.queryByRole('button', { name: /reclaimable/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Developer cleanup' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: /Temp — 256 KB reclaimable/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Developer cleanup' })).toBeInTheDocument();
    await waitFor(() => expect(getResults).toHaveBeenCalledTimes(2));
  });

  it('shows a category skeleton while results load after analysis', async () => {
    const getResults = vi.fn(() => new Promise<ResultsState>(() => {}));
    renderDashboard({ api: makeApi({ getResults }) });

    expect(await screen.findByText('Loading category details…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reclaimable/ })).toBeNull();
  });

  it('disables and relabels the Analyze action while a scan is starting', async () => {
    let resolveAnalyze: (result: StartAnalyzeResult) => void = () => {};
    const onAnalyze = vi.fn(() => new Promise<StartAnalyzeResult>((resolve) => (resolveAnalyze = resolve)));
    const api = makeApi({
      getDashboard: async () => {
        const base = makeDashboardState();
        return {
          ...base,
          volumes: [{ ...base.volumes[0], lastAnalyzedAt: null, lastCleanedAt: null, reclaimableBytes: null }],
        };
      },
    });
    renderDashboard({ api, onAnalyze });

    const analyze = await screen.findByRole('button', { name: 'Analyze C:\\' });
    fireEvent.click(analyze);

    expect(analyze).toBeDisabled();
    expect(analyze).toHaveTextContent('Starting…');

    await act(async () => resolveAnalyze({ ok: true, runId: 'run-1' }));
  });

  it('promotes View results and demotes Analyze after analysis', async () => {
    renderDashboard();

    const viewResults = await screen.findByRole('button', { name: 'View results for C:\\' });
    expect(viewResults.className).toContain('bg-accent');
    const reAnalyze = screen.getByRole('button', { name: 'Re-analyze C:\\' });
    expect(reAnalyze.className).not.toContain('bg-accent');
    expect(screen.queryByRole('button', { name: 'Analyze C:\\' })).toBeNull();
  });

  it('shows used and free capacity beside the reclaimable figure', async () => {
    renderDashboard();

    expect(await screen.findByText('512 MB used · 512 MB free')).toBeInTheDocument();
    expect(screen.getByText('512 MB')).toBeInTheDocument();
  });

  it('keeps the never-analyzed hero action-led with no lone em-dash figure', async () => {
    const api = makeApi({
      getDashboard: async () => {
        const base = makeDashboardState();
        return {
          ...base,
          volumes: [
            { ...base.volumes[0], lastAnalyzedAt: null, lastCleanedAt: null, reclaimableBytes: null },
            ...base.volumes.slice(1),
          ],
        };
      },
    });
    renderDashboard({ api });

    const hero = (await screen.findByRole('heading', { name: 'System drive' })).closest('section');
    expect(hero).not.toBeNull();
    expect(within(hero as HTMLElement).queryByText('—')).toBeNull();
    expect(screen.getByRole('button', { name: 'Analyze C:\\' })).toBeInTheDocument();
    expect(screen.getByText('512 MB used · 512 MB free')).toBeInTheDocument();
    expect(screen.getByText('Analyze this drive to see what is safe to delete.')).toBeInTheDocument();
  });

  it('keeps hero actions and category cards reachable in visual order', async () => {
    renderDashboard();

    const viewResults = await screen.findByRole('button', { name: 'View results for C:\\' });
    const reAnalyze = screen.getByRole('button', { name: 'Re-analyze C:\\' });
    const quickClean = screen.getByRole('button', { name: 'Quick Clean for C:\\' });
    const temp = await screen.findByRole('button', { name: /Temp — 256 KB reclaimable/ });
    const order = screen.getAllByRole('button');
    expect(order.indexOf(viewResults)).toBeLessThan(order.indexOf(reAnalyze));
    expect(order.indexOf(reAnalyze)).toBeLessThan(order.indexOf(quickClean));
    expect(order.indexOf(quickClean)).toBeLessThan(order.indexOf(temp));
  });

  it('shows the documented loading skeleton while drives load', async () => {
    const getDashboard = vi.fn(() => new Promise<DashboardState>(() => {}));
    renderDashboard({ api: makeApi({ getDashboard }) });

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading volumes…')).toBeInTheDocument();
  });

  it('shows a calm titled error with retry when loading drives fails', async () => {
    const getDashboard = vi
      .fn<() => Promise<DashboardState>>()
      .mockRejectedValueOnce(new Error('EPERM: operation not permitted'))
      .mockResolvedValueOnce(makeDashboardState());
    renderDashboard({ api: makeApi({ getDashboard }) });

    expect(await screen.findByRole('heading', { name: "Couldn't load your drives." })).toBeInTheDocument();
    expect(screen.getByText('EPERM: operation not permitted')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    await waitFor(() => expect(getDashboard).toHaveBeenCalledTimes(2));
  });

  it('starts an analyze run for the system volume', async () => {
    const { onAnalyze } = renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: 'Re-analyze C:\\' }));
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith('C:\\'));
  });

  it('reports the system drive root to the shell', async () => {
    const onSystemDrive = vi.fn();
    renderDashboard({ onSystemDrive });

    await waitFor(() => expect(onSystemDrive).toHaveBeenCalledWith('C:\\'));
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

    fireEvent.click(await screen.findByRole('button', { name: 'Re-analyze C:\\' }));
    expect(await screen.findByRole('dialog', { name: 'Scan already running' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel it' }));
    await waitFor(() => expect(cancelScan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledTimes(2));
  });

  it('dismisses the scan-running dialog with Escape', async () => {
    const onAnalyze = vi.fn(async () => ({ ok: false as const, reason: 'busy' as const, running: 'analyze' as const }));
    renderDashboard({ onAnalyze });

    fireEvent.click(await screen.findByRole('button', { name: 'Re-analyze C:\\' }));
    expect(await screen.findByRole('dialog', { name: 'Scan already running' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Scan already running' })).toBeNull());
  });

  it('shows a banner when the scan cannot start', async () => {
    const onAnalyze = vi.fn(async () => ({ ok: false as const, reason: 'start-failed' as const, message: 'no worker' }));
    renderDashboard({ onAnalyze });

    fireEvent.click(await screen.findByRole('button', { name: 'Re-analyze C:\\' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start the scan: no worker');
  });

  it('shows a banner when starting the scan rejects', async () => {
    const onAnalyze = vi.fn(async () => {
      throw new Error('boom');
    });
    renderDashboard({ onAnalyze });

    fireEvent.click(await screen.findByRole('button', { name: 'Re-analyze C:\\' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start the scan: boom');
  });

  it('sets the scan start error in monospace', async () => {
    const onAnalyze = vi.fn(async () => ({ ok: false as const, reason: 'start-failed' as const, message: 'no worker' }));
    renderDashboard({ onAnalyze });

    fireEvent.click(await screen.findByRole('button', { name: 'Re-analyze C:\\' }));
    expect(await screen.findByText('no worker')).toHaveClass('font-mono');
  });

  it('sets the running scan drive path in monospace', async () => {
    renderDashboard({
      api: makeApi({
        getDashboard: async () =>
          makeDashboardState({ scan: { kind: 'analyze', root: 'C:\\', startedAt: 1 } }),
      }),
    });

    const line = await screen.findByText(/A scan is already running on/);
    expect(within(line).getByText('C:\\')).toHaveClass('font-mono');
  });

  it('opens the unfiltered results view from the hero', async () => {
    const onViewResults = vi.fn();
    renderDashboard({ onViewResults });

    fireEvent.click(await screen.findByRole('button', { name: 'View results for C:\\' }));
    expect(onViewResults).toHaveBeenCalledWith('C:\\', null);
  });

  it('opens results filtered to a category from a category card', async () => {
    const onViewResults = vi.fn();
    renderDashboard({ onViewResults });

    fireEvent.click(await screen.findByRole('button', { name: /Temp — 256 KB reclaimable/ }));
    expect(onViewResults).toHaveBeenCalledWith('C:\\', 'temp');
  });

  it('opens dev cleanup from the developer section', async () => {
    const onOpenDevCleanup = vi.fn();
    renderDashboard({ onOpenDevCleanup });

    fireEvent.click(await screen.findByRole('button', { name: /npm projects/ }));
    expect(onOpenDevCleanup).toHaveBeenCalledWith('C:\\');
  });

  it('opens quick clean from the hero', async () => {
    const onQuickClean = vi.fn();
    renderDashboard({ onQuickClean });

    fireEvent.click(await screen.findByRole('button', { name: 'Quick Clean for C:\\' }));
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
    expect(screen.getByText(/No system drive detected/)).toBeInTheDocument();
  });

  it('dismisses an informational notice for the session', async () => {
    const api = makeApi({
      getDashboard: async () => {
        const base = makeDashboardState();
        return { ...base, snapshot: { ...base.snapshot, scanStatus: 'cancelled' } };
      },
    });
    renderDashboard({ api });

    expect(await screen.findByText(/The last scan was cancelled/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/The last scan was cancelled/)).toBeNull();
  });

  it('rescans from the stale-rules notice', async () => {
    const api = makeApi({
      getDashboard: async () => {
        const base = makeDashboardState();
        return { ...base, snapshot: { ...base.snapshot, rulesStale: true } };
      },
    });
    const { onAnalyze } = renderDashboard({ api });

    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith('C:\\'));
  });

  it('shows and dismisses the keyboard shortcut hint', async () => {
    try {
      window.localStorage.removeItem('dust.dashboard.shortcuts');
    } catch {
      /* localStorage can be unavailable in the test environment */
    }
    renderDashboard();

    expect(await screen.findByText(/Shortcuts —/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss keyboard shortcuts' }));
    expect(screen.queryByText(/Shortcuts —/)).toBeNull();
  });

  it('runs actions from the dashboard keyboard shortcuts', async () => {
    const onQuickClean = vi.fn();
    const onViewResults = vi.fn();
    const onOpenDevCleanup = vi.fn();
    const { onAnalyze } = renderDashboard({ onQuickClean, onViewResults, onOpenDevCleanup });

    await screen.findByRole('button', { name: 'View results for C:\\' });
    fireEvent.keyDown(document, { key: 'a' });
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith('C:\\'));

    fireEvent.keyDown(document, { key: 'r' });
    expect(onViewResults).toHaveBeenCalledWith('C:\\', null);

    fireEvent.keyDown(document, { key: 'q' });
    expect(onQuickClean).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'd' });
    expect(onOpenDevCleanup).toHaveBeenCalledWith('C:\\');
  });

  it('ignores shortcuts with modifiers and while typing', async () => {
    const onQuickClean = vi.fn();
    renderDashboard({ onQuickClean });

    await screen.findByRole('button', { name: 'Quick Clean for C:\\' });
    fireEvent.keyDown(document, { key: 'q', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'q', metaKey: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'q' });
    input.remove();

    expect(onQuickClean).not.toHaveBeenCalled();
  });

  it('ignores shortcuts while an overlay owns the screen', async () => {
    const onQuickClean = vi.fn();
    renderDashboard({ onQuickClean, shortcutsEnabled: false });

    await screen.findByRole('button', { name: 'View results for C:\\' });
    fireEvent.keyDown(document, { key: 'q' });
    expect(onQuickClean).not.toHaveBeenCalled();
  });

  it('refreshes the relative analyzed time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 10, 12, 0, 0)));
    try {
      const api = makeApi({
        getDashboard: async () => {
          const base = makeDashboardState();
          return {
            ...base,
            volumes: [
              { ...base.volumes[0], lastAnalyzedAt: Date.UTC(2026, 0, 10, 11, 0, 0) },
              ...base.volumes.slice(1),
            ],
          };
        },
      });
      renderDashboard({ api });

      expect(await screen.findByText(/Last analyzed 1 h ago/)).toBeInTheDocument();

      vi.setSystemTime(new Date(Date.UTC(2026, 0, 10, 14, 0, 0)));
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText(/Last analyzed 3 h ago/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
