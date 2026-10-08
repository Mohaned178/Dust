import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemInfoView } from '../../renderer/src/pages/SystemInfoView';
import { VRAM_CAVEAT } from '../../renderer/src/system-info';
import { makeApi, makeSystemInfo, makeSystemInfoLive } from './fakes';

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SystemInfoView', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the static snapshot and the live cluster', async () => {
    render(<SystemInfoView api={makeApi()} />);
    await flush();

    expect(screen.getByRole('heading', { name: 'System Info' })).toBeInTheDocument();
    expect(screen.getByText('2026-09-27 14:32')).toBeInTheDocument();
    expect(screen.getByText('Windows 11 Pro 25H2')).toBeInTheDocument();
    expect(screen.getByText('26200.9457')).toBeInTheDocument();
    expect(screen.getByText('x64')).toBeInTheDocument();
    expect(screen.getByText('dev-machine')).toBeInTheDocument();
    expect(screen.getByText('2d 4h')).toBeInTheDocument();

    const processor = screen.getByRole('region', { name: 'Processor' });
    expect(within(processor).getByText('AMD Ryzen 7 5800X')).toBeInTheDocument();
    expect(within(processor).getByText('8')).toBeInTheDocument();
    expect(within(processor).getByText('16')).toBeInTheDocument();

    const graphics = screen.getByRole('region', { name: 'Graphics' });
    expect(within(graphics).getByText('NVIDIA GeForce RTX 4070')).toBeInTheDocument();
    expect(within(graphics).getByText('560.94')).toBeInTheDocument();
    expect(within(graphics).getByText('8 GB')).toBeInTheDocument();
    expect(within(graphics).queryByTitle(VRAM_CAVEAT)).toBeNull();

    const firmware = screen.getByRole('region', { name: 'Firmware' });
    expect(within(firmware).getByText('ASUSTeK COMPUTER INC. ROG STRIX B550-F GAMING')).toBeInTheDocument();
    expect(within(firmware).getByText('2803 (2023-04-12)')).toBeInTheDocument();

    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText('18.4 GB used of 32 GB')).toBeInTheDocument();
    expect(screen.queryByText('Hardware details unavailable on this machine.')).toBeNull();
  });

  it('omits missing sections and shows the hardware notice when the query failed', async () => {
    render(
      <SystemInfoView
        api={makeApi({
          getSystemInfo: async () =>
            makeSystemInfo({
              hardwareAvailable: false,
              cpu: null,
              gpus: [],
              board: null,
              bios: null,
            }),
        })}
      />,
    );
    await flush();

    expect(screen.getByText('Hardware details unavailable on this machine.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'This PC' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Processor' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Graphics' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Firmware' })).toBeNull();
  });

  it('omits rows for missing values instead of printing placeholders', async () => {
    render(
      <SystemInfoView
        api={makeApi({
          getSystemInfo: async () =>
            makeSystemInfo({
              os: { name: null, version: null, build: null, arch: null },
              hostname: null,
              uptimeMs: null,
            }),
        })}
      />,
    );
    await flush();

    expect(screen.queryByRole('region', { name: 'This PC' })).toBeNull();
    expect(screen.queryByText('Unknown')).toBeNull();
  });

  it('marks uncertain VRAM with an asterisk and the caveat tooltip', async () => {
    render(
      <SystemInfoView
        api={makeApi({
          getSystemInfo: async () =>
            makeSystemInfo({
              gpus: [
                {
                  name: 'AMD Radeon Graphics',
                  driverVersion: '31.0.21914.1001',
                  vramBytes: 4293918720,
                  vramUncertain: true,
                },
              ],
            }),
        })}
      />,
    );
    await flush();

    const graphics = screen.getByRole('region', { name: 'Graphics' });
    expect(within(graphics).getByText('4 GB')).toBeInTheDocument();
    const asterisk = within(graphics).getByTitle(VRAM_CAVEAT);
    expect(asterisk).toHaveTextContent('*');
  });

  it('omits the VRAM row when no source reports it', async () => {
    render(
      <SystemInfoView
        api={makeApi({
          getSystemInfo: async () =>
            makeSystemInfo({
              gpus: [
                {
                  name: 'Microsoft Basic Display Adapter',
                  driverVersion: null,
                  vramBytes: null,
                  vramUncertain: false,
                },
              ],
            }),
        })}
      />,
    );
    await flush();

    const graphics = screen.getByRole('region', { name: 'Graphics' });
    expect(within(graphics).getByText('Microsoft Basic Display Adapter')).toBeInTheDocument();
    expect(within(graphics).queryByText('VRAM')).toBeNull();
    expect(within(graphics).queryByTitle(VRAM_CAVEAT)).toBeNull();
  });

  it('polls live values while mounted and stops on unmount', async () => {
    vi.useFakeTimers();
    const getSystemInfoLive = vi
      .fn()
      .mockResolvedValueOnce(makeSystemInfoLive({ cpuPercent: 10 }))
      .mockResolvedValueOnce(makeSystemInfoLive({ cpuPercent: 40 }));
    const { unmount } = render(<SystemInfoView api={makeApi({ getSystemInfoLive })} />);
    await flush();

    expect(screen.getByText('10%')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flush();
    expect(screen.getByText('40%')).toBeInTheDocument();

    const calls = getSystemInfoLive.mock.calls.length;
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(4500);
    });
    expect(getSystemInfoLive.mock.calls.length).toBe(calls);
  });

  it('lists fixed volumes under Storage and leaves out removable ones', async () => {
    render(<SystemInfoView api={makeApi()} />);
    await flush();

    const storage = screen.getByRole('region', { name: 'Storage' });
    expect(within(storage).getByText('C:')).toBeInTheDocument();
    expect(within(storage).getByText('System')).toBeInTheDocument();
    expect(within(storage).getByText('512 MB of 1.0 GB')).toBeInTheDocument();
    expect(within(storage).getByRole('meter', { name: 'C: used space' })).toBeInTheDocument();
    expect(within(storage).queryByText('E:')).toBeNull();
  });

  it('omits Storage when the dashboard cannot be read', async () => {
    render(
      <SystemInfoView
        api={makeApi({
          getDashboard: async () => {
            throw new Error('no volumes');
          },
        })}
      />,
    );
    await flush();

    expect(screen.getByRole('region', { name: 'This PC' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Storage' })).toBeNull();
  });

  describe('visibility', () => {
    function setVisibility(state: 'visible' | 'hidden') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    }

    afterEach(() => {
      Reflect.deleteProperty(document, 'visibilityState');
      Reflect.deleteProperty(document, 'hidden');
    });

    it('pauses live polling while the window is hidden and resumes with an immediate poll', async () => {
      vi.useFakeTimers();
      const getSystemInfoLive = vi.fn(async () => makeSystemInfoLive());
      render(<SystemInfoView api={makeApi({ getSystemInfoLive })} />);
      await flush();

      expect(getSystemInfoLive).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(getSystemInfoLive).toHaveBeenCalledTimes(2);

      await act(async () => {
        setVisibility('hidden');
      });
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(getSystemInfoLive).toHaveBeenCalledTimes(2);

      await act(async () => {
        setVisibility('visible');
      });
      expect(getSystemInfoLive).toHaveBeenCalledTimes(3);
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(getSystemInfoLive).toHaveBeenCalledTimes(4);
    });

    it('does not start polling when the window is already hidden', async () => {
      vi.useFakeTimers();
      setVisibility('hidden');
      const getSystemInfoLive = vi.fn(async () => makeSystemInfoLive());
      render(<SystemInfoView api={makeApi({ getSystemInfoLive })} />);
      await flush();

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(getSystemInfoLive).not.toHaveBeenCalled();
    });
  });

  it('refreshes the snapshot on demand', async () => {
    const getSystemInfo = vi.fn(async (force?: boolean) =>
      makeSystemInfo({
        capturedAt: force === true ? new Date(2026, 8, 28, 9, 15).getTime() : new Date(2026, 8, 27, 14, 32).getTime(),
      }),
    );
    render(<SystemInfoView api={makeApi({ getSystemInfo })} />);
    await flush();

    expect(screen.getByText('2026-09-27 14:32')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();

    expect(getSystemInfo).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('2026-09-28 09:15')).toBeInTheDocument();
  });

  it('copies the report and shows the toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SystemInfoView api={makeApi()} />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Copy system info' }));
    await flush();

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text).toContain('OS: Windows 11 Pro 25H2 (Build 26200.9457)');
    expect(text).toContain('CPU: AMD Ryzen 7 5800X (8 cores / 16 threads)');
    expect(text).toContain('RAM: 32 GB total · 18.4 GB used');
    expect(text).toContain('GPU: NVIDIA GeForce RTX 4070 (Driver 560.94, VRAM 8 GB)');
    expect(text).toContain('Disk C:');
    expect(text).not.toContain('E:');
    expect(screen.getByRole('status')).toHaveTextContent('System info copied.');
  });
});
