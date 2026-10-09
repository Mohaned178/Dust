import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../renderer/src/app/App';
import { prefetchHome } from '../../../renderer/src/app/launch';
import { useNavStore } from '../../../renderer/src/app/nav';
import { greetingFor } from '../../../renderer/src/pages/home/useGreeting';
import { useResultsStore } from '../../../renderer/src/stores/results';
import { useScanStore } from '../../../renderer/src/stores/scan';
import type { CategorySummaryRow, DashboardState, DustApi, ResultsCategoriesState } from '../../../src/shared/ipc';
import { makeApi, makeDashboardState } from '../../renderer/fakes';

const GB = 1024 ** 3;

function dashboard(overrides: { analyzed?: boolean; scan?: DashboardState['scan'] } = {}): DashboardState {
  const { analyzed = true, scan = null } = overrides;
  const base = makeDashboardState();
  return {
    ...base,
    scan,
    volumes: [
      {
        ...base.volumes[0]!,
        totalBytes: 237 * GB,
        freeBytes: 50 * GB,
        lastAnalyzedAt: analyzed ? Date.now() - 5 * 60_000 : null,
      },
      { ...base.volumes[1]!, root: 'E:\\', label: 'Backup', totalBytes: 64 * GB, freeBytes: 60 * GB },
    ],
  };
}

function row(category: CategorySummaryRow['category'], gb: number): CategorySummaryRow {
  return { category, label: category, bytes: Math.round(gb * GB), items: gb > 0 ? 3 : 0, ruleIds: [] };
}

function categories(
  rows: CategorySummaryRow[],
  overrides: Partial<ResultsCategoriesState> = {},
): ResultsCategoriesState {
  return {
    source: 'snapshot',
    root: 'C:\\',
    finishedAt: Date.now() - 5 * 60_000,
    status: 'complete',
    rulesStale: false,
    depthLimited: false,
    categories: rows,
    ...overrides,
  };
}

const CLEANABLE = [row('temp', 1.9), row('app-caches', 1.1), row('recycle-bin', 0.8), row('npm-cache', 0.4)];

/** A Home tile, found by its title so the sidebar's buttons are not in the way. */
function tile(title: string): HTMLElement {
  return within(screen.getByRole('main')).getByText(title, { selector: 'span' }).closest('button')!;
}

function renderHome(overrides: Partial<DustApi> = {}) {
  const api = makeApi({
    getDashboard: async () => dashboard(),
    getResultCategories: async () => categories([...CLEANABLE, row('npm-projects', 5.2)]),
    ...overrides,
  });
  render(<App api={api} />);
  return api;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Home hero', () => {
  it('shows the safe total, traced to its rows, and opens Clean up', async () => {
    const user = userEvent.setup();
    renderHome();
    const headline = await screen.findByRole('heading', { level: 2, name: /can be freed$/ });
    // 1.9 + 1.1 + 0.8 + 0.4 GB. The npm projects (5.2 GB) belong to the Developer section, not this figure.
    expect(headline).toHaveTextContent('4.2 GB');

    expect(screen.getByRole('group', { name: 'Space used on C:\\' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Temporary files\s*1\.9 GB$/ })).toBeInTheDocument();
    expect(screen.getByText('Everything else')).toBeInTheDocument();
    expect(screen.getByText('187 GB of 237 GB used')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Choose what to clean' }));
    expect(useNavStore.getState().page).toBe('cleanup');
    expect(useNavStore.getState().params.cleanup).toEqual({ view: 'results', root: 'C:\\' });
  });

  it('jumps to a category from the legend', async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole('heading', { level: 2, name: /can be freed$/ });
    await user.click(screen.getByRole('button', { name: /Recycle Bin/ }));
    expect(useNavStore.getState().params.cleanup).toEqual({ view: 'results', root: 'C:\\', category: 'recycle-bin' });
  });

  it('invites a first scan when the drive has never been scanned', async () => {
    const user = userEvent.setup();
    const startAnalyze = vi.fn(async () => ({ ok: true as const, runId: 'run-9' }));
    renderHome({ getDashboard: async () => dashboard({ analyzed: false }), startAnalyze });
    expect(await screen.findByRole('heading', { level: 2, name: 'Find out what can be freed on C:\\' })).toBeVisible();
    expect(screen.queryByText('can be freed')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Scan C:\\' }));
    expect(startAnalyze).toHaveBeenCalledWith('C:\\');
    await waitFor(() => expect(useNavStore.getState().page).toBe('cleanup'));
    expect(useNavStore.getState().params.cleanup).toEqual({
      view: 'scan',
      root: 'C:\\',
      runId: 'run-9',
      usedBytes: 187 * GB,
    });
  });

  it('shows progress while a scan is running and links to it', async () => {
    const user = userEvent.setup();
    renderHome({ getDashboard: async () => dashboard({ analyzed: false }) });
    await screen.findByRole('heading', { level: 2, name: /Find out what can be freed/ });

    act(() => {
      useScanStore.getState().applyPatches(
        new Map([
          [
            'run-3',
            {
              root: 'C:\\',
              progress: {
                filesScanned: 645_475,
                bytesSeen: 93 * GB,
                currentPath: 'C:\\Windows',
                dirsCompleted: 1,
                errors: 0,
                elapsedMs: 1000,
              },
            },
          ],
        ]),
      );
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Scanning C:\\' })).toBeVisible();
    expect(screen.getByText('645,475 files checked so far.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Scanning C:\\' })).toHaveAttribute('aria-valuenow', '50');

    await user.click(screen.getByRole('button', { name: 'See progress' }));
    expect(useNavStore.getState().params.cleanup).toMatchObject({ view: 'scan', runId: 'run-3' });
  });

  it('knows about a scan that began before Dust opened', async () => {
    renderHome({
      getDashboard: async () => dashboard({ scan: { kind: 'analyze', root: 'C:\\', startedAt: Date.now() - 1000 } }),
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Scanning C:\\' })).toBeVisible();
    // Its run id is unknown, so there is nothing to open.
    expect(screen.queryByRole('button', { name: 'See progress' })).not.toBeInTheDocument();
  });

  it('says so when there is nothing to clean', async () => {
    renderHome({
      getResultCategories: async () => categories(CLEANABLE.map((entry) => ({ ...entry, bytes: 0, items: 0 }))),
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'C:\\ is in good shape.' })).toBeVisible();
    expect(screen.getByText(/Nothing to clean right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Clean up \d/ })).not.toBeInTheDocument();
  });

  it('warns when the figures come from a cancelled scan', async () => {
    renderHome({ getResultCategories: async () => categories(CLEANABLE, { status: 'cancelled', rulesStale: true }) });
    await screen.findByRole('heading', { level: 2, name: /can be freed$/ });
    expect(screen.getByText(/last scan was cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/cleanup rules changed/)).toBeInTheDocument();
  });

  it('offers a retry when the drives cannot be read', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderHome({
      getDashboard: async () => {
        if (fail) throw new Error('No answer');
        return dashboard();
      },
    });
    expect(await screen.findByText('Dust could not read your drives')).toBeVisible();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 2, name: /can be freed$/ })).toBeVisible();
  });

  it('lists the other drives with how full they are', async () => {
    renderHome();
    expect(await screen.findByText('E:\\ · Backup')).toBeInTheDocument();
    expect(screen.getByText('4.0 GB used · 60 GB free of 64 GB')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Space used on E:\\' })).toBeInTheDocument();
  });
});

describe('Home while the scan totals load', () => {
  it('shows the drive and a placeholder figure at once, then the total', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderHome({
      getResultCategories: async () => {
        await gate;
        return categories(CLEANABLE);
      },
    });
    // Everything known from the drive list is on screen while the backend reads the last scan.
    expect(await screen.findByText(/C:\\ · last checked/)).toBeVisible();
    expect(screen.getByText('187 GB of 237 GB used')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeVisible();
    expect(screen.queryByText('can be freed')).not.toBeInTheDocument();

    release();
    expect(await screen.findByRole('heading', { level: 2, name: /can be freed$/ })).toBeVisible();
  });

  it('says so when the last scan cannot be read, and still offers a new one', async () => {
    renderHome({
      getResultCategories: async () => {
        throw new Error('Snapshot unreadable');
      },
    });
    expect(await screen.findByText('Dust could not read the results of the last scan.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeEnabled();
  });
});

describe('prefetch', () => {
  it('asks for the scan totals as soon as the drive list shows a scanned system drive', async () => {
    const getResultCategories = vi.fn(async () => categories(CLEANABLE));
    const api = makeApi({ getDashboard: async () => dashboard(), getResultCategories });
    await prefetchHome(api);
    expect(getResultCategories).toHaveBeenCalledWith('C:\\');
    expect(useResultsStore.getState().categories['c:\\']?.data?.categories).toHaveLength(4);
  });

  it('leaves the totals alone for a drive that was never scanned', async () => {
    const getResultCategories = vi.fn(async () => categories(CLEANABLE));
    await prefetchHome(makeApi({ getDashboard: async () => dashboard({ analyzed: false }), getResultCategories }));
    expect(getResultCategories).not.toHaveBeenCalled();
  });
});

describe('starting a scan', () => {
  it('asks before stopping a running scan, then retries once it is stopped', async () => {
    const user = userEvent.setup();
    const startAnalyze = vi
      .fn<DustApi['startAnalyze']>()
      .mockResolvedValueOnce({ ok: false, reason: 'busy', running: 'analyze' })
      .mockResolvedValueOnce({ ok: true, runId: 'run-2' });
    const cancelScan = vi.fn(async () => {});
    renderHome({ startAnalyze, cancelScan });

    await screen.findByRole('heading', { level: 2, name: /can be freed$/ });
    await user.click(screen.getByRole('button', { name: 'Scan again' }));
    const dialog = await screen.findByRole('dialog', { name: 'A scan is already running.' });
    expect(cancelScan).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel it and scan' }));
    await waitFor(() => expect(useNavStore.getState().page).toBe('cleanup'));
    expect(cancelScan).toHaveBeenCalledTimes(1);
    expect(startAnalyze).toHaveBeenCalledTimes(2);
    expect(useNavStore.getState().params.cleanup).toMatchObject({ view: 'scan', runId: 'run-2' });
  });

  it('leaves the running scan alone when the user chooses to wait', async () => {
    const user = userEvent.setup();
    const cancelScan = vi.fn(async () => {});
    renderHome({
      startAnalyze: async () => ({ ok: false, reason: 'busy', running: 'analyze' }),
      cancelScan,
    });
    await screen.findByRole('heading', { level: 2, name: /can be freed$/ });
    await user.click(screen.getByRole('button', { name: 'Scan again' }));
    await user.click(await screen.findByRole('button', { name: 'Wait' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(cancelScan).not.toHaveBeenCalled();
    expect(useNavStore.getState().page).toBe('home');
  });

  it('explains a start that fails', async () => {
    const user = userEvent.setup();
    renderHome({
      startAnalyze: async () => ({ ok: false, reason: 'start-failed', message: 'The disk is not ready.' }),
    });
    await screen.findByRole('heading', { level: 2, name: /can be freed$/ });
    await user.click(screen.getByRole('button', { name: 'Scan again' }));
    expect(await screen.findByText(/Dust could not start the scan: The disk is not ready\./)).toBeVisible();
    expect(useNavStore.getState().page).toBe('home');
  });
});

describe('Home tiles', () => {
  it('fill in as their own data arrives, one at a time', async () => {
    let releaseStartup: () => void = () => {};
    const startupGate = new Promise<void>((resolve) => {
      releaseStartup = resolve;
    });
    const base = makeApi();
    renderHome({
      getStartup: async () => {
        await startupGate;
        return base.getStartup();
      },
      listUninstallApps: async () => ({
        ok: true,
        apps: Array.from({ length: 142 }, (_, index) => ({ ...makeAppFixture(), id: `app-${index}` })),
        trusted: true,
        elevated: false,
        loadedAt: 0,
      }),
    });

    // Apps and PC Health have answered while Startup is still waiting.
    expect(await screen.findByText('142')).toBeVisible();
    expect(screen.getByText('apps installed')).toBeVisible();
    expect(await screen.findByText('58%')).toBeVisible();
    expect(screen.getByText(/CPU 12%/)).toBeVisible();
    const startupTile = tile('Startup');
    expect(within(startupTile).queryByText(/start with Windows/)).not.toBeInTheDocument();

    releaseStartup();
    expect(await within(startupTile).findByText(/start with Windows/)).toBeVisible();
  });

  it('say so when a source cannot be read, without hiding the rest', async () => {
    renderHome({ listUninstallApps: async () => ({ ok: false, message: 'Registry unavailable' }) });
    await screen.findByRole('heading', { level: 2, name: /can be freed$/ });
    const appsTile = tile('Apps');
    expect(await within(appsTile).findByText('Unavailable right now')).toBeVisible();
    expect(await screen.findByText('58%')).toBeVisible();
  });

  it('total the project caches in the Developer tile and open the page', async () => {
    const user = userEvent.setup();
    const { makeDevProject, makeDevCleanupState } = await import('../../renderer/fakes');
    renderHome({
      getDevCleanup: async (root) =>
        makeDevCleanupState({
          root,
          groups: [
            {
              id: 'dead',
              label: 'Not used',
              projects: [
                makeDevProject({ path: 'C:\\a', offered: true, nodeModulesBytes: 3 * GB }),
                makeDevProject({ path: 'C:\\b', offered: true, nodeModulesBytes: 2 * GB }),
                makeDevProject({ path: 'C:\\c', offered: false, nodeModulesBytes: 9 * GB }),
              ],
            },
          ],
        }),
    });
    const developerTile = tile('Developer');
    expect(await within(developerTile).findByText('5.0 GB')).toBeVisible();
    await user.click(developerTile);
    expect(useNavStore.getState().page).toBe('developer');
    expect(useNavStore.getState().params.developer).toEqual({ root: 'C:\\' });
  });

  it('keep reading memory and CPU while Home is open', async () => {
    const getSystemInfoLive = vi.fn(async () => ({
      cpuPercent: 12,
      memTotalBytes: 100,
      memUsedBytes: 40,
      memAvailableBytes: 60,
    }));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    renderHome({ getSystemInfoLive });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getSystemInfoLive).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getSystemInfoLive).toHaveBeenCalledTimes(2);
  });
});

describe('greeting', () => {
  it('follows the time of day', () => {
    expect(greetingFor(new Date(2026, 0, 1, 7))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 0, 1, 12))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 0, 1, 17, 59))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 0, 1, 18))).toBe('Good evening');
  });
});

function makeAppFixture() {
  return {
    id: 'app',
    displayName: 'App',
    publisher: 'Publisher',
    version: '1',
    installLocation: 'C:\\App',
    estimatedSizeKb: null,
    sizeBytes: null,
    iconDataUrl: null,
    hive: 'hkcu' as const,
    kind: 'exe' as const,
    requiresAdmin: false,
    hasUninstaller: true,
    caution: null,
  };
}
