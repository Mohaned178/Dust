import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DrivesView } from '../../renderer/src/pages/DrivesView';
import type { DustApi, StartAnalyzeResult } from '../../src/shared/ipc';
import { makeApi, makeDashboardState } from './fakes';

function renderDrives(
  props: {
    api?: DustApi;
    onBrowse?: (root: string) => Promise<StartAnalyzeResult>;
  } = {},
) {
  const onBrowse = props.onBrowse ?? vi.fn(async () => ({ ok: true as const, runId: 'browse-1' }));
  render(<DrivesView api={props.api ?? makeApi()} onBrowse={onBrowse} />);
  return { onBrowse };
}

describe('DrivesView', () => {
  it('lists only non-system volumes and browses one', async () => {
    const { onBrowse } = renderDrives();

    expect(await screen.findByRole('heading', { name: 'Drives' })).toBeInTheDocument();
    expect(screen.getByText('E:\\')).toBeInTheDocument();
    expect(screen.queryByText('C:\\')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Browse E:\\' }));
    await waitFor(() => expect(onBrowse).toHaveBeenCalledWith('E:\\'));
  });

  it('says so when there are no other drives', async () => {
    const api = makeApi({
      getDashboard: async () =>
        makeDashboardState({
          volumes: [makeDashboardState().volumes[0]],
        }),
    });
    renderDrives({ api });

    expect(await screen.findByText('No other drives.')).toBeInTheDocument();
  });

  it('offers cancel-or-wait when another scan holds the lock', async () => {
    const onBrowse = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'busy', running: 'analyze' })
      .mockResolvedValueOnce({ ok: true, runId: 'browse-2' });
    const cancelScan = vi.fn(async () => {});
    renderDrives({ api: makeApi({ cancelScan }), onBrowse });

    fireEvent.click(await screen.findByRole('button', { name: 'Browse E:\\' }));
    expect(await screen.findByRole('dialog', { name: 'Scan already running' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel it' }));
    await waitFor(() => expect(cancelScan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onBrowse).toHaveBeenCalledTimes(2));
  });
});
