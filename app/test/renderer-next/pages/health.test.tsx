import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../renderer-next/src/app/App';
import { useNavStore } from '../../../renderer-next/src/app/nav';
import { LIVE_POLL_MS } from '../../../renderer-next/src/pages/health/HealthPage';
import type { DustApi } from '../../../src/shared/ipc';
import { makeApi, makeDashboardState, makeSystemInfo, makeSystemInfoLive } from '../../renderer/fakes';

const GB = 1024 ** 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openHealth(overrides: Partial<DustApi> = {}) {
  const api = makeApi({
    getSystemInfoLive: async () =>
      makeSystemInfoLive({
        cpuPercent: 12.4,
        memTotalBytes: 16 * GB,
        memUsedBytes: 10 * GB,
        memAvailableBytes: 6 * GB,
      }),
    ...overrides,
  });
  render(<App api={api} />);
  act(() => useNavStore.getState().navigate('health'));
  await screen.findByRole('heading', { level: 1, name: 'PC Health' });
  return api;
}

const card = (title: string) => screen.getByRole('heading', { name: title }).closest('.rounded-overlay')!;

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('PC Health', () => {
  it('shows what the PC is doing and what it is made of, with no score', async () => {
    await openHealth();
    expect(await screen.findByRole('img', { name: 'Processor in use, 12%' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Memory in use, 63%' })).toBeInTheDocument();
    expect(screen.getByText('10 GB of 16 GB')).toBeInTheDocument();
    expect(screen.getByText('Across 16 threads')).toBeInTheDocument();

    const specs = await screen.findByRole('region', { name: 'Specs' });
    expect(within(specs).getByText('dev-machine')).toBeInTheDocument();
    expect(within(specs).getByText('Windows 11 Pro 25H2')).toBeInTheDocument();
    expect(within(specs).getByText('AMD Ryzen 7 5800X')).toBeInTheDocument();
    expect(within(specs).getByText('NVIDIA GeForce RTX 4070')).toBeInTheDocument();
    expect(within(specs).getByText('560.94')).toBeInTheDocument();
    expect(within(specs).getByText('8 GB')).toBeInTheDocument();
    expect(within(specs).getByText('ASUSTeK COMPUTER INC. ROG STRIX B550-F GAMING')).toBeInTheDocument();
    expect(within(specs).getByText('2803 (2023-04-12)')).toBeInTheDocument();
    expect(screen.queryByText(/score|System Info|issues|at risk/i)).toBeNull();
  });

  it("lists the PC's own drives, not removable ones", async () => {
    await openHealth();
    const storage = await screen.findByRole('region', { name: 'Storage' });
    expect(within(storage).getByText('C:')).toBeInTheDocument();
    expect(within(storage).getByText('512 MB of 1.0 GB used')).toBeInTheDocument();
    expect(within(storage).getByRole('group', { name: 'C: used space' })).toBeInTheDocument();
    expect(within(storage).queryByText('E:')).not.toBeInTheDocument();
  });

  it('gives each card its own placeholder, and fills in the graphics when they arrive', async () => {
    let calls = 0;
    const getSystemInfo = vi.fn<DustApi['getSystemInfo']>(async () => {
      calls += 1;
      return calls < 3
        ? makeSystemInfo({ hardwarePending: true, gpus: [] })
        : makeSystemInfo({ hardwarePending: false });
    });
    await openHealth({ getSystemInfo });
    const specs = await screen.findByRole('region', { name: 'Specs' });
    // Everything else is there while the graphics card still says it is loading.
    await within(specs).findByText('AMD Ryzen 7 5800X');
    expect(card('Graphics')).toHaveAttribute('aria-busy', 'true');
    expect(card('Processor')).not.toHaveAttribute('aria-busy');
    await waitFor(() => expect(within(specs).getByText('NVIDIA GeForce RTX 4070')).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(card('Graphics')).not.toHaveAttribute('aria-busy');
    expect(getSystemInfo.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('marks video memory that Windows may have misreported', async () => {
    await openHealth({
      getSystemInfo: async () =>
        makeSystemInfo({ gpus: [{ name: 'Big GPU', driverVersion: null, vramBytes: 4 * GB, vramUncertain: true }] }),
    });
    expect(await screen.findByLabelText(/May be inaccurate for GPUs with more than 4 GB/)).toBeInTheDocument();
  });

  it('says so when hardware details are not available, and leaves out the cards it has nothing for', async () => {
    await openHealth({
      getSystemInfo: async () =>
        makeSystemInfo({ hardwareAvailable: false, cpu: null, gpus: [], board: null, bios: null }),
    });
    expect(await screen.findByText('Hardware details are not available on this PC.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Processor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Graphics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Firmware' })).not.toBeInTheDocument();
  });

  it('retries a failed read, and keeps the last details when a refresh fails', async () => {
    const user = userEvent.setup();
    const getSystemInfo = vi
      .fn<DustApi['getSystemInfo']>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(makeSystemInfo())
      .mockRejectedValue(new Error('later'));
    await openHealth({ getSystemInfo });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('AMD Ryzen 7 5800X')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/Dust could not refresh these details/)).toBeInTheDocument();
    expect(screen.getByText('AMD Ryzen 7 5800X')).toBeInTheDocument();
  });

  it('refresh reads everything again', async () => {
    const user = userEvent.setup();
    const getSystemInfo = vi.fn<DustApi['getSystemInfo']>(async () => makeSystemInfo());
    const getDashboard = vi.fn<DustApi['getDashboard']>(async () => makeDashboardState());
    await openHealth({ getSystemInfo, getDashboard });
    await screen.findByText('AMD Ryzen 7 5800X');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(getSystemInfo).toHaveBeenCalledWith(true));
    expect(getDashboard.mock.calls.length).toBeGreaterThan(1);
  });

  it('copies the specs as plain text and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await openHealth();
    await screen.findByText('AMD Ryzen 7 5800X');
    await user.click(screen.getByRole('button', { name: 'Copy specs' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toMatch(/^Dust PC specs\nCaptured: 2026-09-27 14:32/);
    expect(text).toContain('CPU: AMD Ryzen 7 5800X (8 cores / 16 threads)');
    expect(text).toMatch(/Disk C: \(System\): 512 MB used of 1\.0 GB/);
    expect(await screen.findByText('Specs copied')).toBeInTheDocument();
  });
});

describe('PC Health polling', () => {
  it('reads memory and processor use on a timer while the page is open, and not while another page is', async () => {
    const getSystemInfoLive = vi.fn<DustApi['getSystemInfoLive']>(async () => makeSystemInfoLive());
    await openHealth({ getSystemInfoLive });
    await screen.findByRole('img', { name: /Memory in use/ });
    const opened = getSystemInfoLive.mock.calls.length;

    // It keeps reading while the page is on screen.
    await sleep(LIVE_POLL_MS + 400);
    const whileOpen = getSystemInfoLive.mock.calls.length;
    expect(whileOpen).toBeGreaterThan(opened);

    // Another page (not Home, which has its own, slower reading) is open: nothing is read for several rounds.
    act(() => useNavStore.getState().navigate('settings'));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const settled = getSystemInfoLive.mock.calls.length;
    await sleep(LIVE_POLL_MS * 2 + 400);
    expect(getSystemInfoLive.mock.calls.length).toBe(settled);

    // Coming back reads again straight away and carries on.
    act(() => useNavStore.getState().navigate('health'));
    await waitFor(() => expect(getSystemInfoLive.mock.calls.length).toBeGreaterThan(settled));
    const back = getSystemInfoLive.mock.calls.length;
    await sleep(LIVE_POLL_MS + 400);
    expect(getSystemInfoLive.mock.calls.length).toBeGreaterThan(back);
  }, 30_000);
});
